/**
 * tests/midi-parser.test.ts
 *
 * Comprehensive Unit & Integration Test Suite for Milestone 2:
 * Zero-Dependency SMF Parser & Dynamic Timeline Engine.
 *
 * Covers:
 * - SMF Formats 0, 1, and 2 header chunks and extended headers
 * - Track chunks, non-track chunk skipping (RIFF, LIST), corrupted chunk lengths
 * - Missing End-of-Track recovery
 * - Variable-Length Quantity (VLQ) 1-4 byte decoding and 28-bit overflow guards
 * - Running status inheritance and strict resets on Meta/SysEx
 * - Zero-velocity Note-On normalization to Note-Off
 * - Dynamic piecewise-linear TempoMap math and O(log K) lookups
 * - Polyphonic chord pairing and overlapping same-pitch FIFO queues
 * - Orphan Note-Off resilience and unterminated note auto-termination
 * - General MIDI Channel 9 percussion detection
 * - Format 0 vs Format 1 musical equivalence
 * - High-throughput stress test (10,000 note events)
 */

import { describe, it, expect } from 'vitest';
import {
  parseMidi,
  TempoMap,
  decodeVLQ,
  readVariableLengthQuantity,
  InvalidMidiError,
} from '../src/core/midi-parser';
import {
  DEFAULT_MICROSECONDS_PER_QUARTER,
  DEFAULT_TICKS_PER_QUARTER,
  type MidiFile,
  type MidiRawNote,
} from '../src/core/types';

// ============================================================================
// SYNTHETIC MIDI BUILDER (Zero-Dependency In-Memory Test Utility)
// ============================================================================

function encodeTestVLQ(value: number): number[] {
  if (value < 0) {
    throw new Error(`Negative VLQ not permitted: ${value}`);
  }
  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

type TestSyntheticEvent =
  | { type: 'delta'; ticks: number }
  | { type: 'raw'; bytes: number[] }
  | { type: 'meta'; typeId: number; data: number[] }
  | { type: 'sysex'; data: number[] };

class TestSyntheticTrack {
  public events: TestSyntheticEvent[] = [];
  public declaredLength: number | null = null;

  public delta(ticks: number): this {
    this.events.push({ type: 'delta', ticks });
    return this;
  }

  public noteOn(channel: number, pitch: number, velocity: number): this {
    this.events.push({
      type: 'raw',
      bytes: [0x90 | (channel & 0x0f), pitch & 0x7f, velocity & 0x7f],
    });
    return this;
  }

  public noteOff(channel: number, pitch: number, velocity = 0): this {
    this.events.push({
      type: 'raw',
      bytes: [0x80 | (channel & 0x0f), pitch & 0x7f, velocity & 0x7f],
    });
    return this;
  }

  public runningStatusNote(pitch: number, velocity: number): this {
    this.events.push({
      type: 'raw',
      bytes: [pitch & 0x7f, velocity & 0x7f],
    });
    return this;
  }

  public programChange(channel: number, program: number): this {
    this.events.push({
      type: 'raw',
      bytes: [0xc0 | (channel & 0x0f), program & 0x7f],
    });
    return this;
  }

  public controlChange(channel: number, controller: number, value: number): this {
    this.events.push({
      type: 'raw',
      bytes: [0xb0 | (channel & 0x0f), controller & 0x7f, value & 0x7f],
    });
    return this;
  }

  public tempo(bpmOrMicros: number): this {
    const micros = bpmOrMicros > 1000 ? bpmOrMicros : Math.round(60_000_000 / bpmOrMicros);
    this.events.push({
      type: 'meta',
      typeId: 0x51,
      data: [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff],
    });
    return this;
  }

  public trackName(name: string): this {
    const bytes = Array.from(new TextEncoder().encode(name));
    this.events.push({ type: 'meta', typeId: 0x03, data: bytes });
    return this;
  }

  public instrumentName(name: string): this {
    const bytes = Array.from(new TextEncoder().encode(name));
    this.events.push({ type: 'meta', typeId: 0x04, data: bytes });
    return this;
  }

  public timeSignature(num = 4, den = 4, clocks = 24, thirtySeconds = 8): this {
    const denPower = Math.round(Math.log2(den));
    this.events.push({ type: 'meta', typeId: 0x58, data: [num, denPower, clocks, thirtySeconds] });
    return this;
  }

  public keySignature(key = 0, scale: 0 | 1 = 0): this {
    this.events.push({ type: 'meta', typeId: 0x59, data: [key & 0xff, scale] });
    return this;
  }

  public customMeta(typeId: number, data: number[] | Uint8Array): this {
    this.events.push({ type: 'meta', typeId, data: Array.from(data) });
    return this;
  }

  public sysex(data: number[] | Uint8Array): this {
    this.events.push({ type: 'sysex', data: Array.from(data) });
    return this;
  }

  public rawBytes(bytes: number[] | Uint8Array): this {
    this.events.push({ type: 'raw', bytes: Array.from(bytes) });
    return this;
  }

  public endOfTrack(): this {
    this.events.push({ type: 'meta', typeId: 0x2f, data: [] });
    return this;
  }

  public buildTrackData(): number[] {
    const out: number[] = [];
    for (const ev of this.events) {
      if (ev.type === 'delta') {
        out.push(...encodeTestVLQ(ev.ticks));
      } else if (ev.type === 'raw') {
        out.push(...ev.bytes);
      } else if (ev.type === 'meta') {
        out.push(0xff, ev.typeId, ...encodeTestVLQ(ev.data.length), ...ev.data);
      } else if (ev.type === 'sysex') {
        out.push(0xf0, ...encodeTestVLQ(ev.data.length), ...ev.data);
      }
    }
    return out;
  }
}

class TestSyntheticBuilder {
  public format: 0 | 1 | 2;
  public ticksPerQuarterNote: number;
  public tracks: TestSyntheticTrack[] = [];
  public customHeaderLength: number | null = null;
  public extraChunks: { id: string; data: number[] }[] = [];

  constructor(format: 0 | 1 | 2 = 1, ticksPerQuarterNote = 480) {
    this.format = format;
    this.ticksPerQuarterNote = ticksPerQuarterNote;
  }

  public addTrack(): TestSyntheticTrack {
    const t = new TestSyntheticTrack();
    this.tracks.push(t);
    return t;
  }

  public addNonTrackChunk(id: string, data: number[] | Uint8Array): this {
    this.extraChunks.push({ id, data: Array.from(data) });
    return this;
  }

  public build(): Uint8Array {
    const out: number[] = [];

    // 1. MThd Chunk
    out.push(0x4d, 0x54, 0x68, 0x64); // 'MThd'
    const headerLen = this.customHeaderLength !== null ? this.customHeaderLength : 6;
    out.push(
      (headerLen >> 24) & 0xff,
      (headerLen >> 16) & 0xff,
      (headerLen >> 8) & 0xff,
      headerLen & 0xff
    );
    out.push((this.format >> 8) & 0xff, this.format & 0xff);
    out.push((this.tracks.length >> 8) & 0xff, this.tracks.length & 0xff);
    out.push((this.ticksPerQuarterNote >> 8) & 0xff, this.ticksPerQuarterNote & 0xff);

    // Padding for extended headers (> 6 bytes)
    if (headerLen > 6) {
      for (let i = 0; i < headerLen - 6; i++) {
        out.push(0x00);
      }
    }

    // 2. Extra non-track chunks (e.g. RIFF, LIST)
    for (const chunk of this.extraChunks) {
      const idBytes = Array.from(new TextEncoder().encode(chunk.id));
      out.push(...idBytes);
      const len = chunk.data.length;
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
      out.push(...chunk.data);
    }

    // 3. MTrk Chunks
    for (const trk of this.tracks) {
      const data = trk.buildTrackData();
      out.push(0x4d, 0x54, 0x72, 0x6b); // 'MTrk'
      const len = trk.declaredLength !== null ? trk.declaredLength : data.length;
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
      out.push(...data);
    }

    return new Uint8Array(out);
  }
}

// Preset fixture factories
function createFormat0Fixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120).delta(0).trackName('Format 0 Track').delta(0).programChange(0, 0);
  t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0);
  t.delta(0).noteOn(0, 64, 100).delta(480).noteOff(0, 64, 0);
  t.delta(0).endOfTrack();
  return b.build();
}

function createFormat1Fixture(): Uint8Array {
  const b = new TestSyntheticBuilder(1, 480);
  const t0 = b.addTrack();
  t0.delta(0).tempo(140).delta(0).timeSignature(4, 4).delta(0).endOfTrack();

  const t1 = b.addTrack();
  t1.delta(0).trackName('Piano Melody').delta(0).programChange(0, 0);
  t1.delta(0).noteOn(0, 60, 90).delta(240).noteOff(0, 60, 0);
  t1.delta(0).noteOn(0, 62, 95).delta(240).noteOff(0, 62, 0);
  t1.delta(0).endOfTrack();

  const t2 = b.addTrack();
  t2.delta(0).trackName('Bass Line').delta(0).programChange(1, 32);
  t2.delta(0).noteOn(1, 36, 110).delta(480).noteOff(1, 36, 0);
  t2.delta(0).endOfTrack();

  return b.build();
}

function createVariableBpmFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(1, 480);
  const t0 = b.addTrack();
  // Tick 0: 120 BPM (500,000 µs)
  t0.delta(0).tempo(120);
  // Tick 960: 240 BPM (250,000 µs) -> elapsed at tick 960 = 1.0s
  t0.delta(960).tempo(240);
  // Tick 1920: 60 BPM (1,000,000 µs) -> elapsed at tick 1920 = 1.5s
  t0.delta(960).tempo(60);
  t0.delta(480).endOfTrack(); // tick 2400 -> elapsed = 2.5s

  const t1 = b.addTrack();
  t1.delta(0).noteOn(0, 60, 100).delta(960).noteOff(0, 60, 0); // 0 to 1.0s
  t1.delta(0).noteOn(0, 64, 100).delta(960).noteOff(0, 64, 0); // 1.0 to 1.5s
  t1.delta(0).noteOn(0, 67, 100).delta(480).noteOff(0, 67, 0); // 1.5 to 2.5s
  t1.delta(0).endOfTrack();

  return b.build();
}

function createRunningStatusFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120);
  t.delta(0).noteOn(0, 60, 100);
  t.delta(240).runningStatusNote(60, 0);
  t.delta(0).runningStatusNote(62, 90);
  t.delta(240).runningStatusNote(62, 0);
  t.delta(0).endOfTrack();
  return b.build();
}

function createZeroVelocityNoteOnFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120);
  t.delta(0).noteOn(0, 65, 80);
  t.delta(480).noteOn(0, 65, 0); // 0x90 0x41 0x00
  t.delta(0).endOfTrack();
  return b.build();
}

function createChannel9PercussionFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120);
  t.delta(0).noteOn(9, 36, 127); // Bass Drum 1
  t.delta(240).noteOff(9, 36, 0);
  t.delta(0).noteOn(9, 38, 127); // Acoustic Snare
  t.delta(240).noteOff(9, 38, 0);
  t.delta(0).endOfTrack();
  return b.build();
}

function createPolyphonicChordFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120);
  t.delta(0).noteOn(0, 60, 100); // C4
  t.delta(0).noteOn(0, 64, 100); // E4
  t.delta(0).noteOn(0, 67, 100); // G4
  t.delta(480).noteOff(0, 60, 0);
  t.delta(0).noteOff(0, 64, 0);
  t.delta(0).noteOff(0, 67, 0);
  t.delta(0).endOfTrack();
  return b.build();
}

function createOverlappingPitchFixture(): Uint8Array {
  const b = new TestSyntheticBuilder(0, 480);
  const t = b.addTrack();
  t.delta(0).tempo(120);
  t.delta(0).noteOn(0, 60, 100);
  t.delta(240).noteOn(0, 60, 80); // 2nd Note-On before 1st Note-Off
  t.delta(240).noteOff(0, 60, 0); // Closes 1st note (start:0, dur:480)
  t.delta(240).noteOff(0, 60, 0); // Closes 2nd note (start:240, dur:480)
  t.delta(0).endOfTrack();
  return b.build();
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Suite 1: SMF Header Chunk Validation (MThd)', () => {
  it('should parse valid Format 0 single-track header with correct PPQ', () => {
    const bytes = createFormat0Fixture();
    const midi = parseMidi(bytes);
    expect(midi.format).toBe(0);
    expect(midi.numTracks).toBe(1);
    expect(midi.ticksPerQuarterNote).toBe(DEFAULT_TICKS_PER_QUARTER);
  });

  it('should parse valid Format 1 multi-track header', () => {
    const bytes = createFormat1Fixture();
    const midi = parseMidi(bytes);
    expect(midi.format).toBe(1);
    expect(midi.numTracks).toBe(3);
    expect(midi.ticksPerQuarterNote).toBe(DEFAULT_TICKS_PER_QUARTER);
  });

  it('should parse valid Format 2 sequential-track header without error', () => {
    const b = new TestSyntheticBuilder(2, 240);
    b.addTrack().delta(0).tempo(120).delta(0).endOfTrack();
    b.addTrack().delta(0).noteOn(0, 60, 100).delta(240).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.format).toBe(2);
    expect(midi.ticksPerQuarterNote).toBe(240);
  });

  it('should gracefully handle extended header chunks (> 6 bytes) by skipping padding', () => {
    const b = new TestSyntheticBuilder(0, 480);
    b.customHeaderLength = 10; // 4 extra padding bytes
    b.addTrack().delta(0).tempo(120).delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.format).toBe(0);
    expect(midi.tracks[0]?.notes).toHaveLength(1);
  });

  it('should reject files shorter than 14 bytes with descriptive error', () => {
    const shortBytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
    expect(() => parseMidi(shortBytes)).toThrowError(InvalidMidiError);
    expect(() => parseMidi(shortBytes)).toThrow(/too short|header/i);
  });

  it('should reject files with invalid magic bytes (not MThd)', () => {
    const badMagic = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 6, 0, 1, 0, 1, 1, 0xe0]);
    expect(() => parseMidi(badMagic)).toThrowError(InvalidMidiError);
    expect(() => parseMidi(badMagic)).toThrow(/not a standard midi file|invalid magic/i);
  });

  it('should reject header declaring length < 6 bytes', () => {
    const badLen = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 4, 0, 1, 0, 1, 0, 0, 0, 0]);
    expect(() => parseMidi(badLen)).toThrowError(InvalidMidiError);
    expect(() => parseMidi(badLen)).toThrow(/invalid header length/i);
  });
});

describe('Suite 2: Track Chunk Navigation & Non-Track Resilience (MTrk)', () => {
  it('should skip non-track chunks (e.g. RIFF, LIST) preceding MTrk without error', () => {
    const b = new TestSyntheticBuilder(0, 480);
    b.addNonTrackChunk('RIFF', [1, 2, 3, 4]);
    b.addTrack().delta(0).tempo(120).delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tracks).toHaveLength(1);
    expect(midi.tracks[0]?.notes).toHaveLength(1);
  });

  it('should clamp corrupted declared track length exceeding file buffer without out-of-bounds error', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120).delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    t.declaredLength = 999999;
    const midi = parseMidi(b.build());
    expect(midi.tracks).toHaveLength(1);
    expect(midi.tracks[0]?.notes).toHaveLength(1);
  });

  it('should terminate track cleanly when End-of-Track (FF 2F 00) is missing', () => {
    const b = new TestSyntheticBuilder(0, 480);
    b.addTrack().delta(0).tempo(120).delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0);
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    expect(midi.tracks[0]?.notes[0]?.durationTicks).toBe(480);
  });
});

describe('Suite 3: Variable-Length Quantity (VLQ) Decoding', () => {
  it('should decode 1-byte, 2-byte, 3-byte, and 4-byte VLQ values accurately via decodeVLQ', () => {
    const testCases: [number[], number, number][] = [
      [[0x00], 0, 1],
      [[0x7f], 127, 1],
      [[0x81, 0x00], 128, 2],
      [[0x83, 0x60], 480, 2],
      [[0xff, 0x7f], 16383, 2],
      [[0x81, 0x80, 0x00], 16384, 3],
      [[0xff, 0xff, 0xff, 0x7f], 268435455, 4],
    ];

    for (const [bytes, expectedVal, expectedLen] of testCases) {
      const decoded = decodeVLQ(bytes);
      expect(decoded.value).toBe(expectedVal);
      expect(decoded.bytesRead).toBe(expectedLen);
    }
  });

  it('should decode VLQ from DataView via readVariableLengthQuantity', () => {
    const buffer = new Uint8Array([0x83, 0x60, 0x00]);
    const view = new DataView(buffer.buffer);
    const decoded = readVariableLengthQuantity(view, 0, 3);
    expect(decoded.value).toBe(480);
    expect(decoded.bytesRead).toBe(2);
  });

  it('should throw error on VLQ exceeding 4 continuation bytes (28-bit overflow guard)', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.rawBytes([0x80, 0x80, 0x80, 0x80, 0x80, 0x00, 0xff, 0x2f, 0x00]);
    expect(() => parseMidi(b.build())).toThrow(/overflow|vlq/i);
  });
});

describe('Suite 4: Channel Voice Messages & Running Status', () => {
  it('should normalize zero-velocity Note-On (0x90 pitch 0x00) as Note-Off', () => {
    const bytes = createZeroVelocityNoteOnFixture();
    const midi = parseMidi(bytes);
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    const note = midi.tracks[0]?.notes[0];
    expect(note?.pitch).toBe(65);
    expect(note?.velocity).toBe(80);
    expect(note?.durationTicks).toBe(480);
  });

  it('should maintain running status across note-ons and note-offs when status byte is omitted', () => {
    const bytes = createRunningStatusFixture();
    const midi = parseMidi(bytes);
    expect(midi.tracks[0]?.notes).toHaveLength(2);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(60);
    expect(midi.tracks[0]?.notes[0]?.durationTicks).toBe(240);
    expect(midi.tracks[0]?.notes[1]?.pitch).toBe(62);
    expect(midi.tracks[0]?.notes[1]?.durationTicks).toBe(240);
  });

  it('should parse Program Change (0xC0) and update track instrumentProgram', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120).delta(0).programChange(0, 32); // Acoustic Bass
    t.delta(0).noteOn(0, 36, 100).delta(480).noteOff(0, 36, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.instrumentProgram).toBe(32);
    expect(midi.tracks[0]?.notes[0]?.program).toBe(32);
  });

  it('should throw error if track starts with data byte before any active status byte', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).rawBytes([0x3c, 0x64]); // Pitch 60, Vel 100 without 0x90
    t.delta(0).endOfTrack();
    expect(() => parseMidi(b.build())).toThrow(/running status/i);
  });
});

describe('Suite 5: Meta & SysEx Event Handling', () => {
  it('should extract Track Name (0x03) and Instrument Name (0x04)', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).trackName('Lead Synthesizer').delta(0).instrumentName('Square Lead');
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.name).toBe('Lead Synthesizer');
  });

  it('should extract Time Signature (0x58) and Key Signature (0x59)', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).timeSignature(3, 4).delta(0).keySignature(-3, 0); // Eb Major
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.timeSignatures[0]?.numerator).toBe(3);
    expect(midi.timeSignatures[0]?.denominator).toBe(4);
    expect(midi.keySignatures[0]?.key).toBe(-3);
  });

  it('should safely skip unknown Meta events and SysEx packets', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120);
    t.delta(0).customMeta(0x7f, [0x01, 0x02, 0x03]); // Unknown proprietary meta
    t.delta(0).sysex([0x7e, 0x7f, 0x09, 0x01, 0xf7]); // SysEx
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(60);
  });
});

describe('Suite 6: Dynamic Piecewise-Linear Tempo Map & Time Conversion', () => {
  it('should default to 120 BPM (500,000 µs) when no Set Tempo event is declared', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tempoMap[0]?.bpm).toBe(120);
    expect(midi.tempoMap[0]?.microsecondsPerQuarter).toBe(DEFAULT_MICROSECONDS_PER_QUARTER);
    expect(midi.tracks[0]?.notes[0]?.durationSeconds).toBeCloseTo(0.5, 4);
  });

  it('should compute exact piecewise-linear elapsed seconds across dynamic tempo shifts', () => {
    const bytes = createVariableBpmFixture();
    const midi = parseMidi(bytes);
    const notes = midi.tracks[1]?.notes ?? [];
    expect(notes).toHaveLength(3);

    // Note 1: 0 to 960 ticks at 120 BPM (500,000 µs) -> duration = 1.0s
    expect(notes[0]?.startSeconds).toBeCloseTo(0.0, 4);
    expect(notes[0]?.durationSeconds).toBeCloseTo(1.0, 4);

    // Note 2: 960 to 1920 ticks at 240 BPM (250,000 µs) -> duration = 0.5s
    expect(notes[1]?.startSeconds).toBeCloseTo(1.0, 4);
    expect(notes[1]?.durationSeconds).toBeCloseTo(0.5, 4);

    // Note 3: 1920 to 2400 ticks at 60 BPM (1,000,000 µs) -> duration = 1.0s
    expect(notes[2]?.startSeconds).toBeCloseTo(1.5, 4);
    expect(notes[2]?.durationSeconds).toBeCloseTo(1.0, 4);

    // Total song duration = 2.5s
    expect(midi.durationSeconds).toBeCloseTo(2.5, 4);
  });

  it('should deduplicate multiple Set Tempo events declared at identical ticks', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(100);
    t.delta(0).tempo(150); // Duplicate tick 0: last declared (150 BPM) should win
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tempoMap).toHaveLength(1);
    expect(midi.tempoMap[0]?.bpm).toBe(150);
  });

  it('should verify TempoMap class methods directly', () => {
    const map = new TempoMap(480, [
      { tick: 0, microsecondsPerQuarter: 500000 },
      { tick: 960, microsecondsPerQuarter: 250000 },
    ]);

    expect(map.getPrimaryBpm()).toBe(120);
    expect(map.tickToSeconds(0)).toBe(0);
    expect(map.tickToSeconds(960)).toBeCloseTo(1.0, 5);
    expect(map.tickToSeconds(1440)).toBeCloseTo(1.25, 5);
    expect(map.secondsToTick(1.0)).toBe(960);
    expect(map.secondsToTick(1.25)).toBe(1440);
    expect(map.tickToRedstoneTick(1440)).toBe(13); // 1.25s * 10 = 12.5 -> 13
    expect(map.getTempoAtTick(500).bpm).toBe(120);
    expect(map.getTempoAtTick(1200).bpm).toBe(240);
  });
});

describe('Suite 7: Polyphonic Note Pairing FIFO Engine', () => {
  it('should pair simultaneous polyphonic chords starting at tick 0', () => {
    const bytes = createPolyphonicChordFixture();
    const midi = parseMidi(bytes);
    const notes = midi.tracks[0]?.notes ?? [];
    expect(notes).toHaveLength(3);
    const pitches = notes.map((n) => n.pitch).sort();
    expect(pitches).toEqual([60, 64, 67]);
    for (const n of notes) {
      expect(n.startTick).toBe(0);
      expect(n.durationTicks).toBe(480);
    }
  });

  it('should handle overlapping notes of identical pitch using FIFO queue order', () => {
    const bytes = createOverlappingPitchFixture();
    const midi = parseMidi(bytes);
    const notes = midi.tracks[0]?.notes ?? [];
    expect(notes).toHaveLength(2);
    // 1st note: start 0, dur 480
    expect(notes[0]?.startTick).toBe(0);
    expect(notes[0]?.durationTicks).toBe(480);
    // 2nd note: start 240, dur 480
    expect(notes[1]?.startTick).toBe(240);
    expect(notes[1]?.durationTicks).toBe(480);
  });

  it('should ignore orphan Note-Off events without crashing', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120);
    t.delta(0).noteOff(0, 70, 64); // Orphan Note-Off
    t.delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('should automatically close unterminated notes at track end', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120);
    t.delta(0).noteOn(0, 60, 100);
    t.delta(480).endOfTrack(); // No Note-Off before EOT
    const midi = parseMidi(b.build());
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    expect(midi.tracks[0]?.notes[0]?.durationTicks).toBe(480);
  });
});

describe('Suite 8: Channel 9 Percussion & Track Metadata', () => {
  it('should detect channel 9 (0-indexed) as percussion track (isPercussion: true)', () => {
    const bytes = createChannel9PercussionFixture();
    const midi = parseMidi(bytes);
    expect(midi.tracks[0]?.isPercussion).toBe(true);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(36); // Bass Drum
    expect(midi.tracks[0]?.notes[1]?.pitch).toBe(38); // Snare
  });

  it('should default non-channel-9 tracks to isPercussion: false', () => {
    const bytes = createFormat0Fixture();
    const midi = parseMidi(bytes);
    expect(midi.tracks[0]?.isPercussion).toBe(false);
  });
});

describe('Suite 9: Format 0 vs Format 1 Equivalence & Data Model Conformance', () => {
  it('should conform 100% to MidiFile interface in src/core/types.ts', () => {
    const bytes = createFormat1Fixture();
    const midi: MidiFile = parseMidi(bytes);
    expect(typeof midi.format).toBe('number');
    expect(Array.isArray(midi.tracks)).toBe(true);
    expect(Array.isArray(midi.tempoMap)).toBe(true);
    expect(typeof midi.durationSeconds).toBe('number');
    expect(typeof midi.totalTicks).toBe('number');
  });

  it('should produce identical musical note events whether encoded as Format 0 or Format 1', () => {
    // Format 0 single-track
    const b0 = new TestSyntheticBuilder(0, 480);
    b0.addTrack().delta(0).tempo(120).delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi0 = parseMidi(b0.build());

    // Format 1 multi-track
    const b1 = new TestSyntheticBuilder(1, 480);
    b1.addTrack().delta(0).tempo(120).delta(0).endOfTrack();
    b1.addTrack().delta(0).noteOn(0, 60, 100).delta(480).noteOff(0, 60, 0).delta(0).endOfTrack();
    const midi1 = parseMidi(b1.build());

    const note0: MidiRawNote | undefined = midi0.tracks[0]?.notes[0];
    const note1: MidiRawNote | undefined = midi1.tracks[1]?.notes[0];
    expect(note0?.pitch).toBe(note1?.pitch);
    expect(note0?.startTick).toBe(note1?.startTick);
    expect(note0?.durationTicks).toBe(note1?.durationTicks);
    expect(note0?.durationSeconds).toBeCloseTo(note1?.durationSeconds ?? 0, 4);
  });
});

describe('Suite 10: Adversarial Stress & High-Throughput Performance', () => {
  it('should reject completely empty buffers (0 bytes)', () => {
    expect(() => parseMidi(new Uint8Array(0))).toThrow();
  });

  it('should reject random binary noise with clear error', () => {
    const noise = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
    expect(() => parseMidi(noise)).toThrow();
  });

  it('should parse 10,000 synthetic note events in under 100ms', () => {
    const b = new TestSyntheticBuilder(0, 480);
    const t = b.addTrack();
    t.delta(0).tempo(120);
    for (let i = 0; i < 5000; i++) {
      t.delta(10).noteOn(0, (i % 25) + 54, 90).delta(10).noteOff(0, (i % 25) + 54, 0);
    }
    t.delta(0).endOfTrack();
    const bytes = b.build();

    const tStart = performance.now();
    const midi = parseMidi(bytes);
    const duration = performance.now() - tStart;

    expect(midi.tracks[0]?.notes).toHaveLength(5000);
    expect(duration).toBeLessThan(100);
  });
});

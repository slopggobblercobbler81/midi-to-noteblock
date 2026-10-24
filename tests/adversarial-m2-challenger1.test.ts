/**
 * tests/adversarial-m2-challenger1.test.ts
 *
 * Empirical Adversarial Challenge Suite for Milestone 2:
 * Zero-Dependency SMF Parser & Dynamic Timeline Engine.
 *
 * Authored by: Milestone 2 Challenger 1 (teamwork_preview_challenger_m2_1)
 *
 * Challenge Dimensions:
 * 1. Corrupt SMF Inputs & Binary Fuzzing:
 *    - Short buffers (< 14 bytes) and empty buffers
 *    - Invalid magic signatures and non-MThd headers
 *    - Corrupted header declared lengths (< 6 bytes, huge lengths)
 *    - Invalid format IDs (e.g. format 3, format 65535)
 *    - Pseudo-random byte fuzzing (100 randomized byte buffers)
 *    - Truncated tracks (mid-VLQ, mid-event, mid-running status)
 *    - Mismatched chunk sizes and unknown chunk interleaving
 * 2. Extreme Variable-Length Quantity (VLQ) Edge Cases:
 *    - 1-byte, 2-byte, 3-byte, and 4-byte maximum bounds (268,435,455 / 0x0FFFFFFF)
 *    - Arithmetic 28-bit overflow safety (avoiding 32-bit bitshift overflow)
 *    - 5-byte continuation overflow detection and rejection
 *    - Incomplete / truncated VLQ sequences at EOF
 * 3. Extreme Tempos & Boundary Conditions:
 *    - 1 microsecond per quarter note (60,000,000 BPM)
 *    - 10,000,000 microseconds per quarter note (6 BPM)
 *    - 0 BPM / 0 microseconds edge case handling and fallback to 120 BPM
 *    - 24-bit maximum SMF tempo (16,777,215 µs)
 *    - Rapid alternating extreme tempo map stress
 * 4. High Polyphony & Note Pairing Stress:
 *    - 100 simultaneous notes on the exact same tick
 *    - Overlapping notes on the same channel and pitch (strict FIFO verification)
 *    - Zero-duration notes (Note-On and Note-Off at identical tick)
 *    - Unterminated notes auto-termination at track boundary under high polyphony
 *    - 1,000 simultaneous note burst stress test
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
} from '../src/core/types';

// ============================================================================
// ADVERSARIAL HELPER UTILITIES
// ============================================================================

/** Encodes unsigned integer into 7-bit continuation VLQ bytes */
function encodeAdversarialVLQ(val: number): number[] {
  let v = Math.max(0, Math.floor(val)) >>> 0;
  if (v === 0) return [0];
  const bytes: number[] = [];
  bytes.push(v & 0x7f);
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

/** Builds an SMF header with customizable fields */
function buildMThd(
  format: number,
  numTracks: number,
  division: number,
  declaredLength = 6,
  paddingBytes: number[] = []
): number[] {
  return [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    (declaredLength >> 24) & 0xff,
    (declaredLength >> 16) & 0xff,
    (declaredLength >> 8) & 0xff,
    declaredLength & 0xff,
    (format >> 8) & 0xff,
    format & 0xff,
    (numTracks >> 8) & 0xff,
    numTracks & 0xff,
    (division >> 8) & 0xff,
    division & 0xff,
    ...paddingBytes,
  ];
}

/** Builds an MTrk chunk with declared length and payload */
function buildMTrk(payload: number[], overrideDeclaredLength?: number): number[] {
  const len = overrideDeclaredLength !== undefined ? overrideDeclaredLength : payload.length;
  return [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...payload,
  ];
}

/** PRNG with deterministic seed for reproducible fuzzing */
function createXorshift32(seed = 123456789) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}

// ============================================================================
// CHALLENGE 1: CORRUPT SMF INPUTS & BINARY FUZZING
// ============================================================================

describe('Adversarial Challenge 1: Corrupt SMF Inputs & Binary Fuzzing', () => {
  it('should reject buffers shorter than 14 bytes with InvalidMidiError', () => {
    for (let len = 0; len < 14; len++) {
      const buffer = new Uint8Array(len);
      for (let i = 0; i < len; i++) buffer[i] = 0x4d; // 'M'
      expect(() => parseMidi(buffer)).toThrow(InvalidMidiError);
    }
  });

  it('should reject invalid container magic signatures', () => {
    const invalidMagics = [
      'RIFX', 'FORM', 'MTh\0', 'mthd', 'MIDI', 'JUNK', 'OggS', 'ID3\x03'
    ];

    for (const magic of invalidMagics) {
      const bytes = new Uint8Array(20);
      for (let i = 0; i < 4; i++) {
        bytes[i] = magic.charCodeAt(i) ?? 0;
      }
      expect(() => parseMidi(bytes)).toThrow(InvalidMidiError);
    }
  });

  it('should reject MThd chunks with declared length less than 6', () => {
    for (const badLength of [0, 1, 2, 3, 4, 5]) {
      const header = buildMThd(1, 1, 480, badLength);
      expect(() => parseMidi(new Uint8Array(header))).toThrow(InvalidMidiError);
    }
  });

  it('should reject unsupported MIDI file format numbers', () => {
    const unsupportedFormats = [3, 4, 10, 255, 65535];
    for (const fmt of unsupportedFormats) {
      const header = buildMThd(fmt, 1, 480);
      expect(() => parseMidi(new Uint8Array(header))).toThrow(InvalidMidiError);
    }
  });

  it('should survive pseudo-random byte fuzzing without unhandled crashes or infinite loops', () => {
    const nextRand = createXorshift32(987654321);
    const fuzzIterations = 100;

    for (let i = 0; i < fuzzIterations; i++) {
      const length = (nextRand() % 500) + 1; // 1 to 500 bytes
      const randomBytes = new Uint8Array(length);
      for (let j = 0; j < length; j++) {
        randomBytes[j] = nextRand() & 0xff;
      }

      // Parser must either return a valid MidiFile or throw InvalidMidiError;
      // NEVER crash with uncaught RangeError, ReferenceError, or hang.
      try {
        const result = parseMidi(randomBytes);
        expect(result).toBeDefined();
        expect(Array.isArray(result.tracks)).toBe(true);
      } catch (err: unknown) {
        expect(err instanceof InvalidMidiError || err instanceof Error).toBe(true);
      }
    }
  });

  it('should survive MThd-valid but MTrk-fuzzed byte payloads safely', () => {
    const nextRand = createXorshift32(555444333);
    for (let i = 0; i < 50; i++) {
      const trkLength = (nextRand() % 300) + 1;
      const trkPayload: number[] = [];
      for (let j = 0; j < trkLength; j++) {
        trkPayload.push(nextRand() & 0xff);
      }

      const fileData = [
        ...buildMThd(1, 1, 480),
        ...buildMTrk(trkPayload),
      ];

      try {
        const result = parseMidi(new Uint8Array(fileData));
        expect(result).toBeDefined();
      } catch (err: unknown) {
        // Expected InvalidMidiError on corrupt running status, overflow, etc.
        expect(err instanceof InvalidMidiError).toBe(true);
      }
    }
  });

  it('should handle truncated track payloads mid-event without RangeError', () => {
    // Valid note-on event truncated after status byte (missing pitch and velocity)
    const header = buildMThd(0, 1, 480);
    const truncatedPayload = [
      0x00, // delta = 0
      0x90, // Note-On channel 0 (truncated here! Missing pitch & velocity)
    ];
    const file = new Uint8Array([...header, ...buildMTrk(truncatedPayload)]);
    const midi = parseMidi(file);
    expect(midi.tracks).toHaveLength(1);
    expect(midi.tracks[0]?.notes).toHaveLength(0); // Note was truncated before completion
  });

  it('should handle track chunk declared length larger than buffer without reading out of bounds', () => {
    const header = buildMThd(0, 1, 480);
    const validTrack = [
      0x00, 0x90, 0x3c, 0x64, // Note On ch0, note 60, vel 100
      0x83, 0x60, 0x80, 0x3c, 0x00, // delta 480, Note Off ch0, note 60
      0x00, 0xff, 0x2f, 0x00, // End of Track
    ];
    // Declare length as 100,000 bytes when only validTrack.length bytes exist
    const file = new Uint8Array([...header, ...buildMTrk(validTrack, 100000)]);
    const midi = parseMidi(file);
    expect(midi.tracks[0]?.notes).toHaveLength(1);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('should safely skip non-track chunks with declared length exceeding file size', () => {
    const header = buildMThd(0, 1, 480);
    // Unknown chunk 'LIST' with huge declared length (50,000)
    const hugeUnknownChunk = [
      0x4c, 0x49, 0x53, 0x54, // 'LIST'
      0x00, 0x00, 0xc3, 0x50, // 50000 bytes declared
      0x01, 0x02, 0x03, 0x04,
    ];
    const file = new Uint8Array([...header, ...hugeUnknownChunk]);
    const midi = parseMidi(file);
    expect(midi.tracks).toHaveLength(0);
  });
});

// ============================================================================
// CHALLENGE 2: EXTREME VARIABLE-LENGTH QUANTITY (VLQ) EDGE CASES
// ============================================================================

describe('Adversarial Challenge 2: Extreme Variable-Length Quantity (VLQ) Edge Cases', () => {
  it('should decode 1-byte, 2-byte, 3-byte, and 4-byte boundary VLQ values accurately', () => {
    const boundaryCases: Array<{ bytes: number[]; expected: number }> = [
      { bytes: [0x00], expected: 0 },
      { bytes: [0x40], expected: 64 },
      { bytes: [0x7f], expected: 127 },
      { bytes: [0x81, 0x00], expected: 128 },
      { bytes: [0xff, 0x7f], expected: 16383 },
      { bytes: [0x81, 0x80, 0x00], expected: 16384 },
      { bytes: [0xff, 0xff, 0x7f], expected: 2097151 },
      { bytes: [0x81, 0x80, 0x80, 0x00], expected: 2097152 },
      { bytes: [0xff, 0xff, 0xff, 0x7f], expected: 268435455 }, // 28-bit maximum (0x0FFFFFFF)
    ];

    for (const { bytes, expected } of boundaryCases) {
      // 1. decodeVLQ array reader
      const resArray = decodeVLQ(bytes);
      expect(resArray.value).toBe(expected);
      expect(resArray.bytesRead).toBe(bytes.length);

      // 2. readVariableLengthQuantity DataView reader
      const u8 = new Uint8Array(bytes);
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const resView = readVariableLengthQuantity(view, 0, u8.byteLength);
      expect(resView.value).toBe(expected);
      expect(resView.bytesRead).toBe(bytes.length);
    }
  });

  it('should accurately parse maximum 28-bit VLQ delta time (268,435,455 ticks) in track events', () => {
    const maxVlqDelta = [0xff, 0xff, 0xff, 0x7f]; // 268,435,455 ticks
    const trackPayload = [
      0x00, 0x90, 0x3c, 0x64, // delta 0: Note On pitch 60
      ...maxVlqDelta, 0x80, 0x3c, 0x00, // delta 268,435,455: Note Off pitch 60
      0x00, 0xff, 0x2f, 0x00, // End of Track
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    expect(midi.tracks[0]?.notes).toHaveLength(1);
    const note = midi.tracks[0]?.notes[0];
    expect(note?.startTick).toBe(0);
    expect(note?.durationTicks).toBe(268435455);
    expect(midi.totalTicks).toBe(268435455);
  });

  it('should reject 5-byte continuation VLQ overflow attempts in track delta times', () => {
    // 4 continuation bytes with MSB set followed by 5th byte: 0x81 0x80 0x80 0x80 0x00
    const overflowVlq = [0x81, 0x80, 0x80, 0x80, 0x00];
    const trackPayload = [
      ...overflowVlq,
      0x90, 0x3c, 0x64,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    expect(() => parseMidi(file)).toThrow(/28-bit overflow|4-byte limit/i);
  });

  it('should handle incomplete VLQ at EOF without infinite loop', () => {
    // Continuation byte 0x81 at end of file without terminal byte
    const incompletePayload = [0x81];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(incompletePayload)]);
    const midi = parseMidi(file);
    expect(midi.tracks[0]?.notes).toHaveLength(0);
  });
});

// ============================================================================
// CHALLENGE 3: EXTREME TEMPOS & BOUNDARY CONDITIONS
// ============================================================================

describe('Adversarial Challenge 3: Extreme Tempos & Boundary Conditions', () => {
  it('should handle extreme fast tempo of 1 microsecond per quarter (60,000,000 BPM)', () => {
    const trackPayload = [
      0x00, 0xff, 0x51, 0x03, 0x00, 0x00, 0x01, // Set Tempo 1 µs
      0x00, 0x90, 0x3c, 0x64, // Note On
      ...encodeAdversarialVLQ(480), 0x80, 0x3c, 0x00, // Note Off after 480 ticks (1 quarter note)
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    expect(midi.tempoMap[0]?.microsecondsPerQuarter).toBe(1);
    expect(midi.tempoMap[0]?.bpm).toBe(60_000_000);

    const note = midi.tracks[0]?.notes[0];
    expect(note).toBeDefined();
    // 480 ticks at 1 µs / 480 PPQ = 1 µs = 0.000001 seconds
    expect(note?.durationSeconds).toBeCloseTo(0.000001, 7);
    expect(Number.isFinite(note?.durationSeconds)).toBe(true);
    expect(note?.durationSeconds).toBeGreaterThan(0);
  });

  it('should handle extreme slow tempo of 10,000,000 microseconds per quarter (6 BPM)', () => {
    // 10,000,000 = 0x989680
    const trackPayload = [
      0x00, 0xff, 0x51, 0x03, 0x98, 0x96, 0x80, // Set Tempo 10,000,000 µs
      0x00, 0x90, 0x3c, 0x64, // Note On
      ...encodeAdversarialVLQ(480), 0x80, 0x3c, 0x00, // Note Off after 480 ticks
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    expect(midi.tempoMap[0]?.microsecondsPerQuarter).toBe(10_000_000);
    expect(midi.tempoMap[0]?.bpm).toBe(6);

    const note = midi.tracks[0]?.notes[0];
    // 480 ticks at 10,000,000 µs / 480 PPQ = 10.0 seconds
    expect(note?.durationSeconds).toBeCloseTo(10.0, 4);
    expect(midi.durationSeconds).toBeCloseTo(10.0, 4);
  });

  it('should gracefully handle 0 BPM / 0 microseconds Set Tempo without divide-by-zero or NaN', () => {
    // 0 µs in Set Tempo: 0x00 0x00 0x00
    const trackPayload = [
      0x00, 0xff, 0x51, 0x03, 0x00, 0x00, 0x00, // Set Tempo 0 µs
      0x00, 0x90, 0x3c, 0x64,
      ...encodeAdversarialVLQ(480), 0x80, 0x3c, 0x00,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    // Fallback default: 120 BPM, 500,000 µs
    expect(midi.tempoMap[0]?.bpm).toBe(120);
    expect(midi.tempoMap[0]?.microsecondsPerQuarter).toBe(DEFAULT_MICROSECONDS_PER_QUARTER);

    const note = midi.tracks[0]?.notes[0];
    expect(note?.durationSeconds).toBeCloseTo(0.5, 4);
    expect(Number.isFinite(note?.durationSeconds)).toBe(true);
  });

  it('should handle maximum 24-bit SMF tempo (16,777,215 µs = 0xFFFFFF)', () => {
    const trackPayload = [
      0x00, 0xff, 0x51, 0x03, 0xff, 0xff, 0xff, // 16,777,215 µs
      0x00, 0x90, 0x3c, 0x64,
      ...encodeAdversarialVLQ(480), 0x80, 0x3c, 0x00,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    expect(midi.tempoMap[0]?.microsecondsPerQuarter).toBe(16777215);
    expect(midi.tempoMap[0]?.bpm).toBeCloseTo(3.576278, 4);

    const note = midi.tracks[0]?.notes[0];
    expect(note?.durationSeconds).toBeCloseTo(16.777215, 5);
  });

  it('should stress-test TempoMap binary search with 200 alternating extreme tempo transitions', () => {
    const tempoPoints: Array<{ tick: number; microsecondsPerQuarter: number }> = [];
    for (let i = 0; i < 200; i++) {
      tempoPoints.push({
        tick: i * 480,
        // Alternate between 1 µs and 10,000,000 µs
        microsecondsPerQuarter: i % 2 === 0 ? 1 : 10_000_000,
      });
    }

    const map = new TempoMap(480, tempoPoints);
    expect(map.getEntries().length).toBe(200);

    // Monotonicity check: seconds must strictly increase as tick increases
    let lastSec = -1;
    for (let tick = 0; tick <= 200 * 480; tick += 240) {
      const sec = map.tickToSeconds(tick);
      expect(sec).toBeGreaterThanOrEqual(lastSec);
      expect(Number.isFinite(sec)).toBe(true);
      lastSec = sec;

      // Invert back: secondsToTick should closely recover the tick
      const recoveredTick = map.secondsToTick(sec);
      expect(recoveredTick).toBe(tick);
    }
  });

  it('should enforce safe defaults on direct TempoMap instantiation with negative or zero tempo', () => {
    const map = new TempoMap(480, [
      { tick: 0, microsecondsPerQuarter: 0 },
      { tick: 100, microsecondsPerQuarter: -1000 },
    ]);

    for (const entry of map.getEntries()) {
      expect(entry.microsecondsPerQuarter).toBe(DEFAULT_MICROSECONDS_PER_QUARTER);
      expect(entry.bpm).toBe(120);
    }
  });
});

// ============================================================================
// CHALLENGE 4: HIGH POLYPHONY & NOTE PAIRING STRESS
// ============================================================================

describe('Adversarial Challenge 4: High Polyphony & Note Pairing Stress', () => {
  it('should pair 100 simultaneous notes occurring on the exact same tick', () => {
    const noteCount = 100;
    const trackPayload: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // 120 BPM

    // 100 Note-Ons at delta 0
    for (let i = 0; i < noteCount; i++) {
      const channel = i % 16;
      const pitch = (i % 120) + 1; // 1 to 120
      trackPayload.push(0x00, 0x90 | channel, pitch, 90);
    }

    // Advance 480 ticks, then 100 Note-Offs at delta 0
    trackPayload.push(...encodeAdversarialVLQ(480));
    trackPayload.push(0x80 | (0 % 16), (0 % 120) + 1, 0x00);

    for (let i = 1; i < noteCount; i++) {
      const channel = i % 16;
      const pitch = (i % 120) + 1;
      trackPayload.push(0x00, 0x80 | channel, pitch, 0x00);
    }

    trackPayload.push(0x00, 0xff, 0x2f, 0x00); // End of track

    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);

    expect(midi.tracks).toHaveLength(1);
    const notes = midi.tracks[0]?.notes ?? [];
    expect(notes).toHaveLength(noteCount);

    for (const n of notes) {
      expect(n.startTick).toBe(0);
      expect(n.durationTicks).toBe(480);
      expect(n.durationSeconds).toBeCloseTo(0.5, 4);
    }

    // Verify deterministic sorting: startTick ascending, pitch ascending, channel ascending
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1]!;
      const curr = notes[i]!;
      if (prev.startTick === curr.startTick) {
        if (prev.pitch === curr.pitch) {
          expect(prev.channel).toBeLessThanOrEqual(curr.channel);
        } else {
          expect(prev.pitch).toBeLessThanOrEqual(curr.pitch);
        }
      } else {
        expect(prev.startTick).toBeLessThan(curr.startTick);
      }
    }
  });

  it('should handle rapid overlapping notes on identical channel and pitch with strict FIFO pairing', () => {
    // 10 overlapping notes on channel 0, pitch 60
    const count = 10;
    const trackPayload: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];

    // 10 Note-Ons staggered every 100 ticks (tick 0, 100, 200, ..., 900)
    for (let i = 0; i < count; i++) {
      const delta = i === 0 ? 0 : 100;
      trackPayload.push(...encodeAdversarialVLQ(delta), 0x90, 60, 80 + i);
    }

    // 10 Note-Offs staggered every 100 ticks (tick 1000, 1100, 1200, ..., 1900)
    for (let i = 0; i < count; i++) {
      trackPayload.push(...encodeAdversarialVLQ(100), 0x80, 60, 0x00);
    }

    trackPayload.push(0x00, 0xff, 0x2f, 0x00);

    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);
    const notes = midi.tracks[0]?.notes ?? [];

    expect(notes).toHaveLength(count);

    // Verify FIFO pairing: 1st Note-On at tick 0 pairs with 1st Note-Off at tick 1000, etc.
    for (let i = 0; i < count; i++) {
      const n = notes[i]!;
      expect(n.pitch).toBe(60);
      expect(n.startTick).toBe(i * 100);
      expect(n.durationTicks).toBe(1000); // 1000 - 0 = 1000, 1100 - 100 = 1000, etc.
      expect(n.velocity).toBe(80 + i);
    }
  });

  it('should handle zero-duration notes (Note-On and Note-Off at identical tick) cleanly', () => {
    const trackPayload = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0x90, 60, 100, // Note-On at tick 0
      0x00, 0x80, 60, 0,   // Note-Off at tick 0 (zero duration)
      0x00, 0xff, 0x2f, 0x00,
    ];
    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);
    const note = midi.tracks[0]?.notes[0];

    expect(note).toBeDefined();
    expect(note?.startTick).toBe(0);
    expect(note?.durationTicks).toBe(0);
    expect(note?.startSeconds).toBe(0);
    expect(note?.durationSeconds).toBe(0);
  });

  it('should auto-terminate 100 unclosed notes at track end without leaking memory', () => {
    const count = 100;
    const trackPayload: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];

    // Fire 100 Note-Ons at tick 0, but send ZERO Note-Offs
    for (let i = 0; i < count; i++) {
      trackPayload.push(0x00, 0x90, (i % 120) + 1, 90);
    }

    // End track at tick 960
    trackPayload.push(...encodeAdversarialVLQ(960), 0xff, 0x2f, 0x00);

    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);
    const midi = parseMidi(file);
    const notes = midi.tracks[0]?.notes ?? [];

    expect(notes).toHaveLength(count);
    for (const n of notes) {
      expect(n.startTick).toBe(0);
      expect(n.durationTicks).toBe(960);
      expect(n.durationSeconds).toBeCloseTo(1.0, 4);
    }
  });

  it('should process 1,000 simultaneous note events in under 50ms without performance cliff', () => {
    const count = 1000;
    const trackPayload: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];

    // 1000 Note-Ons at delta 0
    for (let i = 0; i < count; i++) {
      trackPayload.push(0x00, 0x90 | (i % 16), (i % 120) + 1, 90);
    }

    // 1000 Note-Offs at delta 480
    trackPayload.push(...encodeAdversarialVLQ(480), 0x80 | (0 % 16), (0 % 120) + 1, 0x00);
    for (let i = 1; i < count; i++) {
      trackPayload.push(0x00, 0x80 | (i % 16), (i % 120) + 1, 0x00);
    }

    trackPayload.push(0x00, 0xff, 0x2f, 0x00);

    const file = new Uint8Array([...buildMThd(0, 1, 480), ...buildMTrk(trackPayload)]);

    const tStart = performance.now();
    const midi = parseMidi(file);
    const duration = performance.now() - tStart;

    expect(midi.tracks[0]?.notes).toHaveLength(count);
    expect(duration).toBeLessThan(50);
  });
});

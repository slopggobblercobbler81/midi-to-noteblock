import { describe, it, expect } from 'vitest';
import {
  parseMidi,
  TempoMap,
  InvalidMidiError,
} from '../src/core/midi-parser';
import {
  type MidiRawNote,
  REDSTONE_TICKS_PER_SECOND,
} from '../src/core/types';

// ============================================================================
// ADVERSARIAL TEST HARNESS: BINARY SMF SYNTHESIZER
// ============================================================================

/**
 * Encodes an integer value into a standard MIDI Variable-Length Quantity (VLQ).
 */
function encodeVLQ(value: number): number[] {
  if (value <= 0) return [0];
  const bytes: number[] = [];
  let temp = value;
  while (temp > 0) {
    bytes.push(temp & 0x7f);
    temp = Math.floor(temp / 128);
  }
  bytes.reverse();
  for (let i = 0; i < bytes.length - 1; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      bytes[i] = b | 0x80;
    }
  }
  return bytes;
}

/**
 * Builds an MTrk binary chunk from a sequence of raw event bytes.
 * Appends standard End of Track meta-event (0x00 0xFF 0x2F 0x00).
 */
function buildTrackChunk(eventsBytes: number[], autoEndOfTrack = true): number[] {
  const data = autoEndOfTrack ? [...eventsBytes, 0x00, 0xff, 0x2f, 0x00] : [...eventsBytes];
  const len = data.length;
  return [
    0x4d,
    0x54,
    0x72,
    0x6b, // 'MTrk'
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...data,
  ];
}

/**
 * Builds a complete SMF binary byte array.
 */
function buildMidiBinary(format: 0 | 1 | 2, ppq: number, trackChunks: number[][]): Uint8Array {
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // 'MThd'
    0x00,
    0x00,
    0x00,
    0x06, // Header length = 6
    0x00,
    format,
    (trackChunks.length >>> 8) & 0xff,
    trackChunks.length & 0xff,
    (ppq >>> 8) & 0xff,
    ppq & 0xff,
  ];

  const allBytes = [...header];
  for (const track of trackChunks) {
    allBytes.push(...track);
  }
  return new Uint8Array(allBytes);
}

// ============================================================================
// SUITE 1: MATHEMATICAL TIMING ACCURACY & DYNAMIC TEMPO ENGINE
// ============================================================================

describe('Adversarial Challenge 1: Mathematical Timing Accuracy & Dynamic Tempo Engine', () => {
  it('should match an exact analytical rational oracle across multi-tempo tracks without drift', () => {
    const ppq = 480;
    // Multi-tempo sequence:
    // Segment 0: tick 0 -> 480 @ 120 BPM (500,000 us/qn) -> dt = 480, deltaSec = 0.5s
    // Segment 1: tick 480 -> 1440 @ 60 BPM (1,000,000 us/qn) -> dt = 960, deltaSec = 2.0s
    // Segment 2: tick 1440 -> 2400 @ 240 BPM (250,000 us/qn) -> dt = 960, deltaSec = 0.5s
    // Segment 3: tick 2400 -> 3000 @ 180 BPM (333,333 us/qn) -> dt = 600, deltaSec = (600 * 333333)/(480 * 10^6)
    const rawTempo = [
      { tick: 0, microsecondsPerQuarter: 500_000 },
      { tick: 480, microsecondsPerQuarter: 1_000_000 },
      { tick: 1440, microsecondsPerQuarter: 250_000 },
      { tick: 2400, microsecondsPerQuarter: 333_333 },
    ];

    const tempoMap = new TempoMap(ppq, rawTempo);

    // Analytical expectations:
    expect(tempoMap.tickToSeconds(0)).toBe(0.0);
    expect(tempoMap.tickToSeconds(240)).toBeCloseTo(0.25, 10);
    expect(tempoMap.tickToSeconds(480)).toBeCloseTo(0.5, 10);
    expect(tempoMap.tickToSeconds(960)).toBeCloseTo(1.5, 10);
    expect(tempoMap.tickToSeconds(1440)).toBeCloseTo(2.5, 10);
    expect(tempoMap.tickToSeconds(1920)).toBeCloseTo(2.75, 10);
    expect(tempoMap.tickToSeconds(2400)).toBeCloseTo(3.0, 10);

    const expectedAt3000 = 3.0 + (600 * 333_333) / (480 * 1_000_000);
    expect(tempoMap.tickToSeconds(3000)).toBeCloseTo(expectedAt3000, 10);
  });

  it('should maintain strict bijective invertibility (secondsToTick(tickToSeconds(t)) === t) across boundaries', () => {
    const ppq = 480;
    const rawTempo = [
      { tick: 0, microsecondsPerQuarter: 500_000 },
      { tick: 480, microsecondsPerQuarter: 750_000 },
      { tick: 1200, microsecondsPerQuarter: 250_000 },
      { tick: 2400, microsecondsPerQuarter: 400_000 },
    ];
    const tempoMap = new TempoMap(ppq, rawTempo);

    // Test transition boundaries explicitly: tick - 1, tick, tick + 1
    const testTicks = [
      0, 1, 2, 479, 480, 481, 1199, 1200, 1201, 2399, 2400, 2401, 3600, 5000,
    ];

    for (const tick of testTicks) {
      const sec = tempoMap.tickToSeconds(tick);
      const invertedTick = tempoMap.secondsToTick(sec);
      expect(invertedTick).toBe(tick);
    }

    // Stress test 1000 incremental ticks across tempo changes
    for (let t = 0; t <= 3000; t += 3) {
      const sec = tempoMap.tickToSeconds(t);
      const roundTrip = tempoMap.secondsToTick(sec);
      expect(roundTrip).toBe(t);
    }
  });

  it('should enforce strict monotonic increasing order (t1 < t2 iff sec1 < sec2)', () => {
    const ppq = 960;
    const rawTempo = [
      { tick: 0, microsecondsPerQuarter: 600_000 },
      { tick: 960, microsecondsPerQuarter: 300_000 },
      { tick: 1920, microsecondsPerQuarter: 120_000 },
      { tick: 2880, microsecondsPerQuarter: 900_000 },
    ];
    const tempoMap = new TempoMap(ppq, rawTempo);

    let prevSec = -1;
    for (let t = 0; t <= 4000; t += 5) {
      const sec = tempoMap.tickToSeconds(t);
      expect(sec).toBeGreaterThan(prevSec);
      prevSec = sec;
    }
  });

  it('should correctly deduplicate simultaneous tempo events (last declared event wins at same tick)', () => {
    const ppq = 480;
    // Two tempo events at tick 0, two at tick 480
    const rawTempo = [
      { tick: 0, microsecondsPerQuarter: 500_000 }, // 120 BPM
      { tick: 0, microsecondsPerQuarter: 250_000 }, // 240 BPM (should overwrite)
      { tick: 480, microsecondsPerQuarter: 600_000 }, // 100 BPM
      { tick: 480, microsecondsPerQuarter: 1_000_000 }, // 60 BPM (should overwrite)
    ];

    const tempoMap = new TempoMap(ppq, rawTempo);
    const entries = tempoMap.getEntries();

    expect(entries.length).toBe(2);
    expect(entries[0]?.tick).toBe(0);
    expect(entries[0]?.microsecondsPerQuarter).toBe(250_000);
    expect(entries[0]?.bpm).toBe(240);

    expect(entries[1]?.tick).toBe(480);
    expect(entries[1]?.microsecondsPerQuarter).toBe(1_000_000);
    expect(entries[1]?.bpm).toBe(60);

    // Cumulative seconds at tick 480 should be (480 * 250_000)/(480 * 10^6) = 0.25s
    expect(entries[1]?.seconds).toBe(0.25);
  });

  it('should handle high-density tempo maps (1,000 transitions) with O(log K) search performance', () => {
    const ppq = 480;
    const rawTempo: Array<{ tick: number; microsecondsPerQuarter: number }> = [];

    // 1,000 tempo transitions, alternating tempos every 24 ticks
    for (let i = 0; i < 1000; i++) {
      rawTempo.push({
        tick: i * 24,
        microsecondsPerQuarter: 200_000 + ((i * 137) % 600_000),
      });
    }

    const tStart = performance.now();
    const tempoMap = new TempoMap(ppq, rawTempo);
    const mapConstructMs = performance.now() - tStart;
    expect(mapConstructMs).toBeLessThan(100);

    // Perform 10,000 tickToSeconds lookups
    const tLookupStart = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const tick = (i * 17) % 24_000;
      const sec = tempoMap.tickToSeconds(tick);
      expect(sec).toBeGreaterThanOrEqual(0);
    }
    const lookupMs = performance.now() - tLookupStart;
    expect(lookupMs).toBeLessThan(500); // 10,000 queries in <500ms (resilient across CI virtual machines)
  });

  it('should precisely calculate 10 Hz Redstone ticks without rounding drift', () => {
    const ppq = 480;
    const tempoMap = new TempoMap(ppq, [{ tick: 0, microsecondsPerQuarter: 500_000 }]);

    // At 120 BPM, 1 beat (480 ticks) = 0.5s = 5 redstone ticks
    expect(tempoMap.tickToRedstoneTick(0)).toBe(0);
    expect(tempoMap.tickToRedstoneTick(96)).toBe(1); // 0.1s -> 1 RT
    expect(tempoMap.tickToRedstoneTick(192)).toBe(2); // 0.2s -> 2 RT
    expect(tempoMap.tickToRedstoneTick(480)).toBe(5); // 0.5s -> 5 RT
    expect(tempoMap.tickToRedstoneTick(960)).toBe(10); // 1.0s -> 10 RT

    // Midpoint check: 0.05s = 48 ticks -> Math.round(0.5) = 1 or 0
    expect(tempoMap.tickToRedstoneTick(48)).toBe(Math.round(0.05 * REDSTONE_TICKS_PER_SECOND));
  });

  it('should support non-standard PPQ divisions (PPQ=1, 96, 384, 960, 15360)', () => {
    const testPPQs = [1, 96, 384, 960, 15_360];
    for (const ppq of testPPQs) {
      const tempoMap = new TempoMap(ppq, [{ tick: 0, microsecondsPerQuarter: 500_000 }]);
      // 1 quarter note = ppq ticks = 0.5 seconds
      const secAtQuarter = tempoMap.tickToSeconds(ppq);
      expect(secAtQuarter).toBeCloseTo(0.5, 10);
      expect(tempoMap.secondsToTick(0.5)).toBe(ppq);
    }
  });

  it('should accurately calculate note duration spanning multiple piecewise tempo changes', () => {
    const ppq = 480;
    // Tempo map:
    // tick 0 -> 240: 120 BPM (500,000 us/qn)
    // tick 240 -> 480: 60 BPM (1,000,000 us/qn)
    // tick 480 -> 960: 240 BPM (250,000 us/qn)
    // tick 960+: 120 BPM (500,000 us/qn)
    const rawTempo = [
      { tick: 0, microsecondsPerQuarter: 500_000 },
      { tick: 240, microsecondsPerQuarter: 1_000_000 },
      { tick: 480, microsecondsPerQuarter: 250_000 },
      { tick: 960, microsecondsPerQuarter: 500_000 },
    ];
    const tempoMap = new TempoMap(ppq, rawTempo);

    // Note from tick 100 to tick 1000
    const startSec = tempoMap.tickToSeconds(100);
    const endSec = tempoMap.tickToSeconds(1000);
    const duration = endSec - startSec;

    // Exact analytical duration:
    // [100, 240] (140 ticks @ 500k): (140 * 500,000) / (480 * 10^6) = 0.14583333333333334
    // [240, 480] (240 ticks @ 1M):   (240 * 1,000,000) / (480 * 10^6) = 0.5
    // [480, 960] (480 ticks @ 250k): (480 * 250,000) / (480 * 10^6) = 0.25
    // [960, 1000] (40 ticks @ 500k): (40 * 500,000) / (480 * 10^6) = 0.041666666666666664
    // Sum = 0.9375s
    expect(duration).toBeCloseTo(0.9375, 10);
  });
});

// ============================================================================
// SUITE 2: RUNNING STATUS DURABILITY & CANCELLATION INVARIANTS
// ============================================================================

describe('Adversarial Challenge 2: Running Status Durability & Cancellation Invariants', () => {
  it('should maintain running status durability across an ultra-long stream of 5,000 consecutive notes', () => {
    const trackBytes: number[] = [];

    // Initial event: Note-On Channel 3, Pitch 60, Vel 100
    // Delta = 0, Status = 0x93, Pitch = 60, Vel = 100
    trackBytes.push(0x00, 0x93, 60, 100);
    // Note-Off for note 0 via running status vel 0
    trackBytes.push(...encodeVLQ(10), 60, 0);

    // Next 4,998 events (2,499 note pairs) omit status byte completely, relying on running status 0x93
    for (let i = 1; i < 2500; i++) {
      const pitch = (i % 60) + 30;
      // Note-On
      trackBytes.push(...encodeVLQ(10), pitch, 80);
      // Note-Off via zero-velocity
      trackBytes.push(...encodeVLQ(10), pitch, 0);
    }

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks.length).toBe(1);
    const track = parsed.tracks[0]!;
    expect(track.channel).toBe(3);

    // Exactly 2,500 paired notes should be output (initial note + 2,499 notes)
    expect(track.notes.length).toBe(2500);
    for (const note of track.notes) {
      expect(note.channel).toBe(3);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.durationTicks).toBe(10);
    }
  });

  it('should maintain running status across all Channel Voice commands (0x80, 0x90, 0xB0, 0xC0, 0xE0)', () => {
    const trackBytes: number[] = [];

    // 1. Program Change running status (0xC0, 1 data byte)
    trackBytes.push(0x00, 0xc0, 10); // Initial 0xC0
    for (let i = 1; i <= 20; i++) {
      trackBytes.push(...encodeVLQ(5), (i * 3) % 128); // 1 data byte each
    }

    // 2. Control Change running status (0xB0, 2 data bytes)
    trackBytes.push(0x00, 0xb0, 7, 100); // Initial 0xB0 (Volume)
    for (let i = 1; i <= 20; i++) {
      trackBytes.push(...encodeVLQ(5), 7, (100 - i) % 128); // 2 data bytes each
    }

    // 3. Pitch Bend running status (0xE0, 2 data bytes)
    trackBytes.push(0x00, 0xe0, 0x00, 0x40); // Center pitch bend
    for (let i = 1; i <= 20; i++) {
      trackBytes.push(...encodeVLQ(5), 0x00, 0x40 + i);
    }

    // 4. Note-On running status (0x90, 2 data bytes)
    trackBytes.push(0x00, 0x90, 60, 100);
    trackBytes.push(...encodeVLQ(100), 60, 0); // Note-Off via running status vel 0

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks.length).toBe(1);
    expect(parsed.tracks[0]?.notes.length).toBe(1);
    expect(parsed.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('should strictly reset running status on Meta-events (0xFF) and throw on orphaned data bytes', () => {
    const trackBytes: number[] = [];

    // Note-On establishing running status 0x90
    trackBytes.push(0x00, 0x90, 60, 100);

    // Meta-Event: Text event (0xFF 0x01 len "Test") -> strictly cancels running status!
    trackBytes.push(0x00, 0xff, 0x01, 0x04, 0x54, 0x65, 0x73, 0x74);

    // Data byte 60 without status byte! Since running status was cancelled, this is invalid MIDI!
    trackBytes.push(0x00, 60, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    expect(() => parseMidi(midiBytes)).toThrowError(InvalidMidiError);
  });

  it('should strictly reset running status on SysEx events (0xF0 / 0xF7) and throw on orphaned data bytes', () => {
    const trackBytes: number[] = [];

    // Note-On establishing running status 0x90
    trackBytes.push(0x00, 0x90, 60, 100);

    // SysEx Event: 0xF0 len 0x02 0x7E 0xF7 -> strictly cancels running status!
    trackBytes.push(0x00, 0xf0, 0x02, 0x7e, 0xf7);

    // Data byte 60 without status byte! Must throw!
    trackBytes.push(0x00, 60, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    expect(() => parseMidi(midiBytes)).toThrowError(InvalidMidiError);
  });

  it('should enforce track boundary isolation (Track 1 running status does not leak to Track 2)', () => {
    // Track 1 establishes running status 0x90
    const track1Bytes = [0x00, 0x90, 60, 100, 0x80, 0x00, 60, 0];
    const track1Chunk = buildTrackChunk(track1Bytes);

    // Track 2 begins immediately with data byte 62 (< 0x80) without status byte!
    const track2Bytes = [0x00, 62, 100, 0x80, 0x00, 62, 0];
    const track2Chunk = buildTrackChunk(track2Bytes);

    const midiBytes = buildMidiBinary(1, 480, [track1Chunk, track2Chunk]);

    expect(() => parseMidi(midiBytes)).toThrowError(InvalidMidiError);
  });

  it('should throw InvalidMidiError when track starts with data byte < 0x80', () => {
    const trackBytes = [0x00, 0x3c, 0x64]; // delta 0, byte 60, byte 100
    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    expect(() => parseMidi(midiBytes)).toThrowError(InvalidMidiError);
  });

  it('should cleanly re-establish running status with an explicit status byte after meta cancellation', () => {
    const trackBytes: number[] = [];

    // 1. Initial Note-On establishes running status 0x90
    trackBytes.push(0x00, 0x90, 60, 100);
    // Running status Note-Off (vel 0)
    trackBytes.push(...encodeVLQ(100), 60, 0);

    // 2. Meta Event (cancels running status)
    trackBytes.push(0x00, 0xff, 0x01, 0x04, 0x54, 0x65, 0x73, 0x74);

    // 3. New explicit Note-On (0x90) cleanly re-establishes running status
    trackBytes.push(0x00, 0x90, 62, 110);
    // Running status Note-Off (vel 0)
    trackBytes.push(...encodeVLQ(100), 62, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(2);
    expect(parsed.tracks[0]?.notes[0]?.pitch).toBe(60);
    expect(parsed.tracks[0]?.notes[1]?.pitch).toBe(62);
  });
});

// ============================================================================
// SUITE 3: ZERO-VELOCITY NOTE-ON NORMALIZATION & GHOST NOTE PREVENTION
// ============================================================================

describe('Adversarial Challenge 3: Zero-Velocity Note-On Normalization & Ghost Note Prevention', () => {
  it('should strictly convert Note-On with velocity 0 to Note-Off with ZERO ghost notes', () => {
    const trackBytes: number[] = [];

    // Note 60 ON at tick 0, OFF via vel 0 at tick 480
    trackBytes.push(0x00, 0x90, 60, 100);
    trackBytes.push(...encodeVLQ(480), 0x90, 60, 0); // vel 0 Note-On

    // Note 64 ON at tick 480, OFF via vel 0 at tick 960
    trackBytes.push(0x00, 0x90, 64, 120);
    trackBytes.push(...encodeVLQ(480), 0x90, 64, 0); // vel 0 Note-On

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(2);

    const [n1, n2] = parsed.tracks[0]!.notes;
    expect(n1?.pitch).toBe(60);
    expect(n1?.velocity).toBe(100); // Preserves Note-On velocity
    expect(n1?.startTick).toBe(0);
    expect(n1?.durationTicks).toBe(480);

    expect(n2?.pitch).toBe(64);
    expect(n2?.velocity).toBe(120);
    expect(n2?.startTick).toBe(480);
    expect(n2?.durationTicks).toBe(480);
  });

  it('should ignore orphan zero-velocity Note-On events without creating ghost notes', () => {
    const trackBytes: number[] = [];

    // Orphan zero-velocity Note-On (pitch 72, vel 0) with no preceding Note-On
    trackBytes.push(0x00, 0x90, 72, 0);

    // Legitimate Note-On (pitch 60, vel 100)
    trackBytes.push(...encodeVLQ(100), 0x90, 60, 100);
    trackBytes.push(...encodeVLQ(200), 0x90, 60, 0);

    // Another orphan zero-velocity Note-On (pitch 80, vel 0)
    trackBytes.push(...encodeVLQ(50), 0x90, 80, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    // Exactly 1 note should exist (pitch 60), zero ghost notes from pitches 72 and 80!
    expect(parsed.tracks[0]?.notes.length).toBe(1);
    expect(parsed.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('should correctly handle zero-duration notes (Note-On and vel 0 Note-Off at same tick)', () => {
    const trackBytes: number[] = [];

    // Staccato note at tick 240: ON and OFF at exact same tick (delta 0)
    trackBytes.push(...encodeVLQ(240), 0x90, 60, 90);
    trackBytes.push(0x00, 0x90, 60, 0); // vel 0 at delta 0

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(1);

    const note = parsed.tracks[0]?.notes[0]!;
    expect(note.pitch).toBe(60);
    expect(note.velocity).toBe(90);
    expect(note.startTick).toBe(240);
    expect(note.durationTicks).toBe(0);
    expect(note.durationSeconds).toBe(0);
  });

  it('should enforce strict FIFO pairing order on overlapping Note-Ons on same pitch and channel', () => {
    const trackBytes: number[] = [];

    // Note 1: Pitch 60, Vel 50 at tick 0
    trackBytes.push(0x00, 0x90, 60, 50);

    // Note 2: Pitch 60, Vel 110 at tick 100 (same channel and pitch before Note 1 ends!)
    trackBytes.push(...encodeVLQ(100), 0x90, 60, 110);

    // First Note-Off at tick 200 (delta 100) -> MUST close Note 1!
    trackBytes.push(...encodeVLQ(100), 0x90, 60, 0);

    // Second Note-Off at tick 350 (delta 150) -> MUST close Note 2!
    trackBytes.push(...encodeVLQ(150), 0x90, 60, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(2);

    const [first, second] = parsed.tracks[0]!.notes;
    // First paired note: started at tick 0 with vel 50, duration = 200 ticks
    expect(first?.startTick).toBe(0);
    expect(first?.velocity).toBe(50);
    expect(first?.durationTicks).toBe(200);

    // Second paired note: started at tick 100 with vel 110, duration = 250 ticks
    expect(second?.startTick).toBe(100);
    expect(second?.velocity).toBe(110);
    expect(second?.durationTicks).toBe(250);
  });

  it('should handle 1,000 rapid polyphonic note pairs with zero note leakage or ghost generation', () => {
    const trackBytes: number[] = [];

    // Generate 1,000 distinct note on/off pairs across multiple pitches and channels
    for (let i = 0; i < 1000; i++) {
      const ch = i % 8;
      const pitch = (i % 48) + 36;
      const vel = ((i * 19) % 100) + 20;

      // Note-On
      trackBytes.push(...encodeVLQ(10), 0x90 | ch, pitch, vel);
      // Note-Off via zero-velocity
      trackBytes.push(...encodeVLQ(15), 0x90 | ch, pitch, 0);
    }

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(1000);

    // Verify all notes have valid positive duration and velocity
    for (const note of parsed.tracks[0]!.notes) {
      expect(note.durationTicks).toBe(15);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.durationSeconds).toBeGreaterThan(0);
    }
  });

  it('should seamlessly pair notes when Note-Off is an alternating mix of 0x80 and 0x90 velocity 0', () => {
    const trackBytes: number[] = [];

    // Note 1: 0x90 ON, 0x80 OFF
    trackBytes.push(0x00, 0x90, 60, 90);
    trackBytes.push(...encodeVLQ(100), 0x80, 60, 64);

    // Note 2: 0x90 ON, 0x90 vel 0 OFF
    trackBytes.push(0x00, 0x90, 62, 95);
    trackBytes.push(...encodeVLQ(100), 0x90, 62, 0);

    // Note 3: 0x90 ON, 0x80 OFF
    trackBytes.push(0x00, 0x90, 64, 100);
    trackBytes.push(...encodeVLQ(100), 0x80, 64, 0);

    // Note 4: 0x90 ON, 0x90 vel 0 OFF
    trackBytes.push(0x00, 0x90, 65, 105);
    trackBytes.push(...encodeVLQ(100), 0x90, 65, 0);

    const trackChunk = buildTrackChunk(trackBytes);
    const midiBytes = buildMidiBinary(0, 480, [trackChunk]);

    const parsed = parseMidi(midiBytes);
    expect(parsed.tracks[0]?.notes.length).toBe(4);
    for (const note of parsed.tracks[0]!.notes) {
      expect(note.durationTicks).toBe(100);
      expect(note.velocity).toBeGreaterThan(80);
    }
  });
});

// ============================================================================
// SUITE 4: FORMAT 0 VS FORMAT 1 PARITY & EQUIVALENCE
// ============================================================================

describe('Adversarial Challenge 4: Format 0 vs Format 1 Parity & Equivalence', () => {
  interface AbstractEvent {
    tick: number;
    bytes: number[];
  }

  it('should achieve 100% note-for-note parity between Format 0 and Format 1 on a multi-channel song', () => {
    const ppq = 480;

    // Defined composition:
    // Tempo changes:
    // Tick 0: 150 BPM (400,000 us/qn)
    // Tick 960: 90 BPM (666,666 us/qn)
    const tempoEvents: AbstractEvent[] = [
      { tick: 0, bytes: [0xff, 0x51, 0x03, 0x06, 0x1a, 0x80] }, // 400,000
      { tick: 960, bytes: [0xff, 0x51, 0x03, 0x0a, 0x2c, 0x20] }, // 666,666
    ];

    // Channel 0 (Melody): 4 notes
    const ch0Events: AbstractEvent[] = [
      { tick: 0, bytes: [0x90, 60, 100] },
      { tick: 480, bytes: [0x90, 60, 0] },
      { tick: 480, bytes: [0x90, 62, 105] },
      { tick: 960, bytes: [0x90, 62, 0] },
      { tick: 960, bytes: [0x90, 64, 110] },
      { tick: 1440, bytes: [0x90, 64, 0] },
      { tick: 1440, bytes: [0x90, 65, 115] },
      { tick: 1920, bytes: [0x90, 65, 0] },
    ];

    // Channel 1 (Harmony / Chords): 2 long notes
    const ch1Events: AbstractEvent[] = [
      { tick: 0, bytes: [0x91, 67, 80] },
      { tick: 960, bytes: [0x91, 67, 0] },
      { tick: 960, bytes: [0x91, 71, 85] },
      { tick: 1920, bytes: [0x91, 71, 0] },
    ];

    // Channel 9 (Drums / Percussion): 4 beats
    const ch9Events: AbstractEvent[] = [
      { tick: 0, bytes: [0x99, 36, 120] }, // Bass drum
      { tick: 120, bytes: [0x99, 36, 0] },
      { tick: 480, bytes: [0x99, 38, 110] }, // Snare
      { tick: 600, bytes: [0x99, 38, 0] },
      { tick: 960, bytes: [0x99, 36, 120] },
      { tick: 1080, bytes: [0x99, 36, 0] },
      { tick: 1440, bytes: [0x99, 38, 110] },
      { tick: 1560, bytes: [0x99, 38, 0] },
    ];

    // --- Build Format 0: Single Track ---
    // All events merged and sorted by absolute tick
    const allEventsSorted: AbstractEvent[] = [
      ...tempoEvents,
      ...ch0Events,
      ...ch1Events,
      ...ch9Events,
    ].sort((a, b) => a.tick - b.tick);

    const f0TrackBytes: number[] = [];
    let lastTickF0 = 0;
    for (const evt of allEventsSorted) {
      const delta = evt.tick - lastTickF0;
      f0TrackBytes.push(...encodeVLQ(delta), ...evt.bytes);
      lastTickF0 = evt.tick;
    }
    const f0TrackChunk = buildTrackChunk(f0TrackBytes);
    const midiF0 = parseMidi(buildMidiBinary(0, ppq, [f0TrackChunk]));

    // --- Build Format 1: Multi-Track ---
    // Track 0: Tempo track
    function buildStream(events: AbstractEvent[]): number[] {
      const stream: number[] = [];
      let lastT = 0;
      for (const e of events) {
        stream.push(...encodeVLQ(e.tick - lastT), ...e.bytes);
        lastT = e.tick;
      }
      return stream;
    }

    const t0Chunk = buildTrackChunk(buildStream(tempoEvents));
    const t1Chunk = buildTrackChunk(buildStream(ch0Events));
    const t2Chunk = buildTrackChunk(buildStream(ch1Events));
    const t3Chunk = buildTrackChunk(buildStream(ch9Events));

    const midiF1 = parseMidi(buildMidiBinary(1, ppq, [t0Chunk, t1Chunk, t2Chunk, t3Chunk]));

    // 1. Total song ticks and duration parity
    expect(midiF0.totalTicks).toBe(midiF1.totalTicks);
    expect(midiF0.totalTicks).toBe(1920);
    expect(midiF0.durationSeconds).toBeCloseTo(midiF1.durationSeconds, 8);

    // 2. Tempo Map entries parity
    expect(midiF0.tempoMap.length).toBe(midiF1.tempoMap.length);
    for (let i = 0; i < midiF0.tempoMap.length; i++) {
      expect(midiF0.tempoMap[i]?.tick).toBe(midiF1.tempoMap[i]?.tick);
      expect(midiF0.tempoMap[i]?.bpm).toBeCloseTo(midiF1.tempoMap[i]?.bpm ?? 0, 6);
      expect(midiF0.tempoMap[i]?.seconds).toBeCloseTo(midiF1.tempoMap[i]?.seconds ?? 0, 8);
    }

    // 3. Extract and sort all notes across all tracks in Format 1
    const f0Notes = midiF0.tracks.flatMap((t) => t.notes).sort(compareNotes);
    const f1Notes = midiF1.tracks.flatMap((t) => t.notes).sort(compareNotes);

    expect(f0Notes.length).toBe(10);
    expect(f1Notes.length).toBe(10);
    expect(f0Notes.length).toBe(f1Notes.length);

    // 4. Note-for-note comparison across every single musical attribute
    for (let i = 0; i < f0Notes.length; i++) {
      const n0 = f0Notes[i]!;
      const n1 = f1Notes[i]!;

      expect(n0.pitch).toBe(n1.pitch);
      expect(n0.channel).toBe(n1.channel);
      expect(n0.velocity).toBe(n1.velocity);
      expect(n0.startTick).toBe(n1.startTick);
      expect(n0.durationTicks).toBe(n1.durationTicks);
      expect(n0.startSeconds).toBeCloseTo(n1.startSeconds, 9);
      expect(n0.durationSeconds).toBeCloseTo(n1.durationSeconds, 9);
    }
  });

  it('should preserve parity with staggered track lengths (Track 1 ends earlier than Track 2)', () => {
    const ppq = 480;

    // Track 1 ends at tick 480
    const trk1Events: AbstractEvent[] = [
      { tick: 0, bytes: [0x90, 60, 100] },
      { tick: 480, bytes: [0x90, 60, 0] },
    ];

    // Track 2 ends at tick 1920
    const trk2Events: AbstractEvent[] = [
      { tick: 960, bytes: [0x91, 64, 90] },
      { tick: 1920, bytes: [0x91, 64, 0] },
    ];

    // Format 0
    const f0Merged = [...trk1Events, ...trk2Events].sort((a, b) => a.tick - b.tick);
    const f0Stream: number[] = [];
    let lastT = 0;
    for (const e of f0Merged) {
      f0Stream.push(...encodeVLQ(e.tick - lastT), ...e.bytes);
      lastT = e.tick;
    }
    const midiF0 = parseMidi(buildMidiBinary(0, ppq, [buildTrackChunk(f0Stream)]));

    // Format 1
    function toStream(evs: AbstractEvent[]): number[] {
      const s: number[] = [];
      let lt = 0;
      for (const e of evs) {
        s.push(...encodeVLQ(e.tick - lt), ...e.bytes);
        lt = e.tick;
      }
      return s;
    }
    const midiF1 = parseMidi(
      buildMidiBinary(1, ppq, [buildTrackChunk(toStream(trk1Events)), buildTrackChunk(toStream(trk2Events))])
    );

    expect(midiF0.totalTicks).toBe(1920);
    expect(midiF1.totalTicks).toBe(1920);
    expect(midiF0.durationSeconds).toBeCloseTo(midiF1.durationSeconds, 8);

    const f0Notes = midiF0.tracks.flatMap((t) => t.notes).sort(compareNotes);
    const f1Notes = midiF1.tracks.flatMap((t) => t.notes).sort(compareNotes);

    expect(f0Notes.length).toBe(2);
    expect(f1Notes.length).toBe(2);

    for (let i = 0; i < f0Notes.length; i++) {
      expect(f0Notes[i]?.startTick).toBe(f1Notes[i]?.startTick);
      expect(f0Notes[i]?.durationTicks).toBe(f1Notes[i]?.durationTicks);
      expect(f0Notes[i]?.startSeconds).toBeCloseTo(f1Notes[i]?.startSeconds ?? 0, 9);
      expect(f0Notes[i]?.durationSeconds).toBeCloseTo(f1Notes[i]?.durationSeconds ?? 0, 9);
    }
  });

  it('should accurately detect Channel 9 percussion across both Format 0 and Format 1', () => {
    const ppq = 480;

    // Track with Channel 9 notes
    const drumEvents: AbstractEvent[] = [
      { tick: 0, bytes: [0x99, 36, 100] },
      { tick: 240, bytes: [0x99, 36, 0] },
    ];

    function toStream(evs: AbstractEvent[]): number[] {
      const s: number[] = [];
      let lt = 0;
      for (const e of evs) {
        s.push(...encodeVLQ(e.tick - lt), ...e.bytes);
        lt = e.tick;
      }
      return s;
    }

    const midiF0 = parseMidi(buildMidiBinary(0, ppq, [buildTrackChunk(toStream(drumEvents))]));
    expect(midiF0.tracks[0]?.isPercussion).toBe(true);

    const midiF1 = parseMidi(
      buildMidiBinary(1, ppq, [
        buildTrackChunk([]), // Track 0 empty
        buildTrackChunk(toStream(drumEvents)), // Track 1 drums
      ])
    );
    expect(midiF1.tracks[1]?.isPercussion).toBe(true);
  });

  it('should maintain time signature and key signature parity between Format 0 and Format 1', () => {
    const ppq = 480;

    // Time signature: 3/4 at tick 0
    // Key signature: G major (1 sharp) at tick 0
    const metaEvents: AbstractEvent[] = [
      { tick: 0, bytes: [0xff, 0x58, 0x04, 0x03, 0x01, 0x18, 0x08] }, // 3/2 (3/2^1 = 3/2 or dd=2 for 3/4)
      { tick: 0, bytes: [0xff, 0x59, 0x02, 0x01, 0x00] }, // 1 sharp, major
    ];

    const noteEvents: AbstractEvent[] = [
      { tick: 0, bytes: [0x90, 60, 100] },
      { tick: 480, bytes: [0x90, 60, 0] },
    ];

    function toStream(evs: AbstractEvent[]): number[] {
      const s: number[] = [];
      let lt = 0;
      for (const e of evs) {
        s.push(...encodeVLQ(e.tick - lt), ...e.bytes);
        lt = e.tick;
      }
      return s;
    }

    // Format 0
    const f0Merged = [...metaEvents, ...noteEvents].sort((a, b) => a.tick - b.tick);
    const midiF0 = parseMidi(buildMidiBinary(0, ppq, [buildTrackChunk(toStream(f0Merged))]));

    // Format 1
    const midiF1 = parseMidi(
      buildMidiBinary(1, ppq, [
        buildTrackChunk(toStream(metaEvents)),
        buildTrackChunk(toStream(noteEvents)),
      ])
    );

    expect(midiF0.timeSignatures.length).toBe(1);
    expect(midiF1.timeSignatures.length).toBe(1);
    expect(midiF0.timeSignatures[0]?.numerator).toBe(midiF1.timeSignatures[0]?.numerator);
    expect(midiF0.timeSignatures[0]?.denominator).toBe(midiF1.timeSignatures[0]?.denominator);

    expect(midiF0.keySignatures.length).toBe(1);
    expect(midiF1.keySignatures.length).toBe(1);
    expect(midiF0.keySignatures[0]?.key).toBe(midiF1.keySignatures[0]?.key);
    expect(midiF0.keySignatures[0]?.scale).toBe(midiF1.keySignatures[0]?.scale);
  });
});

/**
 * Helper to sort notes consistently for cross-format comparison.
 */
function compareNotes(a: MidiRawNote, b: MidiRawNote): number {
  if (a.startTick !== b.startTick) return a.startTick - b.startTick;
  if (a.pitch !== b.pitch) return a.pitch - b.pitch;
  return a.channel - b.channel;
}

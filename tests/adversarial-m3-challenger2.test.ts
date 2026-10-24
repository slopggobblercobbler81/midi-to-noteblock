/**
 * tests/adversarial-m3-challenger2.test.ts
 *
 * Empirical Adversarial Challenge Suite for Milestone 3:
 * Note Block Mapping, Repeater Delay Decomposition & Quantizer Engine.
 *
 * Authored by: Milestone 3 Challenger 2 (teamwork_preview_challenger_m3_2)
 *
 * Challenge Dimensions:
 * 1. Repeater Chain Invariant:
 *    - For all integer deltas in [0, 1000], verify:
 *      * Each element is in {1, 2, 3, 4} (or empty array for 0)
 *      * Sum of delays === delta
 *      * Minimal repeater count === Math.ceil(delta / 4)
 *    - Boundary and stress deltas (1001, 4000, 10000, 250000)
 *    - Degenerate inputs (negative, non-integer floats, NaN, Infinity)
 * 2. Cumulative Timing Quantization & Absolute Drift Invariance:
 *    - 50,000 synthetic notes with microsecond precision & varying tempos
 *    - Strict non-negative integer ticks
 *    - Zero cumulative drift: |tick * 0.1 - timestamp| <= 0.05s
 *    - Pairwise delta accumulation invariant: sum(deltas) === tick_N - tick_0
 *    - Irrational / micro-timing rhythmic subdivisions (triplets, septuplets, prime offsets)
 * 3. Massive Workload & High-Polyphony Timeline Stress:
 *    - 25,000+ notes across 16 tracks converted to SongTimeline in < 500ms
 *    - Completeness (25k events preserved) & Map grouping invariants
 *    - Strict chronological sorting (tick -> time -> track -> note)
 *    - High-polyphony burst (1000 simultaneous notes on a single tick)
 * 4. Edge Cases & Boundary Conditions:
 *    - Zero-duration / empty MIDI files
 *    - Tracks with 0 notes
 *    - Tempo of 0, negative BPM, and missing tempoMap
 *    - Percussion-only MIDI files (transposition immunity & valid base blocks)
 *    - Extreme pitches (-1000 to +1000) with harmonic octave preservation
 *    - Conversion options permutation stress (preserveKey, manualTranspose, enableOctaveFolding)
 * 5. Complete GM Instrument & Percussion Table Specification Compliance:
 *    - All 128 GM instruments mapped to valid vanilla instruments and base blocks
 *    - All 47 GM percussion keys mapped to valid instruments, blocks, and [0, 24] notes
 * 6. TypeScript AST Strict Typing & Zero-Any Audit:
 *    - Zero `any` keywords in `src/core/noteblock-mapper.ts`
 *    - Zero `@ts-ignore` or `@ts-nocheck` annotations
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import {
  type MidiFile,
  type MidiTrack,
  type MidiRawNote,
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  BASE_NOTE_PITCH_MIDI,
  MAX_NOTE_PITCH_MIDI,
  MINECRAFT_INSTRUMENTS,
  INSTRUMENT_METADATA,
  isMinecraftInstrument,
  REDSTONE_TICK_SECONDS,
} from '../src/core/types';
import {
  decomposeRepeaterDelay,
  quantizeToRedstoneTick,
  foldToRange,
  foldToRangeDetailed,
  mapMidiInstrument,
  mapMidiPercussion,
  mapMidiPitchToNoteBlock,
  calculateOptimalTransposition,
  findOptimalTransposition,
  convertToSongTimeline,
  getBaseBlock,
  getNaturalOctaveOffset,
  GM_INSTRUMENT_MAP,
  GM_PERCUSSION_MAP,
} from '../src/core/noteblock-mapper';

// ============================================================================
// ADVERSARIAL HELPER FACTORIES
// ============================================================================

/**
 * Creates a synthetic MidiFile with precise note placements for stress testing.
 */
function createSyntheticMidi(
  tracksData: Array<{
    id?: number;
    name?: string;
    channel?: number;
    program?: number;
    isPercussion?: boolean;
    notes: Array<{
      pitch: number;
      startSeconds: number;
      durationSeconds?: number;
      velocity?: number;
      channel?: number;
      program?: number;
    }>;
  }>,
  options?: {
    bpm?: number;
    durationSeconds?: number;
  }
): MidiFile {
  const bpm = options?.bpm ?? 120;
  const tracks: MidiTrack[] = tracksData.map((t, index) => {
    const isPerc = t.isPercussion ?? (t.channel === 9);
    const rawNotes: MidiRawNote[] = t.notes.map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity ?? 80,
      startTick: Math.round(n.startSeconds * 480),
      durationTicks: Math.round((n.durationSeconds ?? 0.25) * 480),
      startSeconds: n.startSeconds,
      durationSeconds: n.durationSeconds ?? 0.25,
      channel: n.channel ?? (isPerc ? 9 : (t.channel ?? 0)),
      program: n.program ?? t.program ?? 0,
    }));

    const maxNoteEnd = rawNotes.reduce(
      (max, n) => Math.max(max, n.startSeconds + n.durationSeconds),
      0
    );

    return {
      id: t.id ?? index,
      name: t.name ?? `Track ${t.id ?? index}`,
      channel: isPerc ? 9 : (t.channel ?? 0),
      instrumentProgram: t.program ?? 0,
      isPercussion: isPerc,
      notes: rawNotes,
      totalTicks: Math.round(maxNoteEnd * 480),
    };
  });

  const calculatedDuration = tracks.reduce((max, tr) => {
    const trackEnd = tr.notes.reduce((m, n) => Math.max(m, n.startSeconds + n.durationSeconds), 0);
    return Math.max(max, trackEnd);
  }, 0);

  const durationSeconds = options?.durationSeconds !== undefined ? options.durationSeconds : calculatedDuration;

  return {
    format: 1,
    numTracks: tracks.length,
    ticksPerQuarterNote: 480,
    tracks,
    tempoMap: [{ tick: 0, microsecondsPerQuarter: Math.round(60_000_000 / (bpm || 120)), bpm, seconds: 0 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondsPerQuarter: 8 }],
    keySignatures: [],
    durationSeconds,
    totalTicks: Math.round(durationSeconds * 480),
  };
}

// ============================================================================
// SUITE 1: REPEATER CHAIN INVARIANT & MINIMALITY
// ============================================================================

describe('Adversarial Challenge 1: Repeater Delay Decomposition Sum & Minimality Invariant', () => {
  it('should verify repeater chain invariant for all delta values in [0, 1000]', () => {
    for (let delta = 0; delta <= 1000; delta++) {
      const repeaters = decomposeRepeaterDelay(delta);

      if (delta === 0) {
        expect(repeaters).toEqual([]);
        continue;
      }

      // 1. Invariant: length is minimal (ceil(delta / 4))
      const expectedCount = Math.ceil(delta / 4);
      expect(repeaters.length).toBe(expectedCount);

      // 2. Invariant: sum of repeater delays exactly equals delta
      const sum = repeaters.reduce((acc, delay) => acc + delay, 0);
      expect(sum).toBe(delta);

      // 3. Invariant: each delay element is physically realizable by Minecraft redstone repeater (1, 2, 3, or 4)
      for (let i = 0; i < repeaters.length; i++) {
        const d = repeaters[i]!;
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(4);
        expect(Number.isInteger(d)).toBe(true);

        // 4. Greedy structure: all repeaters except possibly the last one MUST have delay 4
        if (i < repeaters.length - 1) {
          expect(d).toBe(4);
        } else {
          const expectedLast = delta % 4 === 0 ? 4 : delta % 4;
          expect(d).toBe(expectedLast);
        }
      }
    }
  });

  it('should maintain invariants for massive redstone delay intervals up to 1,000,000 ticks', () => {
    const stressDeltas = [1001, 1024, 4000, 9999, 10000, 65536, 100000, 250000, 1000000];

    for (const delta of stressDeltas) {
      const repeaters = decomposeRepeaterDelay(delta);
      const expectedCount = Math.ceil(delta / 4);

      expect(repeaters.length).toBe(expectedCount);
      const sum = repeaters.reduce((acc, d) => acc + d, 0);
      expect(sum).toBe(delta);
      expect(repeaters[0]).toBe(4);
      expect(repeaters[repeaters.length - 1]).toBe(delta % 4 === 0 ? 4 : delta % 4);
    }
  });

  it('should handle degenerate, fractional, negative, and non-finite inputs gracefully', () => {
    // Zero
    expect(decomposeRepeaterDelay(0)).toEqual([]);

    // Negative values
    expect(decomposeRepeaterDelay(-1)).toEqual([]);
    expect(decomposeRepeaterDelay(-4)).toEqual([]);
    expect(decomposeRepeaterDelay(-100)).toEqual([]);
    expect(decomposeRepeaterDelay(-0.0001)).toEqual([]);

    // Non-finite numbers
    expect(decomposeRepeaterDelay(NaN)).toEqual([]);
    expect(decomposeRepeaterDelay(Infinity)).toEqual([]);
    expect(decomposeRepeaterDelay(-Infinity)).toEqual([]);

    // Fractional numbers (should floor ticks safely)
    const floatResult1 = decomposeRepeaterDelay(5.9);
    expect(floatResult1).toEqual([4, 1]);
    expect(floatResult1.reduce((a, b) => a + b, 0)).toBe(5);

    const floatResult2 = decomposeRepeaterDelay(0.9);
    expect(floatResult2).toEqual([]);
  });
});

// ============================================================================
// SUITE 2: CUMULATIVE TIMING DRIFT & 10 HZ REDSTONE QUANTIZATION
// ============================================================================

describe('Adversarial Challenge 2: Cumulative Timing Quantization & Absolute Drift Invariance', () => {
  it('should never accumulate timing drift across 50,000 synthetic notes with microsecond timestamps', () => {
    const NOTE_COUNT = 50_000;
    const ticks: number[] = new Array<number>(NOTE_COUNT);
    const times: number[] = new Array<number>(NOTE_COUNT);

    // Generate 50,000 synthetic notes at varying tempos and fractional second offsets
    // Spans approximately 5,000 seconds of music (~1.4 hours)
    let currentTime = 0.00314159; // Irrationally offset start time
    for (let i = 0; i < NOTE_COUNT; i++) {
      times[i] = currentTime;
      ticks[i] = quantizeToRedstoneTick(currentTime);

      // Vary inter-note interval between 0.05s (1 redstone tick boundary), 0.10s, 0.133s (triplets), and 0.25s
      const delta = 0.05 + ((i * 37) % 200) * 0.001; // 0.050s to 0.249s
      currentTime += delta;
    }

    // 1. Verify every single quantized tick is a non-negative integer
    for (let i = 0; i < NOTE_COUNT; i++) {
      const tick = ticks[i]!;
      expect(Number.isInteger(tick)).toBe(true);
      expect(tick).toBeGreaterThanOrEqual(0);

      // 2. Maximum absolute error to physical time is strictly bounded by half a redstone tick (0.05s / 50ms)
      const reconstructedSeconds = tick * REDSTONE_TICK_SECONDS;
      const error = Math.abs(reconstructedSeconds - times[i]!);
      expect(error).toBeLessThanOrEqual(0.0500000001);
    }

    // 3. Verify absolute zero cumulative drift:
    // When placing notes on a timeline, the sum of quantized deltas between successive notes
    // MUST equal exactly the total quantized span: tick_N - tick_0
    let cumulativeQuantizedDelta = 0;
    for (let i = 1; i < NOTE_COUNT; i++) {
      const deltaTick = ticks[i]! - ticks[i - 1]!;
      expect(deltaTick).toBeGreaterThanOrEqual(0); // Monotonicity guarantee
      cumulativeQuantizedDelta += deltaTick;
    }

    const totalSpan = ticks[NOTE_COUNT - 1]! - ticks[0]!;
    expect(cumulativeQuantizedDelta).toBe(totalSpan);

    // 4. Contrast against naive rounded-delta accumulation which would drift drastically
    let naiveAccumulatedTime = times[0]!;
    for (let i = 1; i < 1000; i++) {
      const dt = times[i]! - times[i - 1]!;
      const naiveDeltaTick = Math.round(dt * 10);
      naiveAccumulatedTime += naiveDeltaTick * 0.1;
    }
    const naiveDrift = Math.abs(naiveAccumulatedTime - times[999]!);
    expect(naiveDrift).toBeGreaterThan(0.05);
    // In contrast, absolute quantization produces error strictly bounded by 0.05s
    expect(Math.abs(ticks[999]! * 0.1 - times[999]!)).toBeLessThanOrEqual(0.05);
  });

  it('should accurately quantize awkward rhythmic subdivisions without error', () => {
    // Musical Triplets (1/3s = 0.3333...s, 2/3s = 0.6666...s, 1s = 1.0s)
    expect(quantizeToRedstoneTick(1 / 3)).toBe(3); // 3.333 -> 3
    expect(quantizeToRedstoneTick(2 / 3)).toBe(7); // 6.666 -> 7
    expect(quantizeToRedstoneTick(1.0)).toBe(10); // 10.0 -> 10

    // Septuplets (1/7s, 2/7s, 3/7s, etc.)
    for (let k = 1; k <= 7; k++) {
      const sec = k / 7;
      const tick = quantizeToRedstoneTick(sec);
      expect(Math.abs(tick * 0.1 - sec)).toBeLessThanOrEqual(0.05000001);
    }

    // Exact midpoints: 0.05s, 0.15s, 0.25s, 0.35s
    expect(quantizeToRedstoneTick(0.05)).toBe(1);
    expect(quantizeToRedstoneTick(0.15)).toBe(2);
    expect(quantizeToRedstoneTick(0.25)).toBe(3);
    expect(quantizeToRedstoneTick(0.35)).toBe(4);
  });

  it('should handle boundary, negative, and invalid second inputs in quantizer', () => {
    expect(quantizeToRedstoneTick(0)).toBe(0);
    expect(quantizeToRedstoneTick(-0.001)).toBe(0);
    expect(quantizeToRedstoneTick(-100)).toBe(0);
    expect(quantizeToRedstoneTick(NaN)).toBe(0);
    expect(quantizeToRedstoneTick(Infinity)).toBe(0);
    expect(quantizeToRedstoneTick(-Infinity)).toBe(0);

    // Large duration: 24 hours of continuous playback (86,400s = 864,000 ticks)
    expect(quantizeToRedstoneTick(86400)).toBe(864_000);
    expect(quantizeToRedstoneTick(86400.04)).toBe(864_000);
    expect(quantizeToRedstoneTick(86400.06)).toBe(864_001);
  });
});

// ============================================================================
// SUITE 3: MASSIVE WORKLOAD & HIGH POLYPHONY TIMELINE STRESS
// ============================================================================

describe('Adversarial Challenge 3: Massive Workload & High-Polyphony Timeline Stress', () => {
  it('should convert a massive 25,000-note MIDI file in < 500ms without memory leak or stack overflow', () => {
    const TOTAL_NOTES = 25_000;
    const TRACK_COUNT = 16;
    const notesPerTrack = Math.floor(TOTAL_NOTES / TRACK_COUNT);

    const tracksData = [];
    for (let tr = 0; tr < TRACK_COUNT; tr++) {
      const isPerc = tr === 9;
      const notes = [];
      for (let n = 0; n < notesPerTrack; n++) {
        // Distribute notes chronologically with slight overlaps and chords
        const startSec = (n * 0.1) + ((tr % 4) * 0.025);
        const pitch = isPerc ? (35 + (n % 47)) : (30 + ((tr * 5 + n) % 60));
        notes.push({
          pitch,
          startSeconds: startSec,
          durationSeconds: 0.2,
          velocity: 70 + (n % 50),
          channel: tr,
          program: tr * 8,
        });
      }
      tracksData.push({
        id: tr,
        name: isPerc ? 'Percussion Track' : `Orchestra Track ${tr}`,
        channel: tr,
        program: tr * 8,
        isPercussion: isPerc,
        notes,
      });
    }

    const syntheticMidi = createSyntheticMidi(tracksData);
    const expectedTotalNotes = TRACK_COUNT * notesPerTrack;
    expect(expectedTotalNotes).toBeGreaterThanOrEqual(20_000);

    // Measure throughput and execution time
    const startTime = performance.now();
    const timeline = convertToSongTimeline(syntheticMidi);
    const elapsedMs = performance.now() - startTime;

    // 1. Throughput performance invariant: < 500ms
    expect(elapsedMs).toBeLessThan(500);

    // 2. Data integrity invariants
    expect(timeline.allEvents.length).toBe(expectedTotalNotes);

    // 3. Polyphonic grouping invariant: sum of lengths in eventsByTick must equal total notes
    let totalGroupedEvents = 0;
    for (const events of timeline.eventsByTick.values()) {
      totalGroupedEvents += events.length;
    }
    expect(totalGroupedEvents).toBe(expectedTotalNotes);

    // 4. Chronological ordering invariant across entire timeline
    for (let i = 0; i < timeline.allEvents.length - 1; i++) {
      const a = timeline.allEvents[i]!;
      const b = timeline.allEvents[i + 1]!;
      if (a.redstoneTick === b.redstoneTick) {
        expect(a.timestampSeconds).toBeLessThanOrEqual(b.timestampSeconds);
      } else {
        expect(a.redstoneTick).toBeLessThan(b.redstoneTick);
      }
    }

    // 5. Track summaries invariant
    expect(timeline.tracks.length).toBe(TRACK_COUNT);
    const totalTrackNotes = timeline.tracks.reduce((sum, t) => sum + t.noteCount, 0);
    expect(totalTrackNotes).toBe(expectedTotalNotes);

    // 6. Output pitch invariant for every note in the massive workload: 0 <= note <= 24
    for (const ev of timeline.allEvents) {
      expect(ev.note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
      expect(ev.note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);
      expect(Number.isInteger(ev.note)).toBe(true);
      expect(isMinecraftInstrument(ev.instrument)).toBe(true);
    }
  });

  it('should handle extreme polyphonic chord bursts of 1,000 simultaneous notes on the same tick', () => {
    const BURST_COUNT = 1000;
    const burstNotes = [];

    for (let i = 0; i < BURST_COUNT; i++) {
      burstNotes.push({
        pitch: (i % 128),
        startSeconds: 5.0, // Exactly 5.0 seconds = tick 50
        durationSeconds: 1.0,
        velocity: 80,
        channel: i % 16,
        program: (i * 7) % 128,
      });
    }

    const burstMidi = createSyntheticMidi([{
      id: 0,
      name: 'Mega Burst',
      channel: 0,
      program: 0,
      notes: burstNotes,
    }]);

    const startTime = performance.now();
    const timeline = convertToSongTimeline(burstMidi);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(200);
    expect(timeline.allEvents.length).toBe(BURST_COUNT);

    const tick50Events = timeline.eventsByTick.get(50);
    expect(tick50Events).toBeDefined();
    expect(tick50Events!.length).toBe(BURST_COUNT);

    // Check all are clamped in [0, 24]
    for (const ev of tick50Events!) {
      expect(ev.redstoneTick).toBe(50);
      expect(ev.note).toBeGreaterThanOrEqual(0);
      expect(ev.note).toBeLessThanOrEqual(24);
    }
  });
});

// ============================================================================
// SUITE 4: EDGE CASES & DEGENERATE SMF INPUTS
// ============================================================================

describe('Adversarial Challenge 4: Edge Cases & Degenerate SMF Workloads', () => {
  it('should handle zero-duration and empty MIDI files without errors or NaN values', () => {
    // 1. Completely empty MIDI file
    const emptyMidi: MidiFile = {
      format: 0,
      numTracks: 0,
      ticksPerQuarterNote: 480,
      tracks: [],
      tempoMap: [],
      timeSignatures: [],
      keySignatures: [],
      durationSeconds: 0,
      totalTicks: 0,
    };

    const emptyTimeline = convertToSongTimeline(emptyMidi);
    expect(emptyTimeline.allEvents).toEqual([]);
    expect(emptyTimeline.eventsByTick.size).toBe(0);
    expect(emptyTimeline.tracks).toEqual([]);
    expect(emptyTimeline.totalRedstoneTicks).toBe(0);
    expect(emptyTimeline.durationSeconds).toBe(0);
    expect(emptyTimeline.bpm).toBe(120); // Default fallback

    // 2. MIDI with tracks but zero notes
    const emptyTrackMidi = createSyntheticMidi([
      { id: 0, name: 'Silent Track 1', notes: [] },
      { id: 1, name: 'Silent Track 2', notes: [] },
    ], { durationSeconds: 0 });

    const timeline2 = convertToSongTimeline(emptyTrackMidi);
    expect(timeline2.allEvents).toEqual([]);
    expect(timeline2.tracks.length).toBe(2);
    expect(timeline2.tracks[0]!.noteCount).toBe(0);
    expect(timeline2.tracks[1]!.noteCount).toBe(0);
    expect(timeline2.totalRedstoneTicks).toBe(0);
  });

  it('should handle zero, negative, and extreme BPM values safely', () => {
    // Tempo map with 0 BPM
    const zeroBpmMidi: MidiFile = {
      format: 0,
      numTracks: 1,
      ticksPerQuarterNote: 480,
      tracks: [{
        id: 0,
        name: 'Zero BPM',
        channel: 0,
        instrumentProgram: 0,
        isPercussion: false,
        notes: [{
          pitch: 60,
          velocity: 80,
          startTick: 0,
          durationTicks: 480,
          startSeconds: 0.5,
          durationSeconds: 0.5,
          channel: 0,
          program: 0,
        }],
        totalTicks: 480,
      }],
      tempoMap: [{ tick: 0, microsecondsPerQuarter: 0, bpm: 0, seconds: 0 }],
      timeSignatures: [],
      keySignatures: [],
      durationSeconds: 1.0,
      totalTicks: 480,
    };

    const timeline = convertToSongTimeline(zeroBpmMidi);
    expect(Number.isFinite(timeline.bpm)).toBe(true);
    expect(timeline.allEvents.length).toBe(1);
    expect(timeline.allEvents[0]!.redstoneTick).toBe(5);

    // Negative BPM edge case
    const negBpmMidi: MidiFile = {
      ...zeroBpmMidi,
      tempoMap: [{ tick: 0, microsecondsPerQuarter: -500000, bpm: -120, seconds: 0 }],
    };
    const timelineNeg = convertToSongTimeline(negBpmMidi);
    expect(Number.isFinite(timelineNeg.bpm)).toBe(true);
  });

  it('should process percussion-only MIDI with strict transposition immunity', () => {
    // Synthetic MIDI file containing only drum events on Channel 9
    const drumNotes = [
      { pitch: 35, startSeconds: 0.0 }, // Acoustic Bass Drum -> basedrum, note 1
      { pitch: 38, startSeconds: 0.1 }, // Acoustic Snare -> snare, note 8
      { pitch: 42, startSeconds: 0.2 }, // Closed Hi-Hat -> hat, note 22
      { pitch: 56, startSeconds: 0.3 }, // Cowbell -> cow_bell, note 12
      { pitch: 81, startSeconds: 0.4 }, // Open Triangle -> chime, note 24
      // Edge drum keys outside standard 35-81 range
      { pitch: 20, startSeconds: 0.5 }, // Sub kick -> basedrum, note 2
      { pitch: 95, startSeconds: 0.6 }, // High click -> hat, note 20
    ];

    const drumMidi = createSyntheticMidi([{
      id: 0,
      name: 'Drums Only',
      channel: 9,
      isPercussion: true,
      notes: drumNotes,
    }]);

    // Test with extreme manual transpositions: +12 and -7
    const timelineNormal = convertToSongTimeline(drumMidi);
    const timelineTransposed = convertToSongTimeline(drumMidi, { manualTranspose: 12 });

    expect(timelineNormal.allEvents.length).toBe(drumNotes.length);
    expect(timelineTransposed.allEvents.length).toBe(drumNotes.length);

    // Verify drum notes NEVER transpose regardless of manualTranspose
    for (let i = 0; i < drumNotes.length; i++) {
      const normalEv = timelineNormal.allEvents[i]!;
      const transposedEv = timelineTransposed.allEvents[i]!;

      expect(normalEv.note).toBe(transposedEv.note);
      expect(normalEv.instrument).toBe(transposedEv.instrument);
      expect(normalEv.baseBlock).toBe(transposedEv.baseBlock);

      // Verify all notes are within valid Minecraft semitone boundaries
      expect(normalEv.note).toBeGreaterThanOrEqual(0);
      expect(normalEv.note).toBeLessThanOrEqual(24);
    }
  });

  it('should fold extreme pitches from -1000 to +1000 preserving harmonic pitch class', () => {
    const extremePitches = [
      -1000, -500, -120, -54, -1, 0, 1, 12, 24, 36, 48, 53,
      54, 60, 66, 78,
      79, 84, 96, 120, 127, 128, 255, 500, 1000,
    ];

    for (const pitch of extremePitches) {
      // 1. With octave folding enabled (default)
      const foldedDetailed = foldToRangeDetailed(pitch, 0, true);
      expect(foldedDetailed.note).toBeGreaterThanOrEqual(0);
      expect(foldedDetailed.note).toBeLessThanOrEqual(24);
      expect(Number.isInteger(foldedDetailed.note)).toBe(true);

      // Harmonic pitch class invariance: (foldedPitch - originalPitch) must be a multiple of 12
      const semitoneDifference = foldedDetailed.foldedPitch - pitch;
      expect(Math.abs(semitoneDifference) % 12).toBe(0);

      // Simple signature returns identical note
      const simpleNote = foldToRange(pitch);
      expect(simpleNote).toBe(foldedDetailed.note);

      // 2. With octave folding disabled (clamping mode)
      const clampedDetailed = foldToRangeDetailed(pitch, 0, false);
      expect(clampedDetailed.note).toBeGreaterThanOrEqual(0);
      expect(clampedDetailed.note).toBeLessThanOrEqual(24);

      if (pitch < BASE_NOTE_PITCH_MIDI) {
        expect(clampedDetailed.note).toBe(0);
      } else if (pitch > MAX_NOTE_PITCH_MIDI) {
        expect(clampedDetailed.note).toBe(24);
      } else {
        expect(clampedDetailed.note).toBe(pitch - BASE_NOTE_PITCH_MIDI);
      }
    }
  });

  it('should correctly handle conversion options variations', () => {
    const notes = [
      { pitch: 48, startSeconds: 0.1 }, // C3 (out of range, base is F#3 = 54)
      { pitch: 60, startSeconds: 0.2 }, // C4
      { pitch: 72, startSeconds: 0.3 }, // C5
    ];
    const midi = createSyntheticMidi([{ id: 0, notes }]);

    // 1. preserveKey: true restricts shifts to octave multiples {-24, -12, 0, 12, 24}
    const optShiftKeyPreserved = calculateOptimalTransposition(midi, true);
    expect([-24, -12, 0, 12, 24]).toContain(optShiftKeyPreserved);

    // 2. preserveKey: false allows chromatic shifts in [-6, 6]
    const optShiftChromatic = calculateOptimalTransposition(midi, false);
    expect(optShiftChromatic).toBeGreaterThanOrEqual(-6);
    expect(optShiftChromatic).toBeLessThanOrEqual(6);

    // Verify findOptimalTransposition directly handles raw note list
    expect(findOptimalTransposition(notes, { preserveKey: true })).toBe(optShiftKeyPreserved);
    expect(findOptimalTransposition(notes, { manualTranspose: 5 })).toBe(5);

    // 3. instrumentOverrides correctly overrides instrument and substrate baseBlock
    const timelineOverridden = convertToSongTimeline(midi, {
      instrumentOverrides: { 0: 'guitar' },
    });
    expect(timelineOverridden.tracks[0]!.instrument).toBe('guitar');
    for (const ev of timelineOverridden.allEvents) {
      expect(ev.instrument).toBe('guitar');
      expect(ev.baseBlock).toBe('minecraft:white_wool');
    }
  });

  it('should gracefully handle edge-case parameters in utility functions', () => {
    // mapMidiInstrument with out-of-range program numbers
    expect(mapMidiInstrument(-1).name).toBe('Acoustic Grand Piano');
    expect(mapMidiInstrument(128).name).toBe('Gunshot');
    expect(mapMidiInstrument(999).name).toBe('Gunshot');
    expect(mapMidiInstrument(NaN).name).toBe('Acoustic Grand Piano');

    // mapMidiPercussion with out-of-range pitches
    const lowDrum = mapMidiPercussion(10);
    expect(lowDrum.instrument).toBe('basedrum');
    expect(lowDrum.note).toBe(2);

    const highDrum = mapMidiPercussion(100);
    expect(highDrum.instrument).toBe('hat');
    expect(highDrum.note).toBe(20);

    // Unknown instrument names
    // @ts-expect-error testing invalid instrument input
    expect(getBaseBlock('non_existent_instrument')).toBe('minecraft:dirt');
    // @ts-expect-error testing invalid instrument input
    expect(getNaturalOctaveOffset('non_existent_instrument')).toBe(0);

    // mapMidiPitchToNoteBlock helper contract
    const mapped = mapMidiPitchToNoteBlock(60, 'harp');
    expect(mapped.note).toBe(6);
    expect(mapped.octaveShift).toBe(0);
  });
});

// ============================================================================
// SUITE 5: COMPLETE GM TABLE & PERCUSSION SPECIFICATION COMPLIANCE
// ============================================================================

describe('Adversarial Challenge 5: GM Tables & Minecraft Specification Invariants', () => {
  it('should verify all 128 General MIDI instruments map to valid Minecraft instruments and base blocks', () => {
    expect(GM_INSTRUMENT_MAP.length).toBe(128);

    for (let program = 0; program < 128; program++) {
      const mapping = GM_INSTRUMENT_MAP[program]!;
      expect(mapping.program).toBe(program);
      expect(typeof mapping.name).toBe('string');
      expect(mapping.name.length).toBeGreaterThan(0);

      // Instrument must be one of the 16 vanilla Minecraft instruments
      expect(MINECRAFT_INSTRUMENTS).toContain(mapping.instrument);

      // Base block must match physical vanilla metadata substrate
      const expectedBaseBlock = INSTRUMENT_METADATA[mapping.instrument].baseBlock;
      expect(mapping.baseBlock).toBe(expectedBaseBlock);

      // Octave offset must match physical vanilla metadata acoustic register
      const expectedOctaveOffset = INSTRUMENT_METADATA[mapping.instrument].octaveOffset;
      expect(mapping.octaveOffset).toBe(expectedOctaveOffset);
    }
  });

  it('should verify all 47 Channel 9 General MIDI percussion keys map to valid Minecraft instruments and pitches', () => {
    const percussionPitches = Object.keys(GM_PERCUSSION_MAP).map(Number);
    expect(percussionPitches.length).toBe(47);

    for (let pitch = 35; pitch <= 81; pitch++) {
      const mapping = GM_PERCUSSION_MAP[pitch];
      expect(mapping).toBeDefined();
      if (!mapping) continue;

      expect(mapping.pitch).toBe(pitch);
      expect(typeof mapping.name).toBe('string');
      expect(mapping.name.length).toBeGreaterThan(0);

      // Instrument must be valid vanilla Minecraft instrument
      expect(MINECRAFT_INSTRUMENTS).toContain(mapping.instrument);

      // Base block must match physical vanilla metadata substrate
      const expectedBaseBlock = INSTRUMENT_METADATA[mapping.instrument].baseBlock;
      expect(mapping.baseBlock).toBe(expectedBaseBlock);

      // Note must be strictly within Minecraft note block limits [0, 24]
      expect(mapping.note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
      expect(mapping.note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);
      expect(Number.isInteger(mapping.note)).toBe(true);
    }
  });
});

// ============================================================================
// SUITE 6: STRICT TYPING & ZERO-ANY AST AUDIT
// ============================================================================

describe('Adversarial Challenge 6: Strict Typing & Zero-Any AST Code Audit', () => {
  const rootDir = path.resolve(__dirname, '..');
  const mapperFilePath = path.join(rootDir, 'src', 'core', 'noteblock-mapper.ts');

  it('should verify zero usage of "any" keyword in src/core/noteblock-mapper.ts via TypeScript AST parser', () => {
    const sourceCode = fs.readFileSync(mapperFilePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      'noteblock-mapper.ts',
      sourceCode,
      ts.ScriptTarget.ES2022,
      true
    );

    const anyOccurrences: { line: number; character: number }[] = [];

    function visit(node: ts.Node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        anyOccurrences.push({ line: line + 1, character: character + 1 });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    expect(
      anyOccurrences,
      `Expected zero occurrences of 'any' in noteblock-mapper.ts, but found: ${JSON.stringify(anyOccurrences)}`
    ).toHaveLength(0);
  });

  it('should verify zero @ts-ignore or @ts-nocheck annotations in src/core/noteblock-mapper.ts', () => {
    const sourceCode = fs.readFileSync(mapperFilePath, 'utf-8');
    expect(sourceCode).not.toContain('@ts-ignore');
    expect(sourceCode).not.toContain('@ts-nocheck');
    expect(sourceCode).not.toContain('@ts-expect-error');
  });
});

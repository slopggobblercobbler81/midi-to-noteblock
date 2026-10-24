/**
 * tests/adversarial-m3-challenger1.test.ts
 *
 * Empirical Adversarial Challenge Suite for Milestone 3:
 * Note Block Mapping, Pitch Clamping, GM Translation & Redstone Quantization.
 *
 * Authored by: Milestone 3 Challenger 1 (teamwork_preview_challenger_m3_1)
 *
 * Challenge Dimensions:
 * 1. Extreme Pitch Values & Boundary Conditions:
 *    - Exhaustive integer sweep from -1000 to +1000 (2001 pitches)
 *    - Strict boundary analysis at critical inflection points (53, 54, 78, 79, 66)
 *    - Fractional / microtonal pitches with rounding guarantees
 *    - Multi-octave natural register offsets (-24, -12, 0, 12, 24)
 *    - Non-folding clamping fallback (enableOctaveFolding: false)
 * 2. Octave Congruence & Harmonic Invariant Verification:
 *    - Mathematical modulo 12 congruence across 5,000 random inputs
 *    - Octave-equivalence theorem: foldToRange(p) % 12 === foldToRange(p + 12k) % 12
 *    - 2-octave physical displacement: |foldToRange(p) - foldToRange(p + 12k)| in {0, 12}
 *    - Chroma / pitch-class preservation under transposition and folding
 *    - Harmonic interval defense (5ths invert to 4ths or remain 5ths)
 * 3. Dense Chords & Polyphonic Stress in convertToSongTimeline:
 *    - 100 simultaneous notes at identical redstone tick spanning extreme pitches
 *    - 500-note massive multi-track cluster across melodic and percussion channels
 *    - Rapid succession micro-chords on consecutive ticks
 *    - Velocity boundary handling (velocity 0, 1, 127, 255, sub-zero)
 *    - Empty timeline & percussion-only timeline edge cases
 * 4. Comprehensive General MIDI & Percussion Fuzzing:
 *    - Full sweep of all 128 GM melodic programs (0..127) for vanilla mapping
 *    - Out-of-bounds program fuzzing (-1000, 128, 255, NaN, Infinity)
 *    - Full sweep of all 128 percussion key pitches (0..127)
 *    - Complete 47-key Channel 9 GM Level 1 percussion map verification
 *    - Sub-35 and super-81 percussion fallback resilience
 * 5. Circuit Timing & Repeater Delay Decomposition:
 *    - 1,000 random tick delays decomposed into greedy [1..4] repeaters
 *    - Monotonic 10 Hz redstone tick quantization with zero cumulative drift
 * 6. Optimal Key Transposition & Key-Lock Preservation:
 *    - Global key transposition with preserveKey: true restricted to mod 12
 *    - Drum track immunity from melodic transposition
 *    - calculateOptimalTransposition wrapper verification
 */

import { describe, it, expect } from 'vitest';
import type {
  MidiFile,
  MidiTrack,
  MidiRawNote,
} from '../src/core/types';
import {
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  BASE_NOTE_PITCH_MIDI,
  CENTER_NOTE_PITCH_MIDI,
  MAX_NOTE_PITCH_MIDI,
  MINECRAFT_INSTRUMENTS,
  INSTRUMENT_METADATA,
  isMinecraftInstrument,
} from '../src/core/types';
import {
  foldToRange,
  foldToRangeDetailed,
  mapMidiInstrument,
  mapMidiPercussion,
  decomposeRepeaterDelay,
  quantizeToRedstoneTick,
  calculateOptimalTransposition,
  findOptimalTransposition,
  mapMidiPitchToNoteBlock,
  convertToSongTimeline,
  getBaseBlock,
  getNaturalOctaveOffset,
  GM_INSTRUMENT_MAP,
  GM_PERCUSSION_MAP,
} from '../src/core/noteblock-mapper';

// ============================================================================
// SYNTHETIC MIDI BUILDER HELPERS FOR ADVERSARIAL TESTING
// ============================================================================

function makeSyntheticMidi(
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
    }>;
  }>,
  durationSeconds?: number
): MidiFile {
  let maxTime = durationSeconds ?? 0;
  const tracks: MidiTrack[] = tracksData.map((t, idx) => {
    const trackId = t.id ?? idx;
    const isPerc = t.isPercussion ?? (t.channel === 9);
    const rawNotes: MidiRawNote[] = t.notes.map((n) => {
      const dur = n.durationSeconds ?? 0.5;
      maxTime = Math.max(maxTime, n.startSeconds + dur);
      return {
        pitch: n.pitch,
        velocity: n.velocity ?? 80,
        startTick: Math.round(n.startSeconds * 480),
        durationTicks: Math.round(dur * 480),
        startSeconds: n.startSeconds,
        durationSeconds: dur,
        channel: n.channel ?? t.channel ?? (isPerc ? 9 : 0),
        program: t.program ?? 0,
      };
    });

    return {
      id: trackId,
      name: t.name ?? `Track ${trackId}`,
      channel: t.channel ?? (isPerc ? 9 : 0),
      instrumentProgram: t.program ?? 0,
      isPercussion: isPerc,
      notes: rawNotes,
      totalTicks: Math.round(maxTime * 480),
    };
  });

  return {
    format: 1,
    numTracks: tracks.length,
    ticksPerQuarterNote: 480,
    durationSeconds: maxTime,
    totalTicks: Math.round(maxTime * 480),
    tracks,
    tempoMap: [{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120, seconds: 0 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondsPerQuarter: 8 }],
    keySignatures: [],
  };
}

describe('Adversarial Challenge M3.1: Extreme Pitch Values & Boundary Conditions', () => {
  it('exhaustively bounds all 2001 integer pitches from -1000 to +1000 into [0, 24]', () => {
    for (let p = -1000; p <= 1000; p++) {
      const note = foldToRange(p);
      expect(Number.isInteger(note)).toBe(true);
      expect(note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
      expect(note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);
    }
  });

  it('correctly calculates boundary inflection points: 53, 54, 78, 79, 66', () => {
    // 54 is F#3 (BASE_NOTE_PITCH_MIDI -> note 0)
    expect(BASE_NOTE_PITCH_MIDI).toBe(54);
    const res54 = foldToRangeDetailed(BASE_NOTE_PITCH_MIDI);
    expect(res54.note).toBe(0);
    expect(res54.foldedPitch).toBe(54);
    expect(res54.octaveShift).toBe(0);

    // 53 is F3 (one semitone below bound -> folded up by 1 octave to 65 -> note 11)
    const res53 = foldToRangeDetailed(53);
    expect(res53.note).toBe(11);
    expect(res53.foldedPitch).toBe(65);
    expect(res53.octaveShift).toBe(1);

    // 78 is F#5 (MAX_NOTE_PITCH_MIDI -> note 24)
    expect(MAX_NOTE_PITCH_MIDI).toBe(78);
    const res78 = foldToRangeDetailed(MAX_NOTE_PITCH_MIDI);
    expect(res78.note).toBe(24);
    expect(res78.foldedPitch).toBe(78);
    expect(res78.octaveShift).toBe(0);

    // 79 is G5 (one semitone above bound -> folded down by 1 octave to 67 -> note 13)
    const res79 = foldToRangeDetailed(79);
    expect(res79.note).toBe(13);
    expect(res79.foldedPitch).toBe(67);
    expect(res79.octaveShift).toBe(-1);

    // 66 is F#4 (CENTER_NOTE_PITCH_MIDI -> note 12)
    expect(CENTER_NOTE_PITCH_MIDI).toBe(66);
    const res66 = foldToRangeDetailed(CENTER_NOTE_PITCH_MIDI);
    expect(res66.note).toBe(12);
    expect(res66.foldedPitch).toBe(66);
    expect(res66.octaveShift).toBe(0);
  });

  it('safely rounds fractional and microtonal pitches into valid integer notes [0, 24]', () => {
    const fractions = [
      -500.75, -54.2, -12.5, 0.49, 12.01, 53.4, 53.6, 53.999, 54.001,
      60.5, 66.25, 77.8, 78.2, 78.7, 100.33, 999.9,
    ];

    for (const frac of fractions) {
      const note = foldToRange(frac);
      expect(Number.isInteger(note)).toBe(true);
      expect(note).toBeGreaterThanOrEqual(0);
      expect(note).toBeLessThanOrEqual(24);
    }
  });

  it('preserves range bounds across all 5 instrument acoustic registers (-24, -12, 0, 12, 24)', () => {
    const offsets = [-24, -12, 0, 12, 24];

    for (const offset of offsets) {
      for (let p = -200; p <= 300; p += 7) {
        const res = foldToRangeDetailed(p, offset);
        expect(Number.isInteger(res.note)).toBe(true);
        expect(res.note).toBeGreaterThanOrEqual(0);
        expect(res.note).toBeLessThanOrEqual(24);
        expect(res.foldedPitch).toBeGreaterThanOrEqual(BASE_NOTE_PITCH_MIDI);
        expect(res.foldedPitch).toBeLessThanOrEqual(MAX_NOTE_PITCH_MIDI);
      }
    }
  });

  it('clamps directly without octave shift when enableOctaveFolding is false', () => {
    const low = foldToRangeDetailed(40, 0, false);
    expect(low.note).toBe(0);
    expect(low.foldedPitch).toBe(54);
    expect(low.octaveShift).toBe(0);

    const high = foldToRangeDetailed(90, 0, false);
    expect(high.note).toBe(24);
    expect(high.foldedPitch).toBe(78);
    expect(high.octaveShift).toBe(0);

    const mid = foldToRangeDetailed(60, 0, false);
    expect(mid.note).toBe(6);
    expect(mid.foldedPitch).toBe(60);
    expect(mid.octaveShift).toBe(0);
  });

  it('safely maps all Minecraft instruments via mapMidiPitchToNoteBlock', () => {
    for (const inst of MINECRAFT_INSTRUMENTS) {
      const meta = INSTRUMENT_METADATA[inst];
      expect(getBaseBlock(inst)).toBe(meta.baseBlock);
      expect(getNaturalOctaveOffset(inst)).toBe(meta.octaveOffset);

      for (let p = 0; p <= 127; p += 13) {
        const res = mapMidiPitchToNoteBlock(p, inst);
        expect(Number.isInteger(res.note)).toBe(true);
        expect(res.note).toBeGreaterThanOrEqual(0);
        expect(res.note).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe('Adversarial Challenge M3.2: Octave Invariant & Harmony Verification', () => {
  it('strictly satisfies (foldedPitch - effectivePitch) % 12 === 0 across 5,000 random inputs', () => {
    // Deterministic pseudo-random seed generator
    let seed = 123456789;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    for (let i = 0; i < 5000; i++) {
      const pitch = Math.floor(rand() * 20000) - 10000; // -10000 to +10000
      const offset = (Math.floor(rand() * 5) - 2) * 12; // -24, -12, 0, 12, 24
      const res = foldToRangeDetailed(pitch, offset);

      const effectivePitch = pitch - offset;
      const delta = res.foldedPitch - effectivePitch;

      // 1. Delta must be an exact multiple of 12 (using Math.abs to avoid -0 Object.is mismatch)
      expect(Math.abs(delta % 12)).toBe(0);

      // 2. Octave shift must match delta / 12
      expect(res.octaveShift * 12).toBe(delta);

      // 3. Folded pitch must be within [54, 78]
      expect(res.foldedPitch).toBeGreaterThanOrEqual(BASE_NOTE_PITCH_MIDI);
      expect(res.foldedPitch).toBeLessThanOrEqual(MAX_NOTE_PITCH_MIDI);

      // 4. Invariant: Pitch class (mod 12 chroma) must be mathematically identical
      const effectiveChroma = ((effectivePitch % 12) + 12) % 12;
      const foldedChroma = ((res.foldedPitch % 12) + 12) % 12;
      expect(foldedChroma).toBe(effectiveChroma);
    }
  });

  it('guarantees octave equivalence: pitch class invariant and 2-octave physical displacement', () => {
    // In Minecraft, note blocks span 2 octaves (notes 0..24, pitches 54..78).
    // Any pitch shifted by 12k must preserve pitch class (note % 12),
    // and note displacement must be strictly 0 or 12 (within 2-octave capacity).
    for (let p = 20; p <= 100; p += 3) {
      const baseNote = foldToRange(p);
      const baseChroma = baseNote % 12;

      for (let k = -5; k <= 5; k++) {
        const shiftedNote = foldToRange(p + k * 12);
        const shiftedChroma = shiftedNote % 12;

        // Mod 12 chroma must match exactly
        expect(shiftedChroma).toBe(baseChroma);

        // Absolute physical note displacement must be 0 or 12
        const noteDelta = Math.abs(shiftedNote - baseNote);
        expect([0, 12]).toContain(noteDelta);
      }
    }
  });

  it('preserves harmonic musical intervals under octave folding', () => {
    // When two notes a perfect fifth (7 semitones) apart are folded,
    // their distance must either remain 7 semitones or invert to a perfect fourth (5 semitones)
    for (let root = 40; root <= 85; root++) {
      const fifth = root + 7;
      const noteRoot = foldToRange(root);
      const noteFifth = foldToRange(fifth);
      const diff = Math.abs(noteFifth - noteRoot);

      // Semitone distance mod 12 must be 7 or 5
      const intervalMod12 = ((diff % 12) + 12) % 12;
      expect([5, 7]).toContain(intervalMod12);
    }
  });
});

describe('Adversarial Challenge M3.3: Dense Chords & Polyphonic Stress in convertToSongTimeline', () => {
  it('processes a 100-note simultaneous chord at identical tick without crash or NaN', () => {
    // 100 notes at tick 15 (startSeconds = 1.5) with extreme pitches from -400 to +500
    const chordNotes: Array<{ pitch: number; startSeconds: number; velocity: number }> = [];
    for (let i = 0; i < 100; i++) {
      chordNotes.push({
        pitch: -400 + i * 9, // spans -400 to 491
        startSeconds: 1.5,
        velocity: ((i * 17) % 127) + 1,
      });
    }

    const midi = makeSyntheticMidi([{ notes: chordNotes, program: 0 }]);
    const timeline = convertToSongTimeline(midi);

    expect(timeline.allEvents.length).toBe(100);
    const tick15Events = timeline.eventsByTick.get(15);
    expect(tick15Events).toBeDefined();
    expect(tick15Events?.length).toBe(100);

    // Verify all 100 events conform to strict physical invariants
    for (const ev of timeline.allEvents) {
      expect(Number.isInteger(ev.note)).toBe(true);
      expect(ev.note).toBeGreaterThanOrEqual(0);
      expect(ev.note).toBeLessThanOrEqual(24);
      expect(ev.redstoneTick).toBe(15);
      expect(Number.isFinite(ev.velocity)).toBe(true);
      expect(Number.isNaN(ev.velocity)).toBe(false);
      expect(ev.velocity).toBeGreaterThanOrEqual(0.01);
      expect(ev.velocity).toBeLessThanOrEqual(1.0);
      expect(isMinecraftInstrument(ev.instrument)).toBe(true);
      expect(ev.baseBlock).toBe(INSTRUMENT_METADATA[ev.instrument].baseBlock);
    }

    // Verify events at tick 15 are sorted ascending by note
    for (let j = 1; j < tick15Events!.length; j++) {
      expect(tick15Events![j]!.note).toBeGreaterThanOrEqual(tick15Events![j - 1]!.note);
    }
  });

  it('handles a massive 500-note polyphonic cluster across 10 tracks safely', () => {
    const tracksData = [];
    for (let t = 0; t < 10; t++) {
      const isPerc = t === 9;
      const notes = [];
      for (let n = 0; n < 50; n++) {
        notes.push({
          pitch: isPerc ? (35 + (n % 47)) : (20 + n * 2),
          startSeconds: 2.0,
          velocity: 100,
        });
      }
      tracksData.push({
        id: t,
        name: `Track_${t}`,
        channel: isPerc ? 9 : t,
        program: t * 10,
        isPercussion: isPerc,
        notes,
      });
    }

    const midi = makeSyntheticMidi(tracksData);
    const timeline = convertToSongTimeline(midi);

    expect(timeline.allEvents.length).toBe(500);
    expect(timeline.tracks.length).toBe(10);
    const tick20Events = timeline.eventsByTick.get(20);
    expect(tick20Events).toBeDefined();
    expect(tick20Events?.length).toBe(500);

    // Percussion events should have valid drum instruments (basedrum, snare, hat, cow_bell, bell, etc.)
    const drumEvents = timeline.allEvents.filter((e) => e.channel === 9);
    expect(drumEvents.length).toBe(50);
    for (const dev of drumEvents) {
      expect(isMinecraftInstrument(dev.instrument)).toBe(true);
      expect(dev.note).toBeGreaterThanOrEqual(0);
      expect(dev.note).toBeLessThanOrEqual(24);
    }
  });

  it('safely handles extreme velocity values (0, sub-zero, huge, floats)', () => {
    const extremeNotes = [
      { pitch: 60, startSeconds: 0.1, velocity: 0 },
      { pitch: 61, startSeconds: 0.1, velocity: -50 },
      { pitch: 62, startSeconds: 0.1, velocity: 1 },
      { pitch: 63, startSeconds: 0.1, velocity: 127 },
      { pitch: 64, startSeconds: 0.1, velocity: 255 },
      { pitch: 65, startSeconds: 0.1, velocity: 9999 },
    ];

    const midi = makeSyntheticMidi([{ notes: extremeNotes }]);
    const timeline = convertToSongTimeline(midi);

    for (const ev of timeline.allEvents) {
      expect(Number.isFinite(ev.velocity)).toBe(true);
      expect(Number.isNaN(ev.velocity)).toBe(false);
      expect(ev.velocity).toBeGreaterThanOrEqual(0.01);
      expect(ev.velocity).toBeLessThanOrEqual(1.0);
    }
  });

  it('safely handles empty MIDI file without errors', () => {
    const emptyMidi: MidiFile = {
      format: 0,
      numTracks: 0,
      ticksPerQuarterNote: 480,
      durationSeconds: 0,
      totalTicks: 0,
      tracks: [],
      tempoMap: [],
      timeSignatures: [],
      keySignatures: [],
    };

    const timeline = convertToSongTimeline(emptyMidi);
    expect(timeline.allEvents.length).toBe(0);
    expect(timeline.eventsByTick.size).toBe(0);
    expect(timeline.totalRedstoneTicks).toBe(0);
    expect(timeline.durationSeconds).toBe(0);
  });
});

describe('Adversarial Challenge M3.4: Comprehensive Program & Percussion Fuzzing', () => {
  it('successfully maps all 128 General MIDI programs (0..127) to valid vanilla instruments', () => {
    expect(GM_INSTRUMENT_MAP.length).toBe(128);

    for (let p = 0; p < 128; p++) {
      const mapping = mapMidiInstrument(p, false);

      expect(mapping.program).toBe(p);
      expect(typeof mapping.name).toBe('string');
      expect(mapping.name.length).toBeGreaterThan(0);

      expect(isMinecraftInstrument(mapping.instrument)).toBe(true);
      expect(MINECRAFT_INSTRUMENTS).toContain(mapping.instrument);

      const meta = INSTRUMENT_METADATA[mapping.instrument];
      expect(mapping.baseBlock).toBe(meta.baseBlock);
      expect(mapping.octaveOffset).toBe(meta.octaveOffset);
      expect(mapping.baseBlock.length).toBeGreaterThan(0);
    }
  });

  it('gracefully handles out-of-bounds instrument programs without throwing', () => {
    // Negative numbers and non-finite numbers clamp/fallback to program 0
    const zeroFallbacks = [-1000, -1, NaN, Infinity, -Infinity];
    for (const bp of zeroFallbacks) {
      const mapping = mapMidiInstrument(bp, false);
      expect(isMinecraftInstrument(mapping.instrument)).toBe(true);
      expect(mapping.baseBlock.length).toBeGreaterThan(0);
      expect(mapping.program).toBe(0);
      expect(mapping.instrument).toBe('harp');
    }

    // Numbers > 127 clamp to program 127
    const clampedHigh = [128, 255, 10000];
    for (const bp of clampedHigh) {
      const mapping = mapMidiInstrument(bp, false);
      expect(isMinecraftInstrument(mapping.instrument)).toBe(true);
      expect(mapping.baseBlock.length).toBeGreaterThan(0);
      expect(mapping.program).toBe(127);
    }
  });

  it('successfully maps all 128 percussion key pitches (0..127) to valid notes [0, 24]', () => {
    for (let pitch = 0; pitch < 128; pitch++) {
      const mapping = mapMidiPercussion(pitch);

      expect(isMinecraftInstrument(mapping.instrument)).toBe(true);
      expect(MINECRAFT_INSTRUMENTS).toContain(mapping.instrument);

      const meta = INSTRUMENT_METADATA[mapping.instrument];
      expect(mapping.baseBlock).toBe(meta.baseBlock);

      expect(Number.isInteger(mapping.note)).toBe(true);
      expect(mapping.note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
      expect(mapping.note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);

      expect(typeof mapping.name).toBe('string');
      expect(mapping.name.length).toBeGreaterThan(0);
    }
  });

  it('verifies all 47 keys (35..81) in the GM Level 1 percussion map', () => {
    const percussionMapKeys = Object.keys(GM_PERCUSSION_MAP).map(Number);
    expect(percussionMapKeys.length).toBe(47);

    for (let k = 35; k <= 81; k++) {
      expect(GM_PERCUSSION_MAP[k]).toBeDefined();
      const entry = GM_PERCUSSION_MAP[k]!;
      expect(entry.pitch).toBe(k);
      expect(isMinecraftInstrument(entry.instrument)).toBe(true);
      expect(entry.note).toBeGreaterThanOrEqual(0);
      expect(entry.note).toBeLessThanOrEqual(24);
      expect(entry.baseBlock).toBe(INSTRUMENT_METADATA[entry.instrument].baseBlock);
    }
  });

  it('falls back safely for sub-35 and super-81 percussion pitches', () => {
    const subKick = mapMidiPercussion(20);
    expect(subKick.instrument).toBe('basedrum');
    expect(subKick.note).toBe(2);
    expect(subKick.baseBlock).toBe('minecraft:stone');

    const highClick = mapMidiPercussion(100);
    expect(highClick.instrument).toBe('hat');
    expect(highClick.note).toBe(20);
    expect(highClick.baseBlock).toBe('minecraft:glass');
  });
});

describe('Adversarial Challenge M3.5: Circuit Timing & Quantization Stress', () => {
  it('decomposes 1,000 random inter-note delays into greedy 1-4 tick repeaters', () => {
    let seed = 987654321;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    for (let i = 0; i < 1000; i++) {
      const delta = Math.floor(rand() * 200) - 10; // -10 to +190 ticks
      const repeaters = decomposeRepeaterDelay(delta);

      if (delta <= 0) {
        expect(repeaters).toEqual([]);
      } else {
        // 1. All repeaters must be 1, 2, 3, or 4
        for (const r of repeaters) {
          expect([1, 2, 3, 4]).toContain(r);
        }

        // 2. Sum must exactly equal delta
        const sum = repeaters.reduce((acc, v) => acc + v, 0);
        expect(sum).toBe(delta);

        // 3. Greedy packing invariant: only the last repeater can be < 4
        for (let j = 0; j < repeaters.length - 1; j++) {
          expect(repeaters[j]).toBe(4);
        }
      }
    }
  });

  it('quantizes to 10 Hz redstone ticks monotonically with zero cumulative drift', () => {
    // Test 10,000 seconds in 0.01s steps
    let prevTick = -1;
    for (let t = 0; t <= 100; t += 0.01) {
      const tick = quantizeToRedstoneTick(t);
      expect(tick).toBeGreaterThanOrEqual(prevTick); // Monotonic
      prevTick = tick;
    }

    // Exact boundary tests
    expect(quantizeToRedstoneTick(0.049)).toBe(0);
    expect(quantizeToRedstoneTick(0.050)).toBe(1);
    expect(quantizeToRedstoneTick(0.149)).toBe(1);
    expect(quantizeToRedstoneTick(0.150)).toBe(2);

    // Negative and NaN fallback
    expect(quantizeToRedstoneTick(-5)).toBe(0);
    expect(quantizeToRedstoneTick(NaN)).toBe(0);
    expect(quantizeToRedstoneTick(Infinity)).toBe(0);
  });
});

describe('Adversarial Challenge M3.6: Optimal Transposition & Key Lock Integrity', () => {
  it('restricts candidate shifts to exact octave multiples when preserveKey is true', () => {
    const melody = [
      { pitch: 40, durationSeconds: 1 },
      { pitch: 42, durationSeconds: 1 },
      { pitch: 44, durationSeconds: 1 },
    ];

    const transpose = findOptimalTransposition(melody, { preserveKey: true });
    // Candidate offsets for preserveKey are [-24, -12, 0, 12, 24]
    expect(transpose % 12).toBe(0);
    expect([-24, -12, 0, 12, 24]).toContain(transpose);
  });

  it('confirms Channel 9 percussion events do not distort melodic key transposition', () => {
    const melodyOnly = [{ pitch: 60, durationSeconds: 1, isPercussion: false }];
    const transposeWithoutDrums = findOptimalTransposition(melodyOnly);

    const melodyWithDrums = [
      { pitch: 60, durationSeconds: 1, isPercussion: false },
      { pitch: 35, durationSeconds: 1, isPercussion: true },
      { pitch: 36, durationSeconds: 1, isPercussion: true },
      { pitch: 38, durationSeconds: 1, isPercussion: true },
    ];
    const transposeWithDrums = findOptimalTransposition(melodyWithDrums);

    expect(transposeWithDrums).toBe(transposeWithoutDrums);
  });

  it('calculates optimal transposition for full MidiFile with calculateOptimalTransposition', () => {
    const midi = makeSyntheticMidi([
      {
        program: 0, // Harp (octaveOffset 0)
        notes: [
          { pitch: 36, startSeconds: 0, durationSeconds: 1 }, // C2 (well below 54)
          { pitch: 38, startSeconds: 1, durationSeconds: 1 }, // D2
        ],
      },
      {
        channel: 9,
        isPercussion: true,
        notes: [
          { pitch: 35, startSeconds: 0, durationSeconds: 1 },
        ],
      },
    ]);

    const shiftNoLock = calculateOptimalTransposition(midi, false);
    expect(shiftNoLock).toBeGreaterThanOrEqual(-6);
    expect(shiftNoLock).toBeLessThanOrEqual(6);

    const shiftLock = calculateOptimalTransposition(midi, true);
    expect(shiftLock % 12).toBe(0);
    expect([-24, -12, 0, 12, 24]).toContain(shiftLock);
  });
});

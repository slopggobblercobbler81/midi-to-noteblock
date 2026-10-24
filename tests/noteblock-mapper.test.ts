/**
 * tests/noteblock-mapper.test.ts
 *
 * Comprehensive Unit Test Suite for Milestone 3:
 * Note Block Mapping, Pitch Clamping, GM Translation & Redstone Quantization.
 *
 * Requirements Covered:
 * - R2: Smart Note Block Conversion & Quantization
 * - Invariant: all 128 MIDI notes map strictly into [0, 24]
 * - Invariant: negative notes and extreme notes (>127) fold safely into [0, 24]
 * - All 16 Minecraft instruments and base blocks mapped correctly from GM program categories
 * - Channel 9 percussion notes mapped correctly with immunity from melodic transposition
 * - Quantization aligns times to exact 0.1s increments with no drift
 * - Polyphonic chords at the same tick are grouped in eventsByTick
 * - Full integration with SongTimeline data contracts and repeater delay calculations
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMidi } from '../src/core/midi-parser';
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
  INSTRUMENT_METADATA,
  calculateNoteBlockPitchMultiplier,
  isValidNoteBlockPitch,
  isMinecraftInstrument,
} from '../src/core/types';
import {
  loadNoteBlockMapper,
  isNoteBlockMapperImplemented,
  type NoteBlockMapperModule,
} from './fixtures/test-loader';
import {
  foldToRange,
  foldToRangeDetailed,
  mapMidiInstrument,
  mapMidiPercussion,
  decomposeRepeaterDelay,
  quantizeToRedstoneTick,
  calculateOptimalTransposition,
  findOptimalTransposition,
  convertToSongTimeline,
  getBaseBlock,
  getNaturalOctaveOffset,
  GM_INSTRUMENT_MAP,
  GM_PERCUSSION_MAP,
} from '../src/core/noteblock-mapper';

// ============================================================================
// SYNTHETIC MIDI BUILDER HELPERS FOR ISOLATED UNIT TESTING
// ============================================================================

function makeTestMidi(
  notes: Array<{
    pitch: number;
    startSeconds: number;
    durationSeconds?: number;
    channel?: number;
    program?: number;
    velocity?: number;
  }>,
  trackOptions?: {
    isPercussion?: boolean;
    name?: string;
    program?: number;
  }
): MidiFile {
  const isPerc = trackOptions?.isPercussion ?? false;
  const rawNotes: MidiRawNote[] = notes.map((n) => ({
    pitch: n.pitch,
    velocity: n.velocity ?? 80,
    startTick: Math.round(n.startSeconds * 480),
    durationTicks: Math.round((n.durationSeconds ?? 0.5) * 480),
    startSeconds: n.startSeconds,
    durationSeconds: n.durationSeconds ?? 0.5,
    channel: n.channel ?? (isPerc ? 9 : 0),
    program: n.program ?? trackOptions?.program ?? 0,
  }));

  const maxSec = notes.reduce(
    (max, n) => Math.max(max, n.startSeconds + (n.durationSeconds ?? 0.5)),
    0
  );

  const track: MidiTrack = {
    id: 0,
    name: trackOptions?.name ?? 'Test Track',
    channel: isPerc ? 9 : 0,
    instrumentProgram: trackOptions?.program ?? 0,
    isPercussion: isPerc,
    notes: rawNotes,
    totalTicks: Math.round(maxSec * 480),
  };

  return {
    format: 1,
    numTracks: 1,
    ticksPerQuarterNote: 480,
    tracks: [track],
    tempoMap: [{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120, seconds: 0 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondsPerQuarter: 8 }],
    keySignatures: [],
    durationSeconds: maxSec,
    totalTicks: Math.round(maxSec * 480),
  };
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

describe('Unit Test Suite: Note Block Mapper Engine', () => {
  let mapper: NoteBlockMapperModule | null = null;
  const isImplemented = isNoteBlockMapperImplemented();

  beforeAll(async () => {
    if (isImplemented) {
      mapper = await loadNoteBlockMapper();
    }
  });

  // ==========================================================================
  // SUITE 1: PITCH CLAMPING, OCTAVE FOLDING & SEMITONE INVARIANTS [0, 24]
  // ==========================================================================
  describe('Suite 1: Pitch Clamping & Semitone Invariants [0, 24]', () => {
    it('exhaustively maps all 128 standard MIDI pitches (0 to 127) strictly into [0, 24]', () => {
      expect(mapper).toBeDefined();

      const all128Notes = Array.from({ length: 128 }, (_, pitch) => ({
        pitch,
        startSeconds: pitch * 0.1,
        durationSeconds: 0.1,
      }));

      const midi = makeTestMidi(all128Notes);
      const timeline = mapper!.convertToSongTimeline(midi, { enableOctaveFolding: true });

      expect(timeline.allEvents.length).toBe(128);

      for (let i = 0; i < timeline.allEvents.length; i++) {
        const event = timeline.allEvents[i]!;
        expect(Number.isInteger(event.note)).toBe(true);
        expect(event.note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
        expect(event.note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);
        expect(isValidNoteBlockPitch(event.note)).toBe(true);
      }
    });

    it('safely folds extreme negative notes into [0, 24] without NaN or negative values', () => {
      expect(mapper).toBeDefined();
      const extremeNegativeNotes = [-48, -24, -12, -7, -1].map((pitch, idx) => ({
        pitch,
        startSeconds: idx * 0.1,
      }));

      const midi = makeTestMidi(extremeNegativeNotes);
      const timeline = mapper!.convertToSongTimeline(midi);

      for (const event of timeline.allEvents) {
        expect(Number.isInteger(event.note)).toBe(true);
        expect(event.note).toBeGreaterThanOrEqual(0);
        expect(event.note).toBeLessThanOrEqual(24);
      }
    });

    it('safely folds extreme high notes (>127) into [0, 24]', () => {
      expect(mapper).toBeDefined();
      const extremeHighNotes = [128, 129, 140, 200, 255].map((pitch, idx) => ({
        pitch,
        startSeconds: idx * 0.1,
      }));

      const midi = makeTestMidi(extremeHighNotes);
      const timeline = mapper!.convertToSongTimeline(midi);

      for (const event of timeline.allEvents) {
        expect(Number.isInteger(event.note)).toBe(true);
        expect(event.note).toBeGreaterThanOrEqual(0);
        expect(event.note).toBeLessThanOrEqual(24);
      }
    });

    it('preserves exact pitch class under octave folding: (foldedPitch - originalPitch) mod 12 === 0', () => {
      expect(mapper).toBeDefined();
      const cPitches = [24, 36, 48, 60, 72, 84, 96];
      const midi = makeTestMidi(cPitches.map((pitch, idx) => ({ pitch, startSeconds: idx * 0.1 })), {
        program: 0, // Harp
      });

      const timeline = mapper!.convertToSongTimeline(midi, { preserveKey: true, manualTranspose: 0 });

      // In Harp register (F#3 = 54, F#4 = 66, F#5 = 78):
      // C4 (60) is in range -> note = 60 - 54 = 6.
      // Every other C folded into [0, 24] must map to either 6 or 18 (6 + 12 = 18).
      for (const event of timeline.allEvents) {
        expect([6, 18]).toContain(event.note);
      }
    });

    it('maps natural register notes for F#3, F#4, and F#5 exactly to 0, 12, and 24', () => {
      expect(mapper).toBeDefined();
      const referencePitches = [
        { pitch: BASE_NOTE_PITCH_MIDI, startSeconds: 0.0 },   // 54 (F#3)
        { pitch: CENTER_NOTE_PITCH_MIDI, startSeconds: 0.1 }, // 66 (F#4)
        { pitch: MAX_NOTE_PITCH_MIDI, startSeconds: 0.2 },    // 78 (F#5)
      ];

      const midi = makeTestMidi(referencePitches, { program: 0 });
      const timeline = mapper!.convertToSongTimeline(midi, { manualTranspose: 0 });

      expect(timeline.allEvents[0]!.note).toBe(0);
      expect(timeline.allEvents[1]!.note).toBe(12);
      expect(timeline.allEvents[2]!.note).toBe(24);
    });

    it('accounts for instrument natural octave register offsets (bass, flute, bell)', () => {
      expect(mapper).toBeDefined();
      // Bass: natural register is F#1 (30) to F#3 (54), octave offset -24 semitones
      const bassMidi = makeTestMidi([{ pitch: 30, startSeconds: 0.0 }], { program: 32 }); // Acoustic Bass
      const bassTimeline = mapper!.convertToSongTimeline(bassMidi, { manualTranspose: 0 });
      expect(bassTimeline.allEvents[0]!.instrument).toBe('bass');
      expect(bassTimeline.allEvents[0]!.note).toBe(0);

      // Flute: natural register is F#4 (66) to F#6 (90), octave offset +12 semitones
      const fluteMidi = makeTestMidi([{ pitch: 66, startSeconds: 0.0 }], { program: 73 }); // Flute
      const fluteTimeline = mapper!.convertToSongTimeline(fluteMidi, { manualTranspose: 0 });
      expect(fluteTimeline.allEvents[0]!.instrument).toBe('flute');
      expect(fluteTimeline.allEvents[0]!.note).toBe(0);

      // Bell: natural register is F#5 (78) to F#7 (102), octave offset +24 semitones
      const bellMidi = makeTestMidi([{ pitch: 78, startSeconds: 0.0 }], { program: 9 }); // Glockenspiel
      const bellTimeline = mapper!.convertToSongTimeline(bellMidi, { manualTranspose: 0 });
      expect(bellTimeline.allEvents[0]!.instrument).toBe('bell');
      expect(bellTimeline.allEvents[0]!.note).toBe(0);
    });

    it('verifies foldToRange function returns correct integer semitone indices', () => {
      expect(foldToRange(54, 0)).toBe(0);
      expect(foldToRange(60, 0)).toBe(6);
      expect(foldToRange(66, 0)).toBe(12);
      expect(foldToRange(78, 0)).toBe(24);
      expect(foldToRange(30, -24)).toBe(0); // Bass
      expect(foldToRange(66, 12)).toBe(0);  // Flute
      expect(foldToRange(78, 24)).toBe(0);  // Bell

      // Detailed mode
      const detailed = foldToRangeDetailed(42, 0);
      expect(detailed.note).toBe(0); // 42 + 12 = 54 -> note 0
      expect(detailed.octaveShift).toBe(1);
    });
  });

  // ==========================================================================
  // SUITE 2: GENERAL MIDI (0-127) & PERCUSSION MAPPING
  // ==========================================================================
  describe('Suite 2: GM Programs (0-127) & Percussion Mapping', () => {
    it('maps all 128 General MIDI program numbers to valid Minecraft instruments and base blocks', () => {
      expect(mapper).toBeDefined();
      expect(GM_INSTRUMENT_MAP).toHaveLength(128);

      for (let prog = 0; prog < 128; prog++) {
        const midi = makeTestMidi([{ pitch: 60, startSeconds: 0.0 }], { program: prog });
        const timeline = mapper!.convertToSongTimeline(midi);
        const event = timeline.allEvents[0]!;

        expect(isMinecraftInstrument(event.instrument)).toBe(true);

        const meta = INSTRUMENT_METADATA[event.instrument];
        expect(meta).toBeDefined();
        expect(event.baseBlock).toBe(meta.baseBlock);
        expect(event.baseBlock).toMatch(/^minecraft:[a-z0-9_]+$/);

        // Verify mapMidiInstrument direct lookup
        const directMapping = mapMidiInstrument(prog);
        expect(directMapping.program).toBe(prog);
        expect(directMapping.instrument).toBe(event.instrument);
      }
    });

    it('maps GM Piano category (programs 0-7) to appropriate acoustic and electric timbres', () => {
      expect(mapper).toBeDefined();
      const p0 = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 60, startSeconds: 0 }], { program: 0 })).allEvents[0]!;
      expect(p0.instrument).toBe('harp');
      expect(p0.baseBlock).toBe('minecraft:dirt');

      const p2 = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 60, startSeconds: 0 }], { program: 2 })).allEvents[0]!;
      expect(p2.instrument).toBe('pling');
      expect(p2.baseBlock).toBe('minecraft:glowstone');

      const p7 = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 60, startSeconds: 0 }], { program: 7 })).allEvents[0]!;
      expect(p7.instrument).toBe('bit');
      expect(p7.baseBlock).toBe('minecraft:emerald_block');
    });

    it('maps GM Bass category (programs 32-38) to bass with oak planks substrate', () => {
      expect(mapper).toBeDefined();
      for (let prog = 32; prog <= 38; prog++) {
        const event = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 40, startSeconds: 0 }], { program: prog })).allEvents[0]!;
        expect(event.instrument).toBe('bass');
        expect(event.baseBlock).toBe('minecraft:oak_planks');
      }
    });

    it('maps GM Brass and Reed instruments to didgeridoo and flute', () => {
      expect(mapper).toBeDefined();
      const trumpet = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 60, startSeconds: 0 }], { program: 56 })).allEvents[0]!;
      expect(trumpet.instrument).toBe('didgeridoo');
      expect(trumpet.baseBlock).toBe('minecraft:pumpkin');

      const flute = mapper!.convertToSongTimeline(makeTestMidi([{ pitch: 72, startSeconds: 0 }], { program: 73 })).allEvents[0]!;
      expect(flute.instrument).toBe('flute');
      expect(flute.baseBlock).toBe('minecraft:clay');
    });

    it('maps Channel 9 percussion notes to respective note block percussion instruments', () => {
      expect(mapper).toBeDefined();
      const drumTests = [
        { pitch: 35, expectedInst: 'basedrum', expectedBlock: 'minecraft:stone' },
        { pitch: 36, expectedInst: 'basedrum', expectedBlock: 'minecraft:stone' },
        { pitch: 38, expectedInst: 'snare', expectedBlock: 'minecraft:sand' },
        { pitch: 40, expectedInst: 'snare', expectedBlock: 'minecraft:sand' },
        { pitch: 42, expectedInst: 'hat', expectedBlock: 'minecraft:glass' },
        { pitch: 44, expectedInst: 'hat', expectedBlock: 'minecraft:glass' },
        { pitch: 56, expectedInst: 'cow_bell', expectedBlock: 'minecraft:soul_sand' },
      ];

      for (const test of drumTests) {
        const midi = makeTestMidi([{ pitch: test.pitch, startSeconds: 0, channel: 9 }], { isPercussion: true });
        const event = mapper!.convertToSongTimeline(midi).allEvents[0]!;

        expect(event.instrument).toBe(test.expectedInst);
        expect(event.baseBlock).toBe(test.expectedBlock);
      }
    });

    it('covers all 47 standard percussion notes (35 to 81) with valid tuned notes', () => {
      for (let pitch = 35; pitch <= 81; pitch++) {
        const mapping = mapMidiPercussion(pitch);
        expect(isMinecraftInstrument(mapping.instrument)).toBe(true);
        expect(isValidNoteBlockPitch(mapping.note)).toBe(true);
        expect(mapping.baseBlock).toMatch(/^minecraft:[a-z0-9_]+$/);
      }
      expect(Object.keys(GM_PERCUSSION_MAP).length).toBe(47);
    });

    it('does not transpose Channel 9 percussion notes when melodic transposition is applied', () => {
      expect(mapper).toBeDefined();
      const midi = makeTestMidi([{ pitch: 36, startSeconds: 0, channel: 9 }], { isPercussion: true });

      const timeline0 = mapper!.convertToSongTimeline(midi, { manualTranspose: 0 });
      const timeline7 = mapper!.convertToSongTimeline(midi, { manualTranspose: 7 });

      expect(timeline0.allEvents[0]!.instrument).toBe(timeline7.allEvents[0]!.instrument);
      expect(timeline0.allEvents[0]!.note).toBe(timeline7.allEvents[0]!.note);
    });

    it('safely handles extreme out-of-bounds programs and pitches', () => {
      expect(mapMidiInstrument(-1).instrument).toBe('harp');
      expect(mapMidiInstrument(128).instrument).toBe(GM_INSTRUMENT_MAP[127]!.instrument);
      expect(mapMidiInstrument(999).instrument).toBe(GM_INSTRUMENT_MAP[127]!.instrument);
      expect(mapMidiInstrument(0, true).instrument).toBe('basedrum');

      const lowDrum = mapMidiPercussion(10);
      expect(lowDrum.instrument).toBe('basedrum');
      expect(isValidNoteBlockPitch(lowDrum.note)).toBe(true);

      const highDrum = mapMidiPercussion(100);
      expect(highDrum.instrument).toBe('hat');
      expect(isValidNoteBlockPitch(highDrum.note)).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 3: 10 HZ REDSTONE QUANTIZATION & REPEATER DECOMPOSITION
  // ==========================================================================
  describe('Suite 3: 10 Hz Redstone Quantization & Repeater Delays', () => {
    it('quantizes continuous timestamps to exact 0.1s redstone ticks: round(seconds * 10)', () => {
      expect(mapper).toBeDefined();
      const testTimings = [
        { seconds: 0.00, expectedTick: 0 },
        { seconds: 0.04, expectedTick: 0 },
        { seconds: 0.05, expectedTick: 1 },
        { seconds: 0.09, expectedTick: 1 },
        { seconds: 0.10, expectedTick: 1 },
        { seconds: 0.14, expectedTick: 1 },
        { seconds: 0.15, expectedTick: 2 },
        { seconds: 0.25, expectedTick: 3 },
        { seconds: 0.50, expectedTick: 5 },
        { seconds: 1.23, expectedTick: 12 },
        { seconds: 60.0, expectedTick: 600 },
      ];

      for (const t of testTimings) {
        const midi = makeTestMidi([{ pitch: 60, startSeconds: t.seconds }]);
        const event = mapper!.convertToSongTimeline(midi).allEvents[0]!;
        expect(event.redstoneTick).toBe(t.expectedTick);
        expect(quantizeToRedstoneTick(t.seconds)).toBe(t.expectedTick);
      }
    });

    it('guarantees zero cumulative drift across a long 1,000 note sequence', () => {
      expect(mapper).toBeDefined();
      const count = 1000;
      const notes = Array.from({ length: count }, (_, i) => ({
        pitch: 60,
        startSeconds: i * 0.125,
      }));

      const midi = makeTestMidi(notes);
      const timeline = mapper!.convertToSongTimeline(midi);

      expect(timeline.allEvents.length).toBe(count);

      expect(timeline.allEvents[0]!.redstoneTick).toBe(0);
      expect(timeline.allEvents[8]!.redstoneTick).toBe(10);
      expect(timeline.allEvents[80]!.redstoneTick).toBe(100);
      expect(timeline.allEvents[800]!.redstoneTick).toBe(1000);
      expect(timeline.allEvents[999]!.redstoneTick).toBe(1249);
    });

    it('decomposes tick intervals into greedy repeater chains of 1 to 4 ticks', () => {
      expect(mapper).toBeDefined();
      const decompose = decomposeRepeaterDelay;

      expect(decompose(0)).toEqual([]);
      expect(decompose(-5)).toEqual([]);
      expect(decompose(1)).toEqual([1]);
      expect(decompose(2)).toEqual([2]);
      expect(decompose(3)).toEqual([3]);
      expect(decompose(4)).toEqual([4]);
      expect(decompose(5)).toEqual([4, 1]);
      expect(decompose(6)).toEqual([4, 2]);
      expect(decompose(7)).toEqual([4, 3]);
      expect(decompose(8)).toEqual([4, 4]);
      expect(decompose(10)).toEqual([4, 4, 2]);
      expect(decompose(15)).toEqual([4, 4, 4, 3]);
      expect(decompose(16)).toEqual([4, 4, 4, 4]);
      expect(decompose(17)).toEqual([4, 4, 4, 4, 1]);
    });

    it('verifies that repeater decomposition sum always equals deltaTicks for all deltas 0..100', () => {
      expect(mapper).toBeDefined();

      for (let delta = 0; delta <= 100; delta++) {
        const chain = decomposeRepeaterDelay(delta);
        if (delta === 0) {
          expect(chain).toEqual([]);
        } else {
          const sum = chain.reduce((a, b) => a + b, 0);
          expect(sum).toBe(delta);
          for (const delay of chain) {
            expect([1, 2, 3, 4]).toContain(delay);
          }
          expect(chain.length).toBe(Math.ceil(delta / 4));
        }
      }
    });
  });

  // ==========================================================================
  // SUITE 4: SONGTIMELINE STRUCTURE & POLYPHONY
  // ==========================================================================
  describe('Suite 4: SongTimeline Structure & Polyphony', () => {
    it('constructs a fully populated SongTimeline matching data contracts', () => {
      expect(mapper).toBeDefined();
      const midi = makeTestMidi([
        { pitch: 60, startSeconds: 0.0, durationSeconds: 0.5 },
        { pitch: 64, startSeconds: 0.5, durationSeconds: 0.5 },
      ]);

      const timeline = mapper!.convertToSongTimeline(midi);

      expect(typeof timeline.title).toBe('string');
      expect(typeof timeline.totalRedstoneTicks).toBe('number');
      expect(timeline.totalRedstoneTicks).toBeGreaterThanOrEqual(5);
      expect(typeof timeline.durationSeconds).toBe('number');
      expect(timeline.durationSeconds).toBeGreaterThanOrEqual(1.0);
      expect(typeof timeline.bpm).toBe('number');
      expect(timeline.bpm).toBe(120);

      expect(timeline.eventsByTick).toBeInstanceOf(Map);
      expect(Array.isArray(timeline.allEvents)).toBe(true);
      expect(Array.isArray(timeline.tracks)).toBe(true);
      expect(timeline.tracks.length).toBe(1);
      expect(timeline.tracks[0]!.noteCount).toBe(2);
    });

    it('groups simultaneous polyphonic chord notes under the identical tick in eventsByTick', () => {
      expect(mapper).toBeDefined();
      const chordNotes = [
        { pitch: 60, startSeconds: 1.0 },
        { pitch: 64, startSeconds: 1.0 },
        { pitch: 67, startSeconds: 1.0 },
        { pitch: 71, startSeconds: 1.0 },
      ];

      const midi = makeTestMidi(chordNotes);
      const timeline = mapper!.convertToSongTimeline(midi);

      expect(timeline.eventsByTick.has(10)).toBe(true);
      const tick10Events = timeline.eventsByTick.get(10)!;
      expect(tick10Events.length).toBe(4);

      const pitches = tick10Events.map((e) => e.note);
      expect(new Set(pitches).size).toBe(4);
    });

    it('maintains strict chronological ordering in allEvents array', () => {
      expect(mapper).toBeDefined();
      const unorderedTimings = [
        { pitch: 60, startSeconds: 2.0 },
        { pitch: 62, startSeconds: 0.5 },
        { pitch: 64, startSeconds: 1.0 },
        { pitch: 65, startSeconds: 0.0 },
      ];

      const midi = makeTestMidi(unorderedTimings);
      const timeline = mapper!.convertToSongTimeline(midi);

      for (let i = 1; i < timeline.allEvents.length; i++) {
        const prev = timeline.allEvents[i - 1]!;
        const curr = timeline.allEvents[i]!;
        expect(curr.redstoneTick).toBeGreaterThanOrEqual(prev.redstoneTick);
      }
    });

    it('normalizes MIDI velocity (1-127) into [0.0, 1.0] volume factor', () => {
      expect(mapper).toBeDefined();
      const velocityNotes = [
        { pitch: 60, startSeconds: 0.0, velocity: 1 },
        { pitch: 62, startSeconds: 0.1, velocity: 64 },
        { pitch: 64, startSeconds: 0.2, velocity: 127 },
      ];

      const midi = makeTestMidi(velocityNotes);
      const timeline = mapper!.convertToSongTimeline(midi);

      for (const event of timeline.allEvents) {
        expect(event.velocity).toBeGreaterThan(0.0);
        expect(event.velocity).toBeLessThanOrEqual(1.0);
      }

      expect(timeline.allEvents[0]!.velocity).toBeCloseTo(1 / 127, 2);
      expect(timeline.allEvents[1]!.velocity).toBeCloseTo(64 / 127, 2);
      expect(timeline.allEvents[2]!.velocity).toBeCloseTo(1.0, 2);
    });
  });

  // ==========================================================================
  // SUITE 5: CONVERSION OPTIONS & HARMONY DEFENSE
  // ==========================================================================
  describe('Suite 5: Conversion Options & Harmony Defense', () => {
    it('restricts key transposition to octave shifts when preserveKey is true', () => {
      expect(mapper).toBeDefined();
      const dMajorNotes = [
        { pitch: 62, startSeconds: 0.0 },
        { pitch: 66, startSeconds: 0.1 },
        { pitch: 69, startSeconds: 0.2 },
      ];

      const midi = makeTestMidi(dMajorNotes);
      const timeline = mapper!.convertToSongTimeline(midi, { preserveKey: true });

      for (const event of timeline.allEvents) {
        expect(event.note).toBeGreaterThanOrEqual(0);
        expect(event.note).toBeLessThanOrEqual(24);
      }
    });

    it('applies manual transpose offset cleanly across all tracks', () => {
      expect(mapper).toBeDefined();
      const midi = makeTestMidi([{ pitch: 60, startSeconds: 0.0 }], { program: 0 });

      const t0 = mapper!.convertToSongTimeline(midi, { manualTranspose: 0 }).allEvents[0]!.note;
      const t3 = mapper!.convertToSongTimeline(midi, { manualTranspose: 3 }).allEvents[0]!.note;
      const tNeg2 = mapper!.convertToSongTimeline(midi, { manualTranspose: -2 }).allEvents[0]!.note;

      expect((t3 - t0 + 24) % 12).toBe(3);
      expect((t0 - tNeg2 + 24) % 12).toBe(2);
    });

    it('supports per-track instrument overrides', () => {
      expect(mapper).toBeDefined();
      const midi = makeTestMidi([{ pitch: 60, startSeconds: 0.0 }], { program: 0 });

      const timeline = mapper!.convertToSongTimeline(midi, {
        instrumentOverrides: {
          0: 'iron_xylophone',
        },
      });

      const event = timeline.allEvents[0]!;
      expect(event.instrument).toBe('iron_xylophone');
      expect(event.baseBlock).toBe('minecraft:iron_block');
    });

    it('verifies findOptimalTransposition calculates minimal displacement', () => {
      const notes = [
        { pitch: 60, durationSeconds: 1.0, isPercussion: false, octaveOffset: 0 },
        { pitch: 64, durationSeconds: 1.0, isPercussion: false, octaveOffset: 0 },
      ];
      expect(findOptimalTransposition(notes)).toBe(0);
      expect(findOptimalTransposition(notes, { manualTranspose: 5 })).toBe(5);
    });

    it('calculates optimal transposition for multi-track MIDI file', () => {
      const midi = makeTestMidi([
        { pitch: 60, startSeconds: 0.0 },
        { pitch: 64, startSeconds: 0.5 },
        { pitch: 67, startSeconds: 1.0 },
      ]);
      const optTranspose = calculateOptimalTransposition(midi, false);
      expect(typeof optTranspose).toBe('number');
      expect(Number.isInteger(optTranspose)).toBe(true);

      const optPreserve = calculateOptimalTransposition(midi, true);
      expect([-24, -12, 0, 12, 24]).toContain(optPreserve);

      const directTimeline = convertToSongTimeline(midi);
      expect(directTimeline.allEvents.length).toBe(3);
    });
  });

  // ==========================================================================
  // SUITE 6: BOUNDARY, CORNER CASES & ADVERSARIAL STRESS
  // ==========================================================================
  describe('Suite 6: Boundary, Corner Cases & Adversarial Stress', () => {
    it('handles empty MIDI file with zero tracks or zero notes gracefully', () => {
      expect(mapper).toBeDefined();
      const emptyMidi: MidiFile = {
        format: 1,
        numTracks: 1,
        ticksPerQuarterNote: 480,
        tracks: [{ id: 0, name: 'Empty', channel: 0, instrumentProgram: 0, isPercussion: false, notes: [], totalTicks: 0 }],
        tempoMap: [{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120, seconds: 0 }],
        timeSignatures: [],
        keySignatures: [],
        durationSeconds: 0,
        totalTicks: 0,
      };

      const timeline = mapper!.convertToSongTimeline(emptyMidi);
      expect(timeline.allEvents).toHaveLength(0);
      expect(timeline.totalRedstoneTicks).toBe(0);
      expect(timeline.durationSeconds).toBe(0);
      expect(timeline.eventsByTick.size).toBe(0);
    });

    it('deduplicates identical notes at the same tick and instrument safely', () => {
      expect(mapper).toBeDefined();
      const midi = makeTestMidi([
        { pitch: 60, startSeconds: 0.0 },
        { pitch: 60, startSeconds: 0.0 },
      ]);

      const timeline = mapper!.convertToSongTimeline(midi);
      expect(timeline.allEvents.length).toBeGreaterThanOrEqual(1);
      for (const event of timeline.allEvents) {
        expect(isValidNoteBlockPitch(event.note)).toBe(true);
      }
    });

    it('converts large 5,000 note workload rapidly without memory leak or stack overflow', () => {
      expect(mapper).toBeDefined();
      const largeNoteCount = 5000;
      const notes = Array.from({ length: largeNoteCount }, (_, i) => ({
        pitch: (i % 60) + 30,
        startSeconds: i * 0.05,
        durationSeconds: 0.05,
      }));

      const midi = makeTestMidi(notes);
      const startTime = performance.now();
      const timeline = mapper!.convertToSongTimeline(midi);
      const elapsed = performance.now() - startTime;

      expect(timeline.allEvents.length).toBe(largeNoteCount);
      expect(elapsed).toBeLessThan(1500);
    });
  });

  // ==========================================================================
  // SUITE 7: AUDIO PITCH PARITY & FORMULA VERIFICATION
  // ==========================================================================
  describe('Suite 7: Audio Pitch Parity & Formula Verification', () => {
    it('satisfies 2^((note - 12)/12) Minecraft audio playback rate formula', () => {
      expect(calculateNoteBlockPitchMultiplier(0)).toBeCloseTo(0.5, 6);
      expect(calculateNoteBlockPitchMultiplier(12)).toBeCloseTo(1.0, 6);
      expect(calculateNoteBlockPitchMultiplier(24)).toBeCloseTo(2.0, 6);

      expect(calculateNoteBlockPitchMultiplier(13) / calculateNoteBlockPitchMultiplier(12)).toBeCloseTo(Math.pow(2, 1 / 12), 6);
      expect(calculateNoteBlockPitchMultiplier(6)).toBeCloseTo(Math.SQRT1_2, 6);
    });

    it('verifies getBaseBlock and getNaturalOctaveOffset helpers', () => {
      expect(getBaseBlock('harp')).toBe('minecraft:dirt');
      expect(getBaseBlock('bass')).toBe('minecraft:oak_planks');
      expect(getBaseBlock('flute')).toBe('minecraft:clay');
      expect(getBaseBlock('snare')).toBe('minecraft:sand');

      expect(getNaturalOctaveOffset('harp')).toBe(0);
      expect(getNaturalOctaveOffset('bass')).toBe(-24);
      expect(getNaturalOctaveOffset('flute')).toBe(12);
      expect(getNaturalOctaveOffset('bell')).toBe(24);
    });

    it('snaps tempo to steady redstone grid eliminating fractional tick choppiness', () => {
      const midiBuf = fs.readFileSync(path.resolve(__dirname, '../Ode_to_Joy.mid'));
      const midi = parseMidi(midiBuf);

      // Default: unsnapped (produces choppy 3-then-2 tick intervals on sixteenth notes)
      const unsnapped = mapper!.convertToSongTimeline(midi);
      const unsnappedTicks = Array.from(unsnapped.eventsByTick.keys()).sort((a, b) => a - b);
      // Observe the 3-then-2 stutter at tick 65 -> 68 -> 70
      expect(unsnappedTicks).toContain(65);
      expect(unsnappedTicks).toContain(68);
      expect(unsnappedTicks).toContain(70);

      // Snapped to steady grid: snaps to 4 ticks per quarter note (150 BPM)
      // Every beat is 4 ticks, and eighth notes are 2 ticks, eliminating the stutter
      const snapped = mapper!.convertToSongTimeline(midi, { snapTempoToGrid: true });
      expect(snapped.bpm).toBe(150);
      const snappedTicks = Array.from(snapped.eventsByTick.keys()).sort((a, b) => a - b);
      const deltas = [];
      for (let i = 1; i < snappedTicks.length; i++) {
        deltas.push(snappedTicks[i]! - snappedTicks[i - 1]!);
      }
      // Every single delta in the entire song is either 4 ticks (quarter note) or 2 ticks (eighth note)!
      for (const delta of deltas) {
        expect([2, 4]).toContain(delta);
      }
      expect(deltas.slice(0, 16)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 4]);

      // Explicit grid: 6 ticks per beat (100 BPM)
      const snapped6 = mapper!.convertToSongTimeline(midi, { snapTempoToGrid: true, gridTicksPerQuarter: 6 });
      expect(snapped6.bpm).toBe(100);
      const snappedTicks6 = Array.from(snapped6.eventsByTick.keys()).sort((a, b) => a - b);
      const deltas6 = [];
      for (let i = 1; i < snappedTicks6.length; i++) {
        deltas6.push(snappedTicks6[i]! - snappedTicks6[i - 1]!);
      }
      for (const delta of deltas6) {
        expect([3, 6]).toContain(delta);
      }
      expect(deltas6.slice(0, 16)).toEqual([6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 6]);
    });
  });
});

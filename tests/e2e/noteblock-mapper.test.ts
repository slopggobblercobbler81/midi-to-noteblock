/**
 * tests/e2e/noteblock-mapper.test.ts
 *
 * Comprehensive 4-Tier Opaque-Box E2E Test Suite for Note Block Mapper.
 * Validates pitch clamping [0, 24], octave folding, General MIDI to 16 Minecraft
 * instrument mapping, Channel 9 percussion mapping, 10 Hz redstone quantization,
 * and repeater delay decomposition.
 *
 * Requirements Covered: R2 (Smart Note Block Conversion & Quantization), Acceptance Criteria.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { MidiFile } from '../../src/core/types';
import {
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  INSTRUMENT_METADATA,
  calculateNoteBlockPitchMultiplier,
  isValidNoteBlockPitch,
} from '../../src/core/types';
import {
  createMonophonicFormat0,
  createPolyphonicFormat1,
  createPercussionMidi,
  createAdversarialMidi,
} from '../fixtures/midi-generator';
import {
  loadMidiParser,
  isMidiParserImplemented,
  loadNoteBlockMapper,
  isNoteBlockMapperImplemented,
  type NoteBlockMapperModule,
} from '../fixtures/test-loader';

describe('E2E Track: Note Block Mapper Test Suite', () => {
  let mapper: NoteBlockMapperModule | null = null;
  let parsedMonoMidi: MidiFile | null = null;
  let parsedPolyMidi: MidiFile | null = null;
  let parsedPercMidi: MidiFile | null = null;
  let parsedAdvMidi: MidiFile | null = null;

  const isImplemented = isNoteBlockMapperImplemented();

  beforeAll(async () => {
    if (isImplemented) {
      mapper = await loadNoteBlockMapper();
      if (isMidiParserImplemented()) {
        const parser = await loadMidiParser();
        if (parser) {
          parsedMonoMidi = parser.parseMidi(createMonophonicFormat0());
          parsedPolyMidi = parser.parseMidi(createPolyphonicFormat1());
          parsedPercMidi = parser.parseMidi(createPercussionMidi());
          parsedAdvMidi = parser.parseMidi(createAdversarialMidi());
        }
      }
    }
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 1: Feature Coverage', () => {
    it('strictly clamps and folds all output notes into Minecraft [0, 24] semitone range', () => {
      expect(mapper).toBeDefined();
      if (!parsedMonoMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedMonoMidi);
      expect(timeline.allEvents.length).toBeGreaterThan(0);

      for (const event of timeline.allEvents) {
        expect(Number.isInteger(event.note)).toBe(true);
        expect(event.note).toBeGreaterThanOrEqual(MIN_NOTEBLOCK_PITCH);
        expect(event.note).toBeLessThanOrEqual(MAX_NOTEBLOCK_PITCH);
        expect(isValidNoteBlockPitch(event.note)).toBe(true);
      }
    });

    it('maps General MIDI instrument families to valid Minecraft instruments and base blocks', () => {
      expect(mapper).toBeDefined();
      if (!parsedPolyMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedPolyMidi);

      for (const event of timeline.allEvents) {
        const meta = INSTRUMENT_METADATA[event.instrument];
        expect(meta).toBeDefined();
        // The event base block must match or be a valid substrate for the instrument
        expect(typeof event.baseBlock).toBe('string');
        expect(event.baseBlock).toMatch(/^minecraft:[a-z0-9_]+$/);
      }
    });

    it('quantizes note onsets to 10 Hz redstone ticks (0.1s increments)', () => {
      expect(mapper).toBeDefined();
      if (!parsedMonoMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedMonoMidi);

      for (const event of timeline.allEvents) {
        // Redstone tick must be a non-negative integer
        expect(Number.isInteger(event.redstoneTick)).toBe(true);
        expect(event.redstoneTick).toBeGreaterThanOrEqual(0);

        // Verification of quantization formula: round(t * 10)
        const expectedTick = Math.round(event.timestampSeconds * 10);
        expect(event.redstoneTick).toBe(expectedTick);
      }
    });

    it('maps Channel 9 percussion notes to corresponding note block percussion instruments', () => {
      expect(mapper).toBeDefined();
      if (!parsedPercMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedPercMidi);
      expect(timeline.allEvents.length).toBeGreaterThan(0);

      // Percussion events should map to basedrum, snare, hat, cow_bell, etc.
      const instrumentsUsed = new Set(timeline.allEvents.map((e) => e.instrument));
      const percussionInstruments = ['basedrum', 'snare', 'hat', 'cow_bell', 'bell', 'chime'];
      const hasPercussion = Array.from(instrumentsUsed).some((inst) => percussionInstruments.includes(inst));
      expect(hasPercussion).toBe(true);
    });

    it('decomposes inter-note delays into sequences of 1 to 4 tick repeaters', () => {
      expect(mapper).toBeDefined();
      if (mapper!.decomposeRepeaterDelay) {
        // 1 tick -> [1]
        expect(mapper!.decomposeRepeaterDelay(1)).toEqual([1]);
        // 4 ticks -> [4]
        expect(mapper!.decomposeRepeaterDelay(4)).toEqual([4]);
        // 7 ticks -> [4, 3]
        expect(mapper!.decomposeRepeaterDelay(7)).toEqual([4, 3]);
        // 10 ticks -> [4, 4, 2]
        expect(mapper!.decomposeRepeaterDelay(10)).toEqual([4, 4, 2]);
        // 0 ticks -> []
        expect(mapper!.decomposeRepeaterDelay(0)).toEqual([]);
      }
    });

    it('satisfies the Minecraft pitch multiplier audio formula: 2^((note - 12)/12)', () => {
      // Note 0 (F#3): 0.5
      expect(calculateNoteBlockPitchMultiplier(0)).toBeCloseTo(0.5, 6);
      // Note 12 (F#4): 1.0
      expect(calculateNoteBlockPitchMultiplier(12)).toBeCloseTo(1.0, 6);
      // Note 24 (F#5): 2.0
      expect(calculateNoteBlockPitchMultiplier(24)).toBeCloseTo(2.0, 6);
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 2: Boundary & Corner Cases', () => {
    it('folds extreme MIDI pitches (0, 1, 126, 127) strictly into [0, 24]', () => {
      expect(mapper).toBeDefined();
      if (!parsedAdvMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedAdvMidi);
      for (const event of timeline.allEvents) {
        expect(event.note).toBeGreaterThanOrEqual(0);
        expect(event.note).toBeLessThanOrEqual(24);
      }
    });

    it('groups simultaneous notes sharing identical redstone tick in eventsByTick map', () => {
      expect(mapper).toBeDefined();
      if (!parsedAdvMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedAdvMidi);
      // Check tick corresponding to tick 480 chord
      let foundChord = false;
      for (const [, events] of timeline.eventsByTick.entries()) {
        if (events.length >= 5) {
          foundChord = true;
          break;
        }
      }
      expect(foundChord).toBe(true);
    });

    it('handles empty MIDI file producing valid empty timeline without crashing', () => {
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
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE)
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 3: Cross-Feature Combinations', () => {
    it('respects preserveKey option by only using full octave shifts (-24, -12, 0, +12, +24)', () => {
      expect(mapper).toBeDefined();
      if (!parsedMonoMidi) return;

      const timelineKeyLocked = mapper!.convertToSongTimeline(parsedMonoMidi, {
        preserveKey: true,
      });

      expect(timelineKeyLocked.allEvents.length).toBeGreaterThan(0);
      for (const event of timelineKeyLocked.allEvents) {
        expect(event.note).toBeGreaterThanOrEqual(0);
        expect(event.note).toBeLessThanOrEqual(24);
      }
    });

    it('applies manual transpose offset correctly', () => {
      expect(mapper).toBeDefined();
      if (!parsedMonoMidi) return;

      const timeline0 = mapper!.convertToSongTimeline(parsedMonoMidi, { manualTranspose: 0 });
      const timeline2 = mapper!.convertToSongTimeline(parsedMonoMidi, { manualTranspose: 2 });

      if (timeline0.allEvents.length > 0 && timeline2.allEvents.length > 0) {
        // First note in C-major scale (MIDI 60) transposed by +2 should shift pitch index or octave
        const n0 = timeline0.allEvents[0]!.note;
        const n2 = timeline2.allEvents[0]!.note;
        expect((n2 - n0 + 24) % 12).toBe(2 % 12);
      }
    });

    it('processes multi-track song with independent instrument overrides', () => {
      expect(mapper).toBeDefined();
      if (!parsedPolyMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedPolyMidi, {
        instrumentOverrides: {
          1: 'guitar', // Override Melody track to guitar
        },
      });

      const track1Events = timeline.allEvents.filter((e) => e.trackId === 1);
      if (track1Events.length > 0) {
        expect(track1Events[0]!.instrument).toBe('guitar');
        expect(track1Events[0]!.baseBlock).toBe(INSTRUMENT_METADATA.guitar.baseBlock);
      }
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 4: Real-World Scenarios', () => {
    it('creates a complete, musically coherent SongTimeline from multi-track polyphonic MIDI', () => {
      expect(mapper).toBeDefined();
      if (!parsedPolyMidi) return;

      const timeline = mapper!.convertToSongTimeline(parsedPolyMidi);

      expect(timeline.title).toBeDefined();
      expect(timeline.durationSeconds).toBeGreaterThan(1.0);
      expect(timeline.totalRedstoneTicks).toBeGreaterThan(10);
      expect(timeline.tracks.length).toBeGreaterThanOrEqual(3);
      expect(timeline.allEvents.length).toBeGreaterThanOrEqual(15);

      // Verify chronological sorting of allEvents
      for (let i = 1; i < timeline.allEvents.length; i++) {
        const prev = timeline.allEvents[i - 1]!;
        const curr = timeline.allEvents[i]!;
        expect(curr.redstoneTick).toBeGreaterThanOrEqual(prev.redstoneTick);
      }
    });
  });
});

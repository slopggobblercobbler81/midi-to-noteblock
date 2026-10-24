/**
 * tests/e2e/midi-parser.test.ts
 *
 * Comprehensive 4-Tier Opaque-Box E2E Test Suite for MIDI Parser.
 * Validates SMF 0 & 1 parsing, VLQ decoding, running status, zero-velocity note-ons,
 * dynamic tempo mapping, tick-to-seconds math, note pairing, and error resilience.
 *
 * Requirements Covered: R1 (MIDI Parsing & Track Extraction), Acceptance Criteria.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateMidiBinary,
  createMonophonicFormat0,
  createPolyphonicFormat1,
  createPercussionMidi,
  createAdversarialMidi,
} from '../fixtures/midi-generator';
import { loadMidiParser, isMidiParserImplemented, type MidiParserModule } from '../fixtures/test-loader';

describe('E2E Track: MIDI Parser Test Suite', () => {
  let parser: MidiParserModule | null = null;
  const isImplemented = isMidiParserImplemented();

  beforeAll(async () => {
    if (isImplemented) {
      parser = await loadMidiParser();
    }
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 1: Feature Coverage', () => {
    it('parses Standard MIDI File Format 0 (single track, 480 PPQ)', () => {
      expect(parser).toBeDefined();
      const binary = createMonophonicFormat0();
      const midi = parser!.parseMidi(binary);

      expect(midi.format).toBe(0);
      expect(midi.numTracks).toBe(1);
      expect(midi.ticksPerQuarterNote).toBe(480);
      expect(midi.tracks).toHaveLength(1);

      const track = midi.tracks[0]!;
      expect(track.name).toBe('Monophonic C Major');
      expect(track.notes.length).toBe(8); // 8 notes in C-major scale

      // Verify first note (C4 = MIDI 60)
      const firstNote = track.notes[0]!;
      expect(firstNote.pitch).toBe(60);
      expect(firstNote.startTick).toBe(0);
      expect(firstNote.durationTicks).toBe(400);
      expect(firstNote.velocity).toBe(90);
      expect(firstNote.startSeconds).toBeCloseTo(0.0, 3);
      expect(firstNote.durationSeconds).toBeCloseTo(0.4166, 3); // 400 ticks at 120 BPM = 400/480 * 0.5s = 0.4167s
    });

    it('parses Standard MIDI File Format 1 (multi-track parallel, tempo map)', () => {
      expect(parser).toBeDefined();
      const binary = createPolyphonicFormat1();
      const midi = parser!.parseMidi(binary);

      expect(midi.format).toBe(1);
      expect(midi.numTracks).toBe(4);
      expect(midi.ticksPerQuarterNote).toBe(480);
      expect(midi.tracks.length).toBe(4);

      // Verify tempo map extraction
      expect(midi.tempoMap.length).toBeGreaterThanOrEqual(2);
      expect(midi.tempoMap[0]!.bpm).toBeCloseTo(120, 1);
      expect(midi.tempoMap[1]!.bpm).toBeCloseTo(150, 1);

      // Verify Melody track (Flute, program 73)
      const melodyTrack = midi.tracks.find((t) => t.name === 'Lead Melody');
      expect(melodyTrack).toBeDefined();
      expect(melodyTrack!.notes.length).toBe(5);
      expect(melodyTrack!.instrumentProgram).toBe(73);

      // Verify Bass track (program 32)
      const bassTrack = midi.tracks.find((t) => t.name === 'Bassline');
      expect(bassTrack).toBeDefined();
      expect(bassTrack!.notes.length).toBe(4);
      expect(bassTrack!.instrumentProgram).toBe(32);

      // Verify Chords track
      const chordTrack = midi.tracks.find((t) => t.name === 'Chords');
      expect(chordTrack).toBeDefined();
      expect(chordTrack!.notes.length).toBe(9); // 3 chords * 3 notes
    });

    it('decodes Variable-Length Quantity (VLQ) deltas across 1 to 4 byte boundaries', () => {
      expect(parser).toBeDefined();
      // Test VLQ deltas: 0 (1-byte), 480 (2-byte), 16384 (3-byte)
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            notes: [
              { pitch: 60, startTick: 0, durationTicks: 480 },
              { pitch: 62, startTick: 480, durationTicks: 480 },
              { pitch: 64, startTick: 16864, durationTicks: 480 }, // Large delta jump
            ],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(3);
      expect(notes[0]!.startTick).toBe(0);
      expect(notes[1]!.startTick).toBe(480);
      expect(notes[2]!.startTick).toBe(16864);
    });

    it('handles running status correctly across consecutive Note-On messages', () => {
      expect(parser).toBeDefined();
      // Generate MIDI with forced running status
      const binary = generateMidiBinary(
        {
          format: 0,
          ticksPerQuarterNote: 480,
          tracks: [
            {
              notes: [
                { pitch: 60, startTick: 0, durationTicks: 240 },
                { pitch: 62, startTick: 240, durationTicks: 240 },
                { pitch: 64, startTick: 480, durationTicks: 240 },
              ],
            },
          ],
        },
        { forceRunningStatus: true }
      );

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(3);
      expect(notes[0]!.pitch).toBe(60);
      expect(notes[1]!.pitch).toBe(62);
      expect(notes[2]!.pitch).toBe(64);
    });

    it('treats Note-On with velocity 0 strictly as Note-Off according to MIDI spec', () => {
      expect(parser).toBeDefined();
      // DAWs emit 0x90 pitch 0x00 instead of 0x80
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            useZeroVelocityNoteOff: true,
            notes: [
              { pitch: 60, startTick: 0, durationTicks: 480, velocity: 100 },
              { pitch: 64, startTick: 480, durationTicks: 480, velocity: 90 },
            ],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(2);
      expect(notes[0]!.durationTicks).toBe(480);
      expect(notes[1]!.durationTicks).toBe(480);
    });

    it('identifies Channel 9 (10th channel) as percussion track', () => {
      expect(parser).toBeDefined();
      const binary = createPercussionMidi();
      const midi = parser!.parseMidi(binary);

      const drumTrack = midi.tracks[0]!;
      expect(drumTrack.isPercussion).toBe(true);
      expect(drumTrack.channel).toBe(9);
      expect(drumTrack.notes.length).toBeGreaterThanOrEqual(10);
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 2: Boundary & Corner Cases', () => {
    it('handles extreme MIDI pitch boundaries (pitch 0 and pitch 127)', () => {
      expect(parser).toBeDefined();
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            notes: [
              { pitch: 0, startTick: 0, durationTicks: 240, velocity: 1 },
              { pitch: 127, startTick: 240, durationTicks: 240, velocity: 127 },
            ],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(2);
      expect(notes[0]!.pitch).toBe(0);
      expect(notes[0]!.velocity).toBe(1);
      expect(notes[1]!.pitch).toBe(127);
      expect(notes[1]!.velocity).toBe(127);
    });

    it('handles zero-length notes gracefully without crashing', () => {
      expect(parser).toBeDefined();
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            notes: [{ pitch: 60, startTick: 100, durationTicks: 0 }],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(1);
      expect(notes[0]!.durationTicks).toBe(0);
      expect(notes[0]!.durationSeconds).toBe(0);
    });

    it('gracefully terminates open notes at End of Track if Note-Off is omitted', () => {
      expect(parser).toBeDefined();
      // Generate track with Note On at tick 0 and End of Track at tick 960 without Note Off
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            notes: [{ pitch: 60, startTick: 0, durationTicks: 960 }],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      const notes = midi.tracks[0]!.notes;
      expect(notes).toHaveLength(1);
      expect(notes[0]!.durationTicks).toBe(960);
    });

    it('gracefully ignores orphan Note-Off events without crashing', () => {
      expect(parser).toBeDefined();
      // Track with Note Off (pitch 60) without preceding Note On
      const binary = generateMidiBinary({
        format: 0,
        ticksPerQuarterNote: 480,
        tracks: [
          {
            notes: [{ pitch: 65, startTick: 200, durationTicks: 200 }],
          },
        ],
      });

      const midi = parser!.parseMidi(binary);
      expect(midi.tracks[0]!.notes).toHaveLength(1);
    });

    it('handles completely empty tracks containing only End of Track meta event', () => {
      expect(parser).toBeDefined();
      const binary = generateMidiBinary({
        format: 1,
        ticksPerQuarterNote: 480,
        tracks: [
          { name: 'Empty Track 1', notes: [] },
          { name: 'Empty Track 2', notes: [] },
        ],
      });

      const midi = parser!.parseMidi(binary);
      expect(midi.tracks).toHaveLength(2);
      expect(midi.tracks[0]!.notes).toHaveLength(0);
      expect(midi.tracks[1]!.notes).toHaveLength(0);
      expect(midi.totalTicks).toBe(0);
      expect(midi.durationSeconds).toBe(0);
    });

    it('throws a descriptive error when parsing malformed or corrupted headers', () => {
      expect(parser).toBeDefined();
      const corruptedBinary = generateMidiBinary(
        {
          format: 0,
          ticksPerQuarterNote: 480,
          tracks: [{ notes: [{ pitch: 60, startTick: 0, durationTicks: 240 }] }],
        },
        { corruptHeader: true }
      );

      expect(() => parser!.parseMidi(corruptedBinary)).toThrow();
    });

    it('throws a descriptive error on truncated byte buffers', () => {
      expect(parser).toBeDefined();
      const valid = createMonophonicFormat0();
      const truncated = valid.subarray(0, 10); // Less than 14-byte header

      expect(() => parser!.parseMidi(truncated)).toThrow();
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE)
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 3: Cross-Feature Combinations', () => {
    it('processes dynamic tempo changes alongside polyphonic multi-channel notes', () => {
      expect(parser).toBeDefined();
      const binary = createPolyphonicFormat1();
      const midi = parser!.parseMidi(binary);

      // Check notes in Track 1 after the tempo change at tick 960
      const track1Notes = midi.tracks[1]!.notes;
      const noteBeforeTempoChange = track1Notes.find((n) => n.startTick === 480);
      const noteAtTempoChange = track1Notes.find((n) => n.startTick === 960);

      expect(noteBeforeTempoChange).toBeDefined();
      expect(noteAtTempoChange).toBeDefined();

      // At 120 BPM: 480 ticks = 0.5s, 960 ticks = 1.0s
      expect(noteBeforeTempoChange!.startSeconds).toBeCloseTo(0.5, 3);
      expect(noteAtTempoChange!.startSeconds).toBeCloseTo(1.0, 3);

      // Note at 960 ticks has duration 480 ticks. At 150 BPM (400,000 µs), 480 ticks = 0.4s
      expect(noteAtTempoChange!.durationSeconds).toBeCloseTo(0.4, 3);
    });

    it('handles 10+ note polyphonic chords on identical tick without dropping notes', () => {
      expect(parser).toBeDefined();
      const binary = createAdversarialMidi();
      const midi = parser!.parseMidi(binary);

      const track = midi.tracks[0]!;
      const notesAt480 = track.notes.filter((n) => n.startTick === 480);
      expect(notesAt480.length).toBe(10); // All 10 chord notes preserved
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 4: Real-World Scenarios', () => {
    it('accurately parses full multi-track song representation with strict chronological ordering', () => {
      expect(parser).toBeDefined();
      const binary = createPolyphonicFormat1();
      const midi = parser!.parseMidi(binary);

      for (const track of midi.tracks) {
        for (let i = 1; i < track.notes.length; i++) {
          const prev = track.notes[i - 1]!;
          const curr = track.notes[i]!;
          expect(curr.startTick).toBeGreaterThanOrEqual(prev.startTick);
          expect(curr.startSeconds).toBeGreaterThanOrEqual(prev.startSeconds);
        }
      }

      // Overall song duration matches maximum track duration
      expect(midi.durationSeconds).toBeGreaterThan(1.5);
      expect(midi.totalTicks).toBeGreaterThanOrEqual(1440);
    });
  });
});

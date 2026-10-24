/**
 * tests/e2e/e2e-workloads.test.ts
 *
 * Full Pipeline End-to-End Workload & Integration Test Suite.
 * Validates the complete opaque-box transformation chain:
 * [Raw MIDI Binary] -> [midi-parser] -> [noteblock-mapper] -> [schematic-engine] -> [.schem / .litematic NBT]
 *
 * Requirements Covered: R1, R2, R4, Acceptance Criteria.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createMonophonicFormat0,
  createPolyphonicFormat1,
  createPercussionMidi,
} from '../fixtures/midi-generator';
import {
  validateSpongeSchematic,
  validateLitematic,
} from '../fixtures/nbt-reader';
import {
  loadMidiParser,
  isMidiParserImplemented,
  loadNoteBlockMapper,
  isNoteBlockMapperImplemented,
  loadSchematicExporters,
  isSchematicExporterImplemented,
  type MidiParserModule,
  type NoteBlockMapperModule,
  type SchematicExporterModule,
} from '../fixtures/test-loader';

describe('E2E Track: Full Pipeline Workload Integration', () => {
  let parser: MidiParserModule | null = null;
  let mapper: NoteBlockMapperModule | null = null;
  let exporter: SchematicExporterModule | null = null;

  const isFullPipelineReady =
    isMidiParserImplemented() &&
    isNoteBlockMapperImplemented() &&
    isSchematicExporterImplemented();

  beforeAll(async () => {
    if (isFullPipelineReady) {
      parser = await loadMidiParser();
      mapper = await loadNoteBlockMapper();
      exporter = await loadSchematicExporters();
    }
  });

  // ==========================================================================
  // TIER 1: FULL PIPELINE HAPPY PATH WORKLOADS
  // ==========================================================================
  describe.skipIf(!isFullPipelineReady)('Tier 1: Full Pipeline Happy Path Workloads', () => {
    it('executes full pipeline: Format 0 MIDI -> Sponge .schem schematic', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      // Step 1: Raw MIDI binary
      const midiBinary = createMonophonicFormat0();
      // Step 2: Parse MIDI
      const midi = parser!.parseMidi(midiBinary);
      expect(midi.format).toBe(0);
      expect(midi.tracks[0]!.notes.length).toBe(8);

      // Step 3: Map to note blocks & quantize
      const timeline = mapper!.convertToSongTimeline(midi);
      expect(timeline.allEvents.length).toBe(8);
      for (const ev of timeline.allEvents) {
        expect(ev.note).toBeGreaterThanOrEqual(0);
        expect(ev.note).toBeLessThanOrEqual(24);
      }

      // Step 4: Export to Sponge .schem
      const schemResult = await exporter!.exportSpongeSchematic(timeline, { name: 'MonoSponge' });
      expect(schemResult.filename.endsWith('.schem')).toBe(true);
      expect(schemResult.data.length).toBeGreaterThan(0);

      // Step 5: Independent NBT validation oracle
      const val = validateSpongeSchematic(schemResult.data);
      expect(val.isValid).toBe(true);
      expect(val.errors).toHaveLength(0);
      expect(val.noteBlockCount).toBe(8);
      expect(val.acousticClearanceViolations).toHaveLength(0);
    });

    it('executes full pipeline: Format 0 MIDI -> Litematica .litematic schematic', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      const midiBinary = createMonophonicFormat0();
      const midi = parser!.parseMidi(midiBinary);
      const timeline = mapper!.convertToSongTimeline(midi);

      const litematicResult = await exporter!.exportLitematic(timeline, { name: 'MonoLitematic' });
      expect(litematicResult.filename.endsWith('.litematic')).toBe(true);

      const val = validateLitematic(litematicResult.data);
      expect(val.isValid).toBe(true);
      expect(val.errors).toHaveLength(0);
      expect(val.noteBlockCount).toBe(8);
    });
  });

  // ==========================================================================
  // TIER 2: COMPLEX & MULTI-TRACK REALISTIC WORKLOADS
  // ==========================================================================
  describe.skipIf(!isFullPipelineReady)('Tier 2: Multi-Track Polyphonic Workloads', () => {
    it('executes multi-track polyphonic MIDI with dynamic tempo into dual schematics', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      const midiBinary = createPolyphonicFormat1();
      const midi = parser!.parseMidi(midiBinary);
      expect(midi.format).toBe(1);
      expect(midi.tracks.length).toBe(4);

      const timeline = mapper!.convertToSongTimeline(midi);
      expect(timeline.allEvents.length).toBeGreaterThanOrEqual(15);

      // Export both formats
      const schem = await exporter!.exportSpongeSchematic(timeline, { name: 'PolySong' });
      const litematic = await exporter!.exportLitematic(timeline, { name: 'PolySong' });

      const schemVal = validateSpongeSchematic(schem.data);
      expect(schemVal.isValid).toBe(true);
      expect(schemVal.noteBlockCount).toBeGreaterThanOrEqual(12);
      expect(schemVal.repeaterCount).toBeGreaterThan(0);

      const litematicVal = validateLitematic(litematic.data);
      expect(litematicVal.isValid).toBe(true);
      expect(litematicVal.noteBlockCount).toBeGreaterThanOrEqual(12);
    });

    it('executes drum & percussion MIDI workload preserving percussive timbres', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      const percBinary = createPercussionMidi();
      const midi = parser!.parseMidi(percBinary);
      const timeline = mapper!.convertToSongTimeline(midi);

      const schem = await exporter!.exportSpongeSchematic(timeline, { name: 'PercussionSong' });
      const val = validateSpongeSchematic(schem.data);
      expect(val.isValid).toBe(true);

      // Palette must contain percussive note blocks and substrate blocks
      const paletteStr = Object.keys(val.palette).join(';');
      expect(paletteStr.includes('note_block')).toBe(true);
      expect(
        paletteStr.includes('stone') ||
        paletteStr.includes('sand') ||
        paletteStr.includes('glass') ||
        paletteStr.includes('soul_sand')
      ).toBe(true);
    });
  });

  // ==========================================================================
  // TIER 3: DETERMINISM & REPRODUCIBILITY WORKLOADS
  // ==========================================================================
  describe.skipIf(!isFullPipelineReady)('Tier 3: Determinism & Physical Invariants', () => {
    it('produces identical deterministic schematic dimensions and block counts for identical input', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      const midiBinary = createMonophonicFormat0();
      const midi1 = parser!.parseMidi(midiBinary);
      const midi2 = parser!.parseMidi(midiBinary);

      const timeline1 = mapper!.convertToSongTimeline(midi1);
      const timeline2 = mapper!.convertToSongTimeline(midi2);

      const schem1 = await exporter!.exportSpongeSchematic(timeline1);
      const schem2 = await exporter!.exportSpongeSchematic(timeline2);

      expect(schem1.dimensions).toEqual(schem2.dimensions);
      expect(schem1.totalNoteBlocks).toBe(schem2.totalNoteBlocks);
      expect(schem1.totalRepeaters).toBe(schem2.totalRepeaters);
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION EXCERPTS
  // ==========================================================================
  describe.skipIf(!isFullPipelineReady)('Tier 4: Production Application End-to-End Simulation', () => {
    it('simulates user upload, inspection, conversion, and download generation', async () => {
      expect(parser).toBeDefined();
      expect(mapper).toBeDefined();
      expect(exporter).toBeDefined();

      // 1. User uploads polyphonic MIDI file
      const fileBytes = createPolyphonicFormat1();
      // 2. Client extracts track inspector info
      const parsed = parser!.parseMidi(fileBytes);
      expect(parsed.durationSeconds).toBeGreaterThan(0);
      expect(parsed.numTracks).toBe(4);

      // 3. User configures conversion options
      const converted = mapper!.convertToSongTimeline(parsed, {
        preserveKey: true,
        enableOctaveFolding: true,
      });

      // 4. User downloads both Sponge and Litematica
      const [schem, litematic] = await Promise.all([
        exporter!.exportSpongeSchematic(converted, { name: 'FullSong' }),
        exporter!.exportLitematic(converted, { name: 'FullSong' }),
      ]);

      expect(schem.data.length).toBeGreaterThan(100);
      expect(litematic.data.length).toBeGreaterThan(100);

      // Verify independent NBT parsing succeeds cleanly
      expect(validateSpongeSchematic(schem.data).isValid).toBe(true);
      expect(validateLitematic(litematic.data).isValid).toBe(true);
    });
  });
});

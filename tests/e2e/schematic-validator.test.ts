/**
 * tests/e2e/schematic-validator.test.ts
 *
 * Comprehensive 4-Tier Opaque-Box E2E Test Suite for Minecraft Schematic Exporters.
 * Validates Sponge (.schem) v2/v3 and Litematica (.litematic) v5 NBT binary formats,
 * bit-packing, VarInt block data, 3D coordinate indexing, acoustic clearance (y+1 air),
 * instrument substrate base blocks (y-1), and repeater delay chaining.
 *
 * Requirements Covered: R4 (Minecraft Schematic Export .schem & .litematic), Acceptance Criteria.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { SongTimeline } from '../../src/core/types';
import {
  createMonophonicFormat0,
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
  type SchematicExporterModule,
} from '../fixtures/test-loader';

describe('E2E Track: Schematic Validator Test Suite', () => {
  let exporter: SchematicExporterModule | null = null;
  let testTimeline: SongTimeline | null = null;

  const isImplemented = isSchematicExporterImplemented();

  beforeAll(async () => {
    if (isImplemented) {
      exporter = await loadSchematicExporters();
      if (isMidiParserImplemented() && isNoteBlockMapperImplemented()) {
        const parser = await loadMidiParser();
        const mapper = await loadNoteBlockMapper();
        if (parser && mapper) {
          const midi = parser.parseMidi(createMonophonicFormat0());
          testTimeline = mapper.convertToSongTimeline(midi);
        }
      }
    }

    // Fallback synthetic SongTimeline if earlier modules not yet ready
    if (!testTimeline) {
      testTimeline = {
        title: 'Synthetic Test Song',
        totalRedstoneTicks: 20,
        durationSeconds: 2.0,
        bpm: 120,
        eventsByTick: new Map([
          [
            0,
            [
              {
                redstoneTick: 0,
                timestampSeconds: 0,
                instrument: 'harp',
                baseBlock: 'minecraft:dirt',
                note: 12,
                velocity: 0.8,
                trackId: 0,
              },
            ],
          ],
          [
            4,
            [
              {
                redstoneTick: 4,
                timestampSeconds: 0.4,
                instrument: 'bass',
                baseBlock: 'minecraft:oak_planks',
                note: 6,
                velocity: 0.8,
                trackId: 0,
              },
            ],
          ],
          [
            10,
            [
              {
                redstoneTick: 10,
                timestampSeconds: 1.0,
                instrument: 'flute',
                baseBlock: 'minecraft:clay',
                note: 18,
                velocity: 0.9,
                trackId: 0,
              },
            ],
          ],
        ]),
        allEvents: [
          {
            redstoneTick: 0,
            timestampSeconds: 0,
            instrument: 'harp',
            baseBlock: 'minecraft:dirt',
            note: 12,
            velocity: 0.8,
            trackId: 0,
          },
          {
            redstoneTick: 4,
            timestampSeconds: 0.4,
            instrument: 'bass',
            baseBlock: 'minecraft:oak_planks',
            note: 6,
            velocity: 0.8,
            trackId: 0,
          },
          {
            redstoneTick: 10,
            timestampSeconds: 1.0,
            instrument: 'flute',
            baseBlock: 'minecraft:clay',
            note: 18,
            velocity: 0.9,
            trackId: 0,
          },
        ],
        tracks: [{ id: 0, name: 'Lead', instrument: 'harp', noteCount: 3, isPercussion: false }],
      };
    }
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 1: Feature Coverage - Sponge Schematic (.schem)', () => {
    it('exports Sponge schematic with valid GZIP NBT compound, version, and dimensions', async () => {
      expect(exporter).toBeDefined();
      expect(testTimeline).toBeDefined();

      const result = await exporter!.exportSpongeSchematic(testTimeline!, {
        name: 'TestSong',
        author: 'MidiToNoteBlock',
      });

      expect(result.filename.endsWith('.schem')).toBe(true);
      expect(result.mimeType).toBe('application/x-minecraft-schematic');
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.totalNoteBlocks).toBeGreaterThanOrEqual(3);

      // Validate through independent NBT validator oracle
      const validation = validateSpongeSchematic(result.data);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.version === 2 || validation.version === 3).toBe(true);
      expect(validation.dataVersion).toBeGreaterThanOrEqual(2500); // 1.16+
      expect(validation.dimensions.width).toBeGreaterThan(0);
      expect(validation.dimensions.height).toBeGreaterThanOrEqual(3); // Layer 0: base, 1: circuit, 2: clearance
      expect(validation.dimensions.length).toBeGreaterThan(0);
    });

    it('contains a valid block state Palette and VarInt-encoded BlockData byte array', async () => {
      expect(exporter).toBeDefined();
      const result = await exporter!.exportSpongeSchematic(testTimeline!);
      const validation = validateSpongeSchematic(result.data);

      expect(Object.keys(validation.palette).length).toBeGreaterThanOrEqual(2);
      expect(validation.totalBlocks).toBe(
        validation.dimensions.width * validation.dimensions.height * validation.dimensions.length
      );

      // Palette must include air and note block
      const paletteKeys = Object.keys(validation.palette);
      expect(paletteKeys.some((k) => k.startsWith('minecraft:air'))).toBe(true);
      expect(paletteKeys.some((k) => k.startsWith('minecraft:note_block'))).toBe(true);
    });
  });

  describe.skipIf(!isImplemented)('Tier 1: Feature Coverage - Litematica (.litematic)', () => {
    it('exports Litematica with valid GZIP NBT, Version 5, Metadata, and Regions', async () => {
      expect(exporter).toBeDefined();
      expect(testTimeline).toBeDefined();

      const result = await exporter!.exportLitematic(testTimeline!, {
        name: 'TestLitematicSong',
        author: 'MidiToNoteBlock',
      });

      expect(result.filename.endsWith('.litematic')).toBe(true);
      expect(result.mimeType).toBe('application/x-litematic');
      expect(result.data.length).toBeGreaterThan(0);

      // Validate through independent Litematica validator oracle
      const validation = validateLitematic(result.data);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.version).toBe(5);
      expect(validation.minecraftDataVersion).toBeGreaterThanOrEqual(2500);
      expect(validation.enclosingSize.x).toBeGreaterThan(0);
      expect(validation.enclosingSize.y).toBeGreaterThanOrEqual(3);
      expect(validation.enclosingSize.z).toBeGreaterThan(0);
      expect(validation.palette.length).toBeGreaterThanOrEqual(2);
      expect(validation.noteBlockCount).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 2: Boundary & Corner Cases', () => {
    it('strictly satisfies the Acoustic Clearance Rule: y+1 is air above all note blocks', async () => {
      expect(exporter).toBeDefined();
      const result = await exporter!.exportSpongeSchematic(testTimeline!);
      const validation = validateSpongeSchematic(result.data);

      expect(validation.acousticClearanceViolations).toHaveLength(0);
    });

    it('respects the maxTrackWidth layout constraint in serpentine zigzag routing', async () => {
      expect(exporter).toBeDefined();
      const customWidth = 12;
      const result = await exporter!.exportSpongeSchematic(testTimeline!, {
        name: 'ConstrainedWidth',
        maxTrackWidth: customWidth,
      });

      expect(result.dimensions.width).toBeLessThanOrEqual(customWidth);
    });

    it('exports a single-note minimal schematic correctly', async () => {
      expect(exporter).toBeDefined();
      const singleNoteTimeline: SongTimeline = {
        title: 'Single Note',
        totalRedstoneTicks: 2,
        durationSeconds: 0.2,
        bpm: 120,
        eventsByTick: new Map([
          [
            0,
            [
              {
                redstoneTick: 0,
                timestampSeconds: 0,
                instrument: 'harp',
                baseBlock: 'minecraft:dirt',
                note: 12,
                velocity: 1.0,
                trackId: 0,
              },
            ],
          ],
        ]),
        allEvents: [
          {
            redstoneTick: 0,
            timestampSeconds: 0,
            instrument: 'harp',
            baseBlock: 'minecraft:dirt',
            note: 12,
            velocity: 1.0,
            trackId: 0,
          },
        ],
        tracks: [{ id: 0, name: 'Solo', instrument: 'harp', noteCount: 1, isPercussion: false }],
      };

      const result = await exporter!.exportSpongeSchematic(singleNoteTimeline);
      const validation = validateSpongeSchematic(result.data);
      expect(validation.isValid).toBe(true);
      expect(validation.noteBlockCount).toBe(1);
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE)
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 3: Cross-Feature Combinations', () => {
    it('decomposes delays into repeater chains matching the redstone tick intervals', async () => {
      expect(exporter).toBeDefined();
      const result = await exporter!.exportSpongeSchematic(testTimeline!);
      const validation = validateSpongeSchematic(result.data);

      // Between tick 0 and tick 4: 4 ticks delay (1 repeater with delay=4)
      // Between tick 4 and tick 10: 6 ticks delay (1 repeater with delay=4 + 1 with delay=2)
      // Total repeaters >= 3
      expect(validation.repeaterCount).toBeGreaterThanOrEqual(3);
    });

    it('supports polyphonic chords with lateral note blocks sharing redstone activation', async () => {
      expect(exporter).toBeDefined();
      const chordTimeline: SongTimeline = {
        title: 'Chord Schematic',
        totalRedstoneTicks: 5,
        durationSeconds: 0.5,
        bpm: 120,
        eventsByTick: new Map([
          [
            0,
            [
              { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 0, velocity: 0.8, trackId: 0 },
              { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 4, velocity: 0.8, trackId: 0 },
              { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 7, velocity: 0.8, trackId: 0 },
            ],
          ],
        ]),
        allEvents: [
          { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 0, velocity: 0.8, trackId: 0 },
          { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 4, velocity: 0.8, trackId: 0 },
          { redstoneTick: 0, timestampSeconds: 0, instrument: 'harp', baseBlock: 'minecraft:dirt', note: 7, velocity: 0.8, trackId: 0 },
        ],
        tracks: [{ id: 0, name: 'Chords', instrument: 'harp', noteCount: 3, isPercussion: false }],
      };

      const result = await exporter!.exportSpongeSchematic(chordTimeline);
      const validation = validateSpongeSchematic(result.data);
      expect(validation.isValid).toBe(true);
      expect(validation.noteBlockCount).toBe(3);
    });

    it('correctly connects serpentine rows with continuous redstone wire and proper repeater facings', async () => {
      expect(exporter).toBeDefined();
      // Multi-row timeline with notes spanning across multiple serpentine rows
      const multiRowTimeline: SongTimeline = {
        title: 'MultiRow',
        totalRedstoneTicks: 60,
        durationSeconds: 6.0,
        bpm: 120,
        eventsByTick: new Map(),
        allEvents: [],
        tracks: [{ id: 0, name: 'Lead', instrument: 'harp', noteCount: 20, isPercussion: false }],
      };

      for (let i = 0; i < 20; i++) {
        const tick = i * 3;
        const ev = {
          redstoneTick: tick,
          timestampSeconds: tick * 0.1,
          instrument: 'harp' as const,
          baseBlock: 'minecraft:dirt',
          note: 12,
          velocity: 0.8,
          trackId: 0,
        };
        multiRowTimeline.allEvents.push(ev);
        multiRowTimeline.eventsByTick.set(tick, [ev]);
      }

      // Export with narrow width 8 to force multiple serpentine zigzag turns
      const result = await exporter!.exportSpongeSchematic(multiRowTimeline, { name: 'MultiRow', maxTrackWidth: 8 });
      const validation = validateSpongeSchematic(result.data);
      expect(validation.isValid).toBe(true);
      expect(validation.noteBlockCount).toBe(20);
      expect(validation.repeaterCount).toBeGreaterThan(15);
      expect(validation.dimensions.length).toBeGreaterThanOrEqual(7); // Multiple rows in Z
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================
  describe.skipIf(!isImplemented)('Tier 4: Real-World Scenarios', () => {
    it('generates fully verifiable .schem and .litematic files from complex polyphonic timeline', async () => {
      expect(exporter).toBeDefined();
      // Polyphonic timeline with 10+ notes across different instruments
      const polyTimeline: SongTimeline = {
        title: 'Full Polyphonic Song',
        totalRedstoneTicks: 40,
        durationSeconds: 4.0,
        bpm: 120,
        eventsByTick: new Map(),
        allEvents: [],
        tracks: [
          { id: 0, name: 'Harp', instrument: 'harp', noteCount: 5, isPercussion: false },
          { id: 1, name: 'Bass', instrument: 'bass', noteCount: 4, isPercussion: false },
          { id: 2, name: 'Flute', instrument: 'flute', noteCount: 4, isPercussion: false },
        ],
      };

      for (let i = 0; i < 10; i++) {
        const tick = i * 4;
        const ev = {
          redstoneTick: tick,
          timestampSeconds: tick * 0.1,
          instrument: (i % 3 === 0 ? 'harp' : i % 3 === 1 ? 'bass' : 'flute') as any,
          baseBlock: i % 3 === 0 ? 'minecraft:dirt' : i % 3 === 1 ? 'minecraft:oak_planks' : 'minecraft:clay',
          note: (i * 2) % 25,
          velocity: 0.8,
          trackId: i % 3,
        };
        polyTimeline.allEvents.push(ev);
        polyTimeline.eventsByTick.set(tick, [ev]);
      }

      const schemResult = await exporter!.exportSpongeSchematic(polyTimeline);
      const schemVal = validateSpongeSchematic(schemResult.data);
      expect(schemVal.isValid).toBe(true);
      expect(schemVal.noteBlockCount).toBe(10);

      const litematicResult = await exporter!.exportLitematic(polyTimeline);
      const litematicVal = validateLitematic(litematicResult.data);
      expect(litematicVal.isValid).toBe(true);
      expect(litematicVal.noteBlockCount).toBe(10);
    });
  });
});

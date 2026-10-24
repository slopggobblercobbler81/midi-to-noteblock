import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMidi } from '../src/core/midi-parser';
import { convertToSongTimeline } from '../src/core/noteblock-mapper';
import { buildCircuitGrid } from '../src/core/circuit-builder';
import {
  computeMaterialList,
  formatStacks,
  parseBlockInfo,
} from '../src/core/schematic-viewer';

describe('Schematic Viewer & Material List Test Suite', () => {
  it('formats Minecraft item stacks accurately (64 items/stack)', () => {
    expect(formatStacks(0)).toBe('0');
    expect(formatStacks(1)).toBe('1');
    expect(formatStacks(32)).toBe('32');
    expect(formatStacks(63)).toBe('63');
    expect(formatStacks(64)).toBe('1 stack');
    expect(formatStacks(65)).toBe('1 stack + 1');
    expect(formatStacks(128)).toBe('2 stacks');
    expect(formatStacks(130)).toBe('2 stacks + 2');
    expect(formatStacks(256)).toBe('4 stacks');
  });

  it('parses block states correctly for tooltips and hover info', () => {
    const noteInfo = parseBlockInfo(
      2,
      1,
      1,
      'minecraft:note_block[instrument=harp,note=12,powered=false]',
      'minecraft:dirt'
    );
    expect(noteInfo.blockName).toBe('Note Block');
    expect(noteInfo.category).toBe('noteblock');
    expect(noteInfo.note).toBe(12);
    expect(noteInfo.noteName).toBe('F#4');
    expect(noteInfo.instrument).toBe('Piano / Harp');
    expect(noteInfo.substrateName).toBe('Dirt');

    const repeaterInfo = parseBlockInfo(
      3,
      1,
      1,
      'minecraft:repeater[delay=4,facing=west,powered=false]'
    );
    expect(repeaterInfo.blockName).toBe('Redstone Repeater');
    expect(repeaterInfo.category).toBe('repeater');
    expect(repeaterInfo.delay).toBe(4);
    expect(repeaterInfo.facing).toBe('west');

    const airInfo = parseBlockInfo(0, 1, 0, 'minecraft:air');
    expect(airInfo.blockName).toBe('Air');
    expect(airInfo.category).toBe('air');
  });

  it('computes accurate survival materials report for Ode to Joy', () => {
    const midiBuf = fs.readFileSync(path.resolve(__dirname, '../Ode_to_Joy.mid'));
    const midi = parseMidi(midiBuf);
    const timeline = convertToSongTimeline(midi);
    const circuit = buildCircuitGrid(timeline, { name: 'Ode_to_Joy', maxTrackWidth: 16 });

    const report = computeMaterialList(circuit, 'Beethoven - Ode to Joy');

    expect(report.totalNoteBlocks).toBe(222);
    expect(report.totalRepeaters).toBeGreaterThan(50);
    expect(report.totalBlocks).toBeGreaterThan(300);

    // Verify categories
    expect(report.categories.length).toBe(4);

    const noteBlockItem = report.items.find((i) => i.id === 'minecraft:note_block');
    expect(noteBlockItem).toBeDefined();
    expect(noteBlockItem!.count).toBe(222);
    expect(noteBlockItem!.stacksText).toBe('3 stacks + 30');

    const repeaterItem = report.items.find((i) => i.id === 'minecraft:repeater');
    expect(repeaterItem).toBeDefined();
    expect(repeaterItem!.count).toBe(circuit.totalRepeaters);

    // Verify copyable text contains essential sections
    expect(report.copyableText).toContain('Minecraft Note Block Materials Checklist');
    expect(report.copyableText).toContain('Beethoven - Ode to Joy');
    expect(report.copyableText).toContain('=== Redstone & Note Blocks ===');
    expect(report.copyableText).toContain('Note Block: 222 (3 stacks + 30)');
  });

  it('builds different circuit layouts when maxTrackWidth changes', () => {
    const midiBuf = fs.readFileSync(path.resolve(__dirname, '../Ode_to_Joy.mid'));
    const midi = parseMidi(midiBuf);
    const timeline = convertToSongTimeline(midi);

    const circuit16 = buildCircuitGrid(timeline, { name: 'Ode', maxTrackWidth: 16 });
    const circuit24 = buildCircuitGrid(timeline, { name: 'Ode', maxTrackWidth: 24 });
    const circuit10 = buildCircuitGrid(timeline, { name: 'Ode', maxTrackWidth: 10 });

    console.log('circuit16 dimensions:', circuit16.dimensions);
    console.log('circuit24 dimensions:', circuit24.dimensions);
    console.log('circuit10 dimensions:', circuit10.dimensions);

    expect(circuit16.dimensions.width).toBe(16);
    expect(circuit24.dimensions.width).toBe(24);
    expect(circuit10.dimensions.width).toBe(10);

    // When width is larger, length (Z) should be shorter (fewer rows)
    expect(circuit24.dimensions.length).toBeLessThan(circuit16.dimensions.length);
    // When width is smaller, length (Z) should be longer (more rows)
    expect(circuit10.dimensions.length).toBeGreaterThan(circuit16.dimensions.length);

    let maxX16 = 0;
    for (const key of circuit16.blocks.keys()) {
      const x = parseInt(key.split(',')[0]!, 10);
      if (x > maxX16) maxX16 = x;
    }
    let maxX24 = 0;
    for (const key of circuit24.blocks.keys()) {
      const x = parseInt(key.split(',')[0]!, 10);
      if (x > maxX24) maxX24 = x;
    }
    console.log('maxX16:', maxX16, 'maxX24:', maxX24);

    // Verify zero noteblocks after each other along X (transmission direction)
    const noteblocks = new Set<string>();
    for (const [coord, state] of circuit16.blocks.entries()) {
      if (state.startsWith('minecraft:note_block')) {
        noteblocks.add(coord);
      }
    }
    for (const coord of noteblocks) {
      const [x, y, z] = coord.split(',').map(Number);
      expect(noteblocks.has(`${x! + 1},${y},${z}`)).toBe(false);
      expect(noteblocks.has(`${x! - 1},${y},${z}`)).toBe(false);
    }
  });

  it('exports valid Sponge and Litematica schematics with custom maxTrackWidth (24 and 10)', async () => {
    const { exportSpongeSchematic } = await import('../src/core/schem-exporter');
    const { exportLitematic } = await import('../src/core/litematic-exporter');
    const { validateSpongeSchematic, validateLitematic } = await import('./fixtures/nbt-reader');

    const midiBuf = fs.readFileSync(path.resolve(__dirname, '../Ode_to_Joy.mid'));
    const midi = parseMidi(midiBuf);
    const timeline = convertToSongTimeline(midi);

    // Export with custom width 24
    const schem24 = await exportSpongeSchematic(timeline, { name: 'Ode24', maxTrackWidth: 24 });
    const valSchem24 = validateSpongeSchematic(schem24.data);
    expect(valSchem24.isValid).toBe(true);
    expect(valSchem24.dimensions.width).toBe(24);
    expect(valSchem24.dimensions.length).toBe(40);

    const litematic24 = await exportLitematic(timeline, { name: 'Ode24', maxTrackWidth: 24 });
    const valLitematic24 = validateLitematic(litematic24.data);
    expect(valLitematic24.isValid).toBe(true);
    expect(valLitematic24.enclosingSize.x).toBe(24);
    expect(valLitematic24.enclosingSize.z).toBe(40);

    // Export with custom width 10
    const schem10 = await exportSpongeSchematic(timeline, { name: 'Ode10', maxTrackWidth: 10 });
    const valSchem10 = validateSpongeSchematic(schem10.data);
    expect(valSchem10.isValid).toBe(true);
    expect(valSchem10.dimensions.width).toBe(10);
    expect(valSchem10.dimensions.length).toBe(132);

    const litematic10 = await exportLitematic(timeline, { name: 'Ode10', maxTrackWidth: 10 });
    const valLitematic10 = validateLitematic(litematic10.data);
    expect(valLitematic10.isValid).toBe(true);
    expect(valLitematic10.enclosingSize.x).toBe(10);
    expect(valLitematic10.enclosingSize.z).toBe(132);
  });
});

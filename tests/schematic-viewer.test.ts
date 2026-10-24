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
    expect(report.totalBlocks).toBeGreaterThan(400);

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
});

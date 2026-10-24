import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMidi } from '../src/core/midi-parser';
import { convertToSongTimeline } from '../src/core/noteblock-mapper';
import { exportSpongeSchematic } from '../src/core/schem-exporter';
import { exportLitematic } from '../src/core/litematic-exporter';
import { validateSpongeSchematic, validateLitematic } from './fixtures/nbt-reader';

describe('Public Domain Sample MIDI Conversion Test', () => {
  it('parses, maps, and generates schematics for Ode_to_Joy.mid', async () => {
    const midiPath = path.resolve(__dirname, '../Ode_to_Joy.mid');
    expect(fs.existsSync(midiPath)).toBe(true);

    const buffer = fs.readFileSync(midiPath);
    const midi = parseMidi(buffer);

    expect(midi.numTracks).toBeGreaterThan(0);
    expect(midi.durationSeconds).toBeGreaterThan(0);

    const timeline = convertToSongTimeline(midi);
    expect(timeline.allEvents.length).toBeGreaterThan(0);

    // Verify all notes are strictly in [0, 24] and have valid base blocks
    for (const event of timeline.allEvents) {
      expect(event.note).toBeGreaterThanOrEqual(0);
      expect(event.note).toBeLessThanOrEqual(24);
      expect(typeof event.baseBlock).toBe('string');
      expect(event.baseBlock).toMatch(/^minecraft:/);
    }

    // Export to Sponge .schem
    const schemResult = await exportSpongeSchematic(timeline, { name: 'Ode_to_Joy' });
    expect(schemResult.filename).toBe('Ode_to_Joy.schem');
    fs.writeFileSync(path.resolve(__dirname, '../Ode_to_Joy.schem'), schemResult.data);
    const schemVal = validateSpongeSchematic(schemResult.data);
    expect(schemVal.isValid).toBe(true);
    expect(schemVal.errors).toHaveLength(0);
    expect(schemVal.acousticClearanceViolations).toHaveLength(0);

    // Export to Litematica .litematic
    const litematicResult = await exportLitematic(timeline, { name: 'Ode_to_Joy' });
    expect(litematicResult.filename).toBe('Ode_to_Joy.litematic');
    fs.writeFileSync(path.resolve(__dirname, '../Ode_to_Joy.litematic'), litematicResult.data);
    const litematicVal = validateLitematic(litematicResult.data);
    expect(litematicVal.isValid).toBe(true);
    expect(litematicVal.errors).toHaveLength(0);
  });
});

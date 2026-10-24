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

  it('avoids naming the song after generic GM instruments like Electric Piano', () => {
    const mockMidi = {
      format: 1 as const,
      numTracks: 2,
      division: 480,
      ticksPerQuarterNote: 480,
      totalTicks: 4800,
      durationSeconds: 10,
      tempoMap: [{ absTick: 0, bpm: 120, microsecondsPerBeat: 500000, seconds: 0 }],
      timeSignatures: [],
      keySignatures: [],
      tracks: [
        { id: 0, name: '', channel: 0, isPercussion: false, notes: [] },
        { id: 1, name: 'Electric Piano', channel: 0, isPercussion: false, notes: [{ pitch: 60, velocity: 80, startSeconds: 0, durationSeconds: 0.5, channel: 0 }] },
      ],
    };

    const timeline = convertToSongTimeline(mockMidi as any);
    expect(timeline.title).not.toBe('Electric Piano');

    // When user provides a custom song title (e.g. from file name), it takes precedence
    const customTimeline = convertToSongTimeline(mockMidi as any, { songTitle: 'custom_song' });
    expect(customTimeline.title).toBe('custom_song');
  });
});

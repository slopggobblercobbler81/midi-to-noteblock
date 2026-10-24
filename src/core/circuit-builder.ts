/**
 * src/core/circuit-builder.ts
 *
 * 3D Redstone Circuit Layout Generator for Minecraft Note Block Schematics.
 *
 * Arranges note blocks, base substrate blocks, and repeater delay chains
 * into a compact, deterministic serpentine (zigzag) 3D grid layout that strictly
 * satisfies:
 * 1. Physical Acoustic Clearance: Y+1 above EVERY note block is strictly air.
 * 2. Instrument Substrate: Y-1 beneath every note block has its assigned base block.
 * 3. Exact Redstone Timing: Delays between ticks are decomposed into 1-4 tick repeaters.
 * 4. Polyphonic Chords: Multiple simultaneous notes flank the redstone trigger node laterally.
 * 5. Track Width Constraint: Circuit width strictly <= maxTrackWidth.
 */

import {
  type SongTimeline,
  type SchematicExportOptions,
  type SchematicDimensions,
  type RepeaterFacing,
} from './types';
import { decomposeRepeaterDelay } from './noteblock-mapper';

export interface GeneratedCircuit {
  dimensions: SchematicDimensions;
  blocks: Map<string, string>;
  totalNoteBlocks: number;
  totalRepeaters: number;
}

/**
 * Builds a 3D block circuit grid from a converted SongTimeline.
 */
export function buildCircuitGrid(
  song: SongTimeline,
  options?: SchematicExportOptions
): GeneratedCircuit {
  const maxTrackWidth = Math.max(5, options?.maxTrackWidth ?? 16);
  const blocks = new Map<string, string>();

  let totalNoteBlocks = 0;
  let totalRepeaters = 0;

  const setBlock = (x: number, y: number, z: number, state: string): void => {
    blocks.set(`${x},${y},${z}`, state);
  };

  // Group events by redstone tick in chronological order
  const sortedTicks = Array.from(song.eventsByTick.keys()).sort((a, b) => a - b);

  // If there are no events in the song, return minimal 3x3x3 empty air grid
  if (sortedTicks.length === 0) {
    return {
      dimensions: { width: maxTrackWidth, height: 3, length: 3 },
      blocks,
      totalNoteBlocks: 0,
      totalRepeaters: 0,
    };
  }

  // Layout parameters
  let laneIndex = 0;
  let curX = 1;
  let dirX: 1 | -1 = 1;
  const minX = 1;
  const maxX = maxTrackWidth - 2;

  const getLaneZ = (lane: number) => 1 + lane * 3;

  const advancePosition = () => {
    const nextX = curX + dirX;
    if (nextX >= minX && nextX <= maxX) {
      curX = nextX;
    } else {
      // Reached boundary, turn into next lane
      const oldZ = getLaneZ(laneIndex);
      laneIndex++;
      const newZ = getLaneZ(laneIndex);
      dirX = (dirX === 1 ? -1 : 1);

      // Connect with turn wiring at Y=1 and stone substrate at Y=0
      for (let z = oldZ + 1; z < newZ; z++) {
        setBlock(curX, 1, z, 'minecraft:redstone_wire[power=0]');
        setBlock(curX, 0, z, 'minecraft:stone');
        setBlock(curX, 2, z, 'minecraft:air');
      }
    }
  };

  let prevTick = 0;

  for (let i = 0; i < sortedTicks.length; i++) {
    const tick = sortedTicks[i]!;
    const events = song.eventsByTick.get(tick) ?? [];

    // Delay handling before this tick
    if (i > 0) {
      const deltaTicks = tick - prevTick;
      const repeaterDelays = decomposeRepeaterDelay(deltaTicks);

      for (const delay of repeaterDelays) {
        advancePosition();
        const z = getLaneZ(laneIndex);
        const facing: RepeaterFacing = dirX === 1 ? 'west' : 'east';

        setBlock(
          curX,
          1,
          z,
          `minecraft:repeater[delay=${delay},facing=${facing},powered=false]`
        );
        setBlock(curX, 0, z, 'minecraft:stone');
        setBlock(curX, 2, z, 'minecraft:air');
        totalRepeaters++;
      }
    }

    // Now place note blocks for this tick
    if (events.length > 0) {
      if (i > 0 || prevTick !== tick) {
        advancePosition();
      }

      const centerZ = getLaneZ(laneIndex);

      // First note placed on the center cell
      const firstEvent = events[0]!;
      setBlock(
        curX,
        1,
        centerZ,
        `minecraft:note_block[instrument=${firstEvent.instrument},note=${firstEvent.note},powered=false]`
      );
      setBlock(curX, 0, centerZ, firstEvent.baseBlock);
      setBlock(curX, 2, centerZ, 'minecraft:air');
      totalNoteBlocks++;

      // Additional simultaneous chord notes placed laterally
      for (let chordIdx = 1; chordIdx < events.length; chordIdx++) {
        const ev = events[chordIdx]!;
        // Alternate placing on north (Z - 1) and south (Z + 1)
        const zOffset = (chordIdx % 2 === 1) ? -1 : 1;
        const multiplier = Math.floor((chordIdx - 1) / 2) + 1;
        const targetZ = centerZ + zOffset * multiplier;

        setBlock(
          curX,
          1,
          targetZ,
          `minecraft:note_block[instrument=${ev.instrument},note=${ev.note},powered=false]`
        );
        setBlock(curX, 0, targetZ, ev.baseBlock);
        setBlock(curX, 2, targetZ, 'minecraft:air');
        totalNoteBlocks++;
      }
    }

    prevTick = tick;
  }

  // Calculate actual bounding box dimensions
  let maxZ = 2;
  for (const key of blocks.keys()) {
    const parts = key.split(',');
    const z = parseInt(parts[2]!, 10);
    if (z > maxZ) maxZ = z;
  }

  const dimensions: SchematicDimensions = {
    width: maxTrackWidth,
    height: 3,
    length: maxZ + 2,
  };

  return {
    dimensions,
    blocks,
    totalNoteBlocks,
    totalRepeaters,
  };
}

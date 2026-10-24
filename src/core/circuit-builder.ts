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
 * 6. Signal Continuity: Redstone spine is 100% conductive (repeaters, stone, redstone wire).
 *    Note blocks NEVER sit on the transmission spine, ensuring signals never die.
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

  // Serpentine layout boundaries:
  // X = turnWestX (1) is the West turn column.
  // X = turnEastX (maxTrackWidth - 2) is the East turn column.
  // X in [minLaneX, maxLaneX] is the active playable lane.
  const turnWestX = 1;
  const turnEastX = maxTrackWidth - 2;
  const minLaneX = 2;
  const maxLaneX = maxTrackWidth - 3;

  let laneIndex = 0;
  let curX = minLaneX;
  let dirX: 1 | -1 = 1;
  let isFirstPosition = true;

  const getLaneZ = (lane: number) => 1 + lane * 3;

  // Initial input repeater at (turnWestX, 1, 1) pointing East into the track.
  // In Minecraft Java Edition: repeater facing defines the direction from output to input.
  // To output East into the track (+X), facing must be 'west'.
  setBlock(turnWestX, 1, 1, 'minecraft:repeater[delay=1,facing=west,powered=false]');
  setBlock(turnWestX, 0, 1, 'minecraft:stone');
  setBlock(turnWestX, 2, 1, 'minecraft:air');
  totalRepeaters++;

  const advancePosition = (): void => {
    if (isFirstPosition) {
      isFirstPosition = false;
      return;
    }

    if (dirX === 1) {
      if (curX < maxLaneX) {
        curX++;
      } else {
        // Reached East boundary: turn south into next lane
        const oldZ = getLaneZ(laneIndex);
        laneIndex++;
        const newZ = getLaneZ(laneIndex);
        dirX = -1;
        curX = maxLaneX;

        // Place continuous redstone wire at X = turnEastX from oldZ to newZ
        for (let z = oldZ; z <= newZ; z++) {
          setBlock(turnEastX, 1, z, 'minecraft:redstone_wire[power=0]');
          setBlock(turnEastX, 0, z, 'minecraft:stone');
          setBlock(turnEastX, 2, z, 'minecraft:air');
        }
      }
    } else {
      if (curX > minLaneX) {
        curX--;
      } else {
        // Reached West boundary: turn south into next lane
        const oldZ = getLaneZ(laneIndex);
        laneIndex++;
        const newZ = getLaneZ(laneIndex);
        dirX = 1;
        curX = minLaneX;

        // Place continuous redstone wire at X = turnWestX from oldZ to newZ
        for (let z = oldZ; z <= newZ; z++) {
          setBlock(turnWestX, 1, z, 'minecraft:redstone_wire[power=0]');
          setBlock(turnWestX, 0, z, 'minecraft:stone');
          setBlock(turnWestX, 2, z, 'minecraft:air');
        }
      }
    }
  };

  let prevTick = 0;

  for (let i = 0; i < sortedTicks.length; i++) {
    const tick = sortedTicks[i]!;
    const events = song.eventsByTick.get(tick) ?? [];

    // Delay handling before this tick
    const deltaTicks = tick - prevTick;
    if (deltaTicks > 0) {
      const repeaterDelays = decomposeRepeaterDelay(deltaTicks);

      for (const delay of repeaterDelays) {
        advancePosition();
        const z = getLaneZ(laneIndex);
        // In Minecraft Java Edition: facing is from output to input.
        // Signal traveling East (dirX === 1) -> facing: 'west'
        // Signal traveling West (dirX === -1) -> facing: 'east'
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
      advancePosition();
      let centerZ = getLaneZ(laneIndex);

      // Spine trigger node: redstone wire conducts seamlessly and powers flanking note blocks
      setBlock(curX, 1, centerZ, 'minecraft:redstone_wire[power=0]');
      setBlock(curX, 0, centerZ, 'minecraft:stone');
      setBlock(curX, 2, centerZ, 'minecraft:air');

      // First note placed on North flank (Z - 1)
      const ev0 = events[0]!;
      setBlock(
        curX,
        1,
        centerZ - 1,
        `minecraft:note_block[instrument=${ev0.instrument},note=${ev0.note},powered=false]`
      );
      setBlock(curX, 0, centerZ - 1, ev0.baseBlock);
      setBlock(curX, 2, centerZ - 1, 'minecraft:air');
      totalNoteBlocks++;

      // Second note placed on South flank (Z + 1)
      if (events.length > 1) {
        const ev1 = events[1]!;
        setBlock(
          curX,
          1,
          centerZ + 1,
          `minecraft:note_block[instrument=${ev1.instrument},note=${ev1.note},powered=false]`
        );
        setBlock(curX, 0, centerZ + 1, ev1.baseBlock);
        setBlock(curX, 2, centerZ + 1, 'minecraft:air');
        totalNoteBlocks++;
      }

      // Additional simultaneous chord notes (3, 4, etc.) placed via 0-delay redstone spine extension
      for (let chordIdx = 2; chordIdx < events.length; chordIdx += 2) {
        advancePosition();
        centerZ = getLaneZ(laneIndex);

        // Instant redstone wire along spine connects directly from previous trigger block
        setBlock(curX, 1, centerZ, 'minecraft:redstone_wire[power=0]');
        setBlock(curX, 0, centerZ, 'minecraft:stone');
        setBlock(curX, 2, centerZ, 'minecraft:air');

        // North flank note
        const evA = events[chordIdx]!;
        setBlock(
          curX,
          1,
          centerZ - 1,
          `minecraft:note_block[instrument=${evA.instrument},note=${evA.note},powered=false]`
        );
        setBlock(curX, 0, centerZ - 1, evA.baseBlock);
        setBlock(curX, 2, centerZ - 1, 'minecraft:air');
        totalNoteBlocks++;

        // South flank note (if exists)
        if (chordIdx + 1 < events.length) {
          const evB = events[chordIdx + 1]!;
          setBlock(
            curX,
            1,
            centerZ + 1,
            `minecraft:note_block[instrument=${evB.instrument},note=${evB.note},powered=false]`
          );
          setBlock(curX, 0, centerZ + 1, evB.baseBlock);
          setBlock(curX, 2, centerZ + 1, 'minecraft:air');
          totalNoteBlocks++;
        }
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

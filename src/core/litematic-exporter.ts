/**
 * src/core/litematic-exporter.ts
 *
 * Litematica (.litematic) v5 Exporter.
 * Generates official Litematica Specification compliant GZIP-compressed binary NBT files
 * with continuous bitstream block state packing across 64-bit LongArrays.
 */

import {
  NbtTagType,
  type SongTimeline,
  type SchematicExportOptions,
  type SchematicResult,
} from './types';
import { buildCircuitGrid } from './circuit-builder';
import { serializeGzipNbt, type NbtCompoundData } from './nbt';

/**
 * Parses a Minecraft block state string into Name and Properties dictionary.
 * e.g. "minecraft:note_block[instrument=harp,note=12,powered=false]"
 * -> name: "minecraft:note_block", props: { instrument: "harp", note: "12", powered: "false" }
 */
function parseBlockState(stateStr: string): {
  name: string;
  properties?: Record<string, string>;
} {
  const bracketIndex = stateStr.indexOf('[');
  if (bracketIndex === -1) {
    return { name: stateStr };
  }

  const name = stateStr.slice(0, bracketIndex);
  const propsRaw = stateStr.slice(bracketIndex + 1, stateStr.length - 1);
  const properties: Record<string, string> = {};

  for (const part of propsRaw.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const k = part.slice(0, eqIdx).trim();
      const v = part.slice(eqIdx + 1).trim();
      properties[k] = v;
    }
  }

  return { name, properties };
}

/**
 * Packs array of palette indices into continuous bitstream 64-bit Longs.
 */
export function packLitematicaBlockStates(
  indices: number[],
  bitsPerBlock: number,
  volume: number
): BigInt64Array {
  const b = BigInt(bitsPerBlock);
  const totalLongs = Math.ceil((volume * bitsPerBlock) / 64);
  const longArray = new BigInt64Array(totalLongs);
  const u64 = new BigUint64Array(longArray.buffer);

  for (let i = 0; i < volume; i++) {
    const val = BigInt(indices[i] ?? 0);
    const startBit = BigInt(i) * b;
    const longIndex = Number(startBit / 64n);
    const bitOffset = Number(startBit % 64n);

    if (bitOffset + bitsPerBlock <= 64) {
      u64[longIndex] = (u64[longIndex] ?? 0n) | (val << BigInt(bitOffset));
    } else {
      const lowerBitsCount = 64 - bitOffset;
      const lowerMask = (1n << BigInt(lowerBitsCount)) - 1n;
      const lowerBits = val & lowerMask;
      const upperBits = val >> BigInt(lowerBitsCount);

      u64[longIndex] = (u64[longIndex] ?? 0n) | (lowerBits << BigInt(bitOffset));
      u64[longIndex + 1] = (u64[longIndex + 1] ?? 0n) | upperBits;
    }
  }

  return longArray;
}

export async function exportLitematic(
  song: SongTimeline,
  options?: SchematicExportOptions
): Promise<SchematicResult> {
  const circuit = buildCircuitGrid(song, options);
  const { width, height, length } = circuit.dimensions;
  const totalVolume = width * height * length;

  // 1. Build Palette
  // Index 0: minecraft:air
  const uniqueStates = ['minecraft:air'];
  const stateToIndex = new Map<string, number>([['minecraft:air', 0]]);

  for (const state of circuit.blocks.values()) {
    if (state !== 'minecraft:air' && !stateToIndex.has(state)) {
      stateToIndex.set(state, uniqueStates.length);
      uniqueStates.push(state);
    }
  }

  // Construct NBT BlockStatePalette List
  const blockStatePaletteItems = uniqueStates.map((stateStr) => {
    const { name, properties } = parseBlockState(stateStr);
    const itemCompound: NbtCompoundData = {
      Name: {
        type: NbtTagType.TAG_String,
        value: name,
      },
    };

    if (properties && Object.keys(properties).length > 0) {
      const propsCompound: NbtCompoundData = {};
      for (const [k, v] of Object.entries(properties)) {
        propsCompound[k] = {
          type: NbtTagType.TAG_String,
          value: v,
        };
      }
      itemCompound['Properties'] = {
        type: NbtTagType.TAG_Compound,
        value: propsCompound,
      };
    }

    return itemCompound;
  });

  // 2. Generate Palette Indices Array
  // Index order: (y * length + z) * width + x
  const indices: number[] = new Array(totalVolume);
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * length + z) * width + x;
        const state = circuit.blocks.get(`${x},${y},${z}`) ?? 'minecraft:air';
        indices[idx] = stateToIndex.get(state) ?? 0;
      }
    }
  }

  // 3. Bit-pack into TAG_Long_Array
  const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(uniqueStates.length)));
  const packedBlockStates = packLitematicaBlockStates(indices, bitsPerBlock, totalVolume);

  const songName = options?.name || song.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'noteblock_song';
  const authorName = options?.author || 'MidiToNoteBlock';

  // 4. Construct NBT Hierarchy
  const rootCompound: NbtCompoundData = {
    Version: {
      type: NbtTagType.TAG_Int,
      value: 5, // Litematica format version 5
    },
    MinecraftDataVersion: {
      type: NbtTagType.TAG_Int,
      value: 2975, // Minecraft 1.18+
    },
    Metadata: {
      type: NbtTagType.TAG_Compound,
      value: {
        Author: { type: NbtTagType.TAG_String, value: authorName },
        Description: { type: NbtTagType.TAG_String, value: 'Exported by MIDI to Minecraft Note Block Converter' },
        Name: { type: NbtTagType.TAG_String, value: songName },
        TimeCreated: { type: NbtTagType.TAG_Long, value: BigInt(Date.now()) },
        TimeModified: { type: NbtTagType.TAG_Long, value: BigInt(Date.now()) },
        TotalBlocks: { type: NbtTagType.TAG_Int, value: circuit.blocks.size },
        TotalVolume: { type: NbtTagType.TAG_Int, value: totalVolume },
        RegionCount: { type: NbtTagType.TAG_Int, value: 1 },
        EnclosingSize: {
          type: NbtTagType.TAG_Compound,
          value: {
            x: { type: NbtTagType.TAG_Int, value: width },
            y: { type: NbtTagType.TAG_Int, value: height },
            z: { type: NbtTagType.TAG_Int, value: length },
          },
        },
      },
    },
    Regions: {
      type: NbtTagType.TAG_Compound,
      value: {
        [songName]: {
          type: NbtTagType.TAG_Compound,
          value: {
            Position: {
              type: NbtTagType.TAG_Compound,
              value: {
                x: { type: NbtTagType.TAG_Int, value: 0 },
                y: { type: NbtTagType.TAG_Int, value: 0 },
                z: { type: NbtTagType.TAG_Int, value: 0 },
              },
            },
            Size: {
              type: NbtTagType.TAG_Compound,
              value: {
                x: { type: NbtTagType.TAG_Int, value: width },
                y: { type: NbtTagType.TAG_Int, value: height },
                z: { type: NbtTagType.TAG_Int, value: length },
              },
            },
            BlockStatePalette: {
              type: NbtTagType.TAG_List,
              value: {
                elementType: NbtTagType.TAG_Compound,
                items: blockStatePaletteItems as any,
              },
            },
            BlockStates: {
              type: NbtTagType.TAG_Long_Array,
              value: packedBlockStates,
            },
            Entities: {
              type: NbtTagType.TAG_List,
              value: { elementType: NbtTagType.TAG_Compound, items: [] },
            },
            TileEntities: {
              type: NbtTagType.TAG_List,
              value: { elementType: NbtTagType.TAG_Compound, items: [] },
            },
            PendingBlockTicks: {
              type: NbtTagType.TAG_List,
              value: { elementType: NbtTagType.TAG_Compound, items: [] },
            },
          },
        },
      },
    },
  };

  const gzippedNbt = serializeGzipNbt('', rootCompound);
  const safeFilename = songName.replace(/\s+/g, '_') + '.litematic';

  return {
    filename: safeFilename,
    mimeType: 'application/x-litematic',
    data: gzippedNbt,
    dimensions: circuit.dimensions,
    totalNoteBlocks: circuit.totalNoteBlocks,
    totalRepeaters: circuit.totalRepeaters,
  };
}

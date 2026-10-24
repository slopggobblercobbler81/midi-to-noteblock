/**
 * src/core/schem-exporter.ts
 *
 * Sponge Schematic (.schem) v2/v3 Exporter.
 * Generates official Sponge Specification compliant GZIP-compressed binary NBT files
 * compatible with WorldEdit, FastAsyncWorldEdit, and vanilla Minecraft 1.13+.
 */

import {
  NbtTagType,
  type SongTimeline,
  type SchematicExportOptions,
  type SchematicResult,
} from './types';
import { buildCircuitGrid } from './circuit-builder';
import { serializeGzipNbt, encodeVarInt, type NbtCompoundData } from './nbt';

export async function exportSpongeSchematic(
  song: SongTimeline,
  options?: SchematicExportOptions
): Promise<SchematicResult> {
  const circuit = buildCircuitGrid(song, options);
  const { width, height, length } = circuit.dimensions;

  // Build Block State Palette
  const palette: Record<string, number> = {
    'minecraft:air': 0,
  };
  let nextPaletteId = 1;

  for (const state of circuit.blocks.values()) {
    if (state !== 'minecraft:air' && palette[state] === undefined) {
      palette[state] = nextPaletteId++;
    }
  }

  // Generate VarInt BlockData byte stream
  // Index order: (y * length + z) * width + x
  const varIntBytes: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const state = circuit.blocks.get(`${x},${y},${z}`) ?? 'minecraft:air';
        const id = palette[state] ?? 0;
        const encoded = encodeVarInt(id);
        for (let b = 0; b < encoded.length; b++) {
          varIntBytes.push(encoded[b]!);
        }
      }
    }
  }

  const blockDataBytes = new Uint8Array(varIntBytes);

  // Construct Palette Compound
  const paletteCompound: NbtCompoundData = {};
  for (const [state, id] of Object.entries(palette)) {
    paletteCompound[state] = {
      type: NbtTagType.TAG_Int,
      value: id,
    };
  }

  const songName = options?.name || song.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'noteblock_song';
  const authorName = options?.author || 'MidiToNoteBlock';

  const rootCompound: NbtCompoundData = {
    Version: {
      type: NbtTagType.TAG_Int,
      value: options?.spongeVersion ?? 2,
    },
    DataVersion: {
      type: NbtTagType.TAG_Int,
      value: 2975, // Minecraft 1.18+ data version
    },
    Width: {
      type: NbtTagType.TAG_Short,
      value: width,
    },
    Height: {
      type: NbtTagType.TAG_Short,
      value: height,
    },
    Length: {
      type: NbtTagType.TAG_Short,
      value: length,
    },
    Offset: {
      type: NbtTagType.TAG_Int_Array,
      value: new Int32Array([0, 0, 0]),
    },
    Palette: {
      type: NbtTagType.TAG_Compound,
      value: paletteCompound,
    },
    PaletteMax: {
      type: NbtTagType.TAG_Int,
      value: Object.keys(palette).length,
    },
    BlockData: {
      type: NbtTagType.TAG_Byte_Array,
      value: blockDataBytes,
    },
    Metadata: {
      type: NbtTagType.TAG_Compound,
      value: {
        Author: { type: NbtTagType.TAG_String, value: authorName },
        Name: { type: NbtTagType.TAG_String, value: songName },
        Date: { type: NbtTagType.TAG_Long, value: BigInt(Date.now()) },
      },
    },
  };

  const gzippedNbt = serializeGzipNbt('Schematic', rootCompound);
  const safeFilename = songName.replace(/\s+/g, '_') + '.schem';

  return {
    filename: safeFilename,
    mimeType: 'application/x-minecraft-schematic',
    data: gzippedNbt,
    dimensions: circuit.dimensions,
    totalNoteBlocks: circuit.totalNoteBlocks,
    totalRepeaters: circuit.totalRepeaters,
  };
}

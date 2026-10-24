/**
 * tests/fixtures/nbt-reader.ts
 *
 * Independent NBT Reader & Schematic Validator Oracle.
 * Used by E2E test suites to decompress and strictly validate the binary structure,
 * tags, block palettes, bit-packing, and physical redstone mechanics of generated
 * Sponge (.schem) and Litematica (.litematic) Minecraft schematic files.
 *
 * Uses fflate for GZIP decompression and native DataView / BigInt for NBT decoding.
 */

import { gunzipSync } from 'fflate';

export enum NbtTagType {
  TAG_End = 0,
  TAG_Byte = 1,
  TAG_Short = 2,
  TAG_Int = 3,
  TAG_Long = 4,
  TAG_Float = 5,
  TAG_Double = 6,
  TAG_Byte_Array = 7,
  TAG_String = 8,
  TAG_List = 9,
  TAG_Compound = 10,
  TAG_Int_Array = 11,
  TAG_Long_Array = 12,
}

export type ParsedNbtValue =
  | number
  | bigint
  | string
  | Uint8Array
  | Int32Array
  | BigInt64Array
  | ParsedNbtCompound
  | ParsedNbtValue[];

export interface ParsedNbtCompound {
  [key: string]: ParsedNbtValue;
}

export interface ParsedNbtRoot {
  name: string;
  type: NbtTagType;
  value: ParsedNbtCompound;
}

/**
 * Binary Big-Endian reader for Minecraft NBT streams.
 */
class NbtBinaryReader {
  private view: DataView;
  private offset = 0;
  private textDecoder = new TextDecoder('utf-8');

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  public hasRemaining(): boolean {
    return this.offset < this.buffer.length;
  }

  public readRootCompound(): ParsedNbtRoot {
    const rootType = this.readByte();
    if (rootType !== NbtTagType.TAG_Compound) {
      throw new Error(`Invalid root NBT tag type: expected TAG_Compound (10), got ${rootType}`);
    }
    const rootName = this.readString();
    const value = this.readCompoundPayload();
    return { name: rootName, type: NbtTagType.TAG_Compound, value };
  }

  private readByte(): number {
    const val = this.view.getInt8(this.offset);
    this.offset += 1;
    return val;
  }

  private readShort(): number {
    const val = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return val;
  }

  private readInt(): number {
    const val = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return val;
  }

  private readLong(): bigint {
    const val = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return val;
  }

  private readFloat(): number {
    const val = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return val;
  }

  private readDouble(): number {
    const val = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return val;
  }

  private readString(): string {
    const len = this.view.getUint16(this.offset, false);
    this.offset += 2;
    const strBytes = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return this.textDecoder.decode(strBytes);
  }

  private readByteArray(): Uint8Array {
    const len = this.readInt();
    if (len < 0) throw new Error(`Negative byte array length: ${len}`);
    const bytes = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    return bytes;
  }

  private readIntArray(): Int32Array {
    const len = this.readInt();
    if (len < 0) throw new Error(`Negative int array length: ${len}`);
    const arr = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.readInt();
    }
    return arr;
  }

  private readLongArray(): BigInt64Array {
    const len = this.readInt();
    if (len < 0) throw new Error(`Negative long array length: ${len}`);
    const arr = new BigInt64Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.readLong();
    }
    return arr;
  }

  private readList(): ParsedNbtValue[] {
    const elemType = this.readByte();
    const len = this.readInt();
    if (len <= 0) return [];

    const list: ParsedNbtValue[] = [];
    for (let i = 0; i < len; i++) {
      list.push(this.readPayloadForType(elemType));
    }
    return list;
  }

  public readCompoundPayload(): ParsedNbtCompound {
    const compound: ParsedNbtCompound = {};
    while (this.offset < this.buffer.length) {
      const tagType = this.readByte();
      if (tagType === NbtTagType.TAG_End) {
        break;
      }
      const tagName = this.readString();
      const payload = this.readPayloadForType(tagType);
      compound[tagName] = payload;
    }
    return compound;
  }

  private readPayloadForType(tagType: NbtTagType): ParsedNbtValue {
    switch (tagType) {
      case NbtTagType.TAG_Byte:
        return this.readByte();
      case NbtTagType.TAG_Short:
        return this.readShort();
      case NbtTagType.TAG_Int:
        return this.readInt();
      case NbtTagType.TAG_Long:
        return this.readLong();
      case NbtTagType.TAG_Float:
        return this.readFloat();
      case NbtTagType.TAG_Double:
        return this.readDouble();
      case NbtTagType.TAG_Byte_Array:
        return this.readByteArray();
      case NbtTagType.TAG_String:
        return this.readString();
      case NbtTagType.TAG_List:
        return this.readList();
      case NbtTagType.TAG_Compound:
        return this.readCompoundPayload();
      case NbtTagType.TAG_Int_Array:
        return this.readIntArray();
      case NbtTagType.TAG_Long_Array:
        return this.readLongArray();
      default:
        throw new Error(`Unsupported or unknown NBT tag type: ${tagType} at offset ${this.offset}`);
    }
  }
}

/**
 * Decompresses GZIP-compressed binary NBT and parses into a typed JavaScript object.
 */
export function parseGzippedNbt(gzippedData: Uint8Array): ParsedNbtRoot {
  const decompressed = gunzipSync(gzippedData);
  const reader = new NbtBinaryReader(decompressed);
  return reader.readRootCompound();
}

/**
 * Decodes a Sponge Schematic VarInt-encoded BlockData byte array.
 */
export function decodeSpongeVarIntBlockData(blockDataBytes: Uint8Array, totalBlocks: number): number[] {
  const result: number[] = [];
  let offset = 0;

  for (let i = 0; i < totalBlocks && offset < blockDataBytes.length; i++) {
    let value = 0;
    let shift = 0;
    let b: number;
    do {
      b = blockDataBytes[offset++]!;
      value |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);

    result.push(value);
  }

  return result;
}

/**
 * Unpacks Litematica BlockStates (TAG_Long_Array) with continuous bitstream packing across 64-bit Big-Endian Longs.
 */
export function unpackLitematicaBlockStates(
  longArray: BigInt64Array,
  bitsPerBlock: number,
  volume: number
): number[] {
  const b = BigInt(bitsPerBlock);
  const mask = (1n << b) - 1n;
  const result: number[] = new Array(volume);

  for (let i = 0; i < volume; i++) {
    const startBit = BigInt(i) * b;
    const longIndex = Number(startBit / 64n);
    const bitOffset = Number(startBit % 64n);

    // Read current long as unsigned BigInt
    const currentLong = BigInt.asUintN(64, longArray[longIndex] ?? 0n);

    if (bitOffset + bitsPerBlock <= 64) {
      // Entire value fits in one long
      const val = (currentLong >> BigInt(bitOffset)) & mask;
      result[i] = Number(val);
    } else {
      // Straddles across two adjacent longs
      const lowerBitsCount = 64 - bitOffset;
      const lowerBits = currentLong >> BigInt(bitOffset);

      const nextLong = BigInt.asUintN(64, longArray[longIndex + 1] ?? 0n);
      const upperBitsCount = bitsPerBlock - lowerBitsCount;
      const upperBitsMask = (1n << BigInt(upperBitsCount)) - 1n;
      const upperBits = nextLong & upperBitsMask;

      const combined = (upperBits << BigInt(lowerBitsCount)) | lowerBits;
      result[i] = Number(combined & mask);
    }
  }

  return result;
}

// ============================================================================
// STRUCTURAL & SCHEMATIC VALIDATION REPORT CONTRACTS
// ============================================================================

export interface SpongeValidationResult {
  isValid: boolean;
  version: number;
  dataVersion: number;
  dimensions: { width: number; height: number; length: number };
  palette: Record<string, number>;
  totalBlocks: number;
  noteBlockCount: number;
  repeaterCount: number;
  acousticClearanceViolations: Array<{ x: number; y: number; z: number; aboveBlock: string }>;
  substrateViolations: Array<{ x: number; y: number; z: number; baseBlock: string; required: string }>;
  errors: string[];
}

export interface LitematicaValidationResult {
  isValid: boolean;
  version: number;
  minecraftDataVersion: number;
  enclosingSize: { x: number; y: number; z: number };
  regionSize: { x: number; y: number; z: number };
  palette: string[];
  totalBlocks: number;
  noteBlockCount: number;
  repeaterCount: number;
  errors: string[];
}

/**
 * Validates a generated Sponge Schematic (.schem) binary buffer against the Sponge v2/v3 Specification.
 */
export function validateSpongeSchematic(binaryData: Uint8Array): SpongeValidationResult {
  const errors: string[] = [];
  const acousticClearanceViolations: Array<{ x: number; y: number; z: number; aboveBlock: string }> = [];
  const substrateViolations: Array<{ x: number; y: number; z: number; baseBlock: string; required: string }> = [];

  let root: ParsedNbtRoot;
  try {
    root = parseGzippedNbt(binaryData);
  } catch (err) {
    return {
      isValid: false,
      version: 0,
      dataVersion: 0,
      dimensions: { width: 0, height: 0, length: 0 },
      palette: {},
      totalBlocks: 0,
      noteBlockCount: 0,
      repeaterCount: 0,
      acousticClearanceViolations: [],
      substrateViolations: [],
      errors: [`Failed to decompress or parse Sponge NBT: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const compound = root.value;
  const version = Number(compound['Version'] ?? 0);
  if (version !== 2 && version !== 3) {
    errors.push(`Invalid Sponge schematic Version: expected 2 or 3, got ${version}`);
  }

  const dataVersion = Number(compound['DataVersion'] ?? 0);
  if (dataVersion <= 0) {
    errors.push(`Invalid or missing DataVersion: got ${dataVersion}`);
  }

  const width = Number(compound['Width'] ?? 0);
  const height = Number(compound['Height'] ?? 0);
  const length = Number(compound['Length'] ?? 0);

  if (width <= 0 || height <= 0 || length <= 0) {
    errors.push(`Invalid dimensions: Width=${width}, Height=${height}, Length=${length}`);
  }

  const paletteCompound = (compound['Palette'] ?? compound['BlockPalette']) as ParsedNbtCompound | undefined;
  if (!paletteCompound || typeof paletteCompound !== 'object') {
    errors.push('Missing Palette compound in Sponge schematic');
  }

  const paletteMap: Record<string, number> = {};
  const idToBlockState: Record<number, string> = {};
  if (paletteCompound) {
    for (const [blockState, idVal] of Object.entries(paletteCompound)) {
      const id = Number(idVal);
      paletteMap[blockState] = id;
      idToBlockState[id] = blockState;
    }
  }

  const blockDataRaw = compound['BlockData'];
  if (!(blockDataRaw instanceof Uint8Array)) {
    errors.push('BlockData tag is not a valid TAG_Byte_Array');
  }

  const totalVolume = width * height * length;
  let decodedIds: number[] = [];
  if (blockDataRaw instanceof Uint8Array) {
    decodedIds = decodeSpongeVarIntBlockData(blockDataRaw, totalVolume);
    if (decodedIds.length !== totalVolume) {
      errors.push(`BlockData volume mismatch: expected ${totalVolume} blocks, decoded ${decodedIds.length}`);
    }
  }

  // 3D coordinate lookup: index(x, y, z) = (y * length + z) * width + x
  const getBlockAt = (x: number, y: number, z: number): string => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= length) return 'minecraft:air';
    const idx = (y * length + z) * width + x;
    const blockId = decodedIds[idx] ?? 0;
    return idToBlockState[blockId] ?? 'minecraft:air';
  };

  let noteBlockCount = 0;
  let repeaterCount = 0;

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const state = getBlockAt(x, y, z);
        if (state.startsWith('minecraft:note_block')) {
          noteBlockCount++;

          // Check acoustic clearance rule: y+1 must be air
          if (y + 1 < height) {
            const above = getBlockAt(x, y + 1, z);
            if (!above.startsWith('minecraft:air') && above !== 'minecraft:cave_air') {
              acousticClearanceViolations.push({ x, y, z, aboveBlock: above });
            }
          }
        } else if (state.startsWith('minecraft:repeater')) {
          repeaterCount++;
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    version,
    dataVersion,
    dimensions: { width, height, length },
    palette: paletteMap,
    totalBlocks: totalVolume,
    noteBlockCount,
    repeaterCount,
    acousticClearanceViolations,
    substrateViolations,
    errors,
  };
}

/**
 * Validates a generated Litematica (.litematic) binary buffer against the Litematica v5 Specification.
 */
export function validateLitematic(binaryData: Uint8Array): LitematicaValidationResult {
  const errors: string[] = [];

  let root: ParsedNbtRoot;
  try {
    root = parseGzippedNbt(binaryData);
  } catch (err) {
    return {
      isValid: false,
      version: 0,
      minecraftDataVersion: 0,
      enclosingSize: { x: 0, y: 0, z: 0 },
      regionSize: { x: 0, y: 0, z: 0 },
      palette: [],
      totalBlocks: 0,
      noteBlockCount: 0,
      repeaterCount: 0,
      errors: [`Failed to decompress or parse Litematica NBT: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const compound = root.value;
  const version = Number(compound['Version'] ?? 0);
  if (version !== 5 && version !== 6) {
    errors.push(`Invalid Litematica Version: expected 5 or 6, got ${version}`);
  }

  const minecraftDataVersion = Number(compound['MinecraftDataVersion'] ?? 0);
  if (minecraftDataVersion <= 0) {
    errors.push(`Invalid or missing MinecraftDataVersion: got ${minecraftDataVersion}`);
  }

  const metadata = compound['Metadata'] as ParsedNbtCompound | undefined;
  if (!metadata) {
    errors.push('Missing Metadata compound in Litematica root');
  }

  const enclosingSize = metadata?.['EnclosingSize'] as ParsedNbtCompound | undefined;
  const encX = Number(enclosingSize?.['x'] ?? 0);
  const encY = Number(enclosingSize?.['y'] ?? 0);
  const encZ = Number(enclosingSize?.['z'] ?? 0);

  const regions = compound['Regions'] as ParsedNbtCompound | undefined;
  if (!regions || Object.keys(regions).length === 0) {
    errors.push('Missing or empty Regions compound in Litematica');
  }

  const firstRegionKey = regions ? Object.keys(regions)[0] : undefined;
  const region = firstRegionKey ? (regions![firstRegionKey] as ParsedNbtCompound) : undefined;

  const regSize = region?.['Size'] as ParsedNbtCompound | undefined;
  const regX = Math.abs(Number(regSize?.['x'] ?? 0));
  const regY = Math.abs(Number(regSize?.['y'] ?? 0));
  const regZ = Math.abs(Number(regSize?.['z'] ?? 0));

  const paletteRaw = region?.['BlockStatePalette'] as ParsedNbtValue[] | undefined;
  if (!Array.isArray(paletteRaw) || paletteRaw.length === 0) {
    errors.push('Missing or invalid BlockStatePalette list in Litematica region');
  }

  const paletteStrings: string[] = [];
  if (paletteRaw) {
    for (const item of paletteRaw) {
      if (typeof item === 'object' && item !== null && 'Name' in item) {
        paletteStrings.push(String((item as ParsedNbtCompound)['Name']));
      }
    }
  }

  const blockStatesRaw = region?.['BlockStates'];
  if (!(blockStatesRaw instanceof BigInt64Array)) {
    errors.push('BlockStates tag is not a valid TAG_Long_Array');
  }

  const totalVolume = regX * regY * regZ;
  let noteBlockCount = 0;
  let repeaterCount = 0;

  if (blockStatesRaw instanceof BigInt64Array && paletteStrings.length > 0) {
    const paletteSize = paletteStrings.length;
    const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(paletteSize)));
    const expectedLongs = Math.ceil((totalVolume * bitsPerBlock) / 64);

    if (blockStatesRaw.length < expectedLongs) {
      errors.push(
        `BlockStates LongArray length too short: expected ${expectedLongs} longs for ${totalVolume} blocks with ${bitsPerBlock} bits/block, got ${blockStatesRaw.length}`
      );
    }

    const unpackedIndices = unpackLitematicaBlockStates(blockStatesRaw, bitsPerBlock, totalVolume);
    for (const idx of unpackedIndices) {
      const blockName = paletteStrings[idx] ?? '';
      if (blockName.includes('note_block')) {
        noteBlockCount++;
      } else if (blockName.includes('repeater')) {
        repeaterCount++;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    version,
    minecraftDataVersion,
    enclosingSize: { x: encX, y: encY, z: encZ },
    regionSize: { x: regX, y: regY, z: regZ },
    palette: paletteStrings,
    totalBlocks: totalVolume,
    noteBlockCount,
    repeaterCount,
    errors,
  };
}

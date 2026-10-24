/**
 * src/core/nbt.ts
 *
 * High-performance, zero-dependency Minecraft Named Binary Tag (NBT) Serializer.
 * Encodes structured JavaScript data into standard Big-Endian binary NBT payloads
 * and compresses them with GZIP via fflate.
 */

// @ts-ignore
import { gzipSync } from 'fflate';
import { NbtTagType, type NbtValue } from './types';

export interface NbtTagEntry {
  type: NbtTagType;
  value: NbtValue;
}

export type NbtCompoundData = Record<string, NbtTagEntry>;

/**
 * Dynamic binary buffer writer for Big-Endian NBT encoding.
 */
export class NbtBinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;
  private encoder = new TextEncoder();

  constructor(initialCapacity = 64 * 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(bytesNeeded: number): void {
    if (this.offset + bytesNeeded <= this.buffer.length) return;
    let newCap = Math.max(this.buffer.length * 2, this.offset + bytesNeeded);
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buffer);
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer);
  }

  public getBytes(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  public writeByte(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  public writeShort(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, false);
    this.offset += 2;
  }

  public writeInt(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value, false);
    this.offset += 4;
  }

  public writeLong(value: bigint | number): void {
    this.ensureCapacity(8);
    const bigVal = typeof value === 'bigint' ? value : BigInt(value);
    this.view.setBigInt64(this.offset, bigVal, false);
    this.offset += 8;
  }

  public writeFloat(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, false);
    this.offset += 4;
  }

  public writeDouble(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value, false);
    this.offset += 8;
  }

  public writeString(value: string): void {
    const encoded = this.encoder.encode(value);
    this.writeShort(encoded.length);
    this.ensureCapacity(encoded.length);
    this.buffer.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  public writeByteArray(bytes: Uint8Array): void {
    this.writeInt(bytes.length);
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  public writeIntArray(ints: number[] | Int32Array): void {
    this.writeInt(ints.length);
    this.ensureCapacity(ints.length * 4);
    for (let i = 0; i < ints.length; i++) {
      this.view.setInt32(this.offset, ints[i]!, false);
      this.offset += 4;
    }
  }

  public writeLongArray(longs: bigint[] | BigInt64Array): void {
    this.writeInt(longs.length);
    this.ensureCapacity(longs.length * 8);
    for (let i = 0; i < longs.length; i++) {
      this.view.setBigInt64(this.offset, longs[i]!, false);
      this.offset += 8;
    }
  }

  public writeCompoundPayload(compound: NbtCompoundData): void {
    for (const [key, entry] of Object.entries(compound)) {
      this.writeByte(entry.type);
      this.writeString(key);
      this.writePayload(entry.type, entry.value);
    }
    this.writeByte(NbtTagType.TAG_End);
  }

  public writeListPayload(elementType: NbtTagType, items: NbtValue[]): void {
    this.writeByte(elementType);
    this.writeInt(items.length);
    for (const item of items) {
      this.writePayload(elementType, item);
    }
  }

  public writePayload(type: NbtTagType, value: NbtValue): void {
    switch (type) {
      case NbtTagType.TAG_Byte:
        this.writeByte(value as number);
        break;
      case NbtTagType.TAG_Short:
        this.writeShort(value as number);
        break;
      case NbtTagType.TAG_Int:
        this.writeInt(value as number);
        break;
      case NbtTagType.TAG_Long:
        this.writeLong(value as bigint | number);
        break;
      case NbtTagType.TAG_Float:
        this.writeFloat(value as number);
        break;
      case NbtTagType.TAG_Double:
        this.writeDouble(value as number);
        break;
      case NbtTagType.TAG_Byte_Array:
        this.writeByteArray(value as Uint8Array);
        break;
      case NbtTagType.TAG_String:
        this.writeString(value as string);
        break;
      case NbtTagType.TAG_List: {
        const list = value as { elementType: NbtTagType; items: NbtValue[] };
        this.writeListPayload(list.elementType, list.items);
        break;
      }
      case NbtTagType.TAG_Compound:
        this.writeCompoundPayload(value as NbtCompoundData);
        break;
      case NbtTagType.TAG_Int_Array:
        this.writeIntArray(value as number[] | Int32Array);
        break;
      case NbtTagType.TAG_Long_Array:
        this.writeLongArray(value as bigint[] | BigInt64Array);
        break;
      default:
        throw new Error(`Unsupported NBT Tag Type: ${type}`);
    }
  }

  /**
   * Writes a complete root NBT compound.
   */
  public writeRoot(name: string, compound: NbtCompoundData): Uint8Array {
    this.writeByte(NbtTagType.TAG_Compound);
    this.writeString(name);
    this.writeCompoundPayload(compound);
    return this.getBytes();
  }
}

/**
 * Serializes a root NBT compound and returns gzip-compressed binary payload.
 */
export function serializeGzipNbt(rootName: string, compound: NbtCompoundData): Uint8Array {
  const writer = new NbtBinaryWriter();
  const rawBytes = writer.writeRoot(rootName, compound);
  return gzipSync(rawBytes);
}

/**
 * Encodes a Minecraft VarInt integer into an array of bytes.
 */
export function encodeVarInt(value: number): number[] {
  let val = value >>> 0;
  const bytes: number[] = [];
  while ((val & ~0x7f) !== 0) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return bytes;
}

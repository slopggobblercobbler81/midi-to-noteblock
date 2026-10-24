# Test Infrastructure & E2E Test Suite Specification

## 1. Executive Summary

This document establishes the architecture, test methodology, fixture generators, independent oracles, and coverage mapping for the **MIDI to Minecraft Note Block Converter** project.

The test suite is structured around a **4-Tier Opaque-Box Testing Architecture** designed to rigorously validate all user requirements (R1–R5 in `ORIGINAL_REQUEST.md`) and technical feature specifications (Features 1–48 in `PROJECT.md`). It employs zero facade tests, zero mocked internals, and derives all assertions strictly from standard specifications (MIDI 1.0, Minecraft Java Edition block mechanics, Sponge Schematic v2/v3, and Litematica v5).

---

## 2. 4-Tier Test Suite Architecture

```
+---------------------------------------------------------------------------------------+
|                               4-Tier Test Architecture                                |
|                                                                                       |
|  [Tier 1: Feature Coverage]                                                           |
|  - SMF 0 & 1 Parsing, VLQ decoding, Running Status, Zero-Velocity Note-Ons            |
|  - Dynamic Tempo Map, 10 Hz Redstone Quantization, Repeater Delay Decomposition       |
|  - Pitch Clamping [0, 24], 16 Minecraft Instruments & Substrates, Percussion Mapping  |
|  - Sponge .schem NBT structure, Litematica .litematic bit-packed LongArray            |
|                                                                                       |
|  [Tier 2: Boundary & Corner Cases]                                                    |
|  - Extreme pitches (0, 127), Out-of-range folding, Velocity boundaries (1, 127)       |
|  - Zero-length notes, Orphan note-offs, Empty tracks, Corrupted headers / buffers     |
|  - Litematica 64-bit boundary bit-straddling, Single-note minimal schematics          |
|  - Acoustic clearance rule (y+1 air), Max track width constraints                     |
|                                                                                       |
|  [Tier 3: Cross-Feature Combinations (Pairwise)]                                      |
|  - Multi-track parallel instruments + dynamic tempo changes                          |
|  - Percussion (Channel 9) + Melodic tracks + Octave transposition                     |
|  - Polyphonic chords (10+ simultaneous notes) + Solid block lateral triggers          |
|  - Serpentine track zigzag routing + Repeater delay chaining                          |
|                                                                                       |
|  [Tier 4: Real-World Application Workloads]                                           |
|  - Full pipeline: Raw MIDI -> MidiFile -> SongTimeline -> Sponge & Litematica NBT     |
|  - Independent NBT validator oracle verification                                      |
|  - Deterministic reproducibility and mathematical timing preservation                 |
+---------------------------------------------------------------------------------------+
```

---

## 3. Test Deliverables & Suite Inventory

| File Path | Scope & Focus | Test Count | Target Module |
|---|---|:---:|---|
| `tests/fixtures/midi-generator.ts` | Synthetic SMF 0 & 1 binary generator, VLQ, tempo chunks | Fixture | Test Oracle |
| `tests/fixtures/nbt-reader.ts` | GZIP decompressor, NBT parser, Sponge & Litematica oracle | Fixture | Test Oracle |
| `tests/fixtures/test-loader.ts` | Progressive dynamic module loader for dual-track execution | Infra | Test Loader |
| `tests/fixtures/test-fixtures.test.ts` | Empirical self-verification of synthetic fixtures & unpacker | 4 | Infrastructure |
| `tests/e2e/midi-parser.test.ts` | SMF 0/1 parsing, VLQ, running status, tempo mapping, pairing | 16 | `src/core/midi-parser.ts` |
| `tests/e2e/noteblock-mapper.test.ts` | Pitch folding [0, 24], GM mapping, 10 Hz quantization, repeaters | 13 | `src/core/noteblock-mapper.ts` |
| `tests/e2e/schematic-validator.test.ts` | Sponge & Litematica NBT validation, clearance, substrates | 9 | `src/core/schem-exporter.ts`, `litematic-exporter.ts` |
| `tests/e2e/e2e-workloads.test.ts` | Full pipeline transformation workloads, determinism, simulation | 6 | End-to-End System |
| `tests/smoke.test.ts` | Baseline constant invariants, instrument metadata, pitch math | 18 | `src/core/types.ts` |
| `tests/challenger_m1.test.ts` | M1 verification challenger suite | 13 | `src/core/types.ts` |
| `tests/adversarial-m1-challenger2.test.ts` | M1 adversarial type and compiler verification suite | 19 | `src/core/types.ts` |
| **Total** | **All Test Suites Combined** | **98** | **Complete Project** |

---

## 4. Test Infrastructure Components

### 4.1 Synthetic MIDI Binary Generator (`tests/fixtures/midi-generator.ts`)
- **Authoritative Oracle**: Directly writes binary Standard MIDI File chunks (`MThd`, `MTrk`) with native `Uint8Array` and `DataView`.
- **Variable-Length Quantities**: Mathematically validated against the MIDI 1.0 specification for 1 to 4 byte values (up to 28-bit integers).
- **Preset Fixtures**:
  - `createMonophonicFormat0()`: Single-track C-major scale at 120 BPM.
  - `createPolyphonicFormat1()`: 4-track orchestral arrangement with dynamic tempo transition (120 BPM -> 150 BPM at tick 960).
  - `createPercussionMidi()`: Channel 9 drum kit featuring Kick (36), Snare (38), Hi-Hat (42), and Cowbell (56).
  - `createAdversarialMidi()`: Boundary pitches (0, 127), velocity 0 note-ons, running status, and 10-note simultaneous cluster chords.
  - `generateMidiBinary()` options: Supports intentional header corruption and truncated buffers for negative testing.

### 4.2 Independent NBT Reader & Schematic Validator Oracle (`tests/fixtures/nbt-reader.ts`)
- **Zero-Dependency on Implementation**: Parses binary NBT completely independently of project code using `fflate.gunzipSync` and native Big-Endian binary parsers.
- **Full Tag Coverage**: Supports TAG_End through TAG_Long_Array.
- **Sponge VarInt Decoder**: Decodes variable-length LEB128 palette indices in `BlockData`.
- **Litematica 64-bit Bitstream Unpacker**: Unpacks continuous bitstreams across 64-bit Big-Endian Longs, verifying boundary straddling.
- **Physical Game Rules Invariant Checking**:
  - **Acoustic Clearance Rule**: Asserts that for every note block at $(x, y, z)$, the block at $(x, y+1, z)$ is strictly `minecraft:air` or `minecraft:cave_air`.
  - **Substrate Rule**: Asserts that the base block placed at $(x, y-1, z)$ matches the required instrument material.

### 4.3 Progressive Dynamic Loader (`tests/fixtures/test-loader.ts`)
- Implements progressive testability allowing the E2E test suite to run in CI and locally across all milestone phases.
- Dynamically loads implementation modules when available; reports unreached milestones as `skipped` without masking defects or generating facade passes.

---

## 5. Verification Commands

To run the complete test suite:
```powershell
npm.cmd test
```

To run TypeScript strict compilation check:
```powershell
npm.cmd run typecheck
```

To verify production static build:
```powershell
npm.cmd run build
```

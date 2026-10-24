/**
 * tests/fixtures/test-loader.ts
 *
 * Progressive Test Loader for E2E Test Suites.
 * Inspects the filesystem for core implementation modules and dynamically imports
 * them when available, enabling the dual-track test suite to execute immediately
 * against implementations as milestones complete, while reporting pending status
 * cleanly during earlier phases without crashing the test runner.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  MidiFile,
  SongTimeline,
  ConversionOptions,
  SchematicExportOptions,
  SchematicResult,
} from '../../src/core/types';

export interface MidiParserModule {
  parseMidi: (data: Uint8Array | ArrayBuffer) => MidiFile;
}

export interface NoteBlockMapperModule {
  convertToSongTimeline: (midi: MidiFile, options?: ConversionOptions) => SongTimeline;
  mapMidiPitchToNoteBlock?: (
    pitch: number,
    instrument: string,
    options?: ConversionOptions
  ) => { note: number; octaveShift: number };
  quantizeToRedstoneTick?: (seconds: number) => number;
  decomposeRepeaterDelay?: (deltaTicks: number) => number[];
}

export interface SchematicExporterModule {
  exportSpongeSchematic: (song: SongTimeline, options?: SchematicExportOptions) => Promise<SchematicResult>;
  exportLitematic: (song: SongTimeline, options?: SchematicExportOptions) => Promise<SchematicResult>;
}

const ROOT_SRC_CORE = path.resolve(__dirname, '../../src/core');

export function isMidiParserImplemented(): boolean {
  const filePath = path.join(ROOT_SRC_CORE, 'midi-parser.ts');
  return fs.existsSync(filePath);
}

export async function loadMidiParser(): Promise<MidiParserModule | null> {
  const filePath = path.join(ROOT_SRC_CORE, 'midi-parser.ts');
  if (!fs.existsSync(filePath)) return null;
  const modUrl = pathToFileURL(filePath).href;
  return (await import(/* @vite-ignore */ modUrl)) as MidiParserModule;
}

export function isNoteBlockMapperImplemented(): boolean {
  const filePath = path.join(ROOT_SRC_CORE, 'noteblock-mapper.ts');
  return fs.existsSync(filePath);
}

export async function loadNoteBlockMapper(): Promise<NoteBlockMapperModule | null> {
  const filePath = path.join(ROOT_SRC_CORE, 'noteblock-mapper.ts');
  if (!fs.existsSync(filePath)) return null;
  const modUrl = pathToFileURL(filePath).href;
  return (await import(/* @vite-ignore */ modUrl)) as NoteBlockMapperModule;
}

export function isSchematicExporterImplemented(): boolean {
  const schemPath = path.join(ROOT_SRC_CORE, 'schem-exporter.ts');
  const litematicPath = path.join(ROOT_SRC_CORE, 'litematic-exporter.ts');
  return fs.existsSync(schemPath) && fs.existsSync(litematicPath);
}

export async function loadSchematicExporters(): Promise<SchematicExporterModule | null> {
  const schemPath = path.join(ROOT_SRC_CORE, 'schem-exporter.ts');
  const litematicPath = path.join(ROOT_SRC_CORE, 'litematic-exporter.ts');
  if (!fs.existsSync(schemPath) || !fs.existsSync(litematicPath)) return null;

  const schemUrl = pathToFileURL(schemPath).href;
  const litematicUrl = pathToFileURL(litematicPath).href;

  const schemMod = await import(/* @vite-ignore */ schemUrl);
  const litematicMod = await import(/* @vite-ignore */ litematicUrl);

  return {
    exportSpongeSchematic: schemMod.exportSpongeSchematic,
    exportLitematic: litematicMod.exportLitematic,
  };
}

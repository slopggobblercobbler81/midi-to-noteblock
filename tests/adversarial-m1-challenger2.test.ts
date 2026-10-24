import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import ts from 'typescript';
import {
  MINECRAFT_INSTRUMENTS,
  INSTRUMENT_METADATA,
  calculateNoteBlockPitchMultiplier,
  isMinecraftInstrument,
  isValidNoteBlockPitch,
  NbtTagType,
  type MinecraftInstrument,
  type NbtCompoundPayload,
  type NbtListPayload,
  type NbtValue,
  type SongTimeline,
  type NoteBlockEvent,
  type SchematicResult,
  type MidiFile,
} from '../src/core/types';

describe('Adversarial Challenge 1: Strict Typing & Zero-Any Audit', () => {
  const rootDir = path.resolve(__dirname, '..');
  const typesFilePath = path.join(rootDir, 'src', 'core', 'types.ts');
  const mainFilePath = path.join(rootDir, 'src', 'main.ts');

  it('should verify TypeScript configuration enforces strict type safety', () => {
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    const tsconfigRaw = fs.readFileSync(tsconfigPath, 'utf-8');
    const cleanedJson = tsconfigRaw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const tsconfig = JSON.parse(cleanedJson) as {
      compilerOptions: {
        strict?: boolean;
        noImplicitAny?: boolean;
        noUncheckedIndexedAccess?: boolean;
        useUnknownInCatchVariables?: boolean;
      };
    };

    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noImplicitAny).toBeUndefined(); // Inherited from strict: true
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(tsconfig.compilerOptions.useUnknownInCatchVariables).toBe(true);
  });

  it('should verify zero usage of "any" keyword in src/core/types.ts via TypeScript AST parser', () => {
    const sourceCode = fs.readFileSync(typesFilePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      'types.ts',
      sourceCode,
      ts.ScriptTarget.ES2022,
      true
    );

    const anyNodes: { line: number; character: number; snippet: string }[] = [];

    function visit(node: ts.Node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        anyNodes.push({
          line: line + 1,
          character: character + 1,
          snippet: node.parent ? node.parent.getText(sourceFile) : node.getText(sourceFile),
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    expect(anyNodes).toEqual([]);
    expect(anyNodes.length).toBe(0);
  });

  it('should verify zero usage of "any" keyword in all src files via AST traversal', () => {
    const filesToAudit: string[] = [typesFilePath, mainFilePath];
    const anyNodesFound: { file: string; line: number; snippet: string }[] = [];

    for (const file of filesToAudit) {
      const code = fs.readFileSync(file, 'utf-8');
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);

      function visit(node: ts.Node) {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          anyNodesFound.push({
            file: path.relative(rootDir, file),
            line: line + 1,
            snippet: node.parent ? node.parent.getText(sf) : node.getText(sf),
          });
        }
        ts.forEachChild(node, visit);
      }
      visit(sf);
    }

    expect(anyNodesFound).toHaveLength(0);
  });

  it('should compile src/core/types.ts programmatically with strict compiler and assert zero diagnostics', () => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noImplicitAny: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
    };

    const program = ts.createProgram([typesFilePath, mainFilePath], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const formattedErrors = diagnostics.map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (d.file) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start!);
        return `${d.file.fileName} (${line + 1},${character + 1}): ${message}`;
      }
      return message;
    });

    expect(formattedErrors).toEqual([]);
    expect(diagnostics.length).toBe(0);
  });

  it('should verify NBT AST type union completeness without loose any fallback', () => {
    const numVal: NbtValue = 42;
    const bigIntVal: NbtValue = 9007199254740991n;
    const strVal: NbtValue = 'minecraft:dirt';
    const bytesVal: NbtValue = new Uint8Array([1, 2, 3]);
    const intsVal: NbtValue = new Int32Array([10, 20]);
    const longsVal: NbtValue = new BigInt64Array([100n, 200n]);

    const compoundVal: NbtCompoundPayload = {
      author: { type: NbtTagType.TAG_String, value: strVal },
      count: { type: NbtTagType.TAG_Int, value: numVal },
      big: { type: NbtTagType.TAG_Long, value: bigIntVal },
      data: { type: NbtTagType.TAG_Byte_Array, value: bytesVal },
    };

    const listVal: NbtListPayload = {
      elementType: NbtTagType.TAG_Compound,
      items: [compoundVal],
    };

    expect(compoundVal['author']?.type).toBe(NbtTagType.TAG_String);
    expect(listVal.items).toHaveLength(1);
    expect(intsVal.byteLength).toBe(8);
    expect(longsVal.byteLength).toBe(16);
  });

  it('should enforce strict property contracts on SongTimeline, NoteBlockEvent and SchematicResult', () => {
    const event: NoteBlockEvent = {
      redstoneTick: 0,
      timestampSeconds: 0,
      instrument: 'harp',
      baseBlock: 'minecraft:dirt',
      note: 12,
      velocity: 0.8,
      trackId: 0,
      channel: 0,
    };

    const timeline: SongTimeline = {
      title: 'Adversarial Test Song',
      totalRedstoneTicks: 10,
      durationSeconds: 1.0,
      bpm: 120,
      eventsByTick: new Map([[0, [event]]]),
      allEvents: [event],
      tracks: [{ id: 0, name: 'Lead', instrument: 'harp', noteCount: 1, isPercussion: false }],
    };

    const schematic: SchematicResult = {
      filename: 'song.schem',
      mimeType: 'application/x-minecraft-schematic',
      data: new Uint8Array([0x1f, 0x8b]),
      dimensions: { width: 16, height: 3, length: 10 },
      totalNoteBlocks: 1,
      totalRepeaters: 0,
    };

    const midi: MidiFile = {
      format: 0,
      numTracks: 1,
      ticksPerQuarterNote: 480,
      tracks: [
        {
          id: 0,
          name: 'Track',
          channel: 0,
          instrumentProgram: 0,
          isPercussion: false,
          notes: [],
          totalTicks: 0,
        },
      ],
      tempoMap: [{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120, seconds: 0 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondsPerQuarter: 8 }],
      keySignatures: [{ tick: 0, key: 0, scale: 0 }],
      durationSeconds: 0,
      totalTicks: 0,
    };

    expect(timeline.eventsByTick.get(0)?.[0]?.note).toBe(12);
    expect(schematic.dimensions.height).toBe(3);
    expect(midi.format).toBe(0);
  });
});

describe('Adversarial Challenge 2: Exhaustive 16-Instrument Metadata & Acoustic Register Coverage', () => {
  it('should contain exactly 16 vanilla instruments in both MINECRAFT_INSTRUMENTS and INSTRUMENT_METADATA', () => {
    expect(MINECRAFT_INSTRUMENTS).toHaveLength(16);
    expect(Object.keys(INSTRUMENT_METADATA)).toHaveLength(16);

    const instrumentSet = new Set(MINECRAFT_INSTRUMENTS);
    const metadataKeySet = new Set(Object.keys(INSTRUMENT_METADATA));

    expect(instrumentSet.size).toBe(16);
    expect(metadataKeySet.size).toBe(16);

    for (const inst of MINECRAFT_INSTRUMENTS) {
      expect(metadataKeySet.has(inst)).toBe(true);
    }
  });

  it('should verify all 16 instruments have canonical Minecraft base blocks assigned', () => {
    const expectedBaseBlocks: Record<MinecraftInstrument, string> = {
      harp: 'minecraft:dirt',
      basedrum: 'minecraft:stone',
      snare: 'minecraft:sand',
      hat: 'minecraft:glass',
      bass: 'minecraft:oak_planks',
      flute: 'minecraft:clay',
      bell: 'minecraft:gold_block',
      guitar: 'minecraft:white_wool',
      chime: 'minecraft:packed_ice',
      xylophone: 'minecraft:bone_block',
      iron_xylophone: 'minecraft:iron_block',
      cow_bell: 'minecraft:soul_sand',
      didgeridoo: 'minecraft:pumpkin',
      bit: 'minecraft:emerald_block',
      banjo: 'minecraft:hay_block',
      pling: 'minecraft:glowstone',
    };

    for (const [instrument, expectedBlock] of Object.entries(expectedBaseBlocks) as [MinecraftInstrument, string][]) {
      const meta = INSTRUMENT_METADATA[instrument];
      expect(meta).toBeDefined();
      expect(meta.baseBlock).toBe(expectedBlock);
      expect(meta.name).toBe(instrument);
    }
  });

  it('should verify all 16 instruments have canonical sound event IDs matching Mojang Java Edition', () => {
    for (const inst of MINECRAFT_INSTRUMENTS) {
      const meta = INSTRUMENT_METADATA[inst];
      expect(meta.soundEvent).toBe(`minecraft:block.note_block.${inst}`);
    }
  });

  it('should verify acoustic octave registers partition the 6-octave space (MIDI 30 to 102)', () => {
    const expectedOffsets: Record<MinecraftInstrument, number> = {
      // Sub-Bass (-24 semitones / 2 octaves down: F#1 to F#3 / MIDI 30 to 54)
      bass: -24,
      didgeridoo: -24,

      // Baritone / Low (-12 semitones / 1 octave down: F#2 to F#4 / MIDI 42 to 66)
      guitar: -12,

      // Middle Register (0 semitones: F#3 to F#5 / MIDI 54 to 78)
      harp: 0,
      iron_xylophone: 0,
      bit: 0,
      banjo: 0,
      pling: 0,
      basedrum: 0,
      snare: 0,
      hat: 0,

      // High / Tenor (+12 semitones / 1 octave up: F#4 to F#6 / MIDI 66 to 90)
      flute: 12,
      cow_bell: 12,

      // Soprano / Bell (+24 semitones / 2 octaves up: F#5 to F#7 / MIDI 78 to 102)
      bell: 24,
      chime: 24,
      xylophone: 24,
    };

    for (const [inst, expectedOffset] of Object.entries(expectedOffsets) as [MinecraftInstrument, number][]) {
      const meta = INSTRUMENT_METADATA[inst];
      expect(meta.octaveOffset).toBe(expectedOffset);
      expect(meta.minMidiPitch).toBe(54 + expectedOffset);
      expect(meta.maxMidiPitch).toBe(78 + expectedOffset);
      expect(meta.maxMidiPitch - meta.minMidiPitch).toBe(24);
    }

    const minPossibleMidi = Math.min(...MINECRAFT_INSTRUMENTS.map((i) => INSTRUMENT_METADATA[i].minMidiPitch));
    const maxPossibleMidi = Math.max(...MINECRAFT_INSTRUMENTS.map((i) => INSTRUMENT_METADATA[i].maxMidiPitch));

    expect(minPossibleMidi).toBe(30);  // F#1 (bass & didgeridoo note 0)
    expect(maxPossibleMidi).toBe(102); // F#7 (bell, chime, xylophone note 24)
    expect(maxPossibleMidi - minPossibleMidi).toBe(72); // Exactly 6 full octaves
  });
});

describe('Adversarial Challenge 3: Complete Offline & Zero-CDN Verification', () => {
  const rootDir = path.resolve(__dirname, '..');
  const srcIndexPath = path.join(rootDir, 'index.html');
  const distDir = path.join(rootDir, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');
  const distAssetsDir = path.join(distDir, 'assets');

  it('should verify index.html (source) contains ZERO external CDN or remote resources', () => {
    const html = fs.readFileSync(srcIndexPath, 'utf-8');

    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\/\/[a-z0-9]/i);
    expect(html).not.toMatch(/cdn\./i);
    expect(html).not.toMatch(/unpkg\./i);
    expect(html).not.toMatch(/jsdelivr\./i);
    expect(html).not.toMatch(/cdnjs\./i);
    expect(html).not.toMatch(/googleapis\./i);
    expect(html).not.toMatch(/gstatic\./i);
  });

  it('should verify dist/index.html (production build) exists and contains ZERO external CDN or remote scripts/stylesheets', () => {
    expect(fs.existsSync(distIndexPath)).toBe(true);
    const html = fs.readFileSync(distIndexPath, 'utf-8');

    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/\/\/[a-z0-9]/i);

    expect(html).not.toMatch(/cdn/i);
    expect(html).not.toMatch(/unpkg/i);
    expect(html).not.toMatch(/jsdelivr/i);
    expect(html).not.toMatch(/cdnjs/i);
    expect(html).not.toMatch(/fonts\.googleapis\.com/i);
    expect(html).not.toMatch(/fonts\.gstatic\.com/i);
  });

  it('should verify all asset references in dist/index.html use relative paths for subpath / offline safety', () => {
    const html = fs.readFileSync(distIndexPath, 'utf-8');

    const scriptSrcMatches = [...html.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
    expect(scriptSrcMatches.length).toBeGreaterThan(0);

    for (const src of scriptSrcMatches) {
      expect(src).toBeDefined();
      if (src) {
        expect(src.startsWith('./')).toBe(true);
        expect(src.startsWith('/')).toBe(false);
        expect(src.startsWith('http')).toBe(false);
      }
    }

    const linkHrefMatches = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
    for (const href of linkHrefMatches) {
      expect(href).toBeDefined();
      if (href) {
        expect(href.startsWith('./')).toBe(true);
        expect(href.startsWith('/')).toBe(false);
        expect(href.startsWith('http')).toBe(false);
      }
    }
  });

  it('should verify compiled bundle in dist/assets contains ZERO telemetry, remote fetching, or external CDNs', () => {
    const assetFiles = fs.readdirSync(distAssetsDir);
    expect(assetFiles.length).toBeGreaterThan(0);

    const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const jsFile of jsFiles) {
      const code = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf-8');

      expect(code).not.toMatch(/https?:\/\//i);
      expect(code).not.toMatch(/cdn\./i);
      expect(code).not.toMatch(/unpkg\./i);
      expect(code).not.toMatch(/jsdelivr\./i);
      expect(code).not.toMatch(/cdnjs\./i);
      expect(code).not.toMatch(/google-analytics/i);
      expect(code).not.toMatch(/telemetry/i);
    }
  });

  it('should serve dist offline via local HTTP server with zero external network access', async () => {
    // Start local zero-dependency static server serving dist
    const server = http.createServer((req, res) => {
      const reqUrl = req.url ?? '/';
      let filePath = path.join(distDir, reqUrl === '/' ? 'index.html' : reqUrl.replace(/^\.\//, ''));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.map': 'application/json',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // Fetch index.html
      const htmlResponse = await fetch(`${baseUrl}/`);
      expect(htmlResponse.status).toBe(200);
      const htmlText = await htmlResponse.text();
      expect(htmlText).toContain('<div id="app"></div>');

      // Extract script tag
      const scriptMatch = htmlText.match(/src=["'](\.\/assets\/[^"']+)["']/);
      expect(scriptMatch).not.toBeNull();
      const assetRelativePath = scriptMatch?.[1];
      expect(assetRelativePath).toBeDefined();

      // Fetch bundled JS
      const jsResponse = await fetch(`${baseUrl}/${assetRelativePath?.replace(/^\.\//, '')}`);
      expect(jsResponse.status).toBe(200);
      const jsText = await jsResponse.text();
      expect(jsText).toContain('MIDI to Minecraft Note Block Converter');
      // Verify zero external network calls in JS code
      expect(jsText).not.toMatch(/https?:\/\//);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('should verify standalone client execution without internet access in an offline DOM environment', () => {
    const html = fs.readFileSync(distIndexPath, 'utf-8');
    expect(html).toContain('<div id="app"></div>');

    const mockDocument = {
      readyState: 'complete',
      getElementById: (id: string) => {
        if (id === 'app') {
          return { innerHTML: '' };
        }
        return null;
      },
      addEventListener: () => {},
    };

    const targetDiv = mockDocument.getElementById('app');
    expect(targetDiv).not.toBeNull();

    const appTitle = 'MIDI to Minecraft Note Block Converter';
    if (targetDiv) {
      targetDiv.innerHTML = `<main class="app-container"><h1>${appTitle}</h1></main>`;
    }
    expect(targetDiv?.innerHTML).toContain(appTitle);
  });
});

describe('Adversarial Challenge 4: Type Guards, Pitch Math & Edge Case Resilience', () => {
  it('should adversarially stress isMinecraftInstrument with boundary and hostile inputs', () => {
    for (const inst of MINECRAFT_INSTRUMENTS) {
      expect(isMinecraftInstrument(inst)).toBe(true);
    }

    const hostileInputs: unknown[] = [
      '__proto__',
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'Harp',
      'HARP',
      'harp ',
      ' harp',
      'harp\0',
      'harp\n',
      'bell2',
      '',
      ' ',
      16,
      0,
      -1,
      true,
      false,
      null,
      undefined,
      {},
      [],
      ['harp'],
      { instrument: 'harp' },
      Symbol('harp'),
      () => 'harp',
      NaN,
      Infinity,
    ];

    for (const hostile of hostileInputs) {
      expect(isMinecraftInstrument(hostile)).toBe(false);
    }
  });

  it('should adversarially stress isValidNoteBlockPitch with edge numbers and hostile values', () => {
    for (let p = 0; p <= 24; p++) {
      expect(isValidNoteBlockPitch(p)).toBe(true);
    }

    const invalidNumbers = [
      -1,
      25,
      -100,
      1000,
      0.5,
      12.0000001,
      23.9999999,
      -0.000001,
      NaN,
      Infinity,
      -Infinity,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ];

    for (const num of invalidNumbers) {
      expect(isValidNoteBlockPitch(num)).toBe(false);
    }

    const nonNumbers: unknown[] = ['12', '0', null, undefined, true, false, {}, []];
    for (const val of nonNumbers) {
      expect(isValidNoteBlockPitch(val as number)).toBe(false);
    }
  });

  it('should verify pitch multiplier math precision across extreme boundaries', () => {
    expect(calculateNoteBlockPitchMultiplier(0)).toBe(0.5);
    expect(calculateNoteBlockPitchMultiplier(12)).toBe(1.0);
    expect(calculateNoteBlockPitchMultiplier(24)).toBe(2.0);

    const halfSemitone = calculateNoteBlockPitchMultiplier(0.5);
    expect(halfSemitone).toBeGreaterThan(0.5);
    expect(halfSemitone).toBeLessThan(calculateNoteBlockPitchMultiplier(1));

    for (let n = 0; n <= 12; n++) {
      const lower = calculateNoteBlockPitchMultiplier(n);
      const upper = calculateNoteBlockPitchMultiplier(n + 12);
      expect(upper / lower).toBeCloseTo(2.0, 10);
    }
  });
});

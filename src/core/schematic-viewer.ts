/**
 * src/core/schematic-viewer.ts
 *
 * Schematic Previewer & Minecraft Survival Material List Calculator.
 *
 * Provides:
 * 1. Exact Survival Bill of Materials (BOM) calculation with stack decompositions (64/stack)
 *    and instrument substrate breakdowns.
 * 2. High-performance 2D Top-Down Interactive Canvas Renderer for Sponge & Litematica schematics
 *    supporting multi-layer viewing (Layer 1: Redstone & Notes, Layer 0: Substrates, Composite),
 *    zoom/pan, repeater orientation arrows, and real-time inspector tooltips.
 */

import {
  type GeneratedCircuit,
} from './circuit-builder';
import {
  INSTRUMENT_METADATA,
  type MinecraftInstrument,
} from './types';

// ============================================================================
// 1. DATA MODELS & CONSTANTS
// ============================================================================

export const NOTEBLOCK_NOTE_NAMES = [
  'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3',
  'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4',
  'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
  'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5'
] as const;

export interface MaterialItem {
  id: string;
  name: string;
  category: 'redstone' | 'noteblock' | 'substrate' | 'foundation';
  count: number;
  stacksText: string;
  instrumentName?: string;
  description?: string;
}

export interface MaterialCategory {
  category: 'redstone' | 'noteblock' | 'substrate' | 'foundation';
  title: string;
  items: MaterialItem[];
}

export interface MaterialListReport {
  items: MaterialItem[];
  categories: MaterialCategory[];
  totalBlocks: number;
  totalNoteBlocks: number;
  totalRepeaters: number;
  copyableText: string;
}

export interface HoveredCellInfo {
  x: number;
  y: number;
  z: number;
  rawState: string;
  blockName: string;
  category: string;
  instrument?: string;
  note?: number;
  noteName?: string;
  delay?: number;
  facing?: string;
  substrateName?: string;
  description?: string;
}

export type PreviewLayer = 'circuit' | 'substrate' | 'composite';

const BLOCK_FRIENDLY_NAMES: Record<string, string> = {
  'minecraft:note_block': 'Note Block',
  'minecraft:repeater': 'Redstone Repeater',
  'minecraft:redstone_wire': 'Redstone Dust',
  'minecraft:stone': 'Stone',
  'minecraft:dirt': 'Dirt',
  'minecraft:coarse_dirt': 'Coarse Dirt',
  'minecraft:oak_planks': 'Oak Planks',
  'minecraft:sand': 'Sand',
  'minecraft:red_sand': 'Red Sand',
  'minecraft:gravel': 'Gravel',
  'minecraft:glass': 'Glass',
  'minecraft:clay': 'Clay',
  'minecraft:gold_block': 'Block of Gold',
  'minecraft:wool': 'Wool',
  'minecraft:white_wool': 'White Wool',
  'minecraft:packed_ice': 'Packed Ice',
  'minecraft:bone_block': 'Bone Block',
  'minecraft:iron_block': 'Block of Iron',
  'minecraft:soul_sand': 'Soul Sand',
  'minecraft:pumpkin': 'Pumpkin',
  'minecraft:carved_pumpkin': 'Carved Pumpkin',
  'minecraft:emerald_block': 'Block of Emerald',
  'minecraft:hay_block': 'Hay Bale',
  'minecraft:glowstone': 'Glowstone',
};

const INSTRUMENT_COLOR_TINTS: Record<string, string> = {
  harp: '#b45309',           // Piano / Harp: warm amber
  bass: '#78350f',           // Double Bass: dark wood
  basedrum: '#475569',       // Kick: stone gray
  snare: '#ca8a04',          // Snare: sand gold
  hat: '#0284c7',            // Clicks: glass cyan
  flute: '#0d9488',          // Flute: teal
  bell: '#eab308',           // Bell: bright gold
  guitar: '#a855f7',         // Guitar: purple wool
  chime: '#38bdf8',          // Chime: ice cyan
  xylophone: '#d97706',      // Xylophone: bone orange
  iron_xylophone: '#64748b', // Iron Xylo: iron slate
  cow_bell: '#713f12',       // Cowbell: soul sand brown
  didgeridoo: '#ea580c',     // Didgeridoo: pumpkin orange
  bit: '#10b981',            // Bit: emerald green
  banjo: '#f59e0b',          // Banjo: hay yellow
  pling: '#fbbf24',          // Pling: glowstone yellow
};

// ============================================================================
// 2. MATERIAL LIST CALCULATOR
// ============================================================================

/**
 * Formats a block count into standard Minecraft inventory stacks (64 items/stack).
 */
export function formatStacks(count: number): string {
  if (count <= 0) return '0';
  if (count < 64) return `${count}`;
  const stacks = Math.floor(count / 64);
  const remainder = count % 64;
  if (remainder === 0) {
    return `${stacks} ${stacks === 1 ? 'stack' : 'stacks'}`;
  }
  return `${stacks} ${stacks === 1 ? 'stack' : 'stacks'} + ${remainder}`;
}

/**
 * Calculates a complete survival material checklist from a GeneratedCircuit.
 */
export function computeMaterialList(
  circuit: GeneratedCircuit,
  songTitle?: string
): MaterialListReport {
  let noteBlockCount = 0;
  let repeaterCount = 0;
  let wireCount = 0;
  let stoneCount = 0;

  const substrateCounts = new Map<string, number>();

  for (const [coord, state] of circuit.blocks.entries()) {
    const parts = coord.split(',');
    const y = parseInt(parts[1]!, 10);

    if (state.startsWith('minecraft:note_block')) {
      noteBlockCount++;
    } else if (state.startsWith('minecraft:repeater')) {
      repeaterCount++;
    } else if (state.startsWith('minecraft:redstone_wire')) {
      wireCount++;
    } else if (state === 'minecraft:stone') {
      stoneCount++;
    }

    // Inspect substrates beneath note blocks at Y=0
    if (y === 0 && !state.startsWith('minecraft:air')) {
      // Check if there is a note block above at Y=1
      const aboveCoord = `${parts[0]},1,${parts[2]}`;
      const aboveState = circuit.blocks.get(aboveCoord);
      if (aboveState && aboveState.startsWith('minecraft:note_block')) {
        const substrateBlock = state.split('[')[0]!;
        substrateCounts.set(substrateBlock, (substrateCounts.get(substrateBlock) ?? 0) + 1);
      }
    }
  }

  // Redstone Components Category
  const redstoneItems: MaterialItem[] = [
    {
      id: 'minecraft:note_block',
      name: 'Note Block',
      category: 'noteblock',
      count: noteBlockCount,
      stacksText: formatStacks(noteBlockCount),
      description: 'Crafted with 8 Wood Planks + 1 Redstone Dust',
    },
    {
      id: 'minecraft:repeater',
      name: 'Redstone Repeater',
      category: 'redstone',
      count: repeaterCount,
      stacksText: formatStacks(repeaterCount),
      description: 'Crafted with 3 Stone + 2 Redstone Torches + 1 Redstone Dust',
    },
    {
      id: 'minecraft:redstone_wire',
      name: 'Redstone Dust',
      category: 'redstone',
      count: wireCount,
      stacksText: formatStacks(wireCount),
      description: 'Transmission wire and turn connectors',
    },
  ];

  // Substrate Category
  const substrateItems: MaterialItem[] = [];
  for (const [subBlock, count] of substrateCounts.entries()) {
    const cleanName = BLOCK_FRIENDLY_NAMES[subBlock] || subBlock.replace('minecraft:', '');

    // Identify which instrument this substrate represents
    let instrumentDesc = '';
    for (const meta of Object.values(INSTRUMENT_METADATA)) {
      if (meta.baseBlock === subBlock) {
        instrumentDesc = meta.displayName;
        break;
      }
    }

    substrateItems.push({
      id: subBlock,
      name: cleanName,
      category: 'substrate',
      count,
      stacksText: formatStacks(count),
      instrumentName: instrumentDesc,
      description: instrumentDesc ? `Instrument foundation: ${instrumentDesc}` : undefined,
    });
  }
  substrateItems.sort((a, b) => b.count - a.count);

  // Foundation Category
  const foundationItems: MaterialItem[] = [
    {
      id: 'minecraft:stone',
      name: 'Smooth / Normal Stone',
      category: 'foundation',
      count: stoneCount,
      stacksText: formatStacks(stoneCount),
      description: 'Solid conductive blocks beneath circuits and repeaters',
    },
  ];

  const categories: MaterialCategory[] = [
    {
      category: 'noteblock',
      title: 'Note Blocks',
      items: redstoneItems.filter((i) => i.category === 'noteblock'),
    },
    {
      category: 'redstone',
      title: 'Redstone Wiring',
      items: redstoneItems.filter((i) => i.category === 'redstone'),
    },
    {
      category: 'substrate',
      title: 'Instrument Substrates (Layer 0)',
      items: substrateItems,
    },
    {
      category: 'foundation',
      title: 'Foundation Blocks',
      items: foundationItems,
    },
  ];

  const allItems = [...redstoneItems, ...substrateItems, ...foundationItems];
  const totalBlocks = allItems.reduce((acc, item) => acc + item.count, 0);

  // Generate plain-text clipboard friendly export
  const title = songTitle || 'Minecraft Note Block Song';
  const { width, height, length } = circuit.dimensions;

  const lines: string[] = [
    `Minecraft Note Block Materials Checklist`,
    `Song: ${title}`,
    `Dimensions: ${width} W × ${height} H × ${length} L blocks (${width * length} m² footprint)`,
    ``,
    `=== Redstone & Note Blocks ===`,
  ];

  for (const item of redstoneItems) {
    lines.push(`- ${item.name}: ${item.count} (${item.stacksText})`);
  }

  if (substrateItems.length > 0) {
    lines.push(``, `=== Instrument Base Blocks (Placed under Note Blocks) ===`);
    for (const item of substrateItems) {
      const instSuffix = item.instrumentName ? ` [${item.instrumentName}]` : '';
      lines.push(`- ${item.name}${instSuffix}: ${item.count} (${item.stacksText})`);
    }
  }

  lines.push(``, `=== Foundation Blocks ===`);
  for (const item of foundationItems) {
    lines.push(`- ${item.name}: ${item.count} (${item.stacksText})`);
  }

  return {
    items: allItems,
    categories,
    totalBlocks,
    totalNoteBlocks: noteBlockCount,
    totalRepeaters: repeaterCount,
    copyableText: lines.join('\n'),
  };
}

// ============================================================================
// 3. BLOCK STATE PARSER HELPER
// ============================================================================

/**
 * Parses block state string into detailed component info for rendering and tooltips.
 */
export function parseBlockInfo(
  x: number,
  y: number,
  z: number,
  state: string,
  substrateState?: string
): HoveredCellInfo {
  if (!state || state === 'minecraft:air') {
    return {
      x,
      y,
      z,
      rawState: 'minecraft:air',
      blockName: 'Air',
      category: 'air',
    };
  }

  const bracketIdx = state.indexOf('[');
  const baseName = bracketIdx === -1 ? state : state.slice(0, bracketIdx);
  const propsRaw = bracketIdx === -1 ? '' : state.slice(bracketIdx + 1, -1);

  const props: Record<string, string> = {};
  for (const pair of propsRaw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq !== -1) {
      props[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }

  if (baseName === 'minecraft:note_block') {
    const instrument = (props['instrument'] || 'harp') as MinecraftInstrument;
    const note = parseInt(props['note'] || '0', 10);
    const noteName = NOTEBLOCK_NOTE_NAMES[note] || `Pitch ${note}`;
    const instMeta = INSTRUMENT_METADATA[instrument];

    return {
      x,
      y,
      z,
      rawState: state,
      blockName: 'Note Block',
      category: 'noteblock',
      instrument: instMeta?.displayName || instrument,
      note,
      noteName,
      substrateName: substrateState
        ? BLOCK_FRIENDLY_NAMES[substrateState.split('[')[0]!] || substrateState
        : undefined,
    };
  }

  if (baseName === 'minecraft:repeater') {
    const delay = parseInt(props['delay'] || '1', 10);
    const facing = props['facing'] || 'west';
    // Facing represents output->input. Output direction:
    let outputDir = 'East (+X)';
    if (facing === 'east') outputDir = 'West (-X)';
    else if (facing === 'north') outputDir = 'South (+Z)';
    else if (facing === 'south') outputDir = 'North (-Z)';

    return {
      x,
      y,
      z,
      rawState: state,
      blockName: 'Redstone Repeater',
      category: 'repeater',
      delay,
      facing,
      description: `Delay: ${delay} tick${delay > 1 ? 's' : ''} (${(delay * 0.1).toFixed(1)}s) &bull; Output: ${outputDir}`,
    };
  }

  if (baseName === 'minecraft:redstone_wire') {
    return {
      x,
      y,
      z,
      rawState: state,
      blockName: 'Redstone Wire',
      category: 'wire',
      description: 'Conception spine & serpentine turn transmission',
    };
  }

  if (baseName === 'minecraft:stone') {
    return {
      x,
      y,
      z,
      rawState: state,
      blockName: 'Stone Foundation',
      category: 'foundation',
    };
  }

  return {
    x,
    y,
    z,
    rawState: state,
    blockName: BLOCK_FRIENDLY_NAMES[baseName] || baseName.replace('minecraft:', ''),
    category: 'substrate',
  };
}

// ============================================================================
// 4. INTERACTIVE SCHEMATIC CANVAS RENDERER
// ============================================================================

export interface SchematicRendererOptions {
  onHover?: (info: HoveredCellInfo | null) => void;
}

export class SchematicCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private circuit: GeneratedCircuit | null = null;
  private layer: PreviewLayer = 'circuit';
  private cellSize = 22;
  private activeTick = -1;
  private hoveredCell: { x: number; z: number } | null = null;
  private onHoverCallback?: (info: HoveredCellInfo | null) => void;

  constructor(canvas: HTMLCanvasElement, options?: SchematicRendererOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHoverCallback = options?.onHover;

    this.attachMouseEvents();
  }

  public setCircuit(circuit: GeneratedCircuit): void {
    this.circuit = circuit;
    this.autoFitCellSize();
    this.render();
  }

  public setLayer(layer: PreviewLayer): void {
    this.layer = layer;
    this.render();
  }

  public setZoom(delta: number): void {
    this.cellSize = Math.max(10, Math.min(48, this.cellSize + delta));
    this.render();
  }

  public resetZoom(): void {
    this.autoFitCellSize();
    this.render();
  }

  public setActiveTick(tick: number): void {
    if (this.activeTick !== tick) {
      this.activeTick = tick;
      this.render();
    }
  }

  private autoFitCellSize(): void {
    if (!this.circuit) return;
    const parentWidth = this.canvas.parentElement?.clientWidth || 900;
    const padding = 60;
    const available = parentWidth - padding;
    const width = this.circuit.dimensions.width;
    const calculated = Math.floor(available / width);
    this.cellSize = Math.max(14, Math.min(28, calculated));
  }

  private attachMouseEvents(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.circuit) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;

      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      const headerOffset = 28;
      if (mouseX < headerOffset || mouseY < headerOffset) {
        this.clearHover();
        return;
      }

      const cellX = Math.floor((mouseX - headerOffset) / this.cellSize);
      const cellZ = Math.floor((mouseY - headerOffset) / this.cellSize);

      if (
        cellX >= 0 &&
        cellX < this.circuit.dimensions.width &&
        cellZ >= 0 &&
        cellZ < this.circuit.dimensions.length
      ) {
        if (!this.hoveredCell || this.hoveredCell.x !== cellX || this.hoveredCell.z !== cellZ) {
          this.hoveredCell = { x: cellX, z: cellZ };
          this.dispatchHover();
          this.render();
        }
      } else {
        this.clearHover();
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.clearHover();
    });
  }

  private clearHover(): void {
    if (this.hoveredCell) {
      this.hoveredCell = null;
      if (this.onHoverCallback) this.onHoverCallback(null);
      this.render();
    }
  }

  private dispatchHover(): void {
    if (!this.hoveredCell || !this.circuit || !this.onHoverCallback) return;
    const { x, z } = this.hoveredCell;
    const y = this.layer === 'substrate' ? 0 : 1;
    const state = this.circuit.blocks.get(`${x},${y},${z}`) ?? 'minecraft:air';
    const subState = this.circuit.blocks.get(`${x},0,${z}`);
    const info = parseBlockInfo(x, y, z, state, subState);
    this.onHoverCallback(info);
  }

  public render(): void {
    if (!this.ctx || !this.circuit) return;
    const ctx = this.ctx;
    const { width, length } = this.circuit.dimensions;

    const headerOffset = 28;
    const totalW = headerOffset + width * this.cellSize + 10;
    const totalH = headerOffset + length * this.cellSize + 10;

    if (this.canvas.width !== totalW || this.canvas.height !== totalH) {
      this.canvas.width = totalW;
      this.canvas.height = totalH;
    }

    // Dark Studio Background
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, totalW, totalH);

    // Draw Column Headers (X axis)
    ctx.fillStyle = '#64748b';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let x = 0; x < width; x++) {
      const cx = headerOffset + x * this.cellSize + this.cellSize / 2;
      ctx.fillText(x.toString(), cx, headerOffset / 2);
    }

    // Draw Row Headers (Z axis)
    ctx.textAlign = 'right';
    for (let z = 0; z < length; z += 3) {
      const cy = headerOffset + z * this.cellSize + this.cellSize / 2;
      ctx.fillText(`Z${z}`, headerOffset - 4, cy);
    }

    // Render Blocks
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const px = headerOffset + x * this.cellSize;
        const py = headerOffset + z * this.cellSize;

        this.drawCell(ctx, x, z, px, py);
      }
    }

    // Highlight hovered cell
    if (this.hoveredCell) {
      const hx = headerOffset + this.hoveredCell.x * this.cellSize;
      const hz = headerOffset + this.hoveredCell.z * this.cellSize;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 0.5, hz + 0.5, this.cellSize - 1, this.cellSize - 1);
    }
  }

  private drawCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    z: number,
    px: number,
    py: number
  ): void {
    if (!this.circuit) return;
    const s = this.cellSize;

    // Draw empty grid slot
    ctx.fillStyle = '#181a1f';
    ctx.fillRect(px, py, s, s);
    ctx.strokeStyle = '#22252b';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

    const circuitState = this.circuit.blocks.get(`${x},1,${z}`);
    const substrateState = this.circuit.blocks.get(`${x},0,${z}`);

    // If substrate layer is selected, render Layer 0
    if (this.layer === 'substrate') {
      if (substrateState && !substrateState.startsWith('minecraft:air')) {
        this.renderSubstrateBlock(ctx, substrateState, px, py, s);
      }
      return;
    }

    // Otherwise render Layer 1 (Circuit / Composite)
    if (!circuitState || circuitState === 'minecraft:air') {
      return;
    }

    if (circuitState.startsWith('minecraft:note_block')) {
      this.renderNoteBlock(ctx, circuitState, px, py, s);
    } else if (circuitState.startsWith('minecraft:repeater')) {
      this.renderRepeater(ctx, circuitState, px, py, s);
    } else if (circuitState.startsWith('minecraft:redstone_wire')) {
      this.renderRedstoneWire(ctx, px, py, s);
    } else if (circuitState === 'minecraft:stone') {
      this.renderStone(ctx, px, py, s);
    }
  }

  private renderNoteBlock(
    ctx: CanvasRenderingContext2D,
    state: string,
    px: number,
    py: number,
    s: number
  ): void {
    // Extract instrument & note
    let inst = 'harp';
    let noteNum = 0;
    const instMatch = state.match(/instrument=([a-z_]+)/);
    if (instMatch) inst = instMatch[1]!;
    const noteMatch = state.match(/note=(\d+)/);
    if (noteMatch) noteNum = parseInt(noteMatch[1]!, 10);

    const color = INSTRUMENT_COLOR_TINTS[inst] || '#b45309';

    // Note Block body
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

    // Beveled rim
    ctx.strokeStyle = '#ffffff25';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);

    // Note pitch label if cell is large enough
    if (s >= 16) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(8, Math.floor(s * 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = s >= 24 ? (NOTEBLOCK_NOTE_NAMES[noteNum] || `${noteNum}`) : `${noteNum}`;
      ctx.fillText(label, px + s / 2, py + s / 2);
    }
  }

  private renderRepeater(
    ctx: CanvasRenderingContext2D,
    state: string,
    px: number,
    py: number,
    s: number
  ): void {
    let delay = 1;
    let facing = 'west';
    const delayMatch = state.match(/delay=(\d+)/);
    if (delayMatch) delay = parseInt(delayMatch[1]!, 10);
    const facingMatch = state.match(/facing=([a-z]+)/);
    if (facingMatch) facing = facingMatch[1]!;

    // Stone slab body
    ctx.fillStyle = '#334155';
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);

    // Output arrow direction:
    // In Minecraft: facing is output->input.
    // facing=west -> outputs East (→)
    // facing=east -> outputs West (←)
    // facing=north -> outputs South (↓)
    // facing=south -> outputs North (↑)
    let arrow = '→';
    if (facing === 'east') arrow = '←';
    else if (facing === 'north') arrow = '↓';
    else if (facing === 'south') arrow = '↑';

    // Redstone torches & arrow
    ctx.fillStyle = '#ef4444';
    ctx.font = `bold ${Math.max(9, Math.floor(s * 0.48))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrow, px + s / 2, py + s / 2);

    // Delay indicator badge in corner
    if (s >= 18) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${delay}t`, px + s - 2, py + s - 1);
    }
  }

  private renderRedstoneWire(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    s: number
  ): void {
    // Redstone wire node
    ctx.fillStyle = '#1c1e22';
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

    const midX = px + s / 2;
    const midY = py + s / 2;

    // Glowing red cross
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(2, Math.floor(s * 0.16));
    ctx.beginPath();
    ctx.moveTo(px + 2, midY);
    ctx.lineTo(px + s - 2, midY);
    ctx.moveTo(midX, py + 2);
    ctx.lineTo(midX, py + s - 2);
    ctx.stroke();

    // Center glow dot
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(midX, midY, Math.max(2, s * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }

  private renderStone(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    s: number
  ): void {
    ctx.fillStyle = '#475569';
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  }

  private renderSubstrateBlock(
    ctx: CanvasRenderingContext2D,
    state: string,
    px: number,
    py: number,
    s: number
  ): void {
    const base = state.split('[')[0]!;
    let fill = '#334155';

    if (base.includes('dirt')) fill = '#78350f';
    else if (base.includes('planks') || base.includes('wood')) fill = '#a16207';
    else if (base.includes('sand')) fill = '#eab308';
    else if (base.includes('clay')) fill = '#0d9488';
    else if (base.includes('gold')) fill = '#facc15';
    else if (base.includes('wool')) fill = '#e2e8f0';
    else if (base.includes('glass')) fill = '#38bdf8';
    else if (base.includes('ice')) fill = '#7dd3fc';
    else if (base.includes('bone')) fill = '#fef08a';
    else if (base.includes('iron')) fill = '#cbd5e1';
    else if (base.includes('soul')) fill = '#451a03';
    else if (base.includes('pumpkin')) fill = '#ea580c';
    else if (base.includes('emerald')) fill = '#10b981';
    else if (base.includes('hay')) fill = '#fbbf24';
    else if (base.includes('glowstone')) fill = '#fef08a';
    else if (base.includes('stone')) fill = '#64748b';

    ctx.fillStyle = fill;
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

    if (s >= 18) {
      const name = BLOCK_FRIENDLY_NAMES[base] || base.replace('minecraft:', '');
      ctx.fillStyle = '#ffffff';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.slice(0, 4), px + s / 2, py + s / 2);
    }
  }
}

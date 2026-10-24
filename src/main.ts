/**
 * src/main.ts
 *
 * Client-Side Web Application for MIDI to Minecraft Note Block Converter.
 * Provides interactive file drop, Web Audio preview with live visualizer,
 * track-level instrument inspector, and Sponge (.schem) & Litematica (.litematic) exports.
 */

import './style.css';
import { parseMidi } from './core/midi-parser';
import { convertToSongTimeline } from './core/noteblock-mapper';
import { exportSpongeSchematic } from './core/schem-exporter';
import { exportLitematic } from './core/litematic-exporter';
import { WebAudioNoteBlockPlayer } from './core/audio-preview';
import { buildCircuitGrid, type GeneratedCircuit } from './core/circuit-builder';
import {
  computeMaterialList,
  SchematicCanvasRenderer,
  type MaterialListReport,
  type PreviewLayer,
  type HoveredCellInfo,
} from './core/schematic-viewer';
import {
  MINECRAFT_INSTRUMENTS,
  type MidiFile,
  type SongTimeline,
  type ConversionOptions,
  type MinecraftInstrument,
  type AudioPlayerState,
} from './core/types';

export const APP_TITLE = 'MIDI to Note Block';
export const APP_VERSION = '1.0.0';

// Global Application State
let currentMidi: MidiFile | null = null;
let currentTimeline: SongTimeline | null = null;
let currentCircuit: GeneratedCircuit | null = null;
let currentMaterialReport: MaterialListReport | null = null;
let schematicRenderer: SchematicCanvasRenderer | null = null;
let currentPreviewLayer: PreviewLayer = 'circuit';
let currentExportName = 'Ode_to_Joy';
const audioPlayer = new WebAudioNoteBlockPlayer();

const conversionOptions: ConversionOptions = {
  manualTranspose: 0,
  preserveKey: false,
  enableOctaveFolding: true,
  instrumentOverrides: {},
};
let maxTrackWidth = 16;

/**
 * Downloads a binary Uint8Array buffer as a file in the user's browser.
 */
function triggerBrowserDownload(filename: string, mimeType: string, data: Uint8Array): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formats duration in seconds to MM:SS string.
 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Processes a raw MIDI binary buffer, recalculates timeline, and reloads audio player.
 */
export async function loadMidiBuffer(buffer: ArrayBuffer | Uint8Array, fileName = 'song.mid'): Promise<void> {
  try {
    currentMidi = parseMidi(buffer);

    const baseName = fileName ? fileName.replace(/\.[^/.]+$/, '').trim() : '';
    if (baseName) {
      currentExportName = baseName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'noteblock_song';
      conversionOptions.songTitle = currentExportName;
    } else {
      conversionOptions.songTitle = undefined;
    }

    conversionOptions.instrumentOverrides = {};
    recomputeTimeline();
    renderApp();
  } catch (err) {
    alert(`Failed to parse MIDI file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function getActiveTrackWidth(): number {
  const input = document.getElementById('widthInput') as HTMLInputElement | null;
  if (input) {
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 5) {
      maxTrackWidth = Math.max(5, Math.min(128, val));
    }
  }
  return maxTrackWidth;
}

function renderCircuitBadgesHtml(circuit: GeneratedCircuit): string {
  return `
    <span class="badge-dim">${circuit.dimensions.width}W × ${circuit.dimensions.height}H × ${circuit.dimensions.length}L blocks</span>
    <span class="badge-dim">${circuit.dimensions.width * circuit.dimensions.length} m² footprint</span>
  `;
}

function renderMaterialsGridHtml(report: MaterialListReport): string {
  return report.categories.map((cat) => `
    <div class="material-category-card">
      <div class="material-cat-title">${cat.title}</div>
      <div class="material-items-list">
        ${cat.items.map((item) => `
          <div class="material-row">
            <div class="material-name-col">
              <span class="material-name">${item.name}</span>
              ${item.instrumentName ? `<span class="material-inst-tag">${item.instrumentName}</span>` : ''}
            </div>
            <div class="material-count-col">
              <strong class="material-total">${item.count}</strong>
              <span class="material-stacks">(${item.stacksText})</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function updateCircuitBadgesAndMaterials(): void {
  if (!currentCircuit || !currentMaterialReport) return;

  const badgesEl = document.getElementById('schematicHeaderBadges');
  if (badgesEl) {
    badgesEl.innerHTML = renderCircuitBadgesHtml(currentCircuit);
  }

  const materialsGrid = document.getElementById('materialsGrid');
  if (materialsGrid) {
    materialsGrid.innerHTML = renderMaterialsGridHtml(currentMaterialReport);
  }

  if (schematicRenderer) {
    schematicRenderer.setCircuit(currentCircuit);
  }
}

function recomputeCircuit(): void {
  if (!currentTimeline) {
    currentCircuit = null;
    currentMaterialReport = null;
    return;
  }
  currentCircuit = buildCircuitGrid(currentTimeline, {
    name: currentExportName,
    maxTrackWidth,
  });
  currentMaterialReport = computeMaterialList(currentCircuit, currentExportName);
}

function recomputeTimeline(): void {
  if (!currentMidi) return;
  currentTimeline = convertToSongTimeline(currentMidi, conversionOptions);
  if (currentExportName && currentExportName !== 'noteblock_song') {
    currentTimeline.title = currentExportName;
  } else if (currentTimeline.title && currentTimeline.title !== 'Minecraft Note Block Song') {
    currentExportName = currentTimeline.title;
  }
  audioPlayer.loadSong(currentTimeline);
  recomputeCircuit();
}

/**
 * Loads the bundled demo MIDI song.
 */
async function loadDemoSong(): Promise<void> {
  try {
    const res = await fetch('./demo.mid');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await loadMidiBuffer(buf, 'Beethoven - Ode to Joy.mid');
  } catch (err) {
    alert(`Could not load demo MIDI: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Renders the Visualizer / Piano Roll Canvas.
 */
function setupVisualizer(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const render = () => {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Subtle pitch grid lines (semitones 0, 6, 12, 18, 24)
    ctx.strokeStyle = '#22252c';
    ctx.lineWidth = 1;
    for (let semitone = 0; semitone <= 24; semitone += 6) {
      const y = height - (semitone / 24) * (height - 16) - 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!currentTimeline || currentTimeline.allEvents.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select or drop a MIDI file to preview notes', width / 2, height / 2);
      requestAnimationFrame(render);
      return;
    }

    const playerState = audioPlayer.getState();
    const playheadTime = playerState.currentTime;

    // View window: 6 seconds total
    const windowSeconds = 6;
    const startTime = Math.max(0, playheadTime - 0.8);
    const endTime = startTime + windowSeconds;

    // Draw notes
    for (const ev of currentTimeline.allEvents) {
      if (ev.timestampSeconds < startTime || ev.timestampSeconds > endTime) continue;

      const x = ((ev.timestampSeconds - startTime) / windowSeconds) * width;
      const y = height - (ev.note / 24) * (height - 16) - 8;

      const isCurrent = Math.abs(ev.timestampSeconds - playheadTime) < 0.1;
      ctx.fillStyle = isCurrent ? '#4ade80' : '#38bdf8';

      ctx.beginPath();
      ctx.arc(x, y, isCurrent ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playhead line
    const cursorX = ((playheadTime - startTime) / windowSeconds) * width;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();

    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
}

/**
 * Main application DOM renderer.
 */
export function renderApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const hasSong = currentTimeline !== null;
  const state = audioPlayer.getState();

  app.innerHTML = `
    <div class="app-container">
      <header class="app-header">
        <div class="brand">
          <h1>
            <span class="brand-icon">♪</span>
            ${APP_TITLE}
          </h1>
          <p class="brand-desc">Convert MIDI files into playable Minecraft note block circuits (.schem & .litematic)</p>
        </div>

        <div class="header-links">
          <a href="//github.com/slopggobblercobbler81/midi-to-noteblock" target="_blank" rel="noreferrer" class="btn btn-subtle btn-sm">
            GitHub
          </a>
        </div>
      </header>

      <!-- File Upload Zone -->
      <section class="panel">
        <div id="dropzone" class="dropzone">
          <div class="dropzone-label">Drop a MIDI file here, or click to browse</div>
          <div class="dropzone-hint">Supports SMF Format 0, 1, and 2 (.mid, .midi)</div>
          <input type="file" id="fileInput" accept=".mid,.midi" style="display: none;" />
        </div>

        <div class="upload-bar">
          <button id="btnBrowse" class="btn btn-subtle">Choose File</button>
          <button id="btnDemo" class="btn btn-primary">Load Sample (Beethoven - Ode to Joy)</button>
        </div>
      </section>

      ${hasSong ? `
        <!-- Audio Preview & Transport -->
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title">Audio Preview</div>
            <div class="panel-subtitle">Synthesizing 16 Minecraft Instrument Timbre Foundations</div>
          </div>

          <div class="canvas-wrapper">
            <canvas id="visualizer" width="940" height="120"></canvas>
          </div>

          <div class="player-toolbar">
            <div class="transport-actions">
              <button id="btnPlayPause" class="btn btn-primary btn-sm">
                ${state.isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <button id="btnStop" class="btn btn-subtle btn-sm">⏹ Stop</button>
            </div>

            <input
              type="range"
              id="seekSlider"
              class="scrubber"
              min="0"
              max="${currentTimeline!.durationSeconds}"
              step="0.05"
              value="${state.currentTime}"
            />

            <div class="time-counter" id="timeDisplay">
              <strong>${formatTime(state.currentTime)}</strong> / ${formatTime(currentTimeline!.durationSeconds)}
              <span style="color: var(--text-muted); margin-left: 0.35rem;">(Tick ${state.currentRedstoneTick}/${currentTimeline!.totalRedstoneTicks})</span>
            </div>

            <div class="control-group">
              <span>Speed:</span>
              <select id="speedSelect" class="mini-select">
                <option value="0.5" ${state.playbackSpeed === 0.5 ? 'selected' : ''}>0.5x</option>
                <option value="0.75" ${state.playbackSpeed === 0.75 ? 'selected' : ''}>0.75x</option>
                <option value="1.0" ${state.playbackSpeed === 1.0 ? 'selected' : ''}>1.0x</option>
                <option value="1.25" ${state.playbackSpeed === 1.25 ? 'selected' : ''}>1.25x</option>
                <option value="1.5" ${state.playbackSpeed === 1.5 ? 'selected' : ''}>1.5x</option>
                <option value="2.0" ${state.playbackSpeed === 2.0 ? 'selected' : ''}>2.0x</option>
              </select>
            </div>

            <div class="control-group">
              <span>Vol:</span>
              <input
                type="range"
                id="volumeSlider"
                class="mini-slider"
                min="0"
                max="1"
                step="0.05"
                value="${state.volume}"
              />
            </div>
          </div>
        </section>

        <!-- Tuning & Track Inspector -->
        <div class="workspace-grid">
          <section class="panel">
            <div class="panel-header">
              <div class="panel-title">Tuning & Circuit Layout</div>
            </div>

            <div class="settings-stack">
              <div class="setting-row">
                <div class="setting-label-group">
                  <label for="transposeInput">Pitch Transposition (semitones)</label>
                  <span class="setting-hint">Shift song pitch into optimal Note Block 2-octave range [0, 24].</span>
                </div>
                <input
                  type="number"
                  id="transposeInput"
                  min="-24"
                  max="24"
                  value="${conversionOptions.manualTranspose ?? 0}"
                />
              </div>

              <div class="setting-row">
                <div class="setting-label-group">
                  <label for="widthInput">Max Track Width (blocks)</label>
                  <span class="setting-hint">Limits contraption width (X axis) before turning into the next serpentine row (default 16 = 1 chunk). Lower values make narrow/long tracks; higher values create wider tracks with fewer turns.</span>
                </div>
                <input
                  type="number"
                  id="widthInput"
                  min="5"
                  max="128"
                  value="${maxTrackWidth}"
                />
              </div>

              <label class="checkbox-row">
                <input
                  type="checkbox"
                  id="preserveKeyCheck"
                  ${conversionOptions.preserveKey ? 'checked' : ''}
                />
                <span>Preserve key (octave shifts only)</span>
              </label>

              <label class="checkbox-row">
                <input
                  type="checkbox"
                  id="octaveFoldCheck"
                  ${conversionOptions.enableOctaveFolding !== false ? 'checked' : ''}
                />
                <span>Fold out-of-range notes into [0, 24]</span>
              </label>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div class="panel-title">Track Inspector</div>
              <div class="panel-subtitle">${currentTimeline!.tracks.length} tracks detected</div>
            </div>

            <div class="track-table">
              ${currentTimeline!.tracks.map((track) => `
                <div class="track-item" data-track-id="${track.id}">
                  <div class="track-meta">
                    <span class="track-title">${track.name}</span>
                    <span class="track-count">${track.noteCount} notes</span>
                    ${track.isPercussion ? '<span class="badge-drum">Drums</span>' : ''}
                  </div>

                  <div class="track-tools">
                    <select class="mini-select track-inst-select" data-track-id="${track.id}">
                      ${MINECRAFT_INSTRUMENTS.map((inst) => `
                        <option value="${inst}" ${track.instrument === inst ? 'selected' : ''}>${inst}</option>
                      `).join('')}
                    </select>

                    <button
                      class="toggle-btn track-mute ${state.mutedTracks.has(track.id) ? 'is-muted' : ''}"
                      data-track-id="${track.id}"
                      title="Mute Track"
                    >M</button>

                    <button
                      class="toggle-btn track-solo ${state.soloTracks.has(track.id) ? 'is-soloed' : ''}"
                      data-track-id="${track.id}"
                      title="Solo Track"
                    >S</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>
        </div>

        <!-- Schematic Preview Section -->
        <section class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">Schematic Circuit Preview</div>
              <div class="panel-subtitle">Interactive 2D top-down view of generated redstone wiring, repeaters, and note blocks</div>
            </div>
            <div id="schematicHeaderBadges" class="schematic-header-badges">
              ${currentCircuit ? renderCircuitBadgesHtml(currentCircuit) : ''}
            </div>
          </div>

          <div class="preview-toolbar">
            <div class="preview-layer-group">
              <button id="btnLayerCircuit" class="btn btn-sm ${currentPreviewLayer === 'circuit' ? 'btn-primary' : 'btn-subtle'}">
                Circuit (Y=1)
              </button>
              <button id="btnLayerSubstrate" class="btn btn-sm ${currentPreviewLayer === 'substrate' ? 'btn-primary' : 'btn-subtle'}">
                Substrates (Y=0)
              </button>
            </div>

            <div class="preview-zoom-group">
              <button id="btnZoomOut" class="btn btn-subtle btn-sm" title="Zoom Out">&minus; Zoom</button>
              <button id="btnZoomReset" class="btn btn-subtle btn-sm" title="Fit to Container">Fit</button>
              <button id="btnZoomIn" class="btn btn-subtle btn-sm" title="Zoom In">&plus; Zoom</button>
            </div>
          </div>

          <div class="schematic-canvas-container">
            <canvas id="schematicCanvas"></canvas>
          </div>

          <div id="blockInspector" class="block-inspector-bar">
            <span class="inspector-hint">Hover over any block in the preview above to inspect coordinates, instrument, note pitch, or repeater delay.</span>
          </div>
        </section>

        <!-- Material Checklist Section -->
        ${currentMaterialReport ? `
          <section id="materialsSection" class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Survival Material Checklist</div>
                <div class="panel-subtitle">Exact blocks required to build this schematic in vanilla Minecraft survival</div>
              </div>
              <button id="btnCopyMaterials" class="btn btn-subtle btn-sm">
                📋 Copy Material List
              </button>
            </div>

            <div id="materialsGrid" class="materials-grid">
              ${renderMaterialsGridHtml(currentMaterialReport)}
            </div>
          </section>
        ` : ''}

        <!-- Export Section -->
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title">Export Minecraft Schematics</div>
            <div class="panel-subtitle">${currentTimeline!.title}</div>
          </div>

          <div class="stats-ribbon">
            <div class="stat-cell">
              <div class="stat-number">${currentTimeline!.allEvents.length}</div>
              <div class="stat-desc">Note Blocks</div>
            </div>
            <div class="stat-cell">
              <div class="stat-number">${currentTimeline!.totalRedstoneTicks}</div>
              <div class="stat-desc">Redstone Ticks</div>
            </div>
            <div class="stat-cell">
              <div class="stat-number">${currentTimeline!.bpm.toFixed(0)}</div>
              <div class="stat-desc">Tempo (BPM)</div>
            </div>
            <div class="stat-cell">
              <div class="stat-number">${formatTime(currentTimeline!.durationSeconds)}</div>
              <div class="stat-desc">Duration</div>
            </div>
          </div>

          <div class="schematic-naming-row">
            <label for="schematicNameInput" class="schematic-name-label">File Name:</label>
            <input
              type="text"
              id="schematicNameInput"
              class="schematic-name-input"
              value="${currentExportName}"
              placeholder="e.g. my_song"
            />
            <span class="schematic-ext-hint">(.schem / .litematic)</span>
          </div>

          <div class="export-actions">
            <button id="btnExportSchem" class="btn btn-primary export-btn">
              Download Sponge (.schem) &mdash; WorldEdit 1.13+
            </button>
            <button id="btnExportLitematic" class="btn btn-blue export-btn">
              Download Litematica (.litematic)
            </button>
          </div>

          <div class="guide-box">
            <h4>Minecraft Import Guide:</h4>
            <ol>
              <li><strong>WorldEdit (.schem):</strong> Put in <code>.minecraft/config/worldedit/schematics/</code>. In game, run <code>//schem load &lt;name&gt;</code> and <code>//paste</code>.</li>
              <li><strong>Litematica (.litematic):</strong> Put in <code>.minecraft/schematics/</code>. Press <code>M</code> &rarr; <em>Load Schematics</em>.</li>
              <li><strong>To Play:</strong> Connect a button or redstone lever to the starting input repeater to trigger musical playback!</li>
            </ol>
          </div>
        </section>
      ` : ''}

      <footer class="app-footer">
        <p>
          MIDI to Note Block &bull; Open-source client-side tool &bull;
          <a href="//github.com/slopggobblercobbler81/midi-to-noteblock" target="_blank" rel="noreferrer">GitHub Repository</a>
        </p>
      </footer>
    </div>
  `;

  attachEventListeners();

  const canvas = document.getElementById('visualizer') as HTMLCanvasElement | null;
  if (canvas) {
    setupVisualizer(canvas);
  }

  const schemCanvas = document.getElementById('schematicCanvas') as HTMLCanvasElement | null;
  if (schemCanvas && currentCircuit) {
    setupSchematicPreview(schemCanvas);
  }
}

/**
 * Initializes the interactive schematic canvas previewer.
 */
function setupSchematicPreview(canvas: HTMLCanvasElement): void {
  if (!currentCircuit) return;
  const inspector = document.getElementById('blockInspector');

  schematicRenderer = new SchematicCanvasRenderer(canvas, {
    onHover: (info: HoveredCellInfo | null) => {
      if (!inspector) return;
      if (!info || info.category === 'air') {
        inspector.innerHTML = `<span class="inspector-hint">Hover over any block in the preview above to inspect coordinates, instrument, note pitch, or repeater delay.</span>`;
        return;
      }

      let detailHtml = '';
      if (info.category === 'noteblock') {
        detailHtml = `
          <span class="inspector-badge inspector-badge-note">♪ ${info.instrument}</span>
          <span class="inspector-item">Pitch: <strong>${info.note} (${info.noteName})</strong></span>
          ${info.substrateName ? `<span class="inspector-item">Substrate: <strong>${info.substrateName}</strong></span>` : ''}
        `;
      } else if (info.category === 'repeater') {
        detailHtml = `
          <span class="inspector-badge inspector-badge-rep">⚡ Repeater</span>
          <span class="inspector-item">Delay: <strong>${info.delay}t (${(info.delay! * 0.1).toFixed(1)}s)</strong></span>
          <span class="inspector-item">Output: <strong>${info.facing === 'west' ? 'East (→)' : info.facing === 'east' ? 'West (←)' : info.facing}</strong></span>
        `;
      } else if (info.category === 'wire') {
        detailHtml = `
          <span class="inspector-badge inspector-badge-wire">Redstone Wire</span>
          <span class="inspector-item">Conductive spine & turns</span>
        `;
      } else if (info.category === 'foundation') {
        detailHtml = `
          <span class="inspector-badge">Foundation Stone</span>
          <span class="inspector-item">Solid circuit base</span>
        `;
      } else {
        detailHtml = `
          <span class="inspector-badge">${info.blockName}</span>
          <span class="inspector-item">Base substrate block</span>
        `;
      }

      inspector.innerHTML = `
        <div class="inspector-coord">
          <strong>X:</strong> ${info.x} &bull; <strong>Y:</strong> ${info.y} &bull; <strong>Z:</strong> ${info.z}
        </div>
        <div class="inspector-details">
          ${detailHtml}
        </div>
      `;
    },
  });

  schematicRenderer.setCircuit(currentCircuit);
  schematicRenderer.setLayer(currentPreviewLayer);
}

/**
 * Attaches DOM interaction handlers.
 */
function attachEventListeners(): void {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0]!;
        file.arrayBuffer().then((buf) => loadMidiBuffer(buf, file.name));
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0]!;
        file.arrayBuffer().then((buf) => loadMidiBuffer(buf, file.name));
      }
    });
  }

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', () => fileInput.click());
  }

  if (btnDemo) {
    btnDemo.addEventListener('click', loadDemoSong);
  }

  // Transport Controls
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnStop = document.getElementById('btnStop');
  const seekSlider = document.getElementById('seekSlider') as HTMLInputElement | null;
  const speedSelect = document.getElementById('speedSelect') as HTMLSelectElement | null;
  const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement | null;

  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      const state = audioPlayer.getState();
      if (state.isPlaying) {
        audioPlayer.pause();
        btnPlayPause.textContent = '▶ Play';
      } else {
        audioPlayer.play();
        btnPlayPause.textContent = '⏸ Pause';
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', () => {
      audioPlayer.stop();
      if (btnPlayPause) btnPlayPause.textContent = '▶ Play';
    });
  }

  if (seekSlider) {
    seekSlider.addEventListener('input', () => {
      audioPlayer.seek(parseFloat(seekSlider.value));
    });
  }

  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      audioPlayer.setSpeed(parseFloat(speedSelect.value));
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      audioPlayer.setVolume(parseFloat(volumeSlider.value));
    });
  }

  // Conversion Settings
  const transposeInput = document.getElementById('transposeInput') as HTMLInputElement | null;
  const widthInput = document.getElementById('widthInput') as HTMLInputElement | null;
  const preserveKeyCheck = document.getElementById('preserveKeyCheck') as HTMLInputElement | null;
  const octaveFoldCheck = document.getElementById('octaveFoldCheck') as HTMLInputElement | null;

  if (transposeInput) {
    transposeInput.addEventListener('change', () => {
      conversionOptions.manualTranspose = parseInt(transposeInput.value, 10) || 0;
      recomputeTimeline();
      renderApp();
    });
  }

  if (widthInput) {
    const handleWidthChange = (e: Event) => {
      const rawVal = parseInt(widthInput.value, 10);
      if (isNaN(rawVal) || rawVal < 5) {
        if (e.type === 'change') {
          widthInput.value = '5';
          maxTrackWidth = 5;
        } else {
          return;
        }
      } else {
        maxTrackWidth = Math.max(5, Math.min(128, rawVal));
        if (e.type === 'change' && rawVal > 128) {
          widthInput.value = '128';
        }
      }
      recomputeCircuit();
      updateCircuitBadgesAndMaterials();
    };

    widthInput.addEventListener('input', handleWidthChange);
    widthInput.addEventListener('change', handleWidthChange);
  }

  if (preserveKeyCheck) {
    preserveKeyCheck.addEventListener('change', () => {
      conversionOptions.preserveKey = preserveKeyCheck.checked;
      recomputeTimeline();
      renderApp();
    });
  }

  if (octaveFoldCheck) {
    octaveFoldCheck.addEventListener('change', () => {
      conversionOptions.enableOctaveFolding = octaveFoldCheck.checked;
      recomputeTimeline();
      renderApp();
    });
  }

  // Schematic Preview Controls
  const btnLayerCircuit = document.getElementById('btnLayerCircuit');
  const btnLayerSubstrate = document.getElementById('btnLayerSubstrate');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnZoomReset = document.getElementById('btnZoomReset');

  if (btnLayerCircuit && btnLayerSubstrate) {
    btnLayerCircuit.addEventListener('click', () => {
      currentPreviewLayer = 'circuit';
      btnLayerCircuit.classList.add('btn-primary');
      btnLayerCircuit.classList.remove('btn-subtle');
      btnLayerSubstrate.classList.remove('btn-primary');
      btnLayerSubstrate.classList.add('btn-subtle');
      schematicRenderer?.setLayer('circuit');
    });

    btnLayerSubstrate.addEventListener('click', () => {
      currentPreviewLayer = 'substrate';
      btnLayerSubstrate.classList.add('btn-primary');
      btnLayerSubstrate.classList.remove('btn-subtle');
      btnLayerCircuit.classList.remove('btn-primary');
      btnLayerCircuit.classList.add('btn-subtle');
      schematicRenderer?.setLayer('substrate');
    });
  }

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => schematicRenderer?.setZoom(4));
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => schematicRenderer?.setZoom(-4));
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', () => schematicRenderer?.resetZoom());
  }

  // Copy Materials Checklist
  const btnCopyMaterials = document.getElementById('btnCopyMaterials');
  if (btnCopyMaterials && currentMaterialReport) {
    btnCopyMaterials.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(currentMaterialReport!.copyableText);
        } else {
          const ta = document.createElement('textarea');
          ta.value = currentMaterialReport!.copyableText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        btnCopyMaterials.textContent = '✓ Copied to Clipboard!';
        setTimeout(() => {
          btnCopyMaterials.textContent = '📋 Copy Material List';
        }, 2000);
      } catch (err) {
        alert('Could not copy to clipboard: ' + String(err));
      }
    });
  }

  // Track Instrument Dropdowns
  document.querySelectorAll('.track-inst-select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const trackId = parseInt(select.getAttribute('data-track-id')!, 10);
      const chosen = select.value as MinecraftInstrument;
      if (!conversionOptions.instrumentOverrides) conversionOptions.instrumentOverrides = {};
      conversionOptions.instrumentOverrides[trackId] = chosen;
      recomputeTimeline();
      renderApp();
    });
  });

  // Track Mute & Solo
  document.querySelectorAll('.track-mute').forEach((el) => {
    el.addEventListener('click', (e) => {
      const btn = e.target as HTMLButtonElement;
      const trackId = parseInt(btn.getAttribute('data-track-id')!, 10);
      const isMuted = audioPlayer.getState().mutedTracks.has(trackId);
      audioPlayer.setTrackMute(trackId, !isMuted);
      btn.classList.toggle('is-muted', !isMuted);
    });
  });

  document.querySelectorAll('.track-solo').forEach((el) => {
    el.addEventListener('click', (e) => {
      const btn = e.target as HTMLButtonElement;
      const trackId = parseInt(btn.getAttribute('data-track-id')!, 10);
      const isSolo = audioPlayer.getState().soloTracks.has(trackId);
      audioPlayer.setTrackSolo(trackId, !isSolo);
      btn.classList.toggle('is-soloed', !isSolo);
    });
  });

  // Export Buttons & Filename input
  const btnExportSchem = document.getElementById('btnExportSchem');
  const btnExportLitematic = document.getElementById('btnExportLitematic');
  const schematicNameInput = document.getElementById('schematicNameInput') as HTMLInputElement | null;

  if (schematicNameInput) {
    schematicNameInput.addEventListener('input', () => {
      const val = schematicNameInput.value.trim();
      if (val) {
        currentExportName = val;
      }
    });
  }

  const getCleanExportName = () => {
    const raw = schematicNameInput?.value.trim() || currentExportName || currentTimeline?.title || 'noteblock_song';
    return raw.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'noteblock_song';
  };

  if (btnExportSchem && currentTimeline) {
    btnExportSchem.addEventListener('click', async () => {
      const activeWidth = getActiveTrackWidth();
      const exportName = getCleanExportName();
      const result = await exportSpongeSchematic(currentTimeline!, {
        name: exportName,
        maxTrackWidth: activeWidth,
      });
      triggerBrowserDownload(result.filename, result.mimeType, result.data);
    });
  }

  if (btnExportLitematic && currentTimeline) {
    btnExportLitematic.addEventListener('click', async () => {
      const activeWidth = getActiveTrackWidth();
      const exportName = getCleanExportName();
      const result = await exportLitematic(currentTimeline!, {
        name: exportName,
        maxTrackWidth: activeWidth,
      });
      triggerBrowserDownload(result.filename, result.mimeType, result.data);
    });
  }
}

// Audio Player Tick Callback to synchronize time display and seek slider
audioPlayer.onTick((state: AudioPlayerState) => {
  const timeDisplay = document.getElementById('timeDisplay');
  const seekSlider = document.getElementById('seekSlider') as HTMLInputElement | null;

  if (timeDisplay && currentTimeline) {
    timeDisplay.innerHTML = `
      <strong>${formatTime(state.currentTime)}</strong> / ${formatTime(currentTimeline.durationSeconds)}
      <span style="color: var(--text-muted); margin-left: 0.35rem;">(Tick ${state.currentRedstoneTick}/${currentTimeline.totalRedstoneTicks})</span>
    `;
  }

  if (seekSlider && document.activeElement !== seekSlider) {
    seekSlider.value = state.currentTime.toString();
  }

  schematicRenderer?.setActiveTick(state.currentRedstoneTick);
});

audioPlayer.onEnded(() => {
  const btnPlayPause = document.getElementById('btnPlayPause');
  if (btnPlayPause) btnPlayPause.textContent = '▶ Play';
});

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderApp());
  } else {
    renderApp();
  }
}

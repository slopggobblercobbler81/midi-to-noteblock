# 🎵 MIDI to Minecraft Note Block Converter & Audio Preview

[![CI & GitHub Pages Deployment](https://github.com/slopggobblercobbler81/midi-to-noteblock/actions/workflows/deploy.yml/badge.svg)](https://github.com/slopggobblercobbler81/midi-to-noteblock/actions/workflows/deploy.yml)

A pure client-side web application that converts standard MIDI files into playable Minecraft Note Block schematics (**Sponge `.schem`** and **Litematica `.litematic`**), with an interactive in-browser audio preview synthesizing authentic Minecraft note block sounds across all 16 vanilla instruments.

🌐 **Live Demo Website:** [https://slopggobblercobbler81.github.io/midi-to-noteblock/](https://slopggobblercobbler81.github.io/midi-to-noteblock/)

---

## ✨ Key Features

- **🎹 Zero-Dependency SMF MIDI Parsing**:
  - Handles Standard MIDI File (SMF) formats 0, 1, and 2.
  - Multi-track parsing, dynamic microsecond-accurate tempo changes, running status, and variable-length quantities.
- **🔊 Realistic In-Browser Audio Preview**:
  - Web Audio API physical synthesis mimicking all 16 vanilla Minecraft note block timbres (Harp/Piano, Bass, Snare, Hi-Hat, Flute, Bell, Guitar, Chime, Xylophone, Vibraphone, Cowbell, Didgeridoo, Bit/Chiptune, Banjo, Pling).
  - Transport controls: Play, Pause, Stop, Seek scrubber, Playback Speed (0.5x – 2.0x), and Volume control.
  - Interactive live piano roll visualizer displaying triggering note blocks in real-time.
- **⚙️ Smart Note Block Tuning & Quantization**:
  - **10 Hz Redstone Tick Quantization**: Perfectly aligns note onsets to Minecraft's 0.1-second tick intervals.
  - **Acoustic Octave Folding**: Folds out-of-range notes cleanly into Minecraft's 2-octave register (F#3 to F#5, notes 0–24).
  - **Key Preservation**: Optional lock ensuring transpositions only occur in full octave shifts (-24, -12, 0, +12, +24).
  - **Channel 9 Percussion Support**: Maps General MIDI drums and cymbals to appropriate percussive note block substrates (kick & toms &rarr; basedrum/stone, snare &rarr; snare/sand, cymbals &rarr; hat/glass).
  - **Track Inspector**: Per-track instrument overrides, note count displays, and individual Mute/Solo toggles.
- **🏗️ Dual Minecraft Schematic Exporters**:
  - **Sponge Schematic (`.schem`)**: WorldEdit & FastAsyncWorldEdit compatible for modern Minecraft 1.13+.
  - **Litematica (`.litematic`)**: Litematica mod format (v5) with 64-bit continuous bitstream packed BlockStates.
  - **Strict Acoustic Clearance**: Guaranteed Y+1 air clearance above all note blocks so they never fail to ring.
  - **Substrate Foundations**: Automatically places the correct base block (dirt, oak planks, sand, stone, packed ice, emerald, etc.) underneath each note block.
  - **Compact Serpentine Layout**: Automatic zigzag routing conforming to configurable width bounds (5–32 blocks).

---

## 🎮 How to Use

1. **Open the web application** at [https://slopggobblercobbler81.github.io/midi-to-noteblock/](https://slopggobblercobbler81.github.io/midi-to-noteblock/) or run locally.
2. **Load a MIDI file**:
   - Drag & drop any `.mid` or `.midi` file into the upload zone, or click **Browse File**.
   - Or click **Load Demo Song (Takeshi Abo - Lease)** for instant testing with the preloaded MIDI.
3. **Preview & Customize**:
   - Hit **Play** to listen to the synthesized Minecraft arrangement.
   - Adjust playback speed, transpose key, or override specific track instruments in the inspector.
4. **Export & Download**:
   - Click **Download .schem** or **Download .litematic**.

---

## 📦 Importing into Minecraft

### Option A: WorldEdit (`.schem`)
1. Place the downloaded `.schem` file in:
   - Single Player: `.minecraft/config/worldedit/schematics/`
   - Spigot / Paper Server: `plugins/FastAsyncWorldEdit/schematics/` or `plugins/WorldEdit/schematics/`
2. In-game, stand where you want the circuit built and run:
   ```text
   //schem load <filename>
   //paste
   ```
3. Place a button or redstone lever on the starting input repeater/wire to play the song!

### Option B: Litematica (`.litematic`)
1. Place the downloaded `.litematic` file in:
   - `.minecraft/schematics/`
2. In-game, press `M` (default Litematica menu key) &rarr; **Load Schematics**.
3. Select your song schematic and use the "Paste Schematic in Single Player" hotkey or create a holographic projection to build it in survival!

---

## 🛠️ Local Development & Testing

```bash
# Clone repository
git clone https://github.com/slopggobblercobbler81/midi-to-noteblock.git
cd midi-to-noteblock

# Install dependencies
npm install

# Run comprehensive automated test suite (184+ tests)
npm test

# Start local dev server
npm run dev

# Build production static bundle
npm run build
```

---

## 📜 License

MIT License. Crafted with precision for Minecraft redstone musicians.

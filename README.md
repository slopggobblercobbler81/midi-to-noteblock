# MIDI to Note Block

Convert MIDI files into playable Minecraft Note Block schematics (`.schem` and `.litematic`) with an in-browser audio preview.

Live tool: [https://slopggobblercobbler81.github.io/midi-to-noteblock/](https://slopggobblercobbler81.github.io/midi-to-noteblock/)

Runs entirely in your browser using the Web Audio API and typed arrays. No server uploads or external audio dependencies required.

## Features

- **MIDI parsing**: Reads Standard MIDI File formats 0, 1, and 2. Handles multi-track files, variable tempo changes, and running status.
- **In-browser preview**: Web Audio synthesizer approximating all 16 Minecraft note block instruments (harp, bass, drums, flute, bell, guitar, etc.) with playback controls and live piano roll visualizer.
- **Redstone quantization**: Snaps note events to 10 Hz redstone ticks (0.1s increments) with greedy repeater delay decomposition (1 to 4 ticks).
- **Pitch mapping**: Clamps or octave-folds notes into Minecraft's 2-octave range (`F#3` to `F#5`, semitones 0–24). Supports key-lock mode to only transpose by whole octaves.
- **Percussion mapping**: Maps General MIDI Channel 9 drum kit notes to stone (kick), sand (snare), glass (hat), etc.
- **Schematic exporters**:
  - **Sponge (.schem)**: Compatible with WorldEdit / FAWE on Minecraft 1.13+.
  - **Litematica (.litematic)**: Native v5 format with bit-packed block states.
  - **Acoustic clearance**: Places air above note blocks (`Y+1`) so notes always sound, and positions the matching base blocks directly beneath (`Y-1`).
  - **Serpentine layout**: Configurable track width (5 to 32 blocks) with snake/zigzag turns.

## Usage

1. Open [the web app](https://slopggobblercobbler81.github.io/midi-to-noteblock/).
2. Drop in a `.mid` file, or click **Load Sample** to test with Beethoven's *Ode to Joy*.
3. Use the player to preview playback, mute/solo tracks, or adjust tempo and key.
4. Set your schematic name and click **Download Sponge (.schem)** or **Download Litematica (.litematic)**.

## In-Game Installation

### WorldEdit (.schem)
1. Copy the `.schem` file to:
   - Singleplayer: `.minecraft/config/worldedit/schematics/`
   - Server: `plugins/WorldEdit/schematics/`
2. Run `//schem load <filename>` and `//paste`.
3. Power the initial redstone repeater to start the song.

### Litematica (.litematic)
1. Copy the `.litematic` file to `.minecraft/schematics/`.
2. Press `M` -> **Load Schematics**, select the file, and paste or build the hologram.

## Development

```bash
git clone https://github.com/slopggobblercobbler81/midi-to-noteblock.git
cd midi-to-noteblock

npm install
npm test
npm run dev
npm run build
```

## License

MIT

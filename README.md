# Gradient Atlas

Browser editor for colour and gradient atlas textures: palette sheets for stylised and low-poly models.

## Run

Open `index.html` in a browser. No install and no build step. Without internet the page falls back to system fonts.

## Host on GitHub Pages

1. Create a repository (for example `gradient-atlas`) and push the contents of this folder to it.
2. In the repository go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, save.
3. After a minute the editor is live at `https://<user>.github.io/gradient-atlas/`.

## How it works

- **Palette** – any number of base colours. Every cell refers to them, so changing a colour updates the whole atlas. *Generate* (or `Space`) rolls new colours in the chosen style; locked colours stay. Styles include materials (concrete, granite, sandstone, slate, basalt, brick, limestone); picking a style rolls a palette at once. *Popular palettes* (PICO-8, Sweetie 16, Endesga 32, Resurrect 64, AAP-64, Apollo and more, from [Lospec](https://lospec.com/palette-list)) come in whole; *Generate* then rolls related sets of 8 of their colours (similar hues from light to dark, sometimes with an accent), and `Ctrl+Z` brings the whole palette back.
- **Layout** – *Generate* (or `Shift+Space`) rolls new rows and cells in the chosen style: Classic, Strips, Grid, Bars, Material or Mixed. Colours and sheet settings stay; *Blend to all* then gives every cell one look. *New → Material atlas* starts a Material layout.
- **Shading** – how lighter and darker shades are made: highlights drift towards yellow, shadows towards blue.
- **Cells** – rows of cells; drag the gaps in the preview to resize them. With *Snap to grid* (Sheet) dragged edges stick to the grid in export pixels; hold `Ctrl` to move freely. Drag a cell onto another to swap them; each place keeps its size. `Shift`+click picks several cells, then *Same width* evens out the ones sharing a row and *Same height* evens out their rows. Each cell has:
  - colour: *Solid*, *Gradient* (stops on a bar, each a palette colour plus shade) or *Shades* (one colour from light to dark),
  - direction: linear at any angle or radial,
  - blend: *Smooth* (with hardness), *Steps* (visible bands), *Mosaic* (tiles with size and jitter) or *Noise*: clouds, grain, stones, voronoi, cracks, ridged or turbulence, with size, detail, contrast and how much noise replaces the gradient. A *Noise colour* from the palette paints the noise over the cell instead of moving along its own colours. Noise settings are remembered per colour source and noise type, so switching back brings them back,
  - *Seamless*: mirrors the gradient so the cell tiles without a seam; in *Noise* it wraps the noise at the cell edges instead, so a UV over the whole cell shows no seam.
  - Solid cells can be *Flat* or *Noise*: noise lets the colour drift around its shade by the chosen variation.
- **Sheet** – export size, outer margin, gaps and their colour, snap grid and its size. *Cell bleed* fills the gaps with the nearest cell colour, so texture filtering and mipmaps never pick up a border. *Dither* (on by default) adds a half-step of noise to smooth blends, so 8-bit gradients show no bands; flat colours, steps and tiles stay exact.
- **Export PNG** – the PNG carries the project inside it. Open it again (*Open PNG* or drop it on the page) to keep editing. The current project is also kept in the browser between visits.

## Shortcuts

| Key | Action |
| --- | --- |
| `Space` | New palette |
| `Shift+Space` | New layout |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| Arrow keys | Move between cells |
| `Ctrl+D` | Duplicate cell |
| `Ctrl+C` / `Ctrl+V` | Copy / paste cell |
| `Del` | Delete cell |
| `Shift`+click | Pick several cells |
| Drag a cell | Swap it with another |
| `Esc` | Deselect |
| `Ctrl+S` | Export PNG |

## Files

- `index.html`, `style.css` – page and look
- `js/color.js` – colour maths (OKLab, shades, palette styles)
- `js/atlas.js` – layout, rendering and project data inside the PNG
- `js/app.js` – editor interface
- `examples/` – exported atlases; open one with *Open PNG* to edit it

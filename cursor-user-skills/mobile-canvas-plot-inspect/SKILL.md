---
name: mobile-canvas-plot-inspect
description: Build press-and-hold scrub charts on mobile Safari that show a date tooltip, series values, and a vertical crosshair — without iOS text selection or canvas drag-as-photo. Use when adding or editing canvas line charts, plot inspect tooltips, chart crosshairs, or touch scrubbing in cursor-apps (especially habit-journal Stats plot).
---

# Mobile canvas plot inspect (press-and-hold scrub)

Use this skill when adding **press-and-hold + drag** inspection to a **canvas** line chart in a mobile web app (especially `habit-journal` Stats → Plot).

## Why this exists

On iOS Safari, attaching touch handlers directly to `<canvas>` commonly fails in two ways:

1. **Text selection** — drag highlights habit labels / page text and shows Copy / Look Up.
2. **Canvas lift** — the chart is treated like a draggable image and floats like a photo.

The fix is a **three-layer stack** plus gesture blocking. Do not bind scrub events to the canvas alone.

## Required DOM stack

Inside a `position: relative` wrap:

```html
<div class="graph-canvas-wrap">
  <canvas id="graphCanvas" aria-label="…"></canvas>
  <div id="graphChartTouch" aria-hidden="true"></div>
  <canvas id="graphChartOverlay" aria-hidden="true"></canvas>
  <div class="graph-chart-tooltip" id="graphChartTooltip" hidden></div>
</div>
```

| Layer | Role | Pointer events |
|-------|------|----------------|
| `#graphCanvas` | Draw the chart | **none** — display only |
| `#graphChartTouch` | Receive press/hold/drag | **all** touch/pointer input |
| `#graphChartOverlay` | Draw crosshair line | none |
| `.graph-chart-tooltip` | Date + series values | none |

Z-order: canvas (bottom) → overlay (2) → touch layer (3) → tooltip (5).

## Required CSS (minimum)

```css
.graph-canvas-wrap {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
#graphCanvas {
  pointer-events: none;
  -webkit-user-drag: none;
  user-drag: none;
}
#graphChartTouch {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 260px; /* match chart height */
  z-index: 3;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  background: transparent;
}
#graphChartOverlay {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 260px;
  z-index: 2;
  pointer-events: none;
  -webkit-user-drag: none;
}
```

While inspecting, toggle `graph-inspecting` on the plot root and set `user-select: none !important` on that subtree.

## Required JS patterns

### 1. Canvas is not interactive

```javascript
canvas.draggable = false;
canvas.setAttribute("draggable", "false");
```

### 2. Attach inspect metadata after every draw

Store layout on the canvas (pad, plotW, plotH, w, h) plus either:

- **time mode** — `start`, `end`, `seriesList`, or
- **day mode** — `domainStartIndex`, `pointCount`, `seriesList`

See `attachGraphInspectMeta` in `habit-journal/index.html`.

### 3. Bind events on the touch layer, not the canvas

- **Hold** ~400ms (`GRAPH_INSPECT_HOLD_MS`) then `setPointerCapture` on the touch layer.
- On hold: show tooltip, draw dashed vertical line on overlay, disable selection on plot root.
- On `pointermove` while active: update tooltip + line; `preventDefault()`; `clearTextSelection()`.
- On `pointerup` / `pointercancel`: hide tooltip, clear overlay, release capture.

### 4. Block native gestures on the touch layer (passive: false)

Listen and `preventDefault()` for:

- `contextmenu`
- `dragstart`
- `selectstart`
- `touchstart` (on chart area)
- `touchmove` (while inspect active)
- `pointerdown` / `pointermove` (while inspect active)

Also block `dragstart` on the canvas.

### 5. Crosshair on a separate overlay canvas

Never redraw the full chart on scrub. Clear overlay and stroke one vertical dashed line:

- Color: `rgba(120, 120, 120, 0.42)`
- Dash: `[4, 4]`
- X from scrub position clamped to plot area

### 6. Tooltip content

- **Header** — date or date+time at scrub position.
- **Body** — one row per selected series: color swatch, name, raw value.
- Map x-position → nearest day index (day charts) or timestamp with step-hold lookup (time charts).

## Reference implementation

Copy patterns from **`habit-journal/index.html`** (Stats plot, v46+):

| Concern | Search for |
|---------|------------|
| CSS stack | `#graphChartTouch`, `.graph-chart-tooltip` |
| Inspect bind | `bindGraphChartInspect` |
| Crosshair | `drawGraphInspectLine` |
| Tooltip | `showGraphChartTooltip`, `graphInspectAtPlotX` |
| Plot meta | `attachGraphInspectMeta`, `graphPlotLayout` |

After editing `habit-journal/index.html`, run `./scripts/verify-habit-journal-js.sh`.

## Checklist before shipping a new plot scrub

- [ ] Touch layer exists; canvas has `pointer-events: none`
- [ ] Canvas `draggable="false"`
- [ ] Events bound to touch layer with `{ passive: false }` where `preventDefault` is used
- [ ] `dragstart` / `selectstart` / `contextmenu` blocked on touch layer
- [ ] Crosshair drawn on overlay canvas, not main chart
- [ ] `user-select: none` on wrap; `graph-inspecting` class during scrub
- [ ] Tested mental model: hold → drag moves line; release dismisses; no Copy menu; no photo lift

## Do not

- Bind scrub only to `<canvas>` — iOS will break it.
- Use click/tap only — user expects press-and-hold scrub on phone.
- Redraw the full chart on every `pointermove`.
- Skip the overlay canvas and draw the crosshair on the main chart (causes flicker and full redraws).

## Install (user skill)

From repo root:

```bash
./scripts/install-mobile-canvas-plot-inspect-skill.sh
```

Installs to `~/.cursor/skills/mobile-canvas-plot-inspect/`. Restart Cursor or start a new chat.

// Thin React wrapper over plotly.js-dist-min (no react-plotly.js — avoids its
// React-19 peer friction). Renders a Scene via Plotly.react, which diffs
// efficiently on re-render and keeps zoom/pan state across scene updates.
import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

import type { Scene } from "../lib/scene";
import { sceneToTraces } from "../lib/sceneToTraces";

// Shape of the plotly-internal computed layout we read for right-click panning:
// the post-constraint axis range plus the plot-area pixel length per axis.
interface PlotlyAxis {
  range: [number, number];
  _length: number;
}
interface PlotlyAxes {
  xaxis?: PlotlyAxis;
  yaxis?: PlotlyAxis;
}

// Custom fullscreen toggle for the modebar. Four-corner "expand" glyph; the
// design is symmetric under plotly's icon y-flip so it renders correctly either
// way. Click toggles the browser Fullscreen API on the plot's graph div.
const fullscreenButton: Plotly.ModeBarButton = {
  name: "fullscreen",
  title: "Toggle fullscreen",
  icon: {
    width: 1000,
    height: 1000,
    path:
      "M150 150 L420 150 L420 250 L250 250 L250 420 L150 420 Z " +
      "M850 150 L850 420 L750 420 L750 250 L580 250 L580 150 Z " +
      "M150 850 L150 580 L250 580 L250 750 L420 750 L420 850 Z " +
      "M850 850 L580 850 L580 750 L750 750 L750 580 L850 580 Z",
  },
  click: (gd) => {
    const el = gd as HTMLElement;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.();
    }
  },
};

// Download-as-PNG button. A download-arrow-into-tray glyph (not plotly's default
// camera). Drawn in ordinary top-left SVG coords — no `ascent`/`transform`, so
// plotly applies no y-flip and it renders right-side up (unlike the symmetric
// fullscreen glyph above, which sidesteps the flip by being mirror-symmetric).
const downloadButton: Plotly.ModeBarButton = {
  name: "download",
  title: "Download as PNG",
  icon: {
    width: 1000,
    height: 1000,
    path:
      // downward arrow (shaft + head)
      "M455 170 H545 V470 H650 L500 700 L350 470 H455 Z " +
      // open tray it drops into
      "M300 760 H368 V820 H632 V760 H700 V880 H300 Z",
  },
  click: (gd) => {
    // downloadImage takes explicit pixel dimensions (no `scale`); render at 2×
    // the plot's current size for a crisp export.
    const el = gd as HTMLElement;
    void Plotly.downloadImage(el, {
      format: "png",
      filename: "hammock-plot",
      width: (el.offsetWidth || 1000) * 2,
      height: (el.offsetHeight || 700) * 2,
    });
  },
};

// Zoom (navigate) | fullscreen + download (view / export). The group split puts
// a divider between the two intents. Pan/select/lasso/autoscale/reset/logo are
// all omitted. Modebar is pinned always-visible and restyled in styles.css to
// integrate with the white plot surface.
const CONFIG: Partial<Plotly.Config> = {
  scrollZoom: true,
  responsive: true,
  displaylogo: false,
  displayModeBar: true,
  modeBarButtons: [
    ["zoomIn2d", "zoomOut2d"],
    [fullscreenButton, downloadButton],
  ],
};

export default function HammockPlot({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { data, layout } = sceneToTraces(scene);
    void Plotly.react(el, data, layout, CONFIG);
  }, [scene]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fullscreen toggling resizes the graph div but doesn't fire a window
    // resize, so plotly's responsive handler misses it — resize explicitly.
    const onFullscreenChange = () => void Plotly.Plots.resize(el);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      Plotly.purge(el);
    };
  }, []);

  // Right-click drag to pan. `dragmode` only governs the left button (and we
  // leave it off), so we shift the axis ranges ourselves: on right-mousedown we
  // snapshot the live ranges + pixel extents from plotly's computed layout, then
  // translate them by the cursor delta (converted data-per-pixel) on each move.
  // Both axes move together so the locked 1:1 aspect stays consistent.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let xr0: [number, number] | null = null;
    let yr0: [number, number] | null = null;
    let xPerPix = 0;
    let yPerPix = 0;
    let startX = 0;
    let startY = 0;

    const liveAxes = () => {
      // _fullLayout/_length are plotly internals, but they're the only source of
      // the *post-constraint* ranges (scaleanchor rewrites the configured range)
      // and the plot-area pixel extent needed to convert a drag into data units.
      const fl = (el as unknown as { _fullLayout?: PlotlyAxes })._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!xa?.range || !ya?.range || !xa._length || !ya._length) return null;
      return { xa, ya };
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return; // right button only
      const axes = liveAxes();
      if (!axes) return;
      const { xa, ya } = axes;
      xr0 = [xa.range[0], xa.range[1]];
      yr0 = [ya.range[0], ya.range[1]];
      xPerPix = (xr0[1] - xr0[0]) / xa._length;
      yPerPix = (yr0[1] - yr0[0]) / ya._length;
      startX = e.clientX;
      startY = e.clientY;
      el.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!xr0 || !yr0) return;
      const dx = (e.clientX - startX) * xPerPix;
      // Screen-y grows downward while the y-range grows upward, so a downward
      // drag (positive pixel delta) shifts the range up — note the sign flip.
      const dy = (e.clientY - startY) * yPerPix;
      void Plotly.relayout(el, {
        "xaxis.range": [xr0[0] - dx, xr0[1] - dx],
        "yaxis.range": [yr0[0] + dy, yr0[1] + dy],
      });
    };

    const endPan = () => {
      if (!xr0) return;
      xr0 = null;
      yr0 = null;
      el.style.cursor = "";
    };

    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("mousedown", onMouseDown);
    // Move/up on window so a drag that leaves the plot still tracks and releases.
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endPan);
    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endPan);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ width: "100%", height: "100%", background: "white" }}
    />
  );
}

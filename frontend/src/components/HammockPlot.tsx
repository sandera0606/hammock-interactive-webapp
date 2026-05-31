// Thin React wrapper over plotly.js-dist-min (no react-plotly.js — avoids its
// React-19 peer friction). Renders a Scene via Plotly.react, which diffs
// efficiently on re-render and keeps zoom/pan state across scene updates.
import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

import type { Scene } from "../lib/scene";
import { sceneToTraces } from "../lib/sceneToTraces";

const CONFIG: Partial<Plotly.Config> = {
  scrollZoom: true,
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
  toImageButtonOptions: { format: "png", filename: "hammock-plot", scale: 2 },
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
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

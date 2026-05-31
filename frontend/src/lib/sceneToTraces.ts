// Scene-Graph -> plotly.js traces + layout.
//
// Each mark becomes one plotly scatter, emitted in z order (the backend already
// sorts marks by z, so array order is draw order). Hoverable marks get their
// own trace with hoveron:'fills' + a hovertemplate; non-hover marks skip hover.
// Coordinates are raw library data-coords, so the layout just sets the axis
// ranges to the scene's coordinateSystem — no client-side geometry math.

import type { Data, Layout, Annotations, Shape } from "plotly.js";
import type { Hover, Label, Mark, Scene } from "./scene";

function hoverText(h: Hover): string {
  if (h.kind === "box") {
    const parts = [`<b>${h.axis}</b>`];
    if (h.median !== undefined) parts.push(`median: ${h.median}`);
    parts.push(`Q1–Q3: ${h.q1} – ${h.q3}`);
    return parts.join("<br>");
  }
  return h.text;
}

function polygonTrace(
  xs: number[],
  ys: number[],
  fill: string,
  alpha: number,
  hover: Hover | undefined,
  filled: boolean,
  line: { width: number; color: string },
): Partial<Data> {
  const trace: Record<string, unknown> = {
    type: "scatter",
    mode: "lines",
    x: [...xs, xs[0]],
    y: [...ys, ys[0]],
    fill: filled ? "toself" : "none",
    fillcolor: fill,
    opacity: alpha,
    line,
    showlegend: false,
  };
  if (hover) {
    trace.hoveron = "fills";
    trace.text = hoverText(hover);
    trace.hovertemplate = "%{text}<extra></extra>";
    trace.hoverlabel = { bgcolor: "#222", font: { color: "#fff" } };
  } else {
    trace.hoverinfo = "skip";
  }
  return trace as Partial<Data>;
}

function markToTrace(m: Mark): Partial<Data> {
  switch (m.type) {
    case "polygon": {
      const xs = m.vertices.map((v) => v[0]);
      const ys = m.vertices.map((v) => v[1]);
      return polygonTrace(xs, ys, m.fill, m.alpha, m.hover, true, {
        width: 0.4,
        color: m.fill,
      });
    }
    case "rect": {
      const xs = [m.x0, m.x1, m.x1, m.x0];
      const ys = [m.y0, m.y0, m.y1, m.y1];
      return polygonTrace(
        xs,
        ys,
        m.face ?? "rgba(0,0,0,0)",
        1,
        m.hover,
        m.face !== null,
        { width: m.lw, color: m.edge },
      );
    }
    case "line":
      return {
        type: "scatter",
        mode: "lines",
        x: m.x,
        y: m.y,
        line: { width: m.lw, color: m.color },
        hoverinfo: "skip",
        showlegend: false,
      } as Partial<Data>;
    case "marker":
      return {
        type: "scatter",
        mode: "markers",
        x: m.x,
        y: m.y,
        marker: { size: m.size, color: m.color },
        hoverinfo: "skip",
        showlegend: false,
      } as Partial<Data>;
  }
}

const HA_TO_XANCHOR: Record<string, Annotations["xanchor"]> = {
  left: "left",
  center: "center",
  right: "right",
};
const VA_TO_YANCHOR: Record<string, Annotations["yanchor"]> = {
  top: "top",
  center: "middle",
  middle: "middle",
  bottom: "bottom",
  baseline: "bottom",
};

function labelAnnotation(l: Label): Partial<Annotations> {
  return {
    x: l.x,
    y: l.y,
    text: l.text,
    showarrow: false,
    font: { size: l.size, color: l.color },
    xanchor: HA_TO_XANCHOR[l.ha] ?? "center",
    yanchor: VA_TO_YANCHOR[l.va] ?? "middle",
    textangle: String(-l.rot),
  };
}

export interface PlotlyFigure {
  data: Data[];
  layout: Partial<Layout>;
}

export function sceneToTraces(scene: Scene): PlotlyFigure {
  const data = scene.marks.map(markToTrace) as Data[];

  const annotations: Partial<Annotations>[] = scene.labels.map(labelAnnotation);
  const shapes: Partial<Shape>[] = [];
  const [y0] = scene.coordinateSystem.yRange;

  // Axis names at the bottom of each unibar's x position.
  for (const ax of scene.axes) {
    annotations.push({
      x: ax.x,
      y: y0,
      text: `<b>${ax.name}</b>`,
      showarrow: false,
      yanchor: "top",
      font: { size: 14, color: "#222" },
    });
  }

  const layout: Partial<Layout> = {
    xaxis: {
      range: scene.coordinateSystem.xRange,
      visible: false,
      zeroline: false,
    },
    yaxis: {
      range: scene.coordinateSystem.yRange,
      visible: false,
      zeroline: false,
      // The library lays out connectors (shapes.py Rectangle) by rotating the
      // bar-width vector in *raw data coords*, assuming 1 x-unit and 1 y-unit
      // render at the same pixel scale — which holds in matplotlib because it
      // sets xlim=scale·W over W inches and ylim=scale·H over H inches (equal
      // data-units/inch on both axes). Plotly otherwise stretches x and y
      // independently to fill the div, shearing diagonal connectors into
      // parallelograms. Lock a 1:1 data aspect so rectangles stay rectangles.
      scaleanchor: "x",
      scaleratio: 1,
    },
    shapes,
    annotations,
    hovermode: "closest",
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    margin: { l: 20, r: 20, t: 24, b: 56 },
    showlegend: false,
  };

  return { data, layout };
}

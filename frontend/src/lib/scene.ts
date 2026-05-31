// Scene-Graph contract — the only thing the frontend knows of hammock_plot.
// Mirrors backend/app/capture/scene_builder.py. Library internals never reach
// the UI except through this shape.

export interface CoordinateSystem {
  xRange: [number, number];
  yRange: [number, number];
  width: number;
  height: number;
}

export interface Axis {
  name: string;
  x: number;
  dtype: "categorical" | "numerical";
  displayType: string;
}

export type Hover =
  | {
      kind: "connector";
      leftAxis: string;
      leftCategory: string;
      rightAxis: string;
      rightCategory: string;
      count: number;
      text: string;
    }
  | { kind: "unibar"; axis: string; category: string; count: number; text: string }
  | { kind: "box"; axis: string; median?: number; q1: number; q3: number };

export interface PolygonMark {
  id: string;
  type: "polygon";
  z: number;
  fill: string;
  alpha: number;
  vertices: [number, number][];
  hover?: Hover;
}

export interface RectMark {
  id: string;
  type: "rect";
  z: number;
  face: string | null;
  edge: string;
  lw: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  hover?: Hover;
}

export interface LineMark {
  id: string;
  type: "line";
  z: number;
  color: string;
  lw: number;
  x: number[];
  y: number[];
}

export interface MarkerMark {
  id: string;
  type: "marker";
  z: number;
  color: string;
  size: number;
  x: number[];
  y: number[];
}

export type Mark = PolygonMark | RectMark | LineMark | MarkerMark;

export interface Label {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  ha: "left" | "center" | "right";
  va: "top" | "middle" | "bottom" | "center" | "bottom" | "baseline";
  rot: number;
}

export interface Scene {
  version: number;
  hammockPin: { sha: string; short: string } | null;
  coordinateSystem: CoordinateSystem;
  axes: Axis[];
  marks: Mark[];
  labels: Label[];
  warnings: string[];
  meta: { shape: string; weighted: boolean; highlighted: boolean };
}

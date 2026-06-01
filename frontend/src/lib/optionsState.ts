// The GUI form model (`UiState`) and per-variable settings. This holds raw,
// human-facing control values (percent sliders in 0..100, per-variable choices).
// `optionsToRequest.ts` translates it into the backend `PlotOptions`.
//
// Control set + semantics mirror the Streamlit app (hammock_settings.py); the
// layout/UX does not (see plan). Defaults mirror utils.Defaults.

import { DEFAULTS, PRESET_OVERRIDES, type Preset } from "./defaults";

export type { Preset };
export type Shape = "rectangle" | "parallelogram";
export type HiBox = "side-by-side" | "stacked";
export type HiType = "labels" | "expression";
export type BwMethod = "scott" | "silverman" | "custom";

// Display types, partitioned by column dtype. These are the exact strings the
// vendored library validates against (main.py: numerical=["box","violin","rug"],
// categorical=["bar","stacked_bar"] as of pin deae4c2). They match the Streamlit
// app's labels. Wrong strings make /api/plot 422 — keep in sync on a pin bump.
export const NUMERIC_DISPLAY = ["box", "violin", "rug"] as const;
export const CATEGORICAL_DISPLAY = ["stacked_bar", "bar"] as const;

export interface ColumnMeta {
  name: string;
  dtype: "numeric" | "categorical";
  uniqueValues: string[];
  weightCandidate: boolean;
}

export type DataSource = "sample" | "upload";

export interface Dataset {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  meta: ColumnMeta[];
  source: DataSource;
  edited?: boolean; // true once the user has hand-edited the rows
}

/** Per-variable ("unibar") settings. Fields apply per the column's dtype. */
export interface PerUnibar {
  displayType: string; // box|rug|violin (numeric) or stacked_bar|bar (categorical)
  // numeric-only
  forceCategorical: boolean;
  customLevels: boolean;
  numLevels: number; // -> numerical_var_levels
  // ordering (categorical, or numeric forced-categorical)
  customOrder: boolean;
  valueOrder: string[]; // -> value_order
  // label options
  customLabels: boolean;
  basicLabels: boolean;
  labelFontsize: number;
  labelColor: string;
  labelCustomRaw: string; // advanced: a JSON object literal
}

export interface UiState {
  preset: Preset;
  var: string[]; // selected variables, in axis order
  missing: boolean;

  // appearance / general
  height: number;
  width: number;
  widthTouched: boolean; // once the user edits width, stop auto-deriving it
  minBarHeight: number;
  defaultColor: string;
  alpha: number; // 0..100
  label: boolean;
  unibar: boolean;
  missingPlaceholder: string;
  uniVfill: number; // 0..100
  uniHfill: number; // 0..100
  connectorFraction: number; // 0..100
  shape: Shape;
  customConnectorColor: boolean;
  connectorColor: string;

  // highlighting
  highlight: boolean;
  hiVar: string;
  hiType: HiType;
  hiBox: HiBox;
  hiValues: string[]; // labels mode
  hiExpression: string; // expression mode
  hiMissing: boolean;
  hiColors: string[];

  // weights
  useWeights: boolean;
  weights: string;

  // unibar-specific
  sameScale: string[];
  bwMethod: BwMethod;
  bwCustom: number;
  perUnibar: Record<string, PerUnibar>;
}

/** Initial per-variable settings, matching the Streamlit defaults
 *  (hammock_settings.py:166-173, display_unibar_specific_settings). */
export function defaultPerUnibar(meta: ColumnMeta): PerUnibar {
  const isNumeric = meta.dtype === "numeric";
  // numeric columns whose only values are 0/1 default to categorical with a 0,1 order
  const isBinary01 =
    isNumeric &&
    meta.uniqueValues.length > 0 &&
    meta.uniqueValues.every((v) => v === "0" || v === "1");
  return {
    displayType: isNumeric ? "box" : "stacked_bar",
    forceCategorical: isBinary01,
    customLevels: false,
    numLevels: 7,
    customOrder: false,
    valueOrder: isBinary01 ? ["0", "1"] : [],
    customLabels: false,
    basicLabels: true,
    labelFontsize: 20,
    labelColor: "#000000",
    labelCustomRaw: "",
  };
}

export function initialUiState(): UiState {
  return {
    preset: "hammock",
    var: [],
    missing: false,
    height: DEFAULTS.HEIGHT,
    width: DEFAULTS.WIDTH,
    widthTouched: false,
    minBarHeight: DEFAULTS.MIN_BAR_HEIGHT,
    defaultColor: DEFAULTS.DEFAULT_COLOR,
    alpha: DEFAULTS.ALPHA,
    label: true,
    unibar: true,
    missingPlaceholder: "missing",
    uniVfill: DEFAULTS.UNI_VFILL,
    uniHfill: DEFAULTS.UNI_HFILL,
    connectorFraction: DEFAULTS.CONNECTOR_FRACTION,
    shape: "rectangle",
    customConnectorColor: false,
    connectorColor: DEFAULTS.DEFAULT_COLOR,
    highlight: false,
    hiVar: "",
    hiType: "labels",
    hiBox: "side-by-side",
    hiValues: [],
    hiExpression: "",
    hiMissing: false,
    hiColors: [...DEFAULTS.HI_COLORS],
    useWeights: false,
    weights: "",
    sameScale: [],
    bwMethod: "scott",
    bwCustom: 0.5,
    perUnibar: {},
  };
}

/** Apply a preset's field overrides (utils.set_default_settings / set_snapshot_settings). */
export function applyPreset(state: UiState, preset: Preset): UiState {
  return { ...state, preset, ...PRESET_OVERRIDES[preset] };
}

/** Reconcile a UiState against freshly inferred column metadata after the user
 *  hand-edits the data. Edits can drop columns, flip a column's dtype, or change
 *  its unique values — any of which could make the current options invalid (and
 *  /api/plot 422). This prunes/repairs the affected fields so the plot keeps
 *  working without silently producing a wrong picture. */
export function reconcileUiToMeta(
  state: UiState,
  metaByName: Record<string, ColumnMeta>,
): UiState {
  const has = (c: string) => !!metaByName[c];
  const next: UiState = { ...state };

  // selected vars: keep only columns that still exist
  next.var = state.var.filter(has);

  // per-variable settings: reseed when a column's dtype no longer matches the
  // chosen display type (a numeric->categorical flip, or vice versa); otherwise
  // just prune value orders to the surviving unique values.
  const perUnibar: Record<string, PerUnibar> = {};
  for (const v of next.var) {
    const meta = metaByName[v];
    const cur = state.perUnibar[v];
    const allowed = meta.dtype === "numeric" ? NUMERIC_DISPLAY : CATEGORICAL_DISPLAY;
    if (!cur || !(allowed as readonly string[]).includes(cur.displayType)) {
      perUnibar[v] = defaultPerUnibar(meta);
      continue;
    }
    const valueOrder = cur.valueOrder.filter((x) => meta.uniqueValues.includes(x));
    perUnibar[v] = {
      ...cur,
      valueOrder,
      customOrder: cur.customOrder && valueOrder.length > 0,
    };
  }
  next.perUnibar = perUnibar;

  // same-scale group: numeric, still-selected columns only
  next.sameScale = state.sameScale.filter(
    (c) => next.var.includes(c) && metaByName[c]?.dtype === "numeric",
  );

  // weights: must still be a valid weight candidate column
  if (state.useWeights && (!has(state.weights) || !metaByName[state.weights].weightCandidate)) {
    next.useWeights = false;
    next.weights = "";
  }

  // highlight: variable must survive; its label list pruned to surviving values
  if (state.highlight) {
    if (!has(state.hiVar)) {
      next.highlight = false;
      next.hiVar = "";
      next.hiValues = [];
    } else {
      next.hiValues = state.hiValues.filter((x) =>
        metaByName[state.hiVar].uniqueValues.includes(x),
      );
    }
  }

  return next;
}

/** Ensure every selected var has a PerUnibar entry (seeded from its column meta). */
export function ensurePerUnibar(state: UiState, metaByName: Record<string, ColumnMeta>): UiState {
  const perUnibar = { ...state.perUnibar };
  let changed = false;
  for (const v of state.var) {
    if (!perUnibar[v] && metaByName[v]) {
      perUnibar[v] = defaultPerUnibar(metaByName[v]);
      changed = true;
    }
  }
  return changed ? { ...state, perUnibar } : state;
}

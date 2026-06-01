// optionsToRequest — the analog of `utils.plot(...)` (hammock_settings.run_plot):
// translate the GUI's `UiState` into the backend `PlotOptions`. This is where the
// /100 conversions happen and where fields are omitted when their feature is off,
// exactly mirroring the Streamlit app's call so the two front-ends agree.

import { DEFAULTS } from "./defaults";
import type { ColumnMeta, PerUnibar, UiState } from "./optionsState";
import type { PlotOptions } from "./api";

/** Number of highlight colours the plot needs, mirroring hammock_settings.py:249. */
export function highlightColorCount(ui: UiState): number {
  const base = ui.hiType === "labels" ? ui.hiValues.length : 1;
  return base + (ui.hiMissing ? 1 : 0);
}

/** A colours array of the needed length, padded from the default palette. */
function highlightColors(ui: UiState): string[] {
  const n = highlightColorCount(ui);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      ui.hiColors[i] ?? DEFAULTS.HI_COLORS[i] ?? DEFAULTS.FALLBACK_HI_COLOR,
    );
  }
  return out;
}

/** Parse the advanced label-options text (a JSON object). Returns null if invalid. */
function parseLabelOptions(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function labelOptionsFor(p: PerUnibar): Record<string, unknown> | null {
  if (!p.customLabels) return null;
  if (p.basicLabels) return { fontsize: p.labelFontsize, color: p.labelColor };
  return parseLabelOptions(p.labelCustomRaw);
}

export function uiToPlotOptions(
  ui: UiState,
  metaByName: Record<string, ColumnMeta>,
): PlotOptions {
  const displayType: Record<string, string> = {};
  const valueOrder: Record<string, string[]> = {};
  const numericalVarLevels: Record<string, number> = {};
  const labelOptions: Record<string, unknown> = {};

  for (const v of ui.var) {
    const p = ui.perUnibar[v];
    const meta = metaByName[v];
    if (!p || !meta) continue;

    displayType[v] = p.displayType;

    // value_order: explicit custom order, or a forced-categorical numeric column
    // (which orders by the column's formatted unique values) — matches
    // hammock_settings.display_unibar_specific_settings.
    if (p.customOrder && p.valueOrder.length) {
      valueOrder[v] = p.valueOrder;
    } else if (p.forceCategorical) {
      valueOrder[v] = p.valueOrder.length ? p.valueOrder : meta.uniqueValues;
    }

    if (meta.dtype === "numeric" && !p.forceCategorical && p.customLevels) {
      numericalVarLevels[v] = p.numLevels;
    }

    const lo = labelOptionsFor(p);
    if (lo) labelOptions[v] = lo;
  }

  // uni_hfill collapses to 0 when neither labels nor unibars are shown
  // (hammock_settings.py:290-291).
  const uniHfill = !ui.label && !ui.unibar ? 0 : ui.uniHfill / 100;

  const opts: PlotOptions = {
    var: ui.var,
    missing: ui.missing,
    label: ui.label,
    unibar: ui.unibar,
    default_color: ui.defaultColor,
    uni_vfill: ui.uniVfill / 100,
    connector_fraction: ui.connectorFraction / 100,
    uni_hfill: uniHfill,
    alpha: ui.alpha / 100,
    height: ui.height,
    width: ui.width,
    min_bar_height: ui.minBarHeight,
    shape: ui.shape,
    same_scale: ui.sameScale,
    violin_bw_method: ui.bwMethod === "custom" ? ui.bwCustom : ui.bwMethod,
    // highlighting is off by default; hi_missing must be false when off
    hi_missing: false,
  };

  if (Object.keys(displayType).length) opts.display_type = displayType;
  if (Object.keys(valueOrder).length) opts.value_order = valueOrder;
  if (Object.keys(numericalVarLevels).length) opts.numerical_var_levels = numericalVarLevels;
  if (Object.keys(labelOptions).length) opts.label_options = labelOptions;

  if (ui.missing) opts.missing_placeholder = ui.missingPlaceholder;
  if (ui.useWeights && ui.weights) opts.weights = ui.weights;
  if (ui.customConnectorColor) opts.connector_color = ui.connectorColor;

  if (ui.highlight && ui.hiVar) {
    opts.hi_var = ui.hiVar;
    opts.hi_value = ui.hiType === "labels" ? ui.hiValues : ui.hiExpression;
    opts.hi_box = ui.hiBox;
    opts.hi_missing = ui.missing ? ui.hiMissing : false;
    opts.colors = highlightColors(ui);
  }

  return opts;
}

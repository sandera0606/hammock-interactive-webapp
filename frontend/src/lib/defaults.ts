// Defaults + presets, mirroring the Streamlit source-of-truth
// (../hammock-plot-webapp/utils.py `Defaults`, `set_default_settings`,
// `set_snapshot_settings`). Slider-style values (vfill/hfill/connector/alpha)
// are kept here in the GUI's 0..100 space; optionsToRequest.ts does the /100.

export const DEFAULTS = {
  HEIGHT: 10,
  WIDTH: 15,
  UNI_VFILL: 8, // %
  UNI_HFILL: 30, // %
  CONNECTOR_FRACTION: 100, // %
  ALPHA: 70, // %
  MIN_BAR_HEIGHT: 0.15,
  DEFAULT_COLOR: "#beaed4",
  HI_COLORS: ["#fdc086", "#386cb0", "#7fc97f", "#f0027f"],
  FALLBACK_HI_COLOR: "#00ff00",
} as const;

export type Preset = "hammock" | "snapshot";

// Preset deltas: the fields each preset overrides (utils.set_*_settings).
// "hammock" is the baseline; "snapshot" = unibars only (no connectors).
export const PRESET_OVERRIDES: Record<Preset, { uniVfill: number; uniHfill: number; connectorFraction: number }> = {
  hammock: { uniVfill: 8, uniHfill: 30, connectorFraction: 100 },
  snapshot: { uniVfill: 95, uniHfill: 85, connectorFraction: 0 },
};

// width = max(15, nvar * 4/3) — the Streamlit app's default width heuristic
// (hammock_settings.py:144). Used as the *default* width when the user hasn't
// overridden it.
export function defaultWidth(nVar: number): number {
  return Math.max(DEFAULTS.WIDTH, (nVar * 4) / 3);
}

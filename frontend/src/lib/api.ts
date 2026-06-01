// Thin API client. Same-origin in production; Vite proxies /api -> :8000 in dev.
import type { Scene } from "./scene";
import type { ColumnMeta } from "./optionsState";

export type Row = Record<string, unknown>;

// Full PlotOptions, matching backend/app/schemas.py `PlotOptions` (the
// Hammock.plot(...) contract). All but `var` are optional; omitted fields fall
// back to the library defaults (the backend prunes None/undefined).
export interface PlotOptions {
  var: string[];
  weights?: string;
  value_order?: Record<string, string[]>;
  numerical_var_levels?: Record<string, number>;
  display_type?: Record<string, string>;
  missing?: boolean;
  missing_placeholder?: string;
  label?: boolean;
  unibar?: boolean;

  hi_var?: string;
  hi_value?: string[] | string;
  hi_box?: string;
  hi_missing?: boolean;
  colors?: string[];
  default_color?: string;
  connector_color?: string;

  uni_vfill?: number;
  connector_fraction?: number;
  uni_hfill?: number;
  label_options?: Record<string, unknown>;
  height?: number;
  width?: number;
  min_bar_height?: number;
  alpha?: number;

  shape?: string;
  same_scale?: string[];
  violin_bw_method?: number | string;
}

export interface SampleInfo {
  name: string;
  label: string;
}

export interface DatasetPayload {
  name: string;
  label?: string;
  columns: string[];
  data: Row[];
  meta: ColumnMeta[];
  defaults?: PlotOptions;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = (await r.json()) as { detail?: unknown };
      if (errBody.detail) detail = String(errBody.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await r.json()) as T;
}

export const listSamples = () => getJson<SampleInfo[]>("/api/samples");
export const getSample = (name: string) => getJson<DatasetPayload>(`/api/samples/${name}`);

/** Parse a CSV (read client-side) into rows + column metadata. */
export const uploadCsv = (content: string, filename?: string) =>
  postJson<DatasetPayload>("/api/data/upload", { content, filename });

/** Whether a highlight expression is a valid regex / numeric range. */
export const validateExpression = (expr: string, signal?: AbortSignal) =>
  postJson<{ valid: boolean }>("/api/validate-expression", { expr }, signal);

export function fetchScene(
  data: Row[],
  options: PlotOptions,
  signal?: AbortSignal,
): Promise<Scene> {
  return postJson<Scene>("/api/plot", { data, options }, signal);
}

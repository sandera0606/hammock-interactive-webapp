// Thin API client. Same-origin in production; Vite proxies /api -> :8000 in dev.
import type { Scene } from "./scene";

export type Row = Record<string, unknown>;

export interface PlotOptions {
  var: string[];
  weights?: string;
  display_type?: Record<string, string>;
  hi_var?: string;
  hi_value?: unknown;
  [key: string]: unknown;
}

export interface SampleInfo {
  name: string;
  label: string;
}

export interface SampleData {
  name: string;
  label: string;
  columns: string[];
  data: Row[];
  defaults: PlotOptions;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const listSamples = () => getJson<SampleInfo[]>("/api/samples");
export const getSample = (name: string) => getJson<SampleData>(`/api/samples/${name}`);

export async function fetchScene(
  data: Row[],
  options: PlotOptions,
  signal?: AbortSignal,
): Promise<Scene> {
  const r = await fetch("/api/plot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, options }),
    signal,
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const body = (await r.json()) as { detail?: unknown };
      if (body.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await r.json()) as Scene;
}

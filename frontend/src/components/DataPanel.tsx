// Data source: pick a bundled sample or upload a CSV (read client-side, parsed
// by the backend into rows + column metadata). The big dropzone is a first-run
// call-to-action only — once a dataset is loaded it collapses into the active
// dataset card, where "Replace" sits quietly next to "Edit data" (and the card
// itself accepts a dropped CSV).
import { useRef, useState } from "react";

import type { Dataset } from "../lib/optionsState";
import type { SampleInfo } from "../lib/api";

const PREVIEW_ROWS = 5;

export default function DataPanel({
  samples,
  dataset,
  activeSample,
  onPickSample,
  onUploadText,
  onEditData,
  busy,
}: {
  samples: SampleInfo[];
  dataset: Dataset | null;
  activeSample: string | null;
  onPickSample: (name: string) => void;
  onUploadText: (content: string, filename: string) => void;
  onEditData: () => void;
  busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onUploadText(String(reader.result ?? ""), file.name);
    reader.readAsText(file);
  };
  const browse = () => fileRef.current?.click();

  return (
    <div className="data-source">
      {/* one hidden input, shared by the dropzone and the card's Replace button */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />

      <div className="ds-pickers">
        <div className="ds-group">
          <span className="ds-group-label">Sample data</span>
          <div className="sample-row">
            {samples.map((s) => (
              <button
                key={s.name}
                className={"btn sm" + (activeSample === s.name ? " primary" : "")}
                onClick={() => onPickSample(s.name)}
                disabled={busy}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* The prominent dropzone is shown only before any data is loaded. */}
        {!dataset && (
          <>
            <div className="ds-or">or</div>
            <div className="ds-group">
              <span className="ds-group-label upload">
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                  />
                </svg>
                Your own data
              </span>
              <div
              className={"dropzone" + (over ? " over" : "")}
              role="button"
              tabIndex={0}
              onClick={browse}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") browse();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) readFile(f);
              }}
            >
              <svg className="dz-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                />
              </svg>
              <span className="big">Drop a CSV here</span>
              <span className="small">or click to browse</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Active dataset: the prominent "this is what's loaded" status. Keyed so
          it re-mounts (replaying the highlight pulse) whenever the active set
          changes or is first edited. Drop a CSV onto it to replace. */}
      {dataset && (
        <div
          className={"active-dataset" + (over ? " over" : "")}
          key={dataset.name + (dataset.edited ? "·edited" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
          }}
        >
          <div className="ad-head">
            <span className={"ad-badge " + dataset.source}>
              {dataset.source === "sample" ? "Sample" : "Uploaded"}
            </span>
            {dataset.edited && <span className="ad-badge edited">Edited</span>}
            <span className="ad-name" title={dataset.name}>
              {dataset.name}
            </span>
          </div>
          <div className="ad-meta">
            <span className="ad-count">{dataset.rows.length.toLocaleString()} rows</span>
            <span className="ad-dot">·</span>
            <span className="ad-count">{dataset.columns.length} columns</span>
          </div>

          <div className="ad-actions">
            <button className="btn" onClick={onEditData} disabled={busy}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3"
                />
              </svg>
              Edit data
            </button>
            <button
              className="btn accent"
              onClick={browse}
              disabled={busy}
              title="Replace with another CSV (or drop one here)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                />
              </svg>
              Replace
            </button>
          </div>

          <div className="preview-wrap">
            <table className="preview">
              <thead>
                <tr>
                  {dataset.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  <tr key={i}>
                    {dataset.columns.map((c) => (
                      <td key={c}>{formatCell(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {dataset.rows.length > PREVIEW_ROWS && (
              <div className="preview-more">
                +{(dataset.rows.length - PREVIEW_ROWS).toLocaleString()} more rows ·{" "}
                <button className="linklike" onClick={onEditData} disabled={busy}>
                  open editor
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "·";
  return String(v);
}

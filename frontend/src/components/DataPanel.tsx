// Data source: pick a bundled sample or upload a CSV (read client-side, parsed
// by the backend into rows + column metadata), plus a compact preview table.
import { useRef, useState } from "react";

import type { Dataset } from "../lib/optionsState";
import type { SampleInfo } from "../lib/api";

const PREVIEW_ROWS = 6;

export default function DataPanel({
  samples,
  dataset,
  activeSample,
  onPickSample,
  onUploadText,
  busy,
}: {
  samples: SampleInfo[];
  dataset: Dataset | null;
  activeSample: string | null;
  onPickSample: (name: string) => void;
  onUploadText: (content: string, filename: string) => void;
  busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onUploadText(String(reader.result ?? ""), file.name);
    reader.readAsText(file);
  };

  return (
    <div className="data-source">
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

      <div
        className={"dropzone" + (over ? " over" : "")}
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
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
        <span className="big">Drop a CSV here</span>
        <span className="small">or click to browse · parsed locally + on the server</span>
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
      </div>

      {dataset && (
        <>
          <div className="dataset-tag">
            <span className="name">{dataset.name}</span>
            <span className="rows">
              {dataset.rows.length} rows · {dataset.columns.length} cols
            </span>
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
          </div>
        </>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "·";
  return String(v);
}

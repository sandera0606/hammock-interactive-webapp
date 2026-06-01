// Full-screen data editor modal. Edits a working copy of the dataset's rows —
// inline cell edits, find & replace within a column, add/delete rows, delete
// columns — and commits them via onApply (which re-infers dtypes server-side).
// Cancel/Escape/backdrop discard the working copy, so every op is reversible
// until Apply.
import { useEffect, useMemo, useRef, useState } from "react";

import type { Dataset } from "../lib/optionsState";
import type { Row } from "../lib/api";

// Cell editing renders one <td> per cell; cap the live DOM for big uploads.
// Find/replace and row/column ops still apply to the full dataset.
const MAX_EDIT_ROWS = 500;
const DISTINCT_CAP = 60; // values offered in the find-value datalist

type Cell = { r: number; c: string };

export default function DataEditor({
  dataset,
  busy,
  onApply,
  onClose,
}: {
  dataset: Dataset;
  busy: boolean;
  onApply: (rows: Row[], columns: string[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => dataset.rows.map((r) => ({ ...r })));
  const [columns, setColumns] = useState<string[]>(() => [...dataset.columns]);
  const [dirty, setDirty] = useState(false);

  const [editing, setEditing] = useState<Cell | null>(null);
  const [draft, setDraft] = useState("");

  // find & replace form
  const [frCol, setFrCol] = useState<string>(dataset.columns[0] ?? "");
  const [frFind, setFrFind] = useState("");
  const [frReplace, setFrReplace] = useState("");
  const [frWhole, setFrWhole] = useState(true); // match entire cell vs substring
  const [frCase, setFrCase] = useState(false); // case-insensitive
  const [frMsg, setFrMsg] = useState("");

  // keep the find column valid if its column is deleted
  useEffect(() => {
    if (!columns.includes(frCol)) setFrCol(columns[0] ?? "");
  }, [columns, frCol]);

  // Escape closes (guarding unsaved edits); lock body scroll while open.
  const close = () => {
    if (dirty && !window.confirm("Discard your edits to the data?")) return;
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const norm = (s: string) => (frCase ? s.toLowerCase() : s);
  const asStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));

  // does a cell value match the current find form?
  const matches = (v: unknown): boolean => {
    if (frFind === "") return false;
    const s = norm(asStr(v));
    const f = norm(frFind);
    return frWhole ? s === f : s.includes(f);
  };

  const matchCount = useMemo(
    () => rows.reduce((n, row) => n + (matches(row[frCol]) ? 1 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, frCol, frFind, frWhole, frCase],
  );

  const distinct = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      const s = asStr(row[frCol]);
      if (s !== "" && !seen.has(s)) {
        seen.add(s);
        if (seen.size >= DISTINCT_CAP) break;
      }
    }
    return [...seen];
  }, [rows, frCol]);

  const toStored = (s: string): unknown => (s === "" ? null : s);

  const commitCell = () => {
    if (!editing) return;
    const { r, c } = editing;
    setRows((rs) => rs.map((row, i) => (i === r ? { ...row, [c]: toStored(draft) } : row)));
    setDirty(true);
    setEditing(null);
  };

  const deleteRow = (r: number) => {
    setRows((rs) => rs.filter((_, i) => i !== r));
    setDirty(true);
    if (editing?.r === r) setEditing(null);
  };

  const addRow = () => {
    setRows((rs) => [...rs, Object.fromEntries(columns.map((c) => [c, null]))]);
    setDirty(true);
  };

  const deleteColumn = (c: string) => {
    if (columns.length <= 1) return; // never leave zero columns
    setColumns((cs) => cs.filter((x) => x !== c));
    setRows((rs) =>
      rs.map((row) => {
        const { [c]: _drop, ...rest } = row;
        return rest;
      }),
    );
    setDirty(true);
    if (editing?.c === c) setEditing(null);
  };

  const replaceAll = () => {
    if (frFind === "") return;
    const f = norm(frFind);
    let count = 0;
    setRows((rs) =>
      rs.map((row) => {
        const s = asStr(row[frCol]);
        if (frWhole) {
          if (norm(s) === f) {
            count++;
            return { ...row, [frCol]: toStored(frReplace) };
          }
          return row;
        }
        if (!norm(s).includes(f)) return row;
        count++;
        const replaced = frCase
          ? replaceCaseInsensitive(s, frFind, frReplace)
          : s.split(frFind).join(frReplace);
        return { ...row, [frCol]: toStored(replaced) };
      }),
    );
    if (count > 0) setDirty(true);
    setFrMsg(
      count === 0
        ? "No matching cells"
        : `Replaced ${count} cell${count === 1 ? "" : "s"} in "${frCol}"`,
    );
  };

  const apply = () => onApply(rows, columns);

  const shownRows = Math.min(rows.length, MAX_EDIT_ROWS);
  const canApply = dirty && rows.length > 0 && columns.length > 0 && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="data-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Edit data"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="de-head">
          <div className="de-title">
            <span className="de-title-main">Edit data</span>
            <span className="de-title-sub">{dataset.name}</span>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close editor" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        </header>

        <div className="de-toolbar">
          <div className="fr">
            <span className="fr-label">Find &amp; replace in</span>
            <select
              className="select sm"
              value={frCol}
              onChange={(e) => {
                setFrCol(e.target.value);
                setFrMsg("");
              }}
            >
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="input sm"
              list="fr-distinct"
              placeholder="find value"
              value={frFind}
              onChange={(e) => {
                setFrFind(e.target.value);
                setFrMsg("");
              }}
            />
            <datalist id="fr-distinct">
              {distinct.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <span className="fr-arrow" aria-hidden="true">
              →
            </span>
            <input
              className="input sm"
              placeholder="replace with"
              value={frReplace}
              onChange={(e) => setFrReplace(e.target.value)}
            />
            <button
              className="btn sm primary"
              onClick={replaceAll}
              disabled={frFind === "" || matchCount === 0}
              title={frFind === "" ? "Type a value to find" : `${matchCount} match(es)`}
            >
              Replace all
            </button>
            <span className="fr-status">
              {frMsg || (frFind !== "" ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "")}
            </span>
          </div>
          <div className="fr-opts">
            <label className="mini-check">
              <input
                type="checkbox"
                checked={frWhole}
                onChange={(e) => setFrWhole(e.target.checked)}
              />
              Whole cell
            </label>
            <label className="mini-check">
              <input
                type="checkbox"
                checked={frCase}
                onChange={(e) => setFrCase(e.target.checked)}
              />
              Ignore case
            </label>
          </div>
        </div>

        <div className="de-grid-wrap">
          <table className="de-grid">
            <thead>
              <tr>
                <th className="de-rownum" />
                {columns.map((c) => (
                  <th key={c}>
                    <span className="de-colname" title={c}>
                      {c}
                    </span>
                    <button
                      className="de-coldel"
                      title={`Delete column "${c}"`}
                      aria-label={`Delete column ${c}`}
                      onClick={() => deleteColumn(c)}
                      disabled={columns.length <= 1}
                    >
                      ×
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shownRows).map((row, r) => (
                <tr key={r}>
                  <th className="de-rownum">
                    <span className="de-rn">{r + 1}</span>
                    <button
                      className="de-rowdel"
                      title="Delete row"
                      aria-label={`Delete row ${r + 1}`}
                      onClick={() => deleteRow(r)}
                    >
                      ×
                    </button>
                  </th>
                  {columns.map((c) => {
                    const isEditing = editing?.r === r && editing?.c === c;
                    return (
                      <td
                        key={c}
                        className={isEditing ? "editing" : undefined}
                        onClick={() => {
                          if (isEditing) return;
                          setEditing({ r, c });
                          setDraft(asStr(row[c]));
                        }}
                      >
                        {isEditing ? (
                          <input
                            className="de-cell-input"
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitCell}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitCell();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditing(null);
                              }
                            }}
                          />
                        ) : (
                          <span className={asStr(row[c]) === "" ? "cell-null" : undefined}>
                            {asStr(row[c]) === "" ? "·" : asStr(row[c])}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_EDIT_ROWS && (
            <div className="de-cap-note">
              Showing first {MAX_EDIT_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows
              for cell editing. Find &amp; replace applies to all rows.
            </div>
          )}
        </div>

        <footer className="de-foot">
          <div className="de-foot-left">
            <button className="btn sm" onClick={addRow}>
              + Add row
            </button>
            <span className="de-foot-stat">
              {rows.length.toLocaleString()} rows · {columns.length} cols
              {dirty && <span className="de-unsaved"> · unsaved</span>}
            </span>
          </div>
          <div className="de-foot-right">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" onClick={apply} disabled={!canApply}>
              {busy ? "Applying…" : "Apply changes"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Replace all case-insensitive occurrences of `find` in `s` with `repl`. */
function replaceCaseInsensitive(s: string, find: string, repl: string): string {
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return s.replace(new RegExp(esc, "gi"), repl);
}

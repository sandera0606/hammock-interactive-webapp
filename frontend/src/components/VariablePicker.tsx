// Variable selection + per-variable ("unibar") settings in context.
//   * column chips (with a dtype glyph) toggle membership in `var`
//   * for wide datasets the chip grid is collapsible + filterable, so a long
//     column list doesn't bury the axes list / settings below it
//   * selected vars show as an ordered axes list (drag the grip to reorder =
//     axis order; Arrow keys reorder for keyboard users)
//   * a gear expands that variable's settings (display type, force-categorical,
//     value order, label options) — mirroring hammock_settings semantics.
import { useState, type ReactNode } from "react";

// Above this many columns, the picker offers a filter box and the grid can be
// collapsed to a one-line summary — keeps wide datasets from flooding the rail.
const FILTER_THRESHOLD = 12;

import { Field, Toggle, NumberField, ColorField } from "./controls";
import {
  CATEGORICAL_DISPLAY,
  NUMERIC_DISPLAY,
  defaultPerUnibar,
  type ColumnMeta,
  type PerUnibar,
  type UiState,
} from "../lib/optionsState";

export default function VariablePicker({
  meta,
  ui,
  setVar,
  patchUnibar,
}: {
  meta: ColumnMeta[];
  ui: UiState;
  setVar: (v: string[]) => void;
  patchUnibar: (name: string, patch: Partial<PerUnibar>) => void;
}) {
  const [openVar, setOpenVar] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const metaByName = Object.fromEntries(meta.map((m) => [m.name, m]));

  const toggle = (name: string) => {
    if (ui.var.includes(name)) setVar(ui.var.filter((v) => v !== name));
    else setVar([...ui.var, name]);
  };
  const drag = useReorder(ui.var, setVar);

  // Filtering / collapse only earns its keep on wide datasets.
  const filterable = meta.length > FILTER_THRESHOLD;
  const q = query.trim().toLowerCase();
  const shown = filterable && q ? meta.filter((m) => m.name.toLowerCase().includes(q)) : meta;

  return (
    <>
      {filterable && (
        <div className="chip-bar">
          <button
            type="button"
            className="chip-collapse"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Show columns" : "Hide columns"}
          >
            <span className="chev" aria-hidden="true">
              ▸
            </span>
            Columns
            <span className="chip-bar-count">
              {ui.var.length}/{meta.length}
            </span>
          </button>
          {!collapsed && (
            <div className="chip-search">
              <input
                type="text"
                value={query}
                placeholder="Filter columns…"
                aria-label="Filter columns by name"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="chip-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && (
        <div className="chip-grid">
          {shown.map((m) => {
            const selected = ui.var.includes(m.name);
            return (
              <button
                key={m.name}
                className={"chip" + (selected ? " selected" : "")}
                onClick={() => toggle(m.name)}
                title={selected ? "Remove from plot" : "Add to plot"}
              >
                <span className={"glyph " + m.dtype}>{m.dtype === "numeric" ? "123" : "Aa"}</span>
                {m.name}
              </button>
            );
          })}
          {shown.length === 0 && (
            <span className="empty-note" style={{ padding: "4px 2px" }}>
              No columns match “{query}”.
            </span>
          )}
        </div>
      )}

      {ui.var.length === 0 && (
        <div className="empty-note" style={{ marginTop: 10 }}>
          Select two or more variables to draw the plot. Their order here is the
          left-to-right axis order.
        </div>
      )}

      {ui.var.length > 0 && (
        <div className="axes">
          {ui.var.map((name, idx) => {
            const m = metaByName[name];
            const p = ui.perUnibar[name];
            if (!m || !p) return null;
            const isOpen = openVar === name;
            return (
              <div
                className={"axis-item" + drag.itemClass(idx)}
                key={name}
                {...drag.itemProps(idx)}
              >
                <div className="axis-row">
                  <GripHandle
                    label={`Reorder ${name}`}
                    position={`${idx + 1} of ${ui.var.length}`}
                    {...drag.handleProps(idx)}
                  />
                  <span className="ord">{idx + 1}</span>
                  <span className="nm">{name}</span>
                  <DisplayTypePicker
                    meta={m}
                    p={p}
                    onChange={(v) => patchUnibar(name, { displayType: v })}
                  />
                  <button
                    className="iconbtn gear"
                    aria-pressed={isOpen}
                    onClick={() => setOpenVar(isOpen ? null : name)}
                    aria-label={`Settings for ${name}`}
                    title="Settings"
                  >
                    ⚙
                  </button>
                  <button
                    className="iconbtn"
                    onClick={() => toggle(name)}
                    aria-label={`Remove ${name}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
                {isOpen && (
                  <div className="axis-settings">
                    <UnibarSettings meta={m} p={p} patch={(patch) => patchUnibar(name, patch)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function effectiveCategorical(m: ColumnMeta, p: PerUnibar): boolean {
  return m.dtype === "categorical" || p.forceCategorical;
}

// Inline display-type picker living on the axis row — a native <select> dressed
// as the pill it replaced (mono, small, chevron). Options track the variable's
// *effective* type; flipping numeric↔categorical stays the gear's job.
// User-facing labels only — the option *values* sent to the backend are unchanged.
function displayTypeLabel(d: string): string {
  if (d === "bar") return "bar chart";
  return d.replace("_", " ");
}

function DisplayTypePicker({
  meta,
  p,
  onChange,
}: {
  meta: ColumnMeta;
  p: PerUnibar;
  onChange: (v: string) => void;
}) {
  const options = effectiveCategorical(meta, p) ? CATEGORICAL_DISPLAY : NUMERIC_DISPLAY;
  return (
    <span className="dt-pill">
      <select
        className="dt-select"
        value={p.displayType}
        aria-label={`Display type for ${meta.name}`}
        title="Display type"
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {displayTypeLabel(d)}
          </option>
        ))}
      </select>
    </span>
  );
}

function UnibarSettings({
  meta,
  p,
  patch,
}: {
  meta: ColumnMeta;
  p: PerUnibar;
  patch: (patch: Partial<PerUnibar>) => void;
}) {
  const isNumeric = meta.dtype === "numeric";
  const asCategorical = effectiveCategorical(meta, p);

  const setForceCategorical = (v: boolean) => {
    // reset display type + seed value order to match the new effective type,
    // mirroring hammock_settings.display_unibar_specific_settings.
    const base = defaultPerUnibar(meta);
    patch({
      forceCategorical: v,
      displayType: v ? "stacked_bar" : base.displayType,
      valueOrder: v ? meta.uniqueValues : [],
      customOrder: false,
    });
  };

  return (
    <>
      {isNumeric && (
        <Field hint="Treat this numeric column as discrete categories.">
          <Toggle label="Categorical" checked={p.forceCategorical} onChange={setForceCategorical} />
        </Field>
      )}

      {isNumeric && !p.forceCategorical && (
        <Field hint="Number of label levels along the axis (rug/box/violin).">
          <Toggle
            label="Custom label levels"
            checked={p.customLevels}
            onChange={(v) => patch({ customLevels: v })}
          />
          {p.customLevels && (
            <div style={{ marginTop: 8 }}>
              <NumberField
                label="Levels"
                value={p.numLevels}
                min={0}
                step={1}
                onChange={(v) => patch({ numLevels: v })}
              />
            </div>
          )}
        </Field>
      )}

      {asCategorical && (
        <Field hint="Order of values, bottom → top.">
          <Toggle
            label="Custom value order"
            checked={p.customOrder}
            onChange={(v) =>
              patch({
                customOrder: v,
                valueOrder: v && p.valueOrder.length === 0 ? meta.uniqueValues : p.valueOrder,
              })
            }
          />
          {p.customOrder && (
            <OrderableList
              values={p.valueOrder.length ? p.valueOrder : meta.uniqueValues}
              onChange={(vo) => patch({ valueOrder: vo })}
            />
          )}
        </Field>
      )}

      <Field>
        <Toggle
          label="Custom label options"
          checked={p.customLabels}
          onChange={(v) => patch({ customLabels: v })}
        />
      </Field>
      {p.customLabels && (
        <>
          <Field>
            <Toggle
              label="Basic only"
              checked={p.basicLabels}
              onChange={(v) => patch({ basicLabels: v })}
            />
          </Field>
          {p.basicLabels ? (
            <div className="row2">
              <NumberField
                label="Font size"
                value={p.labelFontsize}
                min={0}
                step={1}
                onChange={(v) => patch({ labelFontsize: v })}
              />
              <Field label="Color">
                <ColorField value={p.labelColor} onChange={(v) => patch({ labelColor: v })} />
              </Field>
            </div>
          ) : (
            <Field
              label="Custom options (JSON)"
              hint='matplotlib text kwargs, e.g. {"fontsize": 16, "rotation": 30}'
            >
              <textarea
                value={p.labelCustomRaw}
                spellCheck={false}
                placeholder='{"fontsize": 16}'
                onChange={(e) => patch({ labelCustomRaw: e.target.value })}
              />
            </Field>
          )}
        </>
      )}
    </>
  );
}

function OrderableList({
  values,
  onChange,
}: {
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const drag = useReorder(values, onChange);
  return (
    <div className="axes" style={{ marginTop: 8 }}>
      {values.map((v, i) => (
        <div
          className={"axis-row axis-row--bordered" + drag.itemClass(i)}
          key={v}
          {...drag.itemProps(i)}
        >
          <GripHandle
            label={`Reorder ${v}`}
            position={`${i + 1} of ${values.length}`}
            {...drag.handleProps(i)}
          />
          <span className="ord">{i + 1}</span>
          <span className="nm">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Drag-to-reorder ------------------------------------------------------
// Native HTML5 drag-and-drop over a small string list. Drag-start is gated to
// the grip handle (the handle arms its row on pointerdown), so clicks on other
// row controls behave normally. Keyboard users reorder via Arrow keys on the
// focused grip — React keeps focus on the same keyed handle across the
// reorder, so repeated presses "carry" the item. No external dnd dependency:
// the lists are short (a handful of axes / values).
function useReorder(items: string[], onChange: (next: string[]) => void) {
  const [armed, setArmed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Insertion boundary, 0..items.length: the line sits *before* row `insertAt`.
  const [insertAt, setInsertAt] = useState<number | null>(null);

  // Move `from` to land before boundary `to` (a 0..length gap index).
  const commit = (from: number, to: number) => {
    // Dropping into the gap right above or below its own slot is a no-op.
    if (to === from || to === from + 1) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, m);
    onChange(next);
  };

  // Keyboard step: swap with the neighbour in `dir`.
  const step = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  // Which gap the pointer is nearest: top half of a row → before it, bottom
  // half → after it. This is what lets you target the very first slot.
  const boundaryAt = (e: React.DragEvent, idx: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? idx + 1 : idx;
  };

  const reset = () => {
    setArmed(null);
    setDragging(null);
    setInsertAt(null);
  };

  return {
    itemClass: (idx: number) => {
      if (dragging === idx) return " dragging";
      if (insertAt === null || dragging === null) return "";
      if (insertAt === idx) return " drop-before";
      if (insertAt === idx + 1) return " drop-after";
      return "";
    },

    handleProps: (idx: number) => ({
      onPointerDown: () => setArmed(idx),
      onPointerUp: () => setArmed((a) => (a === idx ? null : a)),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          step(idx, -1);
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          step(idx, 1);
        }
      },
    }),

    itemProps: (idx: number) => ({
      draggable: armed === idx,
      onDragStart: (e: React.DragEvent) => {
        setDragging(idx);
        setInsertAt(idx);
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without payload.
        e.dataTransfer.setData("text/plain", String(idx));
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setInsertAt(boundaryAt(e, idx));
      },
      onDrop: (e: React.DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        commit(dragging, boundaryAt(e, idx));
        reset();
      },
      onDragEnd: reset,
    }),
  };
}

function GripHandle({
  label,
  position,
  ...handlers
}: {
  label: string;
  position: string;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="grip"
      aria-label={`${label} (${position}). Drag, or use the arrow keys.`}
      title="Drag to reorder"
      {...handlers}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
        <g fill="currentColor">
          <circle cx="2.5" cy="3" r="1.3" />
          <circle cx="7.5" cy="3" r="1.3" />
          <circle cx="2.5" cy="8" r="1.3" />
          <circle cx="7.5" cy="8" r="1.3" />
          <circle cx="2.5" cy="13" r="1.3" />
          <circle cx="7.5" cy="13" r="1.3" />
        </g>
      </svg>
    </button>
  );
}

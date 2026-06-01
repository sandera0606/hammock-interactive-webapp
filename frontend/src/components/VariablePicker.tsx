// Variable selection + per-variable ("unibar") settings in context.
//   * column chips (with a dtype glyph) toggle membership in `var`
//   * selected vars show as an ordered axes list (reorder = axis order)
//   * a gear expands that variable's settings (display type, force-categorical,
//     value order, label options) — mirroring hammock_settings semantics.
import { useState } from "react";

import { Field, Segmented, Toggle, NumberField, ColorField } from "./controls";
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
  const metaByName = Object.fromEntries(meta.map((m) => [m.name, m]));

  const toggle = (name: string) => {
    if (ui.var.includes(name)) setVar(ui.var.filter((v) => v !== name));
    else setVar([...ui.var, name]);
  };
  const move = (name: string, dir: -1 | 1) => {
    const i = ui.var.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ui.var.length) return;
    const next = [...ui.var];
    [next[i], next[j]] = [next[j], next[i]];
    setVar(next);
  };

  return (
    <>
      <div className="chip-grid">
        {meta.map((m) => {
          const selected = ui.var.includes(m.name);
          return (
            <button
              key={m.name}
              className={"chip" + (selected ? " selected" : "")}
              onClick={() => toggle(m.name)}
              title={selected ? "Remove from plot" : "Add to plot"}
            >
              <span className={"glyph " + m.dtype}>{m.dtype === "numeric" ? "1.2" : "Aa"}</span>
              {m.name}
            </button>
          );
        })}
      </div>

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
              <div className="axis-item" key={name}>
                <div className="axis-row">
                  <span className="ord">{idx + 1}</span>
                  <span className="nm">{name}</span>
                  <span className="badge">{p.displayType.replace("_", " ")}</span>
                  <button
                    className="iconbtn"
                    onClick={() => move(name, -1)}
                    disabled={idx === 0}
                    aria-label={`Move ${name} up`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="iconbtn"
                    onClick={() => move(name, 1)}
                    disabled={idx === ui.var.length - 1}
                    aria-label={`Move ${name} down`}
                    title="Move down"
                  >
                    ↓
                  </button>
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
  const displayOptions = asCategorical ? CATEGORICAL_DISPLAY : NUMERIC_DISPLAY;

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

      <Field label="Display type">
        <Segmented
          ariaLabel="Display type"
          value={p.displayType}
          onChange={(v) => patch({ displayType: v })}
          options={displayOptions.map((d) => ({ value: d, label: d.replace("_", " ") }))}
        />
      </Field>

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
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.length) return;
    const next = [...values];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="axes" style={{ marginTop: 8 }}>
      {values.map((v, i) => (
        <div className="axis-row" key={v} style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
          <span className="ord">{i + 1}</span>
          <span className="nm">{v}</span>
          <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="up">
            ↑
          </button>
          <button
            className="iconbtn"
            onClick={() => move(i, 1)}
            disabled={i === values.length - 1}
            aria-label="down"
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}

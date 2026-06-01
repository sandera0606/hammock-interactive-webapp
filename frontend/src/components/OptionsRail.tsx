// The control rail: presets, variables, and the grouped option sections.
// Control set + semantics mirror the Streamlit app; layout is the studio rail.
import { useEffect, useState } from "react";

import { Section } from "./Section";
import VariablePicker from "./VariablePicker";
import { Field, Slider, NumberField, ColorField, Toggle, Segmented } from "./controls";
import { validateExpression } from "../lib/api";
import { highlightColorCount } from "../lib/optionsToRequest";
import {
  type ColumnMeta,
  type PerUnibar,
  type Preset,
  type UiState,
} from "../lib/optionsState";

interface RailProps {
  ui: UiState;
  meta: ColumnMeta[];
  patch: (p: Partial<UiState>) => void;
  patchUnibar: (name: string, p: Partial<PerUnibar>) => void;
  setVar: (v: string[]) => void;
  setPreset: (p: Preset) => void;
}

// A valid, non-empty highlight expression seeded from a variable's first value:
// `x == <n>` is a numeric-range expr for numeric columns; the literal value is a
// regex for categorical ones. Empty hi_value crashes the render, so we never
// leave expression mode blank.
function defaultHiExpr(meta: ColumnMeta | undefined): string {
  const first = meta?.uniqueValues[0];
  if (first === undefined) return "";
  return meta?.dtype === "numeric" ? `x == ${first}` : first;
}

export default function OptionsRail(props: RailProps) {
  const { ui, meta, patch, setVar, setPreset } = props;
  const metaByName = Object.fromEntries(meta.map((m) => [m.name, m]));

  // Turning highlighting on must leave the plot with something to highlight,
  // otherwise the library is asked to highlight nothing and the render throws.
  // Seed a default variable (a selected axis, else any column) and, in labels
  // mode, its first value — only filling blanks the user hasn't set.
  const enableHighlight = (on: boolean) => {
    if (!on) {
      patch({ highlight: false });
      return;
    }
    const next: Partial<UiState> = { highlight: true };
    const hiVar =
      ui.hiVar ||
      ui.var.find((v) => (metaByName[v]?.uniqueValues.length ?? 0) > 0) ||
      meta.find((m) => m.uniqueValues.length > 0)?.name ||
      "";
    if (!ui.hiVar) next.hiVar = hiVar;
    if (ui.hiType === "labels" && ui.hiValues.length === 0) {
      const first = metaByName[hiVar]?.uniqueValues[0];
      if (first !== undefined) next.hiValues = [first];
    } else if (ui.hiType === "expression" && !ui.hiExpression) {
      next.hiExpression = defaultHiExpr(metaByName[hiVar]);
    }
    patch(next);
  };

  return (
    <>
      <Field label="Preset">
        <Segmented<Preset>
          ariaLabel="Preset"
          value={ui.preset}
          onChange={setPreset}
          options={[
            { value: "hammock", label: "Hammock" },
            { value: "snapshot", label: "Snapshot" },
          ]}
        />
      </Field>

      <Section label="Variables" count={ui.var.length} defaultOpen>
        <Field>
          <Toggle
            label="Plot missing values"
            checked={ui.missing}
            onChange={(v) => patch({ missing: v })}
          />
        </Field>
        <VariablePicker meta={meta} ui={ui} setVar={setVar} patchUnibar={props.patchUnibar} />
      </Section>

      <Section label="Appearance">
        <AppearanceSection {...props} />
      </Section>

      <Section
        label="Highlighting"
        toggle={{ checked: ui.highlight, onChange: enableHighlight }}
      >
        <HighlightingSection {...props} metaByName={metaByName} />
      </Section>

      <Section
        label="Weights"
        toggle={{ checked: ui.useWeights, onChange: (v) => patch({ useWeights: v }) }}
      >
        <WeightsSection {...props} />
      </Section>

      <Section label="Advanced">
        <AdvancedSection {...props} metaByName={metaByName} />
      </Section>
    </>
  );
}

function AppearanceSection({ ui, patch }: RailProps) {
  const fillsDisabled = !ui.label && !ui.unibar;
  return (
    <>
      <div className="row2">
        <NumberField label="Height" value={ui.height} step={0.5} onChange={(v) => patch({ height: v })} />
        <NumberField
          label="Width"
          value={ui.width}
          step={0.5}
          onChange={(v) => patch({ width: v, widthTouched: true })}
        />
      </div>
      <NumberField
        label="Min bar height"
        value={ui.minBarHeight}
        step={0.05}
        onChange={(v) => patch({ minBarHeight: v })}
        hint="Floor on bar thickness so tiny groups stay visible."
      />
      <div className="row2">
        <Field label="Default colour">
          <ColorField value={ui.defaultColor} onChange={(v) => patch({ defaultColor: v })} />
        </Field>
        <div />
      </div>
      <Slider label="Opacity" value={ui.alpha} onChange={(v) => patch({ alpha: v })} />

      <div className="row2">
        <Field>
          <Toggle label="Show labels" checked={ui.label} onChange={(v) => patch({ label: v })} />
        </Field>
        <Field>
          <Toggle label="Show unibars" checked={ui.unibar} onChange={(v) => patch({ unibar: v })} />
        </Field>
      </div>
      {ui.missing && (
        <Field label="Missing value label">
          <input
            type="text"
            value={ui.missingPlaceholder}
            onChange={(e) => patch({ missingPlaceholder: e.target.value })}
          />
        </Field>
      )}

      <Slider
        label="Unibar vertical fill"
        value={ui.uniVfill}
        onChange={(v) => patch({ uniVfill: v })}
      />
      <Slider
        label="Unibar horizontal fill"
        value={ui.uniHfill}
        disabled={fillsDisabled}
        onChange={(v) => patch({ uniHfill: v })}
      />
      <Slider
        label="Connector fraction"
        value={ui.connectorFraction}
        onChange={(v) => patch({ connectorFraction: v })}
      />
      <Field label="Connector shape">
        <Segmented
          ariaLabel="Connector shape"
          value={ui.shape}
          onChange={(v) => patch({ shape: v as UiState["shape"] })}
          options={[
            { value: "rectangle", label: "Rectangle" },
            { value: "parallelogram", label: "Parallelogram" },
          ]}
        />
      </Field>
      <Field>
        <Toggle
          label="Separate connector colour"
          checked={ui.customConnectorColor}
          onChange={(v) => patch({ customConnectorColor: v })}
        />
        {ui.customConnectorColor && (
          <div style={{ marginTop: 8 }}>
            <ColorField value={ui.connectorColor} onChange={(v) => patch({ connectorColor: v })} />
          </div>
        )}
      </Field>
    </>
  );
}

function HighlightingSection({
  ui,
  patch,
  metaByName,
}: RailProps & { metaByName: Record<string, ColumnMeta> }) {
  const [exprValid, setExprValid] = useState<boolean | null>(null);
  const hiVarMeta = ui.hiVar ? metaByName[ui.hiVar] : undefined;

  // Debounced expression validation against the backend (the library validator).
  useEffect(() => {
    if (!ui.highlight || ui.hiType !== "expression" || !ui.hiExpression) {
      setExprValid(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      validateExpression(ui.hiExpression, ac.signal)
        .then((r) => setExprValid(r.valid))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [ui.highlight, ui.hiType, ui.hiExpression]);

  if (!ui.highlight) {
    return (
      <div className="empty-note">
        Use the switch above to highlight rows by a variable's values.
      </div>
    );
  }

  const colorCount = highlightColorCount(ui);
  const labelOptions = hiVarMeta?.uniqueValues ?? [];

  return (
    <>
      <Field label="Variable to highlight">
        <select
          value={ui.hiVar}
          onChange={(e) => {
            // Seed the new variable's first value (labels) and a matching
            // expression so the plot always has something to highlight — an
            // empty hi_value crashes the render.
            const v = e.target.value;
            const m = metaByName[v];
            const first = m?.uniqueValues[0];
            patch({
              hiVar: v,
              hiValues: first !== undefined ? [first] : [],
              hiExpression: defaultHiExpr(m),
            });
          }}
        >
          <option value="">— select —</option>
          {Object.keys(metaByName).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <div className="row2">
        <Field label="Type">
          <Segmented
            value={ui.hiType}
            onChange={(v) => {
              // Seed whichever mode we're switching into so it's never blank.
              const p: Partial<UiState> = { hiType: v };
              const m = metaByName[ui.hiVar];
              if (v === "expression" && !ui.hiExpression) {
                p.hiExpression = defaultHiExpr(m);
              } else if (v === "labels" && ui.hiValues.length === 0) {
                const first = m?.uniqueValues[0];
                if (first !== undefined) p.hiValues = [first];
              }
              patch(p);
            }}
            options={[
              { value: "labels", label: "Labels" },
              { value: "expression", label: "Expr" },
            ]}
          />
        </Field>
        <Field label="Box layout">
          <Segmented
            value={ui.hiBox}
            onChange={(v) => patch({ hiBox: v })}
            options={[
              { value: "side-by-side", label: "Side" },
              { value: "stacked", label: "Stack" },
            ]}
          />
        </Field>
      </div>

      {ui.hiType === "labels" ? (
        <Field label="Labels to highlight">
          <div className="chip-grid">
            {labelOptions.map((v) => {
              const on = ui.hiValues.includes(v);
              return (
                <button
                  key={v}
                  className={"chip" + (on ? " selected" : "")}
                  onClick={() =>
                    patch({
                      hiValues: on ? ui.hiValues.filter((x) => x !== v) : [...ui.hiValues, v],
                    })
                  }
                >
                  {v}
                </button>
              );
            })}
            {labelOptions.length === 0 && <span className="empty-note">Pick a variable first.</span>}
          </div>
        </Field>
      ) : (
        <Field label="Expression (regex / range)" hint="e.g. x>1 and (x>5 or x<4)">
          <input
            type="text"
            value={ui.hiExpression}
            placeholder="x > 1"
            onChange={(e) => patch({ hiExpression: e.target.value })}
          />
          {exprValid === false && <div className="inline-warn">Not a valid expression.</div>}
          {exprValid === true && <div className="inline-ok">Valid.</div>}
        </Field>
      )}

      {ui.missing && (
        <Field>
          <Toggle
            label="Highlight missing values"
            checked={ui.hiMissing}
            onChange={(v) => patch({ hiMissing: v })}
          />
        </Field>
      )}

      <Field label="Highlight colours">
        <div className="hi-colors">
          {Array.from({ length: colorCount }, (_, i) => (
            <ColorField
              key={i}
              caption={`#${i + 1}`}
              value={ui.hiColors[i] ?? "#00ff00"}
              onChange={(v) => {
                const next = [...ui.hiColors];
                next[i] = v;
                patch({ hiColors: next });
              }}
            />
          ))}
          {colorCount === 0 && <span className="empty-note">Pick labels to assign colours.</span>}
        </div>
      </Field>
    </>
  );
}

function WeightsSection({ ui, meta, patch }: RailProps) {
  const candidates = meta
    .filter((m) => m.weightCandidate && !ui.var.includes(m.name))
    .map((m) => m.name);
  if (!ui.useWeights) {
    return (
      <div className="empty-note">
        Use the switch above to weight each row by a numeric variable.
      </div>
    );
  }
  return candidates.length === 0 ? (
    <div className="empty-note">
      No valid weight variable. A weight must be numeric with no missing or
      non-positive values, and not already an axis.
    </div>
  ) : (
    <Field label="Weight variable" hint="Acts as a per-row weight.">
      <select value={ui.weights} onChange={(e) => patch({ weights: e.target.value })}>
        <option value="">— select —</option>
        {candidates.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Field>
  );
}

function AdvancedSection({
  ui,
  patch,
  metaByName,
}: RailProps & { metaByName: Record<string, ColumnMeta> }) {
  const sameScaleTypes = new Set(ui.sameScale.map((v) => metaByName[v]?.dtype));
  const mixed = sameScaleTypes.size > 1;
  return (
    <>
      <Field label="Same-scale variables" hint="Share one axis scale (all numeric or all categorical).">
        <div className="chip-grid">
          {ui.var.map((v) => {
            const on = ui.sameScale.includes(v);
            return (
              <button
                key={v}
                className={"chip" + (on ? " selected" : "")}
                onClick={() =>
                  patch({
                    sameScale: on ? ui.sameScale.filter((x) => x !== v) : [...ui.sameScale, v],
                  })
                }
              >
                {v}
              </button>
            );
          })}
          {ui.var.length === 0 && <span className="empty-note">Select variables first.</span>}
        </div>
        {mixed && <div className="inline-warn">Same-scale variables must all be one type.</div>}
      </Field>

      <Field label="Violin bandwidth method">
        <Segmented
          value={ui.bwMethod}
          onChange={(v) => patch({ bwMethod: v })}
          options={[
            { value: "scott", label: "Scott" },
            { value: "silverman", label: "Silverman" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {ui.bwMethod === "custom" && (
          <div style={{ marginTop: 8 }}>
            <NumberField
              label="Bandwidth"
              value={ui.bwCustom}
              min={0}
              step={0.1}
              onChange={(v) => patch({ bwCustom: v })}
            />
          </div>
        )}
      </Field>
    </>
  );
}

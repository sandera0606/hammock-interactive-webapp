// Small reusable, accessible form controls styled by styles.css. Native inputs
// only (range/color/number/checkbox/select) — no UI dependency.
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "%",
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="field">
      <div className="slider-head">
        <span className="field-label" style={{ margin: 0 }}>
          {label}
        </span>
        <span className="val">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  caption,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  caption?: string;
}) {
  return (
    <div className="color-field">
      {caption !== undefined && <span className="cap">{caption}</span>}
      <span className="color-swatch" style={{ background: value }}>
        <input
          type="color"
          value={value}
          aria-label={label ?? caption ?? "colour"}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      {label && <span className="hex">{label}</span>}
      {!label && caption === undefined && <span className="hex">{value}</span>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" />
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A labelled collapsible section for the control rail. Progressive disclosure:
// the rail shows grouping; the user expands what they need.
import { useState, type ReactNode } from "react";

export function Section({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number | string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button
        type="button"
        className="section-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="label">{label}</span>
        {count !== undefined && count !== 0 && count !== "" && (
          <span className="count">{count}</span>
        )}
        <span className="chev">▸</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

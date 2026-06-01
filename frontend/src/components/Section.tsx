// A labelled collapsible section for the control rail. Progressive disclosure:
// the rail shows grouping; the user expands what they need. An optional `toggle`
// renders an on/off switch beside the title (e.g. Highlighting, Weights).
import { useState, type ReactNode } from "react";

import { Toggle } from "./controls";

export function Section({
  label,
  count,
  defaultOpen = false,
  toggle,
  children,
}: {
  label: string;
  count?: number | string;
  defaultOpen?: boolean;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // The whole header row expands/collapses; the switch (when present) drives its
  // own feature and must not toggle the section. Turning the switch on reveals
  // the controls by auto-opening the section.
  const handleToggle = (v: boolean) => {
    toggle?.onChange(v);
    if (v) setOpen(true);
  };

  return (
    <div className="section">
      <div
        className="section-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="label">{label}</span>
        {toggle && (
          <span
            className="section-switch"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Toggle
              checked={toggle.checked}
              onChange={handleToggle}
              ariaLabel={`Enable ${label}`}
            />
          </span>
        )}
        {count !== undefined && count !== 0 && count !== "" && (
          <span className="count">{count}</span>
        )}
        <span className="chev">▸</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

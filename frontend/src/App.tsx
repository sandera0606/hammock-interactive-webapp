import { useEffect, useState, type ReactNode } from "react";

interface Health {
  status: string;
  hammockPin: { sha: string; short: string } | null;
  hammockImportable: boolean;
  python: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "error"; message: string };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // Same-origin call; Vite proxies /api -> FastAPI :8000.
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then((health) => setState({ kind: "ok", health }))
      .catch((e) => setState({ kind: "error", message: String(e) }));
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "4rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>Hammock Plot — Interactive</h1>
      <p style={{ color: "#666" }}>M0 scaffolding · backend health check</p>

      {state.kind === "loading" && <p>Checking backend…</p>}

      {state.kind === "error" && (
        <div style={{ color: "#b00", background: "#fee", padding: "1rem", borderRadius: 8 }}>
          <strong>Backend unreachable.</strong>
          <div>{state.message}</div>
          <div style={{ marginTop: 8, color: "#822" }}>
            Is the API running on :8000? (<code>uvicorn app.main:app --port 8000</code>)
          </div>
        </div>
      )}

      {state.kind === "ok" && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
          <dt>Status</dt>
          <dd>
            <Badge ok={state.health.status === "ok"}>{state.health.status}</Badge>
          </dd>
          <dt>hammock_plot pin</dt>
          <dd>
            <code>{state.health.hammockPin?.short ?? "unknown"}</code>
          </dd>
          <dt>Library importable</dt>
          <dd>
            <Badge ok={state.health.hammockImportable}>
              {String(state.health.hammockImportable)}
            </Badge>
          </dd>
          <dt>Python</dt>
          <dd style={{ color: "#666", fontSize: "0.85rem" }}>
            {state.health.python.split(" ")[0]}
          </dd>
        </dl>
      )}
    </main>
  );
}

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        background: ok ? "#e6f7ec" : "#fee",
        color: ok ? "#0a7d33" : "#b00",
        padding: "0.1rem 0.5rem",
        borderRadius: 6,
        fontSize: "0.85rem",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

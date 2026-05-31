import { useEffect, useRef, useState } from "react";

import HammockPlot from "./components/HammockPlot";
import {
  fetchScene,
  getSample,
  listSamples,
  type PlotOptions,
  type Row,
  type SampleInfo,
} from "./lib/api";
import type { Scene } from "./lib/scene";

type Status = "loading" | "ready" | "error";

export default function App() {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Discover bundled samples once, then auto-load the first.
  useEffect(() => {
    listSamples()
      .then((s) => {
        setSamples(s);
        if (s.length) setActive(s[0].name);
        else setStatus("error");
      })
      .catch((e) => {
        setError(String(e));
        setStatus("error");
      });
  }, []);

  // Whenever the active sample changes: fetch its rows, then the scene. The SPA
  // sends the data + options to the stateless backend on every plot call.
  useEffect(() => {
    if (!active) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("loading");
    setError("");

    (async () => {
      const sample = await getSample(active);
      const options: PlotOptions = sample.defaults;
      const data: Row[] = sample.data;
      const next = await fetchScene(data, options, ac.signal);
      setScene(next);
      setStatus("ready");
    })().catch((e) => {
      if (ac.signal.aborted) return;
      setError(String(e instanceof Error ? e.message : e));
      setStatus("error");
    });

    return () => ac.abort();
  }, [active]);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        margin: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid #eee",
        }}
      >
        <strong style={{ fontSize: "1.05rem" }}>Hammock Plot — Interactive</strong>
        <nav style={{ display: "flex", gap: 8 }}>
          {samples.map((s) => (
            <button
              key={s.name}
              onClick={() => setActive(s.name)}
              style={{
                padding: "0.35rem 0.8rem",
                borderRadius: 6,
                border: "1px solid #ddd",
                background: s.name === active ? "#2563eb" : "white",
                color: s.name === active ? "white" : "#333",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <span style={{ marginLeft: "auto", color: "#999", fontSize: "0.8rem" }}>
          pin {scene?.hammockPin?.short ?? "—"}
        </span>
      </header>

      {scene && scene.warnings.length > 0 && (
        <div
          style={{
            background: "#fffbe6",
            borderBottom: "1px solid #ffe58f",
            padding: "0.4rem 1.25rem",
            fontSize: "0.8rem",
            color: "#7a5b00",
          }}
        >
          {scene.warnings.length} warning(s): {scene.warnings.join(" · ")}
        </div>
      )}

      <main style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {status === "error" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "#b00",
              padding: "2rem",
              textAlign: "center",
            }}
          >
            <div>
              <strong>Could not render plot.</strong>
              <div style={{ marginTop: 8, color: "#822" }}>{error}</div>
            </div>
          </div>
        )}

        {status === "loading" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "#888",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            Rendering…
          </div>
        )}

        {scene && status !== "error" && (
          <div style={{ position: "absolute", inset: 0, opacity: status === "loading" ? 0.4 : 1 }}>
            <HammockPlot scene={scene} />
          </div>
        )}
      </main>
    </div>
  );
}

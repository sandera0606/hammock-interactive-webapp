"""
Side-by-side check: the library's OWN matplotlib output vs our interactive plotly.

Renders hammock_plot's native PNG for the exact configs used by spike.py and
spike2.py (no patching here -> the real library output), then writes two
comparison pages placing the PNG next to the interactive html (via <iframe>).

Run:  python spike/compare.py   (after spike.py and spike2.py have been run)
Open: spike/compare1.html  (asthma + highlight)
      spike/compare2.html  (penguins box + violin)
"""

import os
import sys

import matplotlib
matplotlib.use("Agg")

HERE = os.path.dirname(os.path.abspath(__file__))
HAMMOCK_REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "hammock_plot"))
sys.path.insert(0, HAMMOCK_REPO)

import pandas as pd
import hammock_plot


def ref_png(df, kwargs, path):
    # unpatched, real library -> native matplotlib PNG
    hammock_plot.Hammock(df).plot(display_figure=False, save_path=path, **kwargs)
    print("wrote reference PNG:", os.path.basename(path))


def wrapper(out, title, config, png, iframe):
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>
 body {{ font-family: system-ui, sans-serif; margin: 16px; background:#fafafa; }}
 h1 {{ font-size: 18px; }} .cfg {{ color:#666; font-size:13px; margin-bottom:12px; }}
 .row {{ display:flex; gap:16px; align-items:flex-start; }}
 .col {{ flex:1; background:#fff; border:1px solid #e3e3e3; border-radius:8px; padding:10px; }}
 .col h2 {{ font-size:14px; margin:4px 0 10px; }}
 .col img {{ width:100%; height:auto; }}
 iframe {{ width:100%; height:700px; border:0; }}
 .tag {{ font-size:11px; color:#888; }}
</style></head><body>
<h1>{title}</h1>
<div class="cfg">config: <code>{config}</code></div>
<div class="row">
  <div class="col"><h2>hammock_plot — native matplotlib (static PNG) <span class="tag">the reference</span></h2>
    <img src="{png}"></div>
  <div class="col"><h2>our wrapper — interactive plotly <span class="tag">hover / zoom / pan</span></h2>
    <iframe src="{iframe}"></iframe></div>
</div></body></html>"""
    with open(os.path.join(HERE, out), "w", encoding="utf-8") as f:
        f.write(doc)
    print("wrote", out)


def main():
    asthma = pd.read_csv(os.path.join(HAMMOCK_REPO, "data", "data_asthma.csv"))
    ref_png(asthma,
            dict(var=["group", "gender", "comorbidities"], hi_var="gender", hi_value=["female"]),
            os.path.join(HERE, "asthma_ref.png"))

    peng = (pd.read_csv(os.path.join(HAMMOCK_REPO, "data", "data_penguins.csv"))
            .dropna(subset=["species", "bill_length_mm", "flipper_length_mm"]).reset_index(drop=True))
    ref_png(peng,
            dict(var=["species", "bill_length_mm", "flipper_length_mm"],
                 display_type={"bill_length_mm": "box", "flipper_length_mm": "violin"}),
            os.path.join(HERE, "penguins_ref.png"))

    wrapper("compare1.html", "Asthma + highlight (gender=female)",
            "var=[group, gender, comorbidities], hi_var=gender, hi_value=[female]",
            "asthma_ref.png", "spike.html")
    wrapper("compare2.html", "Penguins — box + violin (NATIVE go.Box/go.Violin — plotly's look)",
            "var=[species, bill_length_mm(box), flipper_length_mm(violin)]",
            "penguins_ref.png", "spike2.html")
    wrapper("compare3.html", "Penguins — box + violin (PIXEL-FAITHFUL capture — library's look)",
            "var=[species, bill_length_mm(box), flipper_length_mm(violin)] — captured exactly as drawn",
            "penguins_ref.png", "spike3.html")

    miss = [f for f in ("spike.html", "spike2.html", "spike3.html") if not os.path.exists(os.path.join(HERE, f))]
    if miss:
        print("\nNOTE: missing", miss, "- run spike.py / spike2.py first so the iframes load.")
    print("\nOpen spike/compare1.html and spike/compare2.html")


if __name__ == "__main__":
    main()

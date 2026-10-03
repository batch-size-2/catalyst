"""Demo dashboard: ingest a batch, show the verdict and the evidence behind it. Owned by the backend engineer.

Usage: uv run streamlit run app.py
"""

from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

from qc.run import run
from qc.schema import EVIDENCE_DIR, Evidence, evidence_path, load_config, preview_path

VERDICT_BOX = {"ACCEPT": st.success, "INVESTIGATE": st.warning, "REJECT": st.error}
STATUS_COLOR = {"CONFORMING": "green", "SUSPECT": "orange", "NON_CONFORMING": "red"}
STATUS_ORDER = {"NON_CONFORMING": 0, "SUSPECT": 1, "CONFORMING": 2}

st.set_page_config(page_title="Catalyst batch QC", layout="wide")
cfg = load_config()
data_dir = Path(cfg["data_dir"])

with st.sidebar:
    st.header("Ingest a batch")
    st.caption(f"Baseline `{cfg['baseline']}` · config `{cfg['version']}`")
    uploads = st.file_uploader("Upload a batch folder", type=["tif", "tiff"], accept_multiple_files="directory")
    upload_name = st.text_input("Name for the uploaded batch", "new_batch")
    folders = sorted(p.name for p in data_dir.iterdir() if p.is_dir()) if data_dir.is_dir() else []
    folder = st.selectbox("…or pick a folder in data/", folders, index=None)
    if st.button("Run QC", type="primary", disabled=not (uploads or folder)):
        batch_dir = data_dir / (upload_name if uploads else folder)
        if uploads:
            batch_dir.mkdir(parents=True, exist_ok=True)
            for upload in uploads:
                (batch_dir / Path(upload.name).name).write_bytes(upload.getbuffer())
        bar = st.progress(0.0, text="Starting…")
        try:
            [evidence] = run([batch_dir], cfg, lambda i, n, label: bar.progress(i / n, text=f"Measuring {label}"))
            st.session_state["batch"] = evidence.batch
        except FileNotFoundError as error:
            st.error(str(error))
        bar.empty()

st.title("Catalyst · batch QC")
files = sorted(EVIDENCE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
if not files:
    st.info("No results yet. Ingest a batch from the sidebar, or run `uv run python -m qc.run --batch data/<batch>`.")
    st.stop()

names = [p.stem for p in files]
current = st.session_state.get("batch")
ev = Evidence.model_validate_json(
    evidence_path(st.selectbox("Batch", names, index=names.index(current) if current in names else 0)).read_text()
)
nc = ev.nonconforming

VERDICT_BOX[ev.verdict](f"## {ev.verdict}\n{ev.next_action}")
cols = st.columns(4)
cols[0].metric("Non-conforming tiles", f"{nc.x} / {nc.n}")
cols[1].metric(f"Non-conforming rate, {cfg['ci_level']:.0%} CI", f"{nc.ci[0]:.0%} – {nc.ci[1]:.0%}")
cols[2].metric("Baseline", f"{ev.baseline} ({ev.n_images['baseline']} tiles)")
cols[3].metric("Config", ev.config_version)

st.subheader("KPIs against the baseline tolerance band")
points = pd.DataFrame([
    {"kpi": k.name, "tile": t.image_id, "value": t.kpis[k.name], "unit": k.unit,
     "position": (t.kpis[k.name] - sum(k.band) / 2) / max((k.band[1] - k.band[0]) / 2, 1e-12)}
    for k in ev.kpis for t in ev.tiles if t.kpis.get(k.name) is not None
])
if not points.empty:
    points["band"] = points["position"].abs().le(1).map({True: "inside", False: "outside"})
    fig = px.strip(points, x="position", y="kpi", color="band", hover_data=["tile", "value", "unit"],
                   color_discrete_map={"inside": "#2e7d32", "outside": "#c62828"})
    fig.add_vrect(x0=-1, x1=1, fillcolor="green", opacity=0.08, line_width=0)
    fig.update_layout(xaxis_title="position in band (−1 and +1 are the band edges)", yaxis_title=None,
                      height=140 + 60 * len(ev.kpis), legend_title=None)
    st.plotly_chart(fig)
st.dataframe(pd.DataFrame([
    {"KPI": k.name, "unit": k.unit, "band": f"{k.band[0]:.3g} – {k.band[1]:.3g}", "baseline mean": k.baseline_mean,
     "batch mean": k.batch_mean, "tiles outside": k.n_outside} for k in ev.kpis
]), hide_index=True)

st.subheader("Tiles")
st.caption("BSE with overlay: orange = Si particle, blue = pore. Worst tiles first.")
cols = st.columns(3)
for i, tile in enumerate(sorted(ev.tiles, key=lambda t: STATUS_ORDER[t.status])):
    with cols[i % 3]:
        preview = preview_path(ev.batch, tile.image_id)
        if preview.exists():
            st.image(str(preview), width="stretch")
        st.markdown(f"**{tile.image_id}** · :{STATUS_COLOR[tile.status]}[{tile.status}] · strip {tile.strip_id}")
        for reason in tile.reasons:
            st.caption(reason)

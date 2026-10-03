from pathlib import Path

import pandas as pd
import streamlit as st

from qc.schema import Evidence

st.title("Catalyst: batch QC")

files = sorted(Path("out/evidence").glob("*.json"))
if not files:
    st.info("No evidence yet. Run `uv run python -m qc.decide` first.")
    st.stop()

path = st.selectbox("Batch", files, format_func=lambda p: p.stem)
evidence = Evidence.model_validate_json(path.read_text())

st.header(f"{evidence.batch}: {evidence.verdict}")
st.caption(f"{evidence.n_images['batch']} images vs {evidence.n_images['baseline']} baseline · config {evidence.config_version}")
st.dataframe(pd.DataFrame([k.model_dump() for k in evidence.kpis]))

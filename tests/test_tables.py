import numpy as np
import pandas as pd

from qc.decide import evaluate, read_tables, split_tables
from qc.schema import IMAGING_COLUMNS, PARTICLE_COLUMNS, load_config
from tests.synth import synth_kpis

CFG = load_config() | {"version": "test", "data_dir": "data", "baseline": "r"}


def particle_table(kpis, allocations):
    rows = []
    indices = {}
    for row in kpis.itertuples(index=False):
        i = indices.get(row.batch, 0)
        indices[row.batch] = i + 1
        for j, (kind, area) in enumerate(allocations(row.batch, i)):
            rows.append({"batch": row.batch, "image_id": row.image_id, "strip_id": row.strip_id,
                         "particle_id": f"{row.image_id}_{j}", "area_um2": area, "type": kind})
    return pd.DataFrame(rows, columns=PARTICLE_COLUMNS)


def imaging_table(kpis, black_overrides=None, curtain_overrides=None):
    black_overrides, curtain_overrides = black_overrides or {}, curtain_overrides or {}
    indices = {}
    rows = []
    for row in kpis.itertuples(index=False):
        i = indices.get(row.batch, 0)
        indices[row.batch] = i + 1
        for channel in ("BSE", "ETD", "InLens"):
            rows.append({
                "batch": row.batch,
                "image_id": row.image_id,
                "strip_id": row.strip_id,
                "channel": channel,
                "black_level": black_overrides.get((row.image_id, channel), 0),
                "p1": 5,
                "p50": 100 + i,
                "p99": 240,
                "noise": 3,
                "sharpness": 50 + i,
                "saturated_frac": 0,
                "curtaining_index": curtain_overrides.get((row.image_id, channel), 0.1),
            })
    return pd.DataFrame(rows, columns=IMAGING_COLUMNS)


def test_type_shares_become_key_quantities():
    layout = {"r": {f"R{i}": 1 for i in range(6)}, "b": {f"B{i}": 1 for i in range(4)}}
    kpis = synth_kpis(layout)
    particles = particle_table(
        kpis,
        lambda batch, i: ([("T1", 7 + 0.1 * i), ("T2", 3 - 0.1 * i)] if batch == "r"
                          else [("T1", 3 + 0.1 * i), ("T2", 7 - 0.1 * i)]),
    )
    tables = split_tables(kpis, particles)
    cfg = CFG | {"key_descriptors": []}
    evidence = evaluate(tables, "b", cfg)
    by_name = {d.name: d for d in evidence.differences}
    for name in ("type_share:T1", "type_share:T2"):
        assert by_name[name].key and by_name[name].used and by_name[name].unit == "fraction"
    assert by_name["type_share:T1"].status == "DIFFERENT"
    assert evidence.verdict == "REJECT"
    assert {d.name for d in evidence.fingerprint.type_shares} == {"T1", "T2"}
    assert all(set(d.by_strip) == {s.strip_id for s in evidence.fingerprint.segments}
               for d in evidence.fingerprint.type_shares)
    assert not any(d.name.startswith("type_share:") for d in evidence.fingerprint.descriptors)

    without_type_keys = evaluate(tables, "b", cfg | {"key_type_shares": False})
    assert not next(d for d in without_type_keys.differences if d.name == "type_share:T1").key


def test_new_type_share():
    layout = {"r": {f"R{i}": 1 for i in range(4)}, "b": {f"B{i}": 1 for i in range(4)}}
    kpis = synth_kpis(layout)
    particles = particle_table(
        kpis,
        lambda batch, _: [("T1", 50), ("T2", 50)] if batch == "r"
        else [("T1", 45), ("T2", 45), ("unassigned", 10)],
    )
    evidence = evaluate(split_tables(kpis, particles), "b", CFG | {"key_descriptors": []})
    assert evidence.new_type_share == 0.1
    assert evidence.verdict == "REJECT"
    assert any(reason.startswith("Contains a particle type not seen before") for reason in evidence.reasons)
    unassigned = next(d for d in evidence.differences if d.name == "unassigned_share")
    assert not unassigned.key

    untyped = particle_table(kpis, lambda _batch, _i: [(np.nan, 10)])
    empty_evidence = evaluate(split_tables(kpis, untyped), "b", CFG | {"key_descriptors": []})
    assert empty_evidence.new_type_share is None
    assert not any(d.name.startswith("type_share:") for d in empty_evidence.differences)


def test_imaging_check():
    layout = {"r": {**{f"R{i}": 1 for i in range(6)}, "outlier": 1},
              "b": {f"B{i}": 1 for i in range(6)}}
    kpis = synth_kpis(layout)
    outlier = "r_outlier_0"
    imaging = imaging_table(kpis, {(outlier, "BSE"): 22})
    tables = split_tables(kpis, imaging=imaging)
    evidence = evaluate(tables, "b", CFG)
    assert evidence.imaging.outliers_in_reference == [outlier]
    assert evidence.imaging.changed is False

    ids = set(tables["b"].kpis["image_id"])
    target = sorted(ids)[0]
    changed_imaging = imaging.copy()
    changed_imaging.loc[(changed_imaging["image_id"] == target)
                        & (changed_imaging["channel"] == "BSE"), "black_level"] = 6
    changed = evaluate(split_tables(kpis, imaging=changed_imaging), "b", CFG)
    assert changed.imaging.changed and "BSE.black_level" in changed.imaging.changed_metrics
    for name in ("si_contrast_ratio", "porosity_apparent"):
        difference = next(d for d in changed.differences if d.name == name)
        assert not difference.used and difference.note == "imaging changed"
        assert name not in changed.other_unit.statuses
    assert any(reason.startswith("Imaging changed") for reason in changed.reasons)

    padded_imaging = imaging.copy()
    padded_imaging.loc[(padded_imaging["image_id"] == target)
                       & (padded_imaging["channel"] == "BSE"), "black_level"] = 1
    padded = evaluate(split_tables(kpis, imaging=padded_imaging), "b", CFG)
    assert padded.imaging.changed is False


def test_curtaining_blanks_run_lengths():
    layout = {"r": {f"R{i}": 1 for i in range(4)}, "b": {f"B{i}": 1 for i in range(4)}}
    kpis = synth_kpis(layout)
    kpis["graphite_chord_um"] = [
        (10 + i) if row.batch == "r" else (20 + i)
        for i, row in enumerate(kpis.itertuples(index=False))
    ]
    target = "b_B0_0"
    imaging = imaging_table(kpis, curtain_overrides={(target, "BSE"): 0.9})
    tables = split_tables(kpis, imaging=imaging)

    off = evaluate(tables, "b", CFG | {"curtaining_max": None})
    on = evaluate(tables, "b", CFG | {"curtaining_max": 0.5})
    assert off.imaging.curtained_images == []
    assert on.imaging.curtained_images == [target]
    off_count = next(d.n_segments[0] for d in off.differences if d.name == "graphite_chord_um")
    on_count = next(d.n_segments[0] for d in on.differences if d.name == "graphite_chord_um")
    assert on_count == off_count - 1


def test_read_tables(tmp_path):
    layout = {"r": {"R0": 1}, "b": {"B0": 1}}
    kpis = synth_kpis(layout)
    kpis_csv = tmp_path / "kpis.csv"
    kpis.to_csv(kpis_csv, index=False)
    particles = particle_table(kpis, lambda _batch, _i: [("T1", 10)])
    imaging = imaging_table(kpis)
    particles.to_csv(tmp_path / "particles.csv", index=False)
    imaging.to_csv(tmp_path / "imaging.csv", index=False)

    tables = read_tables(kpis_csv)
    assert not tables["b"].particles.empty and not tables["b"].imaging.empty

    only_dir = tmp_path / "only"
    only_dir.mkdir()
    only_csv = only_dir / "kpis.csv"
    kpis.to_csv(only_csv, index=False)
    only_tables = read_tables(only_csv)
    assert only_tables["b"].particles.empty
    assert list(only_tables["b"].particles.columns) == PARTICLE_COLUMNS
    assert only_tables["b"].imaging.empty
    assert list(only_tables["b"].imaging.columns) == IMAGING_COLUMNS

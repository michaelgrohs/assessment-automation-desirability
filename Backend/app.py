# app.py
import re
import multiprocessing
try:
    multiprocessing.set_start_method('fork', force=True)
except RuntimeError:
    pass

import platform
import sys
print("PYTHON EXECUTABLE:", sys.executable)
print("ARCH:", platform.machine())

print(">>> BEFORE pm4py import")
import pm4py
print(">>> AFTER pm4py import")

print(">>> BEFORE dowhy import")
from dowhy import CausalModel
print(">>> AFTER dowhy import")

import json
import numpy as np
import pm4py

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask import send_from_directory
import os
import pandas as pd
from pm4py.objects.conversion.log import converter as log_converter

from process_mining.process_bpmn import parse_bpmn
from process_mining.process_xes import parse_xes
from process_mining.conformance_alignments import (
    calculate_alignments,
    get_fitness_per_trace,
    get_conformance_bins,
    get_outcome_distribution,
    get_conformance_by_role,
    get_conformance_by_event_attribute,
    get_unique_sequences_per_bin,
    get_requested_amount_vs_conformance,
    get_conformance_by_resource,
    get_trace_sequences,
    get_all_activities_from_bpmn,
    get_all_activities_from_model,
    build_trace_deviation_matrix_df
)

from process_mining.activity_deviations import get_activity_deviations
from pm4py.objects.log.importer.xes import importer as xes_importer


import traceback

app = Flask(__name__)
CORS(app, supports_credentials=True)

@app.errorhandler(Exception)
def handle_exception(e):
    tb = traceback.format_exc()
    print(tb)
    return jsonify({"error": str(e), "traceback": tb}), 500

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Store the filenames of the last uploaded files
last_uploaded_files = {
    "bpmn": None,
    "xes": None
}

last_uploaded_data = {
    "bpmn_path": None,
    "xes_path": None,
    "decl_path": None,
    "bpmn_model": None,
    "xes_log": None,
    "alignments": None,
    "deviation_matrix": None,
    "original_deviation_matrix": None,
    "deviation_labels": None,
    "impact_matrix": None,
    "aggregated_base_matrix": None,  # issue-grouped matrix (set by /api/apply-issue-grouping)
    "trace_features": None,  # pre-computed per-trace features (BPMN modes)
    "resources_by_deviation": None,  # {deviation_col: [resource, ...]} computed at upload time
    "stored_issue_map": None,  # issue_map from last /api/apply-issue-grouping call
    "mode": "bpmn",
    "atoms": None,
    "atoms_df": None,
    "event_log_pa": None,
    "mined_decl_path": None,
    "decl_constraint_info": None,
    "violation_diagnostics": None,
    "trace_time_deltas": None,
    "alignment_status": "idle",
    "alignment_error": None,
    # Filtering state
    "filtered_log": None,
    "filtered_alignments": None,
    "excluded_case_ids": [],
    "excluded_by_step": {},
    "is_filtered": False,
}

def reset_cache():
    last_uploaded_data["bpmn_model"] = None
    last_uploaded_data["xes_log"] = None
    last_uploaded_data["alignments"] = None
    last_uploaded_data["deviation_matrix"] = None
    last_uploaded_data["original_deviation_matrix"] = None
    last_uploaded_data["impact_matrix"] = None
    last_uploaded_data["aggregated_base_matrix"] = None
    last_uploaded_data["mode"] = "bpmn"
    last_uploaded_data["atoms"] = None
    last_uploaded_data["atoms_df"] = None
    last_uploaded_data["event_log_pa"] = None
    last_uploaded_data["mined_decl_path"] = None
    last_uploaded_data["decl_path"] = None
    last_uploaded_data["decl_constraint_info"] = None
    last_uploaded_data["violation_diagnostics"] = None
    last_uploaded_data["trace_time_deltas"] = None
    last_uploaded_data["alignment_status"] = "idle"
    last_uploaded_data["alignment_error"] = None
    last_uploaded_data["filtered_log"] = None
    last_uploaded_data["filtered_alignments"] = None
    last_uploaded_data["excluded_case_ids"] = []
    last_uploaded_data["excluded_by_step"] = {}
    last_uploaded_data["is_filtered"] = False
    last_uploaded_data["resources_by_deviation"] = None
    last_uploaded_data["stored_issue_map"] = None

@app.route("/api/reset", methods=["POST"])
def api_reset():
    reset_cache()
    return jsonify({"message": "Cache reset successfully"})


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"}), 200


@app.route('/upload', methods=['POST'])
def upload_files():
    print("\n==== UPLOAD CALLED ====")
    print("Request files:", request.files)
    print("Request form:", request.form)

    # Save files
    bpmn_file = request.files['bpmn']
    xes_file = request.files['xes']

    print("BPMN file:", bpmn_file)
    print("XES file:", xes_file)

    if not bpmn_file or not xes_file:
        return jsonify({"error": "Missing process model or event log file"}), 400

    if xes_file.filename == '':
        return jsonify({"error": "Empty XES filename"}), 400

    upload_folder = "uploads"
    os.makedirs(upload_folder, exist_ok=True)

    xes_path = os.path.join(upload_folder, xes_file.filename)
    bpmn_path = os.path.join(upload_folder, bpmn_file.filename)

    xes_file.save(xes_path)
    bpmn_file.save(bpmn_path)

    print("Saved XES to:", xes_path)
    print("Saved BPMN to:", bpmn_path)


    # Store paths and clear any previously cached results from prior uploads
    last_uploaded_data['bpmn_path'] = bpmn_path
    last_uploaded_data['xes_path'] = xes_path
    last_uploaded_data['deviation_matrix'] = None
    last_uploaded_data['original_deviation_matrix'] = None
    last_uploaded_data['impact_matrix'] = None
    last_uploaded_data['aggregated_base_matrix'] = None
    last_uploaded_data['atoms'] = None
    last_uploaded_data['atoms_df'] = None
    last_uploaded_data['event_log_pa'] = None
    last_uploaded_data['excluded_case_ids'] = []
    last_uploaded_data['excluded_by_step'] = {}
    last_uploaded_data['is_filtered'] = False

    # Parse BPMN
    bpmn_model = parse_bpmn(bpmn_path)
    last_uploaded_data['bpmn_model'] = bpmn_model

    # Parse XES or CSV
    filename, file_extension = os.path.splitext(xes_path)
    print(file_extension)
    if file_extension == '.csv':
        log_csv = pd.read_csv(xes_path, encoding='utf-8-sig')
        log_csv['time:timestamp'] = pd.to_datetime(log_csv['time:timestamp'], utc=True)
        xes_log = log_converter.apply(log_csv)
    elif file_extension == '.xes':
        xes_log = xes_importer.apply(xes_path)
    else:
        return jsonify({"error": "Unsupported log format"}), 400

    last_uploaded_data['xes_log'] = xes_log

    alignments = calculate_alignments(bpmn_path, xes_log)
    last_uploaded_data['alignments'] = alignments
    last_uploaded_data['mode'] = 'bpmn'

    try:
        log_df_feats = pm4py.convert_to_dataframe(xes_log)
        last_uploaded_data['trace_features'] = _compute_trace_features(log_df_feats)
        print("[INFO] Trace features pre-computed (BPMN upload)")
    except Exception as e:
        last_uploaded_data['trace_features'] = None
        print(f"[WARN] Could not pre-compute trace features: {e}")

    print("Alignments computed successfully")

    return jsonify({
        "message": "Files uploaded and alignments computed",
        "alignment_count": len(alignments)
    })


def validate_xes_log(xes_log):
    """
    Check that the parsed pm4py EventLog has the required fields.
    Returns a list of human-readable error strings (empty = valid).
    """
    errors = []
    missing_case_id = []
    missing_concept = []
    missing_timestamp = []

    for i, trace in enumerate(xes_log):
        if 'concept:name' not in trace.attributes:
            missing_case_id.append(i)
        for j, event in enumerate(trace):
            if 'concept:name' not in event:
                missing_concept.append((i, j))
            if 'time:timestamp' not in event:
                missing_timestamp.append((i, j))

    if missing_case_id:
        sample = missing_case_id[:3]
        errors.append(
            f"Missing 'case:concept:name' on {len(missing_case_id)} trace(s) "
            f"(e.g. trace indices {sample}). Every trace must have a case ID."
        )
    if missing_concept:
        sample = missing_concept[:3]
        errors.append(
            f"Missing 'concept:name' on {len(missing_concept)} event(s) "
            f"(e.g. {sample}). Every event must have an activity name."
        )
    if missing_timestamp:
        sample = missing_timestamp[:3]
        errors.append(
            f"Missing 'time:timestamp' on {len(missing_timestamp)} event(s) "
            f"(e.g. {sample}). Every event must have a timestamp."
        )
    return errors


def _compute_alignments_background():
    """Run alignment computation in a background thread (called after mining is done)."""
    last_uploaded_data['alignment_status'] = 'computing'
    last_uploaded_data['alignment_error'] = None
    try:
        log = get_cached_xes_log()
        aligned_traces = calculate_alignments(
            last_uploaded_data['bpmn_path'], log
        )
        last_uploaded_data['alignments'] = aligned_traces
        last_uploaded_data['alignment_status'] = 'ready'
        print(f"Background alignments done: {len(aligned_traces)} traces")
    except Exception as e:
        last_uploaded_data['alignment_status'] = 'error'
        last_uploaded_data['alignment_error'] = str(e)
        print(f"Background alignment error: {e}")


def _mine_and_align_background(algorithm, noise_threshold, xes_path, upload_folder, log_stem):
    """Mine process model via subprocess (avoids fork-in-thread deadlock on macOS), then compute alignments."""
    import subprocess
    try:
        print(f"[bg] Mining model with algorithm={algorithm}, noise_threshold={noise_threshold}", flush=True)
        mined_models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mined_models')
        os.makedirs(mined_models_dir, exist_ok=True)
        bpmn_path = os.path.join(mined_models_dir, f'{log_stem}_{algorithm}.bpmn')
        worker_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'process_mining', 'mine_worker.py')
        args_json = json.dumps({
            'algorithm': algorithm,
            'noise_threshold': noise_threshold,
            'xes_path': os.path.abspath(xes_path),
            'bpmn_path': os.path.abspath(bpmn_path),
        })
        proc = subprocess.Popen(
            [sys.executable, worker_script, args_json],
            stdin=subprocess.DEVNULL,
        )
        returncode = proc.wait(timeout=600)
        if returncode != 0:
            raise RuntimeError(f'Mining subprocess exited with code {returncode}')

        last_uploaded_data['bpmn_path'] = bpmn_path
        print(f"[bg] Mining done, starting alignments", flush=True)
        _compute_alignments_background()
    except Exception as e:
        last_uploaded_data['alignment_status'] = 'error'
        last_uploaded_data['alignment_error'] = str(e)
        print(f"[bg] Mining error: {e}", flush=True)


@app.route('/api/alignment-status', methods=['GET'])
def alignment_status_route():
    return jsonify({
        "status": last_uploaded_data.get('alignment_status', 'idle'),
        "error": last_uploaded_data.get('alignment_error'),
    })


@app.route('/upload-mine-model', methods=['POST'])
def upload_mine_model():
    """Mine a process model from the event log and compute trace alignments."""
    xes_file = request.files.get('xes')
    if not xes_file:
        return jsonify({"error": "Missing event log file"}), 400

    algorithm = request.form.get('algorithm', 'inductive_infrequent')
    noise_threshold = float(request.form.get('noise_threshold', '0.2'))

    upload_folder = 'uploads'
    os.makedirs(upload_folder, exist_ok=True)

    raw_name = os.path.basename(xes_file.filename)
    log_stem = raw_name.split('.')[0].replace(' ', '_')

    xes_path = os.path.join(upload_folder, xes_file.filename)
    xes_file.save(xes_path)

    _, ext = os.path.splitext(xes_path)
    if ext == '.csv':
        log_csv = pd.read_csv(xes_path, encoding='utf-8-sig')
        log_csv['time:timestamp'] = pd.to_datetime(log_csv['time:timestamp'], utc=True)
        xes_log = log_converter.apply(log_csv)
    elif ext in ('.xes', '.gz'):
        xes_log = xes_importer.apply(xes_path)
    else:
        return jsonify({"error": f"Unsupported log format: {ext}"}), 400

    xes_errors = validate_xes_log(xes_log)
    if xes_errors:
        return jsonify({"error": "Invalid XES log:\n" + "\n".join(xes_errors)}), 400

    last_uploaded_data['bpmn_path'] = None
    last_uploaded_data['xes_path'] = xes_path
    last_uploaded_data['xes_log'] = xes_log
    last_uploaded_data['bpmn_model'] = None
    last_uploaded_data['deviation_matrix'] = None
    last_uploaded_data['impact_matrix'] = None
    last_uploaded_data['aggregated_base_matrix'] = None
    last_uploaded_data['alignments'] = None
    last_uploaded_data['atoms'] = None
    last_uploaded_data['atoms_df'] = None
    last_uploaded_data['event_log_pa'] = None
    last_uploaded_data['mode'] = 'bpmn'
    last_uploaded_data['alignment_status'] = 'mining'
    last_uploaded_data['alignment_error'] = None

    try:
        log_df_feats = pm4py.convert_to_dataframe(xes_log)
        last_uploaded_data['trace_features'] = _compute_trace_features(log_df_feats)
        print("[INFO] Trace features pre-computed (mine-model upload)")
    except Exception as e:
        last_uploaded_data['trace_features'] = None
        print(f"[WARN] Could not pre-compute trace features: {e}")

    import threading
    t = threading.Thread(
        target=_mine_and_align_background,
        args=(algorithm, noise_threshold, xes_path, upload_folder, log_stem),
        daemon=True,
    )
    t.start()

    return jsonify({
        "message": f"Mining started ({algorithm})",
        "algorithm": algorithm,
    })


@app.route('/api/available-templates', methods=['GET'])
def available_templates():
    from process_mining.process_atoms.mine.declare.enums.mp_constants import Template
    templates = [t.templ_str for t in Template if t.is_binary]
    return jsonify({"templates": templates})


@app.route('/upload-declarative', methods=['POST'])
def upload_declarative():
    from process_mining.process_atoms.processatoms import ProcessAtoms
    from process_mining.process_atoms.mine.declare.regexchecker import RegexChecker
    from process_mining.process_atoms.models.event_log import EventLog, EventLogSchemaTypes
    from process_mining.process_atoms.models.column_types import (
        CaseID, Categorical, EventType, EventTime, Continuous,
    )

    print("\n==== UPLOAD DECLARATIVE CALLED ====")

    xes_file = request.files.get('xes')
    if not xes_file or xes_file.filename == '':
        return jsonify({"error": "Missing event log file"}), 400

    templates_json = request.form.get('templates', '[]')
    min_support_str = request.form.get('min_support', '0.1')

    considered_templates = json.loads(templates_json)
    min_support = float(min_support_str)

    upload_folder = "uploads"
    os.makedirs(upload_folder, exist_ok=True)
    xes_path = os.path.join(upload_folder, xes_file.filename)
    xes_file.save(xes_path)

    last_uploaded_data['xes_path'] = xes_path
    last_uploaded_data['bpmn_path'] = None
    last_uploaded_data['bpmn_model'] = None
    last_uploaded_data['alignments'] = None
    last_uploaded_data['deviation_matrix'] = None
    last_uploaded_data['impact_matrix'] = None
    last_uploaded_data['aggregated_base_matrix'] = None

    # Parse log with pm4py (for downstream compatibility)
    filename_base, file_extension = os.path.splitext(xes_path)
    if file_extension == '.csv':
        log_csv = pd.read_csv(xes_path, encoding='utf-8-sig')
        log_csv['time:timestamp'] = pd.to_datetime(log_csv['time:timestamp'], utc=True)
        xes_log = log_converter.apply(log_csv)
    elif file_extension == '.xes':
        xes_log = xes_importer.apply(xes_path)
    else:
        return jsonify({"error": "Unsupported log format"}), 400

    last_uploaded_data['xes_log'] = xes_log

    # Build process_atoms EventLog from pm4py log
    log_df = pm4py.convert_to_dataframe(xes_log)

    # Auto-detect columns
    case_col = None
    activity_col = None
    timestamp_col = None
    for col in log_df.columns:
        cl = col.lower()
        if 'case' in cl and 'id' in cl:
            case_col = col
        elif cl in ('concept:name', 'activity'):
            activity_col = col
        elif 'timestamp' in cl or 'time' in cl:
            timestamp_col = col

    if not case_col:
        case_col = 'case:concept:name'
    if not activity_col:
        activity_col = 'concept:name'
    if not timestamp_col:
        timestamp_col = 'time:timestamp'

    # Build schema: case attributes + event attributes
    case_attrs = {}
    event_attrs = {}

    case_attrs[case_col] = CaseID
    event_attrs[case_col] = CaseID
    event_attrs[activity_col] = EventType
    event_attrs[timestamp_col] = EventTime

    # Add extra columns as Categorical or Continuous
    for col in log_df.columns:
        if col in (case_col, activity_col, timestamp_col):
            continue
        if col.startswith('(case)') or col.startswith('case:'):
            if pd.api.types.is_numeric_dtype(log_df[col]):
                case_attrs[col] = Continuous
            else:
                case_attrs[col] = Categorical
        else:
            if pd.api.types.is_numeric_dtype(log_df[col]):
                event_attrs[col] = Continuous
            else:
                event_attrs[col] = Categorical

    schema = EventLogSchemaTypes(cases=case_attrs, events=event_attrs)

    df_cases = log_df[list(case_attrs.keys())].drop_duplicates(subset=case_col)
    df_events = log_df[list(event_attrs.keys())]

    event_log = EventLog(df_cases, df_events, schema)
    last_uploaded_data['event_log_pa'] = event_log

    # Mine atoms
    process_id = "declarative_process"
    api = ProcessAtoms()
    atoms = api.mine_atoms_from_log(
        process_id,
        event_log,
        considered_templates,
        min_support=min_support,
        local=True,
        consider_vacuity=False,
    )
    print(f"[declarative] Mined {len(atoms)} atoms with min_support={min_support}, consider_vacuity=False")

    last_uploaded_data['atoms'] = atoms

    # Build atoms_df
    records = []
    for atom in atoms:
        records.append({
            "type": atom.atom_type,
            "op_0": atom.operands[0],
            "op_1": atom.operands[1] if len(atom.operands) > 1 else "",
            "support": atom.support,
            "confidence": atom.attributes.get("confidence", 0.0),
        })
    atoms_df = pd.DataFrame.from_records(records)
    if len(atoms_df) > 0:
        atoms_df = atoms_df.sort_values(by="confidence", ascending=False).reset_index(drop=True)
    last_uploaded_data['atoms_df'] = atoms_df

    # Build constraint violation matrix
    dev_cols = []
    for i in range(len(atoms_df)):
        dev_cols.append(f"{atoms_df['type'][i]}_{atoms_df['op_0'][i]}_{atoms_df['op_1'][i]}")

    collect_data = pd.DataFrame(data=0, index=range(len(event_log)), columns=dev_cols)
    collect_data['case_id'] = None

    for i, d in enumerate(dev_cols):
        the_atom = None
        for atom in atoms:
            expected_ops = [atoms_df['op_0'][i]]
            if atoms_df['op_1'][i]:
                expected_ops.append(atoms_df['op_1'][i])
            if atom.atom_type == atoms_df['type'][i] and atom.operands == expected_ops:
                the_atom = atom
                break

        if the_atom is None:
            print(f"[declarative] WARNING: no atom found for column {d!r} (skipping)")
            continue

        checker = RegexChecker(process_id, event_log)
        activities = checker.log.unique_activities()
        activity_map = checker._map_activities_to_letters(activities)
        variant_frame = checker.create_variant_frame_from_log(activity_map)
        variant_frame["sat"] = checker.compute_satisfaction(
            the_atom, variant_frame, activity_map, consider_vacuity=False
        )

        if i == 0:
            collect_data['case_id'] = list(
                val for cases in variant_frame["case_ids"].values for val in cases
            )

        violation_count = 0
        for j in range(len(variant_frame)):
            for case_id in variant_frame["case_ids"][j]:
                ids = collect_data.index[collect_data['case_id'] == case_id]
                if variant_frame["sat"][j] == 1:
                    collect_data.loc[ids, d] = 0
                else:
                    collect_data.loc[ids, d] = 1
                    violation_count += 1

        print(f"[declarative] Constraint {d!r}: {violation_count} violations")

    # Compute trace duration per case
    if timestamp_col in log_df.columns:
        log_df[timestamp_col] = pd.to_datetime(log_df[timestamp_col])
        durations = log_df.groupby(case_col)[timestamp_col].agg(['min', 'max'])
        durations['duration'] = (durations['max'] - durations['min']).dt.total_seconds()
        duration_map = durations['duration'].to_dict()
        collect_data['trace_duration_seconds'] = collect_data['case_id'].map(duration_map).fillna(0)
    else:
        collect_data['trace_duration_seconds'] = 0.0

    # Rename case_id → trace_id to match BPMN matrix format
    collect_data = collect_data.rename(columns={'case_id': 'trace_id'})

    # Add trace-level attributes from df_cases (all columns except case_col itself)
    trace_attr_cols = [col for col in df_cases.columns if col != case_col]
    df_cases_indexed = df_cases.set_index(case_col)
    for col in trace_attr_cols:
        attr_map = df_cases_indexed[col].to_dict()
        collect_data[col] = collect_data['trace_id'].map(attr_map)

    # Add activities column: ordered list of activity names per trace
    if timestamp_col in log_df.columns:
        activities_per_case = (
            log_df.sort_values(timestamp_col)
            .groupby(case_col)[activity_col]
            .apply(list)
            .to_dict()
        )
    else:
        activities_per_case = log_df.groupby(case_col)[activity_col].apply(list).to_dict()
    collect_data['activities'] = collect_data['trace_id'].map(activities_per_case)

    # Reorder columns: trace_id, trace attributes, trace_duration_seconds, activities, violation columns
    ordered_cols = (
        ['trace_id']
        + trace_attr_cols
        + ['trace_duration_seconds', 'activities']
        + dev_cols
    )
    collect_data = collect_data[[c for c in ordered_cols if c in collect_data.columns]]

    # Merge per-trace features (event_count, rework_count, inter-event gaps, resource count)
    try:
        trace_features = _compute_trace_features(log_df, case_col=case_col, activity_col=activity_col,
                                                  timestamp_col=timestamp_col)
        collect_data = collect_data.merge(trace_features, on='trace_id', how='left')
        print(f"[INFO] Trace features added (declarative): {[c for c in trace_features.columns if c != 'trace_id']}")
    except Exception as feat_err:
        import traceback
        print(f"[WARN] Could not compute trace features (declarative): {feat_err}")
        traceback.print_exc()

    last_uploaded_data['deviation_matrix'] = collect_data
    last_uploaded_data['original_deviation_matrix'] = collect_data.copy()
    last_uploaded_data['mode'] = 'declarative'
    last_uploaded_data['excluded_case_ids'] = []
    last_uploaded_data['excluded_by_step'] = {}
    last_uploaded_data['is_filtered'] = False

    print(f"Mined {len(atoms)} constraints, matrix shape: {collect_data.shape}")

    # Compute resources per deviation column (declarative-mine)
    try:
        decl_constraint_lookup = {}
        atoms_df_ref = last_uploaded_data.get('atoms_df')
        if atoms_df_ref is not None:
            for _, row in atoms_df_ref.iterrows():
                cname = f"{row['type']}_{row['op_0']}_{row['op_1']}"
                decl_constraint_lookup[cname] = {
                    'type': str(row['type']),
                    'operands': [str(row['op_0']), str(row['op_1'])],
                }
        last_uploaded_data['resources_by_deviation'] = _compute_resources_by_deviation(
            log_df, collect_data, mode='declarative', constraint_info_lookup=decl_constraint_lookup,
            case_col=case_col, activity_col=activity_col,
        )
    except Exception as res_err:
        import traceback
        print(f"[WARN] Could not compute resources_by_deviation (declarative-mine): {res_err}")
        traceback.print_exc()

    # Save mined model as .decl to mined_models/
    mined_models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mined_models')
    os.makedirs(mined_models_dir, exist_ok=True)
    log_stem = os.path.splitext(os.path.basename(last_uploaded_data.get('xes_path', 'log.xes')))[0].replace(' ', '_')
    decl_filename = f"{log_stem}_mined.decl"
    decl_save_path = os.path.join(mined_models_dir, decl_filename)
    decl_content = _atoms_to_decl_string(atoms)
    with open(decl_save_path, 'w', encoding='utf-8') as f:
        f.write(decl_content)
    last_uploaded_data['mined_decl_path'] = decl_save_path
    print(f"Saved mined .decl to {decl_save_path}")

    atom_summary = atoms_df.to_dict(orient="records") if len(atoms_df) > 0 else []

    return jsonify({
        "message": "Declarative constraints mined successfully",
        "constraint_count": len(atoms),
        "atom_summary": atom_summary,
        "decl_filename": decl_filename,
    })


def get_cached_impact_matrix():
    return last_uploaded_data.get("impact_matrix")

def get_cached_alignments():
    import time
    # Wait for background computation if it is in progress
    while last_uploaded_data.get('alignment_status') == 'computing':
        time.sleep(0.5)
    if last_uploaded_data['alignments'] is None:
        last_uploaded_data['alignments'] = calculate_alignments(
            last_uploaded_data['bpmn_path'],
            get_cached_xes_log()
        )
        print('alignments computed')
    return last_uploaded_data['alignments']

def get_cached_xes_log():
    if last_uploaded_data['xes_log'] is None and last_uploaded_data['xes_path']:
        last_uploaded_data['xes_log'] = xes_importer.apply(last_uploaded_data['xes_path'])
    return last_uploaded_data['xes_log']

def get_cached_deviation_matrix():
    if last_uploaded_data["deviation_matrix"] is None:

        # Declarative matrix can only be built during upload — cannot reconstruct here
        if last_uploaded_data.get("mode") == "declarative":
            return pd.DataFrame()

        print("⚙️ Building deviation matrix...")

        log = get_cached_xes_log()
        aligned_traces = get_cached_alignments()

        df, labels = build_trace_deviation_matrix_df(log, aligned_traces)

        # Merge pre-computed trace features (event_count, rework_count, inter-event gaps, resource count)
        trace_features = last_uploaded_data.get('trace_features')
        if trace_features is not None and not trace_features.empty:
            df = df.merge(trace_features, on='trace_id', how='left')
            print(f"[INFO] Trace features merged (BPMN): {[c for c in trace_features.columns if c != 'trace_id']}")

        last_uploaded_data["deviation_matrix"] = df
        last_uploaded_data["deviation_labels"] = labels

        # Cache the original (unfiltered) matrix once
        if last_uploaded_data.get("original_deviation_matrix") is None:
            last_uploaded_data["original_deviation_matrix"] = df.copy()

        # Compute resources per deviation column (BPMN)
        try:
            log_df_res = pm4py.convert_to_dataframe(log)
            last_uploaded_data["resources_by_deviation"] = _compute_resources_by_deviation(
                log_df_res, df, mode='bpmn'
            )
        except Exception as res_err:
            import traceback
            print(f"[WARN] Could not compute resources_by_deviation (BPMN): {res_err}")
            traceback.print_exc()

        print("✅ Deviation matrix cached.")
        print("Shape:", df.shape)

    return last_uploaded_data["deviation_matrix"]


def _compute_resources_by_deviation(log_df, deviation_df, mode, constraint_info_lookup=None,
                                     case_col='case:concept:name', activity_col='concept:name'):
    """
    For each binary deviation column in deviation_df, compute which org:resource values
    are responsible for that deviation.

    BPMN:
      (Insert X): resources from events with activity X in DEVIATING traces
                  (they inserted an activity that shouldn't be there)
      (Skip X):   resources from events with activity X across ALL traces
                  (they normally execute X, but skipped it in deviating traces)

    Declarative — depends on constraint semantics:
      Insertion-like (Absence, Not* constraints):
          the violating activity exists when it shouldn't →
          resources from events with the target activity in DEVIATING traces
      Skip-like (Existence, Response, Precedence, Succession, …):
          the required activity is missing →
          resources from events with the target activity across ALL traces
          (those who normally perform it, but didn't in deviating traces)
    """
    NON_META = {
        'trace_id', 'trace_duration_seconds', 'activities',
        'event_count', 'rework_count', 'max_inter_event_gap_seconds',
        'avg_inter_event_gap_seconds', 'unique_resource_count',
    }

    # Find resource column
    resource_col = None
    for rc in ('org:resource', 'org:group', 'Resource'):
        if rc in log_df.columns:
            resource_col = rc
            break
    if resource_col is None:
        print(f"[WARN] _compute_resources_by_deviation: no resource column found. Columns: {list(log_df.columns)}")
        return {}

    print(f"[INFO] _compute_resources_by_deviation: case_col={case_col!r}, activity_col={activity_col!r}, resource_col={resource_col!r}, mode={mode}")

    # Pre-build: activity → resources from ALL traces (for skip-like lookups)
    act_all_resources = {}
    for act, grp in log_df.groupby(activity_col)[resource_col]:
        act_all_resources[str(act)] = set(grp.dropna().astype(str))

    # DECLARE constraint type → (skip_like, operand_index_for_target_activity)
    # skip_like=True  → look in ALL traces for that activity
    # skip_like=False → look in DEVIATING traces for that activity
    CONSTRAINT_SEMANTICS = {
        # Skip-like: target activity is missing in violations
        'Existence': (True, 0), 'Existence1': (True, 0), 'Existence2': (True, 0),
        'Init': (True, 0), 'End': (True, 0),
        'Response': (True, 1), 'ChainResponse': (True, 1), 'AlternateResponse': (True, 1),
        'RespondedExistence': (True, 1), 'CoExistence': (True, 1),
        'Precedence': (True, 0), 'ChainPrecedence': (True, 0), 'AlternatePrecedence': (True, 0),
        'Succession': (True, 1), 'ChainSuccession': (True, 1), 'AlternateSuccession': (True, 1),
        # Insertion-like: target activity appears when it shouldn't
        'Absence': (False, 0), 'Absence1': (False, 0), 'Absence2': (False, 0),
        'NotResponse': (False, 1), 'NotChainResponse': (False, 1), 'NotAlternateResponse': (False, 1),
        'NotPrecedence': (False, 1), 'NotChainPrecedence': (False, 1), 'NotAlternatePrecedence': (False, 1),
        'NotSuccession': (False, 1), 'NotChainSuccession': (False, 1), 'NotAlternateSuccession': (False, 1),
        'NotCoExistence': (False, 1), 'NotRespondedExistence': (False, 1),
    }

    result = {}

    for col in deviation_df.columns:
        if col in NON_META:
            continue
        col_vals = set(deviation_df[col].dropna().unique())
        if not col_vals.issubset({0, 1, 0.0, 1.0}):
            continue

        deviating_ids = set(deviation_df.loc[deviation_df[col] == 1, 'trace_id'].astype(str))

        if mode == 'bpmn':
            m_ins = re.match(r'\(Insert (.+?)\)$', col)
            m_skip = re.match(r'\(Skip (.+?)\)$', col)
            if m_ins:
                act = m_ins.group(1)
                mask = (log_df[case_col].astype(str).isin(deviating_ids)) & (log_df[activity_col] == act)
                resources = sorted(log_df.loc[mask, resource_col].dropna().astype(str).unique())
            elif m_skip:
                act = m_skip.group(1)
                resources = sorted(act_all_resources.get(act, set()))
            else:
                resources = []
        else:
            # Declarative
            info = (constraint_info_lookup or {}).get(col, {})
            ctype = info.get('type', '')
            operands = info.get('operands', [])

            if not ctype or not operands:
                # Fallback: all resources from deviating traces
                mask = log_df[case_col].astype(str).isin(deviating_ids)
                resources = sorted(log_df.loc[mask, resource_col].dropna().astype(str).unique())
            else:
                semantics = CONSTRAINT_SEMANTICS.get(ctype)
                if semantics is None:
                    mask = log_df[case_col].astype(str).isin(deviating_ids)
                    resources = sorted(log_df.loc[mask, resource_col].dropna().astype(str).unique())
                else:
                    skip_like, op_idx = semantics
                    target_act = operands[op_idx] if op_idx < len(operands) else operands[0]
                    if skip_like:
                        resources = sorted(act_all_resources.get(target_act, set()))
                    else:
                        mask = (log_df[case_col].astype(str).isin(deviating_ids)) & (log_df[activity_col] == target_act)
                        resources = sorted(log_df.loc[mask, resource_col].dropna().astype(str).unique())

        result[col] = resources

    return result


def _atoms_to_decl_string(atoms) -> str:
    """
    Serialize a list of ProcessAtom objects to Declare4Py-compatible .decl format.
    """
    _unary_types = {"Existence", "Absence", "Exactly", "Init", "End"}
    _cardinality_types = {"Existence", "Absence", "Exactly"}

    activities: set = set()
    for atom in atoms:
        for op in atom.operands:
            activities.add(op)

    lines = []
    for act in sorted(activities):
        lines.append(f"activity {act}")
    lines.append("")

    for atom in atoms:
        ttype = atom.atom_type
        ops = atom.operands
        cardinality = getattr(atom, 'cardinality', 1)

        type_str = ttype
        if ttype in _cardinality_types and isinstance(cardinality, int) and cardinality > 1:
            type_str = f"{ttype}{cardinality}"

        if len(ops) >= 2:
            lines.append(f"{type_str}[{ops[0]}, {ops[1]}] | | |")
        elif len(ops) == 1:
            lines.append(f"{type_str}[{ops[0]}] | |")

    return "\n".join(lines)


def _compute_trace_features(log_df: pd.DataFrame, case_col: str = 'case:concept:name',
                             activity_col: str = 'concept:name',
                             timestamp_col: str = 'time:timestamp',
                             resource_col: str = None) -> pd.DataFrame:
    """
    Compute per-trace features from an event-log DataFrame.
    """
    features = pd.DataFrame({'trace_id': log_df[case_col].unique()})
    features = features.set_index('trace_id')

    features['event_count'] = log_df.groupby(case_col)[activity_col].count()
    features['rework_count'] = (
        log_df.groupby(case_col)[activity_col]
        .apply(lambda x: int((x.value_counts() - 1).clip(lower=0).sum()))
    )

    if timestamp_col in log_df.columns:
        log_sorted = log_df.sort_values([case_col, timestamp_col]).copy()
        log_sorted['_gap_s'] = (
            log_sorted.groupby(case_col)[timestamp_col]
            .diff()
            .dt.total_seconds()
        )
        features['max_inter_event_gap_seconds'] = log_sorted.groupby(case_col)['_gap_s'].max()
        features['avg_inter_event_gap_seconds'] = log_sorted.groupby(case_col)['_gap_s'].mean()
    else:
        features['max_inter_event_gap_seconds'] = float('nan')
        features['avg_inter_event_gap_seconds'] = float('nan')

    if resource_col and resource_col in log_df.columns:
        features['unique_resource_count'] = log_df.groupby(case_col)[resource_col].nunique()
    else:
        for rc in ('org:resource', 'org:group', 'Resource'):
            if rc in log_df.columns:
                features['unique_resource_count'] = log_df.groupby(case_col)[rc].nunique()
                break
        else:
            features['unique_resource_count'] = float('nan')

    return features.reset_index()


def _diagnose_declare_violations(declare_model, d4py_log, violations_df, case_ids_ordered):
    """
    For each binary constraint with violations, diagnose the root cause per violated trace.
    Returns (diagnostics, trace_time_deltas).
    """
    from datetime import timedelta
    from Declare4Py.ProcessModels.DeclareModel import DeclareModelConditionParserUtility

    _glob = {'__builtins__': None}
    parser = DeclareModelConditionParserUtility()

    pm4py_log = d4py_log.get_log()
    activity_key = d4py_log.activity_key or 'concept:name'

    trace_map = {}
    for trace in pm4py_log:
        cid = trace.attributes.get('concept:name', '')
        trace_map[str(cid)] = list(trace)

    model_constraints = declare_model.get_decl_model_constraints()
    constraint_dict_map = {}
    for idx, col in enumerate(model_constraints):
        if idx < len(declare_model.constraints):
            constraint_dict_map[str(col)] = declare_model.constraints[idx]

    index_vals = list(violations_df.index)
    index_is_case_ids = all(str(v) in trace_map for v in index_vals[:5]) if index_vals else False

    diagnostics = {}
    trace_time_deltas = {}

    for col in violations_df.columns:
        col_str = str(col)
        cdict = constraint_dict_map.get(col_str)
        if cdict is None:
            continue
        template = cdict['template']
        if not template.is_binary:
            continue

        activities = cdict['activities']
        act_A, act_B = activities[0], activities[1]
        conditions = cdict['condition']
        act_cond_str  = conditions[0] if len(conditions) > 0 else ""
        corr_cond_str = conditions[1] if len(conditions) > 1 else ""
        time_cond_str = conditions[-1] if conditions else ""

        try:
            activation_rules = parser.parse_data_cond(act_cond_str)
            correlation_rules = parser.parse_data_cond(corr_cond_str)
            time_rule         = parser.parse_time_cond(time_cond_str)
        except SyntaxError:
            continue

        no_target_count   = 0
        corr_failed_count = 0
        time_viol_count   = 0
        time_viol_details = []
        col_trace_deltas  = {}

        def _record_time_viol(cid, delta_s):
            nonlocal time_viol_count
            time_viol_count += 1
            if len(time_viol_details) < 50:
                time_viol_details.append({'trace_id': cid, 'actual_seconds': delta_s})
            if delta_s > col_trace_deltas.get(cid, 0):
                col_trace_deltas[cid] = delta_s

        tname = template.templ_str.replace(' ', '')

        col_series = violations_df[col]
        violated_indices = col_series[col_series > 0].index.tolist()

        for idx_val in violated_indices:
            if index_is_case_ids:
                case_id = str(idx_val)
            else:
                pos = int(idx_val)
                case_id = str(case_ids_ordered[pos]) if pos < len(case_ids_ordered) else None
            if case_id is None:
                continue
            events = trace_map.get(case_id)
            if not events:
                continue

            if tname in ('ChainResponse', 'AlternateResponse'):
                for i, event in enumerate(events):
                    if event[activity_key] != act_A:
                        continue
                    locl = {'A': event}
                    try:
                        if not eval(activation_rules, _glob, locl):
                            continue
                    except Exception:
                        continue
                    if i >= len(events) - 1:
                        no_target_count += 1
                        continue
                    nxt = events[i + 1]
                    if nxt[activity_key] != act_B:
                        no_target_count += 1
                        continue
                    locl2 = {'A': event, 'T': nxt, 'timedelta': timedelta, 'abs': abs, 'float': float}
                    try:
                        corr_ok = eval(correlation_rules, _glob, locl2)
                    except Exception:
                        corr_ok = True
                    if not corr_ok:
                        corr_failed_count += 1
                        continue
                    try:
                        time_ok = eval(time_rule, _glob, locl2)
                    except Exception:
                        time_ok = True
                    if not time_ok:
                        try:
                            delta_s = abs((nxt['time:timestamp'] - event['time:timestamp']).total_seconds())
                            _record_time_viol(case_id, delta_s)
                        except Exception:
                            _record_time_viol(case_id, 0.0)

            elif tname in ('Response', 'RespondedExistence', 'AlternateResponse'):
                pendings = []
                for i, event in enumerate(events):
                    if event[activity_key] == act_A:
                        locl = {'A': event}
                        try:
                            if eval(activation_rules, _glob, locl):
                                pendings.append((i, event))
                        except Exception:
                            pass
                    if pendings and event[activity_key] == act_B:
                        for pidx, (ai, aev) in reversed(list(enumerate(pendings))):
                            locl2 = {'A': aev, 'T': event, 'timedelta': timedelta, 'abs': abs, 'float': float}
                            try:
                                corr_ok = eval(correlation_rules, _glob, locl2)
                                time_ok = eval(time_rule, _glob, locl2)
                            except Exception:
                                corr_ok = time_ok = True
                            if corr_ok and time_ok:
                                pendings.pop(pidx)
                                break
                for ai, aev in pendings:
                    future_Bs = [(j, events[j]) for j in range(ai + 1, len(events))
                                 if events[j][activity_key] == act_B]
                    if not future_Bs:
                        no_target_count += 1
                        continue
                    any_corr = False
                    for bj, bev in future_Bs:
                        locl2 = {'A': aev, 'T': bev, 'timedelta': timedelta, 'abs': abs, 'float': float}
                        try:
                            corr_ok = eval(correlation_rules, _glob, locl2)
                        except Exception:
                            corr_ok = True
                        if corr_ok:
                            any_corr = True
                    if not any_corr:
                        corr_failed_count += 1
                    else:
                        for bj, bev in future_Bs:
                            locl2 = {'A': aev, 'T': bev, 'timedelta': timedelta, 'abs': abs, 'float': float}
                            try:
                                if eval(correlation_rules, _glob, locl2):
                                    delta_s = abs((bev['time:timestamp'] - aev['time:timestamp']).total_seconds())
                                    _record_time_viol(case_id, delta_s)
                                    break
                            except Exception:
                                pass

            elif tname in ('ChainPrecedence', 'AlternatePrecedence'):
                for i, event in enumerate(events):
                    if event[activity_key] != act_B:
                        continue
                    locl = {'A': event}
                    try:
                        if not eval(activation_rules, _glob, locl):
                            continue
                    except Exception:
                        continue
                    if i == 0:
                        no_target_count += 1
                        continue
                    prev = events[i - 1]
                    if prev[activity_key] != act_A:
                        no_target_count += 1
                        continue
                    locl2 = {'A': event, 'T': prev, 'timedelta': timedelta, 'abs': abs, 'float': float}
                    try:
                        corr_ok = eval(correlation_rules, _glob, locl2)
                    except Exception:
                        corr_ok = True
                    if not corr_ok:
                        corr_failed_count += 1
                        continue
                    try:
                        time_ok = eval(time_rule, _glob, locl2)
                    except Exception:
                        time_ok = True
                    if not time_ok:
                        try:
                            delta_s = abs((prev['time:timestamp'] - event['time:timestamp']).total_seconds())
                            _record_time_viol(case_id, delta_s)
                        except Exception:
                            _record_time_viol(case_id, 0.0)

            elif tname == 'Precedence':
                for i, event in enumerate(events):
                    if event[activity_key] != act_B:
                        continue
                    locl = {'A': event}
                    try:
                        if not eval(activation_rules, _glob, locl):
                            continue
                    except Exception:
                        continue
                    prior_As = [(j, events[j]) for j in range(i) if events[j][activity_key] == act_A]
                    if not prior_As:
                        no_target_count += 1
                        continue
                    any_corr = False
                    for aj, aev in prior_As:
                        locl2 = {'A': event, 'T': aev, 'timedelta': timedelta, 'abs': abs, 'float': float}
                        try:
                            corr_ok = eval(correlation_rules, _glob, locl2)
                        except Exception:
                            corr_ok = True
                        if corr_ok:
                            any_corr = True
                    if not any_corr:
                        corr_failed_count += 1
                    else:
                        for aj, aev in prior_As:
                            locl2 = {'A': event, 'T': aev, 'timedelta': timedelta, 'abs': abs, 'float': float}
                            try:
                                if eval(correlation_rules, _glob, locl2):
                                    delta_s = abs((aev['time:timestamp'] - event['time:timestamp']).total_seconds())
                                    _record_time_viol(case_id, delta_s)
                                    break
                            except Exception:
                                pass

        diagnostics[col_str] = {
            'no_target_count': no_target_count,
            'target_condition_failed_count': corr_failed_count,
            'time_window_violated_count': time_viol_count,
            'time_violation_details': time_viol_details,
        }
        if col_trace_deltas:
            trace_time_deltas[col_str] = col_trace_deltas

    return diagnostics, trace_time_deltas


@app.route('/upload-declarative-model', methods=['POST'])
def upload_declarative_model():
    import re
    from Declare4Py.ProcessModels.DeclareModel import DeclareModel
    from Declare4Py.D4PyEventLog import D4PyEventLog
    from Declare4Py.ProcessMiningTasks.ConformanceChecking.MPDeclareAnalyzer import MPDeclareAnalyzer

    print("\n==== UPLOAD DECLARATIVE MODEL CALLED ====")

    xes_file = request.files.get('xes')
    decl_file = request.files.get('decl')

    if not xes_file or not xes_file.filename:
        return jsonify({"error": "Missing event log file"}), 400
    if not decl_file or not decl_file.filename:
        return jsonify({"error": "Missing .decl model file"}), 400

    upload_folder = "uploads"
    os.makedirs(upload_folder, exist_ok=True)

    xes_path = os.path.join(upload_folder, xes_file.filename)
    decl_path = os.path.join(upload_folder, decl_file.filename)

    xes_file.save(xes_path)
    decl_file.save(decl_path)

    last_uploaded_data['xes_path'] = xes_path
    last_uploaded_data['decl_path'] = decl_path
    last_uploaded_data['bpmn_path'] = None
    last_uploaded_data['bpmn_model'] = None
    last_uploaded_data['alignments'] = None
    last_uploaded_data['deviation_matrix'] = None
    last_uploaded_data['impact_matrix'] = None
    last_uploaded_data['aggregated_base_matrix'] = None
    last_uploaded_data['atoms'] = None
    last_uploaded_data['atoms_df'] = None
    last_uploaded_data['event_log_pa'] = None
    last_uploaded_data['decl_constraint_info'] = None

    _, ext = os.path.splitext(xes_path)
    if xes_path.endswith('.xes.gz') or ext == '.xes':
        xes_log = xes_importer.apply(xes_path)
    elif ext == '.csv':
        log_csv = pd.read_csv(xes_path, encoding='utf-8-sig')
        log_csv['time:timestamp'] = pd.to_datetime(log_csv['time:timestamp'], utc=True)
        xes_log = log_converter.apply(log_csv)
    else:
        return jsonify({"error": "Unsupported log format"}), 400

    xes_errors = validate_xes_log(xes_log)
    if xes_errors:
        return jsonify({"error": "Invalid XES log:\n" + "\n".join(xes_errors)}), 400

    last_uploaded_data['xes_log'] = xes_log
    log_df = pm4py.convert_to_dataframe(xes_log)

    case_col = 'case:concept:name'
    activity_col = 'concept:name'
    timestamp_col = 'time:timestamp'

    case_ids_ordered = list(dict.fromkeys(log_df[case_col].tolist()))

    d4py_log = D4PyEventLog(case_name=case_col)
    d4py_log.parse_xes_log(xes_path)

    declare_model = DeclareModel().parse_from_file(decl_path)
    model_constraints = declare_model.get_decl_model_constraints()

    basic_checker = MPDeclareAnalyzer(log=d4py_log, declare_model=declare_model, consider_vacuity=False)
    conf_check_res = basic_checker.run()

    violations_df = conf_check_res.get_metric(metric="num_violations")
    constraint_cols = list(violations_df.columns)

    try:
        activations_df = conf_check_res.get_metric(metric="num_activations")
        activations_per_constraint = activations_df.fillna(0).sum(axis=0).to_dict()
    except Exception:
        activations_per_constraint = {}

    violations_binary = (violations_df > 0).astype(int)

    if set(violations_df.index).issubset(set(case_ids_ordered)):
        violations_binary = violations_binary.reindex(case_ids_ordered).fillna(0).astype(int)
        violations_binary.index = case_ids_ordered
    else:
        n = min(len(violations_binary), len(case_ids_ordered))
        violations_binary = violations_binary.iloc[:n].copy()
        violations_binary.index = case_ids_ordered[:n]
        if n < len(case_ids_ordered):
            pad = pd.DataFrame(0, index=case_ids_ordered[n:], columns=constraint_cols)
            violations_binary = pd.concat([violations_binary, pad])

    violations_binary.index.name = 'trace_id'
    collect_data = violations_binary.reset_index()

    if timestamp_col in log_df.columns:
        log_df[timestamp_col] = pd.to_datetime(log_df[timestamp_col])
        durations = log_df.groupby(case_col)[timestamp_col].agg(['min', 'max'])
        durations['duration'] = (durations['max'] - durations['min']).dt.total_seconds()
        duration_map = durations['duration'].to_dict()
        collect_data['trace_duration_seconds'] = collect_data['trace_id'].map(duration_map).fillna(0)
    else:
        collect_data['trace_duration_seconds'] = 0.0

    if timestamp_col in log_df.columns:
        activities_per_case = (
            log_df.sort_values(timestamp_col)
            .groupby(case_col)[activity_col]
            .apply(list)
            .to_dict()
        )
    else:
        activities_per_case = log_df.groupby(case_col)[activity_col].apply(list).to_dict()
    collect_data['activities'] = collect_data['trace_id'].map(activities_per_case)

    ordered_cols = ['trace_id', 'trace_duration_seconds', 'activities'] + constraint_cols
    collect_data = collect_data[[c for c in ordered_cols if c in collect_data.columns]]

    try:
        trace_features = _compute_trace_features(log_df, case_col=case_col, activity_col=activity_col,
                                                  timestamp_col=timestamp_col)
        collect_data = collect_data.merge(
            trace_features,
            left_on='trace_id', right_on='trace_id', how='left'
        )
    except Exception as feat_err:
        print(f"[WARN] Could not compute trace features: {feat_err}")

    last_uploaded_data['deviation_matrix'] = collect_data
    last_uploaded_data['original_deviation_matrix'] = collect_data.copy()
    last_uploaded_data['mode'] = 'declarative-model'
    last_uploaded_data['excluded_case_ids'] = []
    last_uploaded_data['excluded_by_step'] = {}
    last_uploaded_data['is_filtered'] = False

    print("Running per-violation diagnostics...")
    try:
        violation_diagnostics, trace_time_deltas = _diagnose_declare_violations(
            declare_model, d4py_log, violations_df, case_ids_ordered
        )
    except Exception as diag_err:
        print(f"[WARN] Violation diagnostics failed: {diag_err}")
        import traceback as tb
        tb.print_exc()
        violation_diagnostics, trace_time_deltas = {}, {}
    last_uploaded_data['violation_diagnostics'] = violation_diagnostics
    last_uploaded_data['trace_time_deltas'] = trace_time_deltas
    print(f"Diagnostics done for {len(violation_diagnostics)} constraints.")

    decl_constraint_info = []
    for col in constraint_cols:
        m = re.match(r'^([^\[]+)\[([^\]]*)\]', str(col).strip())
        if m:
            ctype = m.group(1).strip()
            ops = [op.strip() for op in m.group(2).split(',') if op.strip()]
        else:
            ctype = str(col)
            ops = []

        col_parts = str(col).split(' |')
        raw_conds = [p.strip() for p in col_parts[1:]]

        is_binary = len(ops) == 2

        if is_binary:
            activation_cond  = raw_conds[0] if len(raw_conds) > 0 else ""
            correlation_cond = raw_conds[1] if len(raw_conds) > 1 else ""
            time_cond        = raw_conds[2] if len(raw_conds) > 2 else ""
        else:
            activation_cond  = raw_conds[0] if len(raw_conds) > 0 else ""
            correlation_cond = ""
            time_cond        = raw_conds[1] if len(raw_conds) > 1 else ""

        _time_pat = re.compile(r'^[\d.]+,[\d.]+(,\s*(s|m|h|d))?$', re.IGNORECASE)
        if correlation_cond and _time_pat.match(correlation_cond):
            time_cond = correlation_cond
            correlation_cond = ""

        total_activations = int(activations_per_constraint.get(col, 0))

        parsed_time = None
        if time_cond:
            time_parts = time_cond.split(',')
            if len(time_parts) == 3:
                try:
                    parsed_time = {
                        'min': float(time_parts[0]),
                        'max': float(time_parts[1]),
                        'unit': time_parts[2].strip(),
                        'raw': time_cond,
                    }
                except ValueError:
                    parsed_time = {'raw': time_cond}

        diag = violation_diagnostics.get(str(col), {})
        decl_constraint_info.append({
            'col_name': col,
            'type': ctype,
            'operands': ops,
            'activation_condition': activation_cond if activation_cond else None,
            'correlation_condition': correlation_cond if correlation_cond else None,
            'time_condition': parsed_time,
            'is_data_aware': bool(activation_cond or correlation_cond),
            'has_time_constraint': parsed_time is not None,
            'total_activations': total_activations,
            'violation_diagnostics': diag,
        })
    last_uploaded_data['decl_constraint_info'] = decl_constraint_info

    # Compute resources per deviation column (declarative-model)
    try:
        decl_constraint_lookup = {
            info['col_name']: {'type': info['type'], 'operands': info['operands']}
            for info in decl_constraint_info
        }
        last_uploaded_data['resources_by_deviation'] = _compute_resources_by_deviation(
            log_df, last_uploaded_data['deviation_matrix'], mode='declarative-model',
            constraint_info_lookup=decl_constraint_lookup
        )
    except Exception as res_err:
        import traceback
        print(f"[WARN] Could not compute resources_by_deviation (declarative-model): {res_err}")
        traceback.print_exc()

    print(f"Uploaded .decl model: {len(model_constraints)} constraints, {len(case_ids_ordered)} traces, matrix shape: {collect_data.shape}")

    return jsonify({
        "message": "Declarative model conformance check completed",
        "constraint_count": len(model_constraints),
        "trace_count": len(case_ids_ordered),
    })


@app.route('/api/time-constraint-columns', methods=['GET'])
def time_constraint_columns():
    """Return constraint columns with a time window."""
    decl_info = last_uploaded_data.get('decl_constraint_info', [])
    result = []
    for info in decl_info:
        if info.get('has_time_constraint'):
            tc = info.get('time_condition', {}) or {}
            result.append({
                'col_name': info['col_name'],
                'label': f"{info['type']}[{', '.join(info['operands'])}]",
                'time_condition': tc,
            })
    return jsonify({'constraints': result})


@app.route('/api/download-mined-decl', methods=['GET'])
def download_mined_decl():
    """Download the .decl file saved from the last declarative mining run."""
    path = last_uploaded_data.get('mined_decl_path')
    if not path or not os.path.isfile(path):
        return jsonify({"error": "No mined .decl file available. Run declarative mining first."}), 404
    directory = os.path.dirname(path)
    filename = os.path.basename(path)
    return send_from_directory(directory, filename, as_attachment=True)


@app.route("/api/preview-matrix", methods=["GET"])
def api_preview_matrix():

    df = get_cached_deviation_matrix()

    # return small sample to avoid huge payload
    sample_df = df.head(500)
    #sample_df = df.copy()

    return jsonify({
        "columns": list(sample_df.columns),
        "rows": sample_df.to_dict(orient="records")
    })



@app.route('/api/deviation-overview', methods=['GET'])
def deviation_overview():
    mode = last_uploaded_data.get('mode', 'bpmn')

    if mode == 'declarative-model':
        decl_constraint_info = last_uploaded_data.get('decl_constraint_info', [])
        if not decl_constraint_info:
            return jsonify({"error": "No .decl model loaded yet"}), 400
        df = last_uploaded_data.get('deviation_matrix')
        constraints = []
        for info in decl_constraint_info:
            col_name = info['col_name']
            violation_count = int(df[col_name].sum()) if df is not None and col_name in df.columns else 0
            constraints.append({
                "constraint": col_name,
                "type": info['type'],
                "operands": info['operands'],
                "violation_count": violation_count,
                "activation_condition": info.get('activation_condition'),
                "correlation_condition": info.get('correlation_condition'),
                "time_condition": info.get('time_condition'),
                "is_data_aware": info.get('is_data_aware', False),
                "has_time_constraint": info.get('has_time_constraint', False),
                "total_activations": info.get('total_activations', 0),
                "violation_diagnostics": info.get('violation_diagnostics', {}),
            })
        return jsonify({"constraints": constraints})

    if mode == 'declarative':
        atoms_df = last_uploaded_data.get('atoms_df')
        if atoms_df is None or len(atoms_df) == 0:
            return jsonify({"error": "No constraints mined yet"}), 400

        df = last_uploaded_data.get('deviation_matrix')
        constraints = []
        for i in range(len(atoms_df)):
            col_name = f"{atoms_df['type'][i]}_{atoms_df['op_0'][i]}_{atoms_df['op_1'][i]}"
            violation_count = int(df[col_name].sum()) if df is not None and col_name in df.columns else 0
            constraints.append({
                "constraint": col_name,
                "type": atoms_df['type'][i],
                "operands": [atoms_df['op_0'][i], atoms_df['op_1'][i]],
                "violation_count": violation_count,
                "support": float(atoms_df['support'][i]),
                "confidence": float(atoms_df['confidence'][i]),
            })

        return jsonify({"constraints": constraints})

    # BPMN mode
    if not last_uploaded_data['alignments']:
        return jsonify({"error": "Alignments not computed yet"}), 400

    alignments = last_uploaded_data['alignments']

    skip_counts = {}
    insertion_counts = {}

    for trace in alignments:
        for move in trace['alignment']:
            log_move, model_move = move

            # Skip (model move)
            if log_move == '>>' and model_move not in (None, '>>'):
                skip_counts[model_move] = skip_counts.get(model_move, 0) + 1

            # Insertion (log move)
            elif model_move == '>>' and log_move not in (None, '>>'):
                insertion_counts[log_move] = insertion_counts.get(log_move, 0) + 1

    return jsonify({
        "skips": [
            {"activity": k, "count": v}
            for k, v in sorted(skip_counts.items(), key=lambda x: -x[1])
        ],
        "insertions": [
            {"activity": k, "count": v}
            for k, v in sorted(insertion_counts.items(), key=lambda x: -x[1])
        ]
    })


@app.route("/api/deviation-matrix", methods=["GET"])
def api_deviation_matrix_preview(preview=False):

    df = get_cached_deviation_matrix()

    if preview:
        preview_size = 50  # only return first 50 rows
        preview_df = df.head(preview_size)
    else:
        preview_df = df.copy()

    return jsonify({
        "columns": list(preview_df.columns),
        "rows": preview_df.to_dict(orient="records"),
        "total_rows": df.shape[0],
        "total_columns": df.shape[1]
    })


from flask import request, jsonify
import pandas as pd

@app.route("/api/current-impact-matrix", methods=["GET"])
def get_current_impact_matrix():

    if last_uploaded_data.get("impact_matrix") is not None:
        df = last_uploaded_data["impact_matrix"]
    elif last_uploaded_data.get("aggregated_base_matrix") is not None:
        df = last_uploaded_data["aggregated_base_matrix"]
    else:
        df = get_cached_deviation_matrix()

    print(f"[current-impact-matrix] returning {df.shape[1]} cols: {list(df.columns)}")
    return jsonify({
        "columns": list(df.columns),
        "rows": df.to_dict(orient="records"),
        "total_rows": df.shape[0],
        "total_columns": df.shape[1]
    })

@app.route("/api/apply-issue-grouping", methods=["POST"])
def apply_issue_grouping():
    """Create aggregated impact matrix: AND-combine merged deviation columns into issue columns."""
    data = request.json
    issue_map = data.get("issue_map", {})  # original_col → issue_name
    exclude_cols = set(data.get("exclude_cols", []))  # cols to drop entirely (logging errors etc.)

    base_df = get_cached_deviation_matrix().copy()

    if not issue_map and not exclude_cols:
        # No grouping: use original matrix as-is
        last_uploaded_data["aggregated_base_matrix"] = base_df
        last_uploaded_data["impact_matrix"] = None
        return jsonify({"status": "success", "columns": list(base_df.columns)})

    from collections import defaultdict
    groups = defaultdict(list)
    for col, issue_name in issue_map.items():
        if col in base_df.columns:
            groups[issue_name].append(col)

    # Remove original deviation columns and excluded columns from base
    drop_cols = set(issue_map.keys()) | exclude_cols
    base_cols = [c for c in base_df.columns if c not in drop_cols]
    new_df = base_df[base_cols].copy()

    # AND-combine (min of binary) merged groups; single col: direct copy under issue name
    for issue_name, cols in groups.items():
        if len(cols) == 1:
            new_df[issue_name] = base_df[cols[0]].values
        else:
            new_df[issue_name] = base_df[cols].min(axis=1).values

    # Drop any remaining deviation columns not covered by the issue_map
    # (e.g. zero-violation cols absent from the deviation-selection response)
    mode = last_uploaded_data.get('mode', 'bpmn')
    issue_name_cols = set(groups.keys())
    non_meta = {
        'trace_id', 'trace_duration_seconds', 'activities',
        'event_count', 'rework_count', 'max_inter_event_gap_seconds',
        'avg_inter_event_gap_seconds', 'unique_resource_count',
    }
    if mode == 'bpmn':
        leftover_devs = [
            c for c in new_df.columns
            if (c.startswith('(Skip ') or c.startswith('(Insert ')) and c not in issue_name_cols
        ]
    else:
        leftover_devs = [
            c for c in new_df.columns
            if c not in non_meta and c not in issue_name_cols and c != 'trace_id'
            and set(new_df[c].dropna().unique()).issubset({0, 1, 0.0, 1.0})
        ]
    if leftover_devs:
        new_df = new_df.drop(columns=leftover_devs)

    last_uploaded_data["aggregated_base_matrix"] = new_df
    last_uploaded_data["impact_matrix"] = None  # reset dimension-layer so it rebuilds on top of new base
    last_uploaded_data["stored_issue_map"] = dict(issue_map)  # persist for workaround-resources aggregation
    return jsonify({"status": "success", "columns": list(new_df.columns)})


@app.route("/api/configure-dimensions", methods=["POST"])
def configure_dimensions():

    data = request.json
    dimension_configs = data.get("dimensions", [])
    if last_uploaded_data.get("xes_log") is None:
        raise ValueError("No XES log loaded.")

    if last_uploaded_data.get("mode") == "bpmn" and last_uploaded_data.get("bpmn_path") is None:
        raise ValueError("No BPMN model loaded.")
    # Use aggregated base matrix if available (set by apply-issue-grouping), else raw cached matrix
    base = last_uploaded_data.get("aggregated_base_matrix")
    df = base.copy() if base is not None else get_cached_deviation_matrix().copy()

    for dim in dimension_configs:

        dimension = dim["dimension"]
        comp_type = dim["computationType"]
        config = dim["config"]

        if comp_type == "existing":
            column = config.get("column")

            if not column:
                return jsonify({"error": f"No column selected for dimension '{dimension}'"}), 400

            if column not in df.columns:
                return jsonify({"error": f"Column '{column}' not found"}), 400

            df[dimension] = df[column]


        elif comp_type == "formula":

            expression = config.get("expression")

            if not expression:
                return jsonify({"error": "Missing formula expression"}), 400

            try:

                df[dimension] = df.eval(

                    expression,

                    engine="python",

                    local_dict={

                        "where": np.where,

                        "abs": np.abs,

                        "log": np.log,

                        "min": np.minimum,

                        "max": np.maximum,

                    }

                )

                # convert boolean result to int automatically

                if df[dimension].dtype == bool:
                    df[dimension] = df[dimension].astype(int)


            except Exception as e:

                return jsonify({"error": f"Invalid formula: {str(e)}"}), 400


        elif comp_type == "rule":

            # Support compound { conditions: [{column, operator, value, connector?}...] }
            # and legacy flat { column, operator, value } formats
            conditions_raw = config.get("conditions")
            if conditions_raw:
                conditions = conditions_raw
            else:
                col_flat = config.get("column")
                if not col_flat:
                    return jsonify({"error": f"No column selected for rule dimension '{dimension}'"}), 400
                conditions = [{"column": col_flat, "operator": config.get("operator"), "value": config.get("value")}]

            if not conditions:
                return jsonify({"error": f"No conditions defined for rule dimension '{dimension}'"}), 400

            def _eval_cond(col, operator, value):
                if not col:
                    raise ValueError("No column selected in condition")
                if col not in df.columns:
                    raise ValueError(f"Column '{col}' not found")
                if operator == "equals":
                    # coerce to numeric for numeric columns so "2" matches int 2
                    if pd.api.types.is_numeric_dtype(df[col]):
                        try:
                            return df[col] == float(value)
                        except (ValueError, TypeError):
                            pass
                    return df[col] == value
                elif operator == "not_equals":
                    if pd.api.types.is_numeric_dtype(df[col]):
                        try:
                            return df[col] != float(value)
                        except (ValueError, TypeError):
                            pass
                    return df[col] != value
                elif operator == "contains":
                    return df[col].apply(lambda x: any(str(value) in str(v) for v in x) if isinstance(x, list) else str(value) in str(x))
                elif operator == "starts_with":
                    return df[col].apply(lambda x: any(str(v).startswith(str(value)) for v in x) if isinstance(x, list) else str(x).startswith(str(value)))
                elif operator == "ends_with":
                    return df[col].apply(lambda x: any(str(v).endswith(str(value)) for v in x) if isinstance(x, list) else str(x).endswith(str(value)))
                elif operator == "greater":
                    return df[col] > float(value)
                elif operator == "less":
                    return df[col] < float(value)
                elif operator == "greater_equal":
                    return df[col] >= float(value)
                elif operator == "less_equal":
                    return df[col] <= float(value)
                else:
                    raise ValueError(f"Unsupported operator: {operator}")

            try:
                combined = None
                for cond in conditions:
                    cond_col  = cond.get("column", "")
                    cond_op   = cond.get("operator", "")
                    cond_val  = cond.get("value", "")
                    connector = cond.get("connector", "AND")
                    negate    = cond.get("negate", False)
                    cond_result = _eval_cond(cond_col, cond_op, cond_val)
                    if negate:
                        cond_result = ~cond_result
                    if combined is None:
                        combined = cond_result
                    elif connector == "OR":
                        combined = combined | cond_result
                    else:
                        combined = combined & cond_result

                df[dimension] = combined.astype(int)

            except Exception as e:
                return jsonify({"error": f"Invalid rule: {str(e)}"}), 400

    # ✅ store result inside your cache dict instead of global variable
    last_uploaded_data["impact_matrix"] = df

    return jsonify({
        "status": "success",
        "columns": list(df.columns)
    })


from dowhy import CausalModel as dowhymodel

@app.route("/api/compute-causal-effects", methods=["POST"])
def compute_causal_effects():

    payload = request.json
    selected_deviations = payload.get("deviations", [])
    selected_dimensions = payload.get("dimensions", [])

    if last_uploaded_data.get("impact_matrix") is None:
        return jsonify({"error": "Impact matrix not available"}), 400

    df = last_uploaded_data["impact_matrix"].copy()

    print("Received deviations:", selected_deviations)
    print("Received dimensions:", selected_dimensions)
    print("Impact matrix shape:", df.shape)
    print("Columns:", df.columns.tolist())

    results = []

    for dim in selected_dimensions:
        for dev in selected_deviations:

            # Skip if columns missing
            if dev not in df.columns or dim not in df.columns:
                continue

            # Skip degenerate cases: zero variance in treatment or outcome causes
            # statsmodels divide-by-zero warnings and meaningless estimates
            if df[dev].nunique() < 2 or df[dim].nunique() < 2:
                results.append({
                    "deviation": dev,
                    "dimension": dim,
                    "ate": 0.0,
                    "p_value": 1.0,
                    "error": "No variation in treatment or outcome — effect is undefined"
                })
                continue

            graph = f'digraph {{ "{dev}" -> "{dim}" }}'

            try:
                import warnings
                model = dowhymodel(
                    data=df,
                    treatment=dev,
                    outcome=dim,
                    graph=graph
                )

                identified_estimand = model.identify_effect(
                    proceed_when_unidentifiable=True
                )

                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=RuntimeWarning)
                    estimate = model.estimate_effect(
                        identified_estimand,
                        method_name="backdoor.linear_regression",
                        test_significance=True
                    )
                    significance = estimate.test_stat_significance()

                results.append({
                    "deviation": dev,
                    "dimension": dim,
                    "ate": float(estimate.value),
                    "p_value": float(significance["p_value"]) if significance else None
                })


            except Exception as e:
                results.append({
                    "deviation": dev,
                    "dimension": dim,
                    "error": str(e)
                })

    last_uploaded_data["causal_results"] = results
    if not results:
        return jsonify({
            "error": "No valid deviation-dimension combinations found",
            "available_columns": df.columns.tolist()
        }), 400

    return jsonify({
        "results": results
    })


@app.route('/api/save-timing', methods=['POST'])
def save_timing():
    data = request.get_json()
    elapsed_ms = data.get("elapsedMs")

    if elapsed_ms is None:
        return jsonify({"error": "Timing is required"}), 400

    # Get XES file name without extension
    if not last_uploaded_data.get("xes_path"):
        return jsonify({"error": "No XES file uploaded yet"}), 400

    xes_filename = os.path.basename(last_uploaded_data["xes_path"])
    base_name, _ = os.path.splitext(xes_filename)

    # Create /timing subfolder next to app.py
    timing_folder = os.path.join(os.path.dirname(__file__), 'timing')
    os.makedirs(timing_folder, exist_ok=True)

    # File path (append .txt)
    timing_file_path = os.path.join(timing_folder, f"{base_name}.txt")

    # Append with timestamp
    from datetime import datetime
    with open(timing_file_path, 'a') as f:
        f.write(f"{datetime.now().isoformat()} - {elapsed_ms:.2f} ms\n")

    return jsonify({"message": "Timing saved", "elapsedMs": elapsed_ms, "file": timing_file_path})



@app.route('/api/fitness', methods=['GET'])
def api_fitness():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    return jsonify(get_fitness_per_trace(aligned_traces))

@app.route('/api/bpmn-activities', methods=['POST'])
def api_bpmn_activities():
    if 'bpmn' not in request.files:
        return jsonify({"error": "No process model file uploaded"}), 400
    bpmn_file = request.files['bpmn']
    file_path = os.path.join('/tmp', bpmn_file.filename)
    bpmn_file.save(file_path)
    last_uploaded_files['bpmn'] = file_path
    activities = get_all_activities_from_model(file_path)
    return jsonify({"activities": activities})

@app.route('/api/conformance-bins', methods=['GET'])
def api_conformance_bins():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    fitness_data = get_fitness_per_trace(aligned_traces)
    return jsonify(get_conformance_bins(fitness_data))

@app.route('/api/activity-deviations', methods=['GET'])
def api_activity_deviations():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()

    xes_log = get_cached_xes_log()
    result = get_activity_deviations(last_uploaded_files['bpmn'], xes_log, aligned_traces)
    return jsonify(result)
@app.route("/api/outcome-distribution", methods=["POST"])
def api_outcome_distribution():
    data = request.get_json() or {}
    matching_mode = data.get('matchingMode')             # 'end' or 'contains' or None
    selected_activities = data.get('selectedActivities') # array or maybe empty

    # normalize: make sure selected_activities is a list (or empty list)
    if isinstance(selected_activities, str):
        selected_activities = [selected_activities]
    if selected_activities is None:
        selected_activities = []

    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    xes_log = get_cached_xes_log()

    result = get_outcome_distribution(
        bpmn_path=last_uploaded_files['bpmn'],
        log=xes_log,
        aligned_traces=aligned_traces,
        matching_mode=matching_mode,
        selected_activities=selected_activities
    )
    return jsonify(result)

@app.route('/api/conformance-by-role', methods=['GET'])
def api_conformance_by_role():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    xes_log = get_cached_xes_log()
    result = get_conformance_by_role(xes_log, aligned_traces)
    return jsonify(result)

@app.route('/api/conformance-by-event_attribute', methods=['GET'])
def api_conformance_by_event_attribute():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    result = get_conformance_by_event_attribute(get_cached_xes_log(), aligned_traces)
    return jsonify(result)

@app.route("/api/unique-sequences", methods=["GET"])
def unique_sequences():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    result = get_unique_sequences_per_bin(get_cached_xes_log(), aligned_traces)
    return jsonify(result)

@app.route('/api/requested-amounts', methods=['GET'])
def api_requested_amounts():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()
    result = get_requested_amount_vs_conformance(get_cached_xes_log(), aligned_traces)
    return jsonify(result)

@app.route('/api/conformance-by-resource', methods=['GET'])
def api_conformance_by_resource():
    if not last_uploaded_data['bpmn_path'] or not last_uploaded_data['xes_path']:
        return jsonify({"error": "No files uploaded yet."}), 400

    aligned_traces = get_cached_alignments()

    xes_log = get_cached_xes_log()

    result = get_conformance_by_resource(xes_log, aligned_traces)
    return jsonify(result)
@app.route('/api/trace-sequences', methods=['GET'])
def api_trace_sequences():


    result = get_trace_sequences(get_cached_xes_log())
    return jsonify(result)

@app.route('/preload/<filename>', methods=['GET'])
def preload_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route('/api/model-content', methods=['GET'])
def api_model_content():
    """Return the uploaded model content. For BPMN: raw XML. For PNML: SVG. For declarative: constraint list."""
    mode = last_uploaded_data.get('mode', 'bpmn')

    if mode == 'declarative-model':
        decl_constraint_info = last_uploaded_data.get('decl_constraint_info', [])
        if not decl_constraint_info:
            return jsonify({"error": "No .decl model loaded yet"}), 400
        constraints = []
        for info in decl_constraint_info:
            constraints.append({
                "type": info['type'],
                "op_0": info['operands'][0] if len(info['operands']) > 0 else '',
                "op_1": info['operands'][1] if len(info['operands']) > 1 else '',
                "activation_condition": info.get('activation_condition'),
                "correlation_condition": info.get('correlation_condition'),
                "time_condition": info.get('time_condition'),
                "total_activations": info.get('total_activations', 0),
            })
        return jsonify({"type": "declarative-model", "constraints": constraints})

    if mode == 'declarative':
        atoms_df = last_uploaded_data.get('atoms_df')
        if atoms_df is None or len(atoms_df) == 0:
            return jsonify({"error": "No constraints mined yet"}), 400
        constraints = atoms_df.to_dict(orient="records")
        return jsonify({"type": "declarative", "constraints": constraints})

    model_path = last_uploaded_data.get('bpmn_path')
    if not model_path:
        return jsonify({"error": "No model uploaded yet"}), 400

    ext = os.path.splitext(model_path)[1].lower()

    if ext == '.bpmn':
        with open(model_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({"type": "bpmn", "content": content})
    elif ext == '.pnml':
        from process_mining.conformance_alignments import read_model_as_petri_net
        net, im, fm = read_model_as_petri_net(model_path)
        from pm4py.visualization.petri_net import visualizer as pn_visualizer
        gviz = pn_visualizer.apply(net, im, fm,
                                    parameters={pn_visualizer.Variants.WO_DECORATION.value.Parameters.FORMAT: "svg"})
        svg_content = pn_visualizer.serialize(gviz).decode('utf-8')
        return jsonify({"type": "pnml", "content": svg_content})
    else:
        return jsonify({"error": f"Unsupported model type: {ext}"}), 400


@app.route('/api/filtering-status', methods=['GET'])
def get_filtering_status():
    """Return current filtering state and per-step breakdown."""
    original_log = last_uploaded_data.get('xes_log')
    original_count = len(original_log) if original_log else 0
    excluded_ids = last_uploaded_data.get('excluded_case_ids', [])
    return jsonify({
        "is_filtered": last_uploaded_data.get('is_filtered', False),
        "original_count": original_count,
        "filtered_count": original_count - len(excluded_ids),
        "excluded_count": len(excluded_ids),
        "excluded_by_step": last_uploaded_data.get('excluded_by_step', {}),
    })


@app.route('/api/recompute-filtered-log', methods=['POST'])
def recompute_filtered_log():
    """Filter the original log and recompute alignments/deviation matrix."""
    import ast as _ast
    from pm4py.objects.log.obj import EventLog as PM4PyLog

    data = request.json or {}
    exclude_ids_raw = data.get('exclude_case_ids', [])
    deviations_to_remove = data.get('deviations_to_remove_cases', [])
    variants_to_remove = data.get('variants_to_remove', [])   # list of activity-sequence lists
    excluded_by_step = data.get('excluded_by_step', {})

    original_log = last_uploaded_data.get('xes_log')
    if original_log is None:
        return jsonify({"error": "No log loaded"}), 400

    mode = last_uploaded_data.get('mode', 'bpmn')
    exclude_case_ids = set(str(i) for i in exclude_ids_raw)

    # Ensure original deviation matrix is available
    orig_matrix = last_uploaded_data.get('original_deviation_matrix')
    if orig_matrix is None:
        # Build and cache it for BPMN; for declarative it should already be set
        if mode == 'bpmn':
            orig_matrix = get_cached_deviation_matrix()
            if last_uploaded_data.get('original_deviation_matrix') is None:
                last_uploaded_data['original_deviation_matrix'] = orig_matrix.copy()
        else:
            orig_matrix = pd.DataFrame()

    # Expand deviation-based exclusions
    if deviations_to_remove and orig_matrix is not None and not orig_matrix.empty:
        for col in deviations_to_remove:
            if col in orig_matrix.columns and 'trace_id' in orig_matrix.columns:
                affected = orig_matrix.loc[orig_matrix[col] == 1, 'trace_id'].astype(str)
                exclude_case_ids.update(affected.tolist())
                if 'step1b' not in excluded_by_step:
                    excluded_by_step['step1b'] = []
                excluded_by_step['step1b'].extend(affected.tolist())

    # Expand variant-based exclusions
    if variants_to_remove and orig_matrix is not None and not orig_matrix.empty:
        if 'activities' in orig_matrix.columns and 'trace_id' in orig_matrix.columns:
            variant_tuples = {tuple(v) for v in variants_to_remove if isinstance(v, list)}
            for _, row in orig_matrix.iterrows():
                acts = row.get('activities', [])
                if isinstance(acts, str):
                    try:
                        acts = _ast.literal_eval(acts)
                    except Exception:
                        acts = []
                if isinstance(acts, list) and tuple(acts) in variant_tuples:
                    cid = str(row.get('trace_id', ''))
                    exclude_case_ids.add(cid)
                    if 'step3' not in excluded_by_step:
                        excluded_by_step['step3'] = []
                    excluded_by_step['step3'].append(cid)

    original_count = len(original_log)

    # Build filtered log from original (skip log-level attribute copy — not used downstream)
    filtered_log = PM4PyLog()
    for trace in original_log:
        cid = str(trace.attributes.get('concept:name', ''))
        if cid not in exclude_case_ids:
            filtered_log.append(trace)

    filtered_count = len(filtered_log)
    excluded_count = original_count - filtered_count

    last_uploaded_data['filtered_log'] = filtered_log
    last_uploaded_data['excluded_case_ids'] = list(exclude_case_ids)
    last_uploaded_data['excluded_by_step'] = excluded_by_step
    last_uploaded_data['is_filtered'] = excluded_count > 0
    last_uploaded_data['impact_matrix'] = None
    last_uploaded_data['aggregated_base_matrix'] = None   # invalidate downstream

    if mode == 'bpmn':
        # Slice cached alignments — do NOT recompute (alignments are non-deterministic;
        # recomputing would produce different results from the original analysis).
        original_alignments = get_cached_alignments()
        original_log = get_cached_xes_log()

        filtered_alignments = [
            original_alignments[i]
            for i, trace in enumerate(original_log)
            if str(trace.attributes.get('concept:name', '')) not in exclude_case_ids
        ]
        last_uploaded_data['filtered_alignments'] = filtered_alignments
        print(f"✂️ Sliced alignments: {len(original_alignments)} → {len(filtered_alignments)} (removed {len(original_alignments) - len(filtered_alignments)})")

        df, labels = build_trace_deviation_matrix_df(filtered_log, filtered_alignments)
        trace_features = last_uploaded_data.get('trace_features')
        if trace_features is not None and not trace_features.empty:
            df = df.merge(trace_features, on='trace_id', how='left')
        last_uploaded_data['deviation_matrix'] = df
        last_uploaded_data['deviation_labels'] = labels
        print(f"✅ Filtered deviation matrix shape: {df.shape}")

        filtered_events = sum(len(t) for t in filtered_log)
        return jsonify({
            "original_count": original_count,
            "filtered_count": filtered_count,
            "excluded_count": excluded_count,
            "filtered_events": filtered_events,
            "alignment_count": len(filtered_alignments),
            "excluded_by_step": {k: list(set(v)) for k, v in excluded_by_step.items()},
        })

    else:  # declarative — filter rows from original matrix
        if orig_matrix is not None and not orig_matrix.empty and 'trace_id' in orig_matrix.columns:
            filtered_matrix = orig_matrix[
                ~orig_matrix['trace_id'].astype(str).isin(exclude_case_ids)
            ].copy()
        else:
            filtered_matrix = orig_matrix.copy() if orig_matrix is not None else pd.DataFrame()

        last_uploaded_data['deviation_matrix'] = filtered_matrix
        filtered_events = sum(len(t) for t in filtered_log)
        return jsonify({
            "original_count": original_count,
            "filtered_count": filtered_count,
            "excluded_count": excluded_count,
            "filtered_events": filtered_events,
            "excluded_by_step": {k: list(set(v)) for k, v in excluded_by_step.items()},
        })


@app.route('/api/log-quality', methods=['GET'])
def get_log_quality():
    """Return data quality metrics for the uploaded event log, including outlier detection."""
    log = last_uploaded_data.get("xes_log")
    if log is None:
        return jsonify({"error": "No log loaded"}), 400

    import ast
    from collections import Counter

    total_traces = len(log)
    total_events = sum(len(trace) for trace in log)

    # Collect all attribute names
    trace_attr_names = set()
    event_attr_names = set()
    for trace in log:
        for key in trace.attributes:
            if key != 'concept:name':
                trace_attr_names.add(key)
        for event in trace:
            for key in event:
                event_attr_names.add(key)

    def is_missing(val):
        return val is None or (isinstance(val, str) and val.strip() == '')

    # Missing values per trace attribute
    trace_attributes = []
    for attr in sorted(trace_attr_names):
        missing = sum(1 for trace in log if is_missing(trace.attributes.get(attr)))
        trace_attributes.append({
            "name": attr,
            "missing_count": missing,
            "missing_percentage": round(missing / total_traces * 100, 1) if total_traces > 0 else 0
        })

    # Missing values per event attribute
    event_attributes = []
    for attr in sorted(event_attr_names):
        missing = sum(1 for trace in log for event in trace if is_missing(event.get(attr)))
        event_attributes.append({
            "name": attr,
            "missing_count": missing,
            "missing_percentage": round(missing / total_events * 100, 1) if total_events > 0 else 0
        })

    # Timestamp anomalies (out-of-order events within a trace)
    out_of_order_ids = []
    for trace in log:
        timestamps = [event['time:timestamp'] for event in trace if 'time:timestamp' in event and event['time:timestamp'] is not None]
        for i in range(1, len(timestamps)):
            if timestamps[i] < timestamps[i - 1]:
                out_of_order_ids.append(str(trace.attributes.get('concept:name', 'unknown')))
                break

    # Duplicate case IDs
    case_ids = [str(trace.attributes.get('concept:name', '')) for trace in log]
    id_counts = Counter(case_ids)
    duplicate_ids = [cid for cid, cnt in id_counts.items() if cnt > 1]

    # Trace length stats
    trace_lengths = [len(trace) for trace in log]

    # Trace duration stats
    durations = []
    for trace in log:
        events = list(trace)
        if len(events) >= 2:
            start = events[0].get('time:timestamp')
            end = events[-1].get('time:timestamp')
            if start and end:
                durations.append(abs((end - start).total_seconds()))

    def safe_stats(vals):
        if not vals:
            return {"min": 0, "max": 0, "mean": 0, "median": 0}
        sv = sorted(vals)
        return {
            "min": round(sv[0], 1),
            "max": round(sv[-1], 1),
            "mean": round(sum(vals) / len(vals), 1),
            "median": round(sv[len(sv) // 2], 1)
        }

    # ── Outlier detection (Z-score, all traces, computed from XES log directly) ─
    # Collect per-trace duration and event count
    trace_durations = {}   # case_id -> seconds
    trace_lengths_map = {} # case_id -> event count
    for trace in log:
        cid = str(trace.attributes.get('concept:name', ''))
        trace_lengths_map[cid] = len(trace)
        events = list(trace)
        if len(events) >= 2:
            start = events[0].get('time:timestamp')
            end = events[-1].get('time:timestamp')
            if start and end:
                trace_durations[cid] = abs((end - start).total_seconds())

    duration_outliers = []
    if len(trace_durations) >= 4:
        dur_vals = list(trace_durations.values())
        mean_d = sum(dur_vals) / len(dur_vals)
        std_d = (sum((v - mean_d) ** 2 for v in dur_vals) / len(dur_vals)) ** 0.5
        if std_d > 0:
            for cid, val in trace_durations.items():
                z = (val - mean_d) / std_d
                if abs(z) > 3:
                    duration_outliers.append({
                        "case_id": cid,
                        "value_seconds": round(val, 1),
                        "z_score": round(z, 2)
                    })

    length_outliers = []
    count_vals = list(trace_lengths_map.values())
    if len(count_vals) >= 4:
        mean_l = sum(count_vals) / len(count_vals)
        std_l = (sum((v - mean_l) ** 2 for v in count_vals) / len(count_vals)) ** 0.5
        if std_l > 0:
            for cid, cnt in trace_lengths_map.items():
                z = (cnt - mean_l) / std_l
                if abs(z) > 3:
                    length_outliers.append({
                        "case_id": cid,
                        "value": cnt,
                        "z_score": round(z, 2)
                    })

    # Sort by |z_score| descending — no cap (all outliers returned)
    duration_outliers.sort(key=lambda x: -abs(x["z_score"]))
    length_outliers.sort(key=lambda x: -abs(x["z_score"]))

    return jsonify({
        "total_traces": total_traces,
        "total_events": total_events,
        "trace_attributes": sorted(trace_attributes, key=lambda x: -x["missing_count"]),
        "event_attributes": sorted(event_attributes, key=lambda x: -x["missing_count"]),
        "timestamp_anomalies": {
            "out_of_order_count": len(out_of_order_ids),
            "out_of_order_case_ids": out_of_order_ids[:20]
        },
        "duplicate_case_ids": duplicate_ids[:20],
        "trace_length_stats": safe_stats(trace_lengths),
        "trace_duration_stats": safe_stats(durations),
        "duration_outliers": duration_outliers,
        "length_outliers": length_outliers
    })


@app.route('/api/filter-traces', methods=['POST'])
def filter_traces():
    """Optionally filter anomalous cases out of the deviation matrix."""
    data = request.json or {}
    filters = data.get('filters', {})

    matrix = get_cached_deviation_matrix()
    if matrix is None or matrix.empty:
        return jsonify({"error": "No deviation matrix available"}), 400

    original_count = len(matrix)
    filtered = matrix.copy()

    exclude_ids = set()
    if filters.get('exclude_out_of_order'):
        exclude_ids.update(str(i) for i in (filters.get('out_of_order_ids') or []))
    if filters.get('exclude_duplicates'):
        exclude_ids.update(str(i) for i in (filters.get('duplicate_ids') or []))
    # Direct list of trace IDs to exclude (used for outlier removal)
    if filters.get('exclude_ids'):
        exclude_ids.update(str(i) for i in filters['exclude_ids'])

    if exclude_ids and 'trace_id' in filtered.columns:
        filtered = filtered[~filtered['trace_id'].astype(str).isin(exclude_ids)]

    last_uploaded_data["deviation_matrix"] = filtered

    return jsonify({
        "original_count": original_count,
        "filtered_count": len(filtered),
        "excluded_count": original_count - len(filtered)
    })


@app.route('/api/process-variants', methods=['GET'])
def get_process_variants():
    """Return all unique process variants (activity sequences) with case counts."""
    import ast as _ast
    from collections import Counter

    # Prefer original (unfiltered) matrix so variants aren't missing after filters applied
    matrix = last_uploaded_data.get('original_deviation_matrix')
    if matrix is None:
        matrix = last_uploaded_data.get('deviation_matrix')
    log = last_uploaded_data.get('xes_log')

    if matrix is not None and not matrix.empty and 'activities' in matrix.columns:
        total = len(matrix)
        variant_counter: Counter = Counter()
        for val in matrix['activities']:
            if isinstance(val, list):
                key = tuple(val)
            elif isinstance(val, str):
                try:
                    key = tuple(_ast.literal_eval(val))
                except Exception:
                    key = ()
            else:
                key = ()
            variant_counter[key] += 1

        variants = [
            {
                "sequence": list(seq),
                "count": cnt,
                "percentage": round(cnt / total * 100, 1) if total > 0 else 0,
            }
            for seq, cnt in variant_counter.most_common()
            if seq
        ]
        return jsonify({"variants": variants, "total_traces": total})

    elif log is not None:
        # Fallback: compute directly from the XES log
        total = len(log)
        variant_counter = Counter()
        for trace in log:
            key = tuple(event.get('concept:name', '') for event in trace)
            variant_counter[key] += 1

        variants = [
            {
                "sequence": list(seq),
                "count": cnt,
                "percentage": round(cnt / total * 100, 1) if total > 0 else 0,
            }
            for seq, cnt in variant_counter.most_common()
            if seq
        ]
        return jsonify({"variants": variants, "total_traces": total})

    return jsonify({"variants": [], "total_traces": 0})


@app.route('/api/model-check', methods=['GET'])
def get_model_check():
    """Return model suitability metrics: fitness, precision, activity comparison."""
    mode = last_uploaded_data.get('mode', 'bpmn')

    if mode == 'declarative':
        log = last_uploaded_data.get('xes_log')
        atoms_df = last_uploaded_data.get('atoms_df')
        deviation_matrix = last_uploaded_data.get('deviation_matrix')

        if log is None:
            return jsonify({"error": "No log loaded"}), 400

        total_traces = len(log)
        activities_in_log = set()
        for trace in log:
            for event in trace:
                act = event.get('concept:name')
                if act:
                    activities_in_log.add(act)

        total_constraints = len(atoms_df) if atoms_df is not None else 0
        constraint_violation_rate = None
        if deviation_matrix is not None and not deviation_matrix.empty and total_constraints > 0:
            non_meta = {'trace_id', 'trace_duration_seconds', 'activities'}
            dev_cols = [c for c in deviation_matrix.columns if c not in non_meta and
                        set(deviation_matrix[c].dropna().unique()).issubset({0, 1, 0.0, 1.0})]
            if dev_cols:
                n_violated = int(deviation_matrix[dev_cols].any(axis=1).sum())
                constraint_violation_rate = round(n_violated / len(deviation_matrix), 4)

        return jsonify({
            "mode": "declarative",
            "total_traces": total_traces,
            "total_constraints": total_constraints,
            "constraint_violation_rate": constraint_violation_rate,
            "activities_in_log": sorted(activities_in_log)
        })

    # BPMN mode
    if not last_uploaded_data.get('bpmn_path') or not last_uploaded_data.get('xes_log'):
        return jsonify({"error": "No BPMN model or log loaded"}), 400

    log = last_uploaded_data['xes_log']
    bpmn_path = last_uploaded_data['bpmn_path']

    # Fitness from stored alignments
    aligned_traces = get_cached_alignments()
    fitness_values = [t.get('fitness', 0) for t in aligned_traces]
    avg_fitness = round(sum(fitness_values) / len(fitness_values), 4) if fitness_values else 0

    # Precision
    precision = None
    try:
        from process_mining.conformance_alignments import read_model_as_petri_net
        net, im, fm = read_model_as_petri_net(bpmn_path)
        precision_val = pm4py.precision_alignments(log, net, im, fm)
        precision = round(float(precision_val), 4)
    except Exception as e:
        print(f"Precision computation failed: {e}")

    # Activities
    activities_in_model = set(get_all_activities_from_model(bpmn_path))
    activities_in_log = set()
    for trace in log:
        for event in trace:
            act = event.get('concept:name')
            if act:
                activities_in_log.add(act)

    return jsonify({
        "mode": "bpmn",
        "fitness": avg_fitness,
        "precision": precision,
        "total_traces": len(log),
        "activities_only_in_model": sorted(activities_in_model - activities_in_log),
        "activities_only_in_log": sorted(activities_in_log - activities_in_model),
        "activities_in_both": sorted(activities_in_model & activities_in_log)
    })


@app.route('/api/deviation-selection', methods=['GET'])
def get_deviation_selection():
    """Return deviations with affected case counts and top process variants per deviation."""
    import ast
    from collections import Counter

    matrix = get_cached_deviation_matrix()
    mode = last_uploaded_data.get('mode', 'bpmn')

    if matrix is None or matrix.empty:
        return jsonify({"error": "No deviation matrix available"}), 400

    # Build constraint-info lookup
    constraint_info_by_col = {}
    if mode == 'declarative-model':
        for info in (last_uploaded_data.get('decl_constraint_info') or []):
            constraint_info_by_col[info['col_name']] = info
    elif mode == 'declarative':
        atoms_df = last_uploaded_data.get('atoms_df')
        if atoms_df is not None and len(atoms_df) > 0:
            for _, row in atoms_df.iterrows():
                col_name = f"{row['type']}_{row['op_0']}_{row['op_1']}"
                constraint_info_by_col[col_name] = {
                    'support': float(row.get('support', 0)),
                    'confidence': float(row.get('confidence', 0)),
                }

    total_traces = len(matrix)
    non_meta = {
        'trace_id', 'trace_duration_seconds', 'activities',
        'event_count', 'rework_count', 'max_inter_event_gap_seconds',
        'avg_inter_event_gap_seconds', 'unique_resource_count',
    }

    if mode == 'bpmn':
        dev_cols = [c for c in matrix.columns if c.startswith('(Skip ') or c.startswith('(Insert ')]
    else:
        dev_cols = []
        for col in matrix.columns:
            if col in non_meta:
                continue
            unique_vals = set(matrix[col].dropna().unique())
            if unique_vals.issubset({0, 1, 0.0, 1.0}):
                dev_cols.append(col)

    deviations = []
    for col in dev_cols:
        affected_mask = matrix[col] == 1
        affected_count = int(affected_mask.sum())
        if affected_count == 0:
            continue

        affected_pct = round(affected_count / total_traces * 100, 1)

        top_variants = []
        if 'activities' in matrix.columns:
            variant_counts = Counter()
            for acts in matrix.loc[affected_mask, 'activities']:
                if isinstance(acts, list):
                    variant_counts[tuple(acts)] += 1
                elif isinstance(acts, str):
                    try:
                        variant_counts[tuple(ast.literal_eval(acts))] += 1
                    except Exception:
                        pass

            top_variants = [
                {
                    "sequence": list(seq),
                    "count": cnt,
                    "percentage": round(cnt / affected_count * 100, 1)
                }
                for seq, cnt in variant_counts.most_common(10)
            ]

        if col.startswith('(Skip '):
            label = f"Skip: {col[6:-1]}"
            dev_type = "skip"
        elif col.startswith('(Insert '):
            label = f"Insert: {col[8:-1]}"
            dev_type = "insertion"
        else:
            cinfo_pre = constraint_info_by_col.get(col, {})
            if mode == 'declarative-model' and cinfo_pre.get('operands'):
                ops = cinfo_pre['operands']
                dev_type = cinfo_pre.get('type', col)
                arrow = f"{ops[0]} \u2192 {ops[1]}" if len(ops) >= 2 else ops[0]
                label = f"{dev_type}: {arrow}"
            else:
                parts = col.split('_', 2)
                dev_type = parts[0]
                if len(parts) == 3 and parts[2] != 'None':
                    label = f"{parts[0]}: {parts[1]} \u2192 {parts[2]}"
                elif len(parts) >= 2:
                    label = f"{parts[0]}: {parts[1]}"
                else:
                    label = col

        cinfo = constraint_info_by_col.get(col, {})
        deviations.append({
            "column": col,
            "label": label,
            "type": dev_type,
            "affected_count": affected_count,
            "affected_percentage": affected_pct,
            "top_variants": top_variants,
            "activation_condition": cinfo.get('activation_condition'),
            "correlation_condition": cinfo.get('correlation_condition'),
            "time_condition": cinfo.get('time_condition'),
            "total_activations": cinfo.get('total_activations'),
            "violation_diagnostics": cinfo.get('violation_diagnostics'),
            "support": cinfo.get('support'),
            "confidence": cinfo.get('confidence'),
        })

    deviations.sort(key=lambda x: -x["affected_count"])

    return jsonify({"deviations": deviations, "total_traces": total_traces})


@app.route('/api/deviation-correlations', methods=['GET'])
def get_deviation_correlations():
    """Return pairwise co-occurrence counts for all deviations."""
    matrix = get_cached_deviation_matrix()
    mode = last_uploaded_data.get('mode', 'bpmn')

    if matrix is None or matrix.empty:
        return jsonify({"correlations": [], "total_traces": 0})

    non_meta = {
        'trace_id', 'trace_duration_seconds', 'activities',
        'event_count', 'rework_count', 'max_inter_event_gap_seconds',
        'avg_inter_event_gap_seconds', 'unique_resource_count',
    }

    if mode == 'bpmn':
        dev_cols = [c for c in matrix.columns if c.startswith('(Skip ') or c.startswith('(Insert ')]
    else:
        dev_cols = []
        for col in matrix.columns:
            if col in non_meta:
                continue
            unique_vals = set(matrix[col].dropna().unique())
            if unique_vals.issubset({0, 1, 0.0, 1.0}):
                dev_cols.append(col)

    dev_cols = [c for c in dev_cols if int((matrix[c] == 1).sum()) > 0]
    total = len(matrix)

    correlations = []
    for i, col_a in enumerate(dev_cols):
        for col_b in dev_cols[i + 1:]:
            both = int(((matrix[col_a] == 1) & (matrix[col_b] == 1)).sum())
            if both > 0:
                count_a = int((matrix[col_a] == 1).sum())
                count_b = int((matrix[col_b] == 1).sum())
                correlations.append({
                    "col_a": col_a,
                    "col_b": col_b,
                    "count": both,
                    "percentage": round(both / total * 100, 1),
                    "jaccard": round(both / (count_a + count_b - both), 3) if (count_a + count_b - both) > 0 else 0,
                })

    correlations.sort(key=lambda x: -x["count"])
    return jsonify({"correlations": correlations, "total_traces": total})


@app.route('/api/ollama/models', methods=['GET'])
def api_ollama_models():
    import urllib.request
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = [m["name"] for m in data.get("models", [])]
        return jsonify({"models": models, "online": True})
    except Exception as e:
        return jsonify({"models": [], "online": False, "error": str(e)})


@app.route('/api/ollama/start', methods=['POST'])
def api_ollama_start():
    import subprocess
    try:
        subprocess.Popen(['ollama', 'serve'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return jsonify({'started': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ollama/pull', methods=['POST'])
def api_ollama_pull():
    import urllib.request
    data = request.get_json(force=True)
    model = data.get('model', 'llama3.2')
    payload = json.dumps({"name": model, "stream": False}).encode("utf-8")
    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/pull",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=600) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        return jsonify({"status": result.get("status", "success")})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/llm-suggestion', methods=['POST'])
def api_llm_suggestion():
    import urllib.request
    data = request.get_json(force=True)
    deviation = data.get('deviation', '')
    direction = data.get('direction', 'neutral')
    causal_effects = data.get('causal_effects', [])
    top_rule = data.get('top_rule', None)
    model = data.get('model', 'llama3.2')
    all_activities = data.get('all_activities', [])
    workaround = data.get('workaround', None)        # {actor_roles, misfit, goal, intended_dimensions}
    risks_opportunities = data.get('risks_opportunities', [])  # [{type, horizon, description}]

    effects_lines = "\n".join(
        f"  - {e['dimension']}: CATE={e['ate']:.3f} ({e['criticality']})"
        for e in causal_effects if e.get('ate') is not None
    )
    rule_line = f"\nKey predictive pattern: {top_rule}" if top_rule else ""

    if direction == 'negative':
        action = "avoid or reduce this deviation"
    elif direction == 'positive':
        action = "encourage or institutionalize this deviation as a standard practice"
    else:
        action = "monitor this deviation without urgent intervention"

    activities_block = ""
    if all_activities:
        activities_list = ", ".join(f'"{a}"' for a in all_activities[:80])
        activities_block = f"""
All activity names observed in the process log:
{activities_list}

Step 1 — Infer the process domain: Based on the activity names above, identify what kind of real-world process this likely is (e.g. healthcare, logistics, finance, IT service management, manufacturing). Look at the nouns (objects) and verbs (actions) in the activity names to reason about the domain and the process flow.
"""

    workaround_block = ""
    if workaround:
        roles_str = ", ".join(workaround.get('actor_roles', [])) or "unspecified"
        misfit = workaround.get('misfit', '').strip()
        goal = workaround.get('goal', '').strip()
        intended = workaround.get('intended_dimensions', [])
        intended_lines = "\n".join(
            f"    • {d['dimension']}: {d['description']}" for d in intended if d.get('description')
        ) or "    (none specified)"
        workaround_block = f"""
Participant perspective (workaround analysis):
  - This deviation is a workaround performed by: {roles_str}
  - Stated misfit / reason: {misfit or '(not provided)'}
  - Stated goal: {goal or '(not provided)'}
  - Intended impact on dimensions (as reported by participants):
{intended_lines}
"""

    risks_block = ""
    if risks_opportunities:
        risks_lines = "\n".join(
            f"  - [{e['type'].upper()} / {e['horizon']}-term] {e['description']}"
            for e in risks_opportunities if e.get('description')
        )
        if risks_lines:
            risks_block = f"\nIdentified risks and opportunities:\n{risks_lines}\n"

    prompt = f"""You are a process improvement consultant analyzing a business process.
{activities_block}
A process deviation called "{deviation}" has been detected.
Overall impact direction: {direction}.

Measured causal effects on process dimensions (from data):
{effects_lines}{rule_line}
{workaround_block}{risks_block}
Step 2 — Give 3 concise, actionable recommendations to {action}.
Ground your recommendations in the inferred process domain, the specific activities involved, the participant perspective, and the identified risks/opportunities. Be specific and practical. Use bullet points. Do not repeat the input data."""

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": 500, "temperature": 0.7}
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        return jsonify({"suggestion": result.get("response", "").strip()})
    except Exception as e:
        return jsonify({"error": f"Ollama error: {str(e)}"}), 500


@app.route('/api/workaround-resources', methods=['GET'])
def get_workaround_resources():
    """
    For each issue column in the aggregated matrix, return the org:resource values responsible.

    Uses resources_by_deviation (computed at upload time with insertion/skip semantics) and
    stored_issue_map (original_col → issue_name) to aggregate per-issue resources.
    """
    matrix = last_uploaded_data.get('aggregated_base_matrix')
    if matrix is None:
        matrix = get_cached_deviation_matrix()
    if matrix is None or matrix.empty:
        return jsonify({'resources_by_issue': {}})

    non_meta = {
        'trace_id', 'trace_duration_seconds', 'activities',
        'event_count', 'rework_count', 'max_inter_event_gap_seconds',
        'avg_inter_event_gap_seconds', 'unique_resource_count',
    }
    DIMENSION_NAMES = {'time', 'costs', 'quality', 'outcome', 'compliance'}

    issue_cols = [
        c for c in matrix.columns
        if c not in non_meta and c not in DIMENSION_NAMES and c != 'trace_id'
        and set(matrix[c].dropna().unique()).issubset({0, 1, 0.0, 1.0})
    ]

    resources_by_deviation = last_uploaded_data.get('resources_by_deviation') or {}
    stored_issue_map = last_uploaded_data.get('stored_issue_map') or {}

    # Build reverse map: issue_name → list of original deviation columns
    issue_to_devs: dict = {}
    for dev_col, issue_name in stored_issue_map.items():
        issue_to_devs.setdefault(issue_name, []).append(dev_col)

    resources_by_issue = {}
    for issue in issue_cols:
        devs_for_issue = issue_to_devs.get(issue, [])
        if devs_for_issue:
            # Union resources from all original deviations that were merged into this issue
            merged = set()
            for dev in devs_for_issue:
                merged.update(resources_by_deviation.get(dev, []))
            resources_by_issue[issue] = sorted(merged)
        else:
            # Issue name was not in the map (e.g. ungrouped single deviation kept as-is)
            # Fall back to the resources computed for that column directly (if same name exists)
            resources_by_issue[issue] = sorted(resources_by_deviation.get(issue, []))

    return jsonify({'resources_by_issue': resources_by_issue})


@app.route('/api/workaround-patterns', methods=['GET'])
def get_workaround_patterns_endpoint():
    """Return workaround pattern hints for each issue (BPMN / trace-alignment mode only).

    Analyzes inserted and skipped activities per issue and returns per-issue pattern
    evidence: recurrence, direct_repetition, mutually_exclusive, wrong_order,
    missing_occurrence, unusual_neighbor — each with a support count and percentage.
    """
    mode = last_uploaded_data.get('mode', 'bpmn')
    log = last_uploaded_data.get('xes_log')
    aligned_traces = last_uploaded_data.get('alignments')
    stored_issue_map = last_uploaded_data.get('stored_issue_map')

    if mode != 'bpmn' or log is None or aligned_traces is None or stored_issue_map is None:
        return jsonify({'patterns': {}})

    try:
        from process_mining.pattern_workarounds import get_workaround_patterns, get_merge_suggestions
        bpmn_path = last_uploaded_data.get('bpmn_path')
        patterns = get_workaround_patterns(log, aligned_traces, stored_issue_map, bpmn_path)
        merge_suggestions = get_merge_suggestions(aligned_traces, stored_issue_map)
        return jsonify({'patterns': patterns, 'merge_suggestions': merge_suggestions})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'patterns': {}, 'merge_suggestions': [], 'error': str(e)})


if __name__ == '__main__':
    print("🚀 Flask backend running at: http://localhost:1965")
    app.run(host="0.0.0.0", port=1965, debug=True, use_reloader=False, threaded=True)
    reset_cache()
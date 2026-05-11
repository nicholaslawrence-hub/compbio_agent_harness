"""Runtime helpers for pointer-based graph execution."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any

from config import settings


# These nodes now call API/database adapters rather than launching native model jobs.
HEAVY_NODE_TYPES: set[str] = set()


def stable_hash(payload: Any) -> str:
    body = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def checkpoint_dir() -> Path:
    path = settings.raw_dir / "checkpoints"
    path.mkdir(parents=True, exist_ok=True)
    return path


def checkpoint_path(job_id: str) -> Path:
    return checkpoint_dir() / f"{job_id}.json"


def save_checkpoint(job_id: str, state: dict) -> dict[str, Any]:
    payload = checkpoint_payload(state)
    checkpoint_path(job_id).write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return payload


def load_checkpoint(job_id: str) -> dict[str, Any] | None:
    path = checkpoint_path(job_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def register_artifact(path: str, kind: str, summary: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    p = Path(path)
    artifact_id = f"{kind}_{uuid.uuid4().hex[:12]}"
    return {
        "artifact_id": artifact_id,
        "uri": str(p),
        "kind": kind,
        "summary": summary,
        "bytes": p.stat().st_size if p.exists() else None,
        "metadata": metadata or {},
    }


def node_instance_config(state: dict, node_id: str) -> dict[str, Any]:
    topology = state.get("network_topology") or {}
    for node in topology.get("nodes", []):
        if node.get("id") == node_id:
            return node
    return {"id": node_id, "type": node_id, "config": {}}


def scoped_patch(state: dict, node_id: str, node_type: str, output: dict[str, Any]) -> dict[str, Any]:
    existing_outputs = dict(state.get("node_outputs", {}) or {})
    existing_outputs[node_id] = {
        "node_type": node_type,
        "summary": summarize_output(output),
        "keys": sorted(output.keys()),
        "data": _compact_output(output),
        "artifact_refs": list((output.get("artifact_registry") or {}).keys()),
    }
    node_status = dict(state.get("node_status", {}) or {})
    node_status[node_id] = output.get("status", "complete")
    return {
        "node_outputs": existing_outputs,
        "node_status": node_status,
        "active_node_id": node_id,
    }


def summarize_output(output: dict[str, Any]) -> str:
    for value in output.get("supervisor_context", []) or []:
        if value.get("summary"):
            return str(value["summary"])[:280]
    for key, value in output.items():
        if key.endswith("_results") and isinstance(value, list):
            return f"{key}: {len(value)} records"
    if output.get("status"):
        return str(output["status"])
    return "Node completed."


def _compact_output(output: dict[str, Any]) -> dict[str, Any]:
    compact = {}
    for key, value in output.items():
        if key in {"all_dge_results"}:
            continue
        if isinstance(value, list):
            compact[key] = value[:5]
        elif isinstance(value, dict):
            compact[key] = {k: value[k] for k in list(value)[:12]}
        elif key not in {"all_dge_results"}:
            compact[key] = value
    return compact


def provenance_event(node_id: str, node_type: str, state: dict, output: dict[str, Any]) -> dict[str, Any]:
    context = {
        "node_id": node_id,
        "node_type": node_type,
        "input_summary": {
            "top_genes": state.get("top_genes", [])[:10],
            "artifact_ids": list((state.get("artifact_registry") or {}).keys()),
            "previous_node_id": state.get("previous_node_id", ""),
        },
        "output_summary": summarize_output(output),
        "temperature": getattr(getattr(state, "llm", None), "temperature", None),
        "prompt": str(state.get("supervisor_reasoning") or state.get("supervisor_subquery") or "")[:2000],
        "raw_output": str(output.get("supervisor_reasoning") or summarize_output(output))[:2000],
        "timestamp": time.time(),
    }
    return {
        **context,
        "hash": stable_hash(context),
    }


def pending_task(node_id: str, node_type: str, state: dict) -> dict[str, Any]:
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    return {
        "task_id": task_id,
        "node_id": node_id,
        "node_type": node_type,
        "status": "pending_external_worker",
        "queue": "gpu" if node_type in HEAVY_NODE_TYPES else "cpu",
        "summary": f"{node_type} dispatched as asynchronous background work.",
        "created_at": time.time(),
    }


def dispatch_external_task(state: dict, node_id: str, node_type: str) -> dict[str, Any]:
    task = pending_task(node_id, node_type, state)
    pending = dict(state.get("pending_tasks", {}) or {})
    pending[node_id] = task
    node_status = dict(state.get("node_status", {}) or {})
    node_status[node_id] = "pending_external_worker"
    return {
        "pending_tasks": pending,
        "node_status": node_status,
        "status": "pending_external_worker",
    }


def approval_is_granted(state: dict, node_id: str) -> bool:
    approval = (state.get("approval_requests", {}) or {}).get(node_id, {})
    return approval.get("decision") == "approved"


def checkpoint_payload(state: dict) -> dict[str, Any]:
    resume_keys = {
        "disease_term",
        "condition_a",
        "condition_b",
        "count_matrix_path",
        "sample_conditions",
        "study_context",
        "sandbox_config",
        "network_topology",
        "artifact_registry",
        "node_outputs",
        "node_status",
        "pending_tasks",
        "approval_requests",
        "provenance_ledger",
        "edge_decisions",
        "external_results",
        "active_node_id",
        "dge_results",
        "detected_genes",
        "top_genes",
        "enrichment_method",
        "pathway_results",
        "ppi_results",
        "literature_results",
        "drug_interactions",
        "depmap_results",
        "opentargets_results",
        "clinical_trials_results",
        "pathway_crosstalk_results",
        "evo2_fitness_results",
        "esm3_design_results",
        "scenic_regulon_results",
        "spatial_tme_results",
        "lincs_reversion_results",
        "tcga_survival_results",
        "pharmacogenomics_pgx_results",
        "crispr_design_results",
        "alphafold_complex_results",
        "viper_protein_activity_results",
        "mageck_crispr_results",
        "reinvent_generative_results",
        "gnina_docking_results",
        "rdkit_feature_results",
        "hypotheses",
        "final_report",
        "errors",
        "dge_attempt",
        "next_step",
        "supervisor_subquery",
        "supervisor_reasoning",
        "supervisor_iterations",
        "supervisor_context",
        "pruned_genes",
        "routing_history",
        "prompt_payloads",
        "execution_events",
        "critic_feedback",
        "critic_retries",
        "retry_counts",
        "critic_route",
        "flow_killed",
        "previous_node_id",
        "status",
        "progress",
        "current_gene_index",
    }
    resume_state = {key: state.get(key) for key in resume_keys if key in state}
    resume_state["all_dge_results"] = []
    return {
        "status": state.get("status"),
        "progress": state.get("progress", 0),
        "network_topology": state.get("network_topology", {}),
        "node_outputs": state.get("node_outputs", {}),
        "node_status": state.get("node_status", {}),
        "artifact_registry": state.get("artifact_registry", {}),
        "pending_tasks": state.get("pending_tasks", {}),
        "approval_requests": state.get("approval_requests", {}),
        "provenance_ledger": state.get("provenance_ledger", []),
        "edge_decisions": state.get("edge_decisions", {}),
        "external_results": state.get("external_results", {}),
        "routing_history": state.get("routing_history", []),
        "execution_events": state.get("execution_events", []),
        "prompt_payloads": state.get("prompt_payloads", []),
        "errors": state.get("errors", []),
        "resume_state": resume_state,
    }

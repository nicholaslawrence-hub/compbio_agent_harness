"""FastAPI routes for PharmaGPT-Agent."""
import asyncio
import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from config import settings
from agents.graph import get_pipeline, NODE_IMPLS
from agents.state import AgentState
from agents.runtime import checkpoint_payload, load_checkpoint, register_artifact, save_checkpoint
from db.ncbi import search_sra, fetch_pubmed_abstracts
from db.uniprot import search_protein
from db.chembl import get_drug_interactions
from db.pinecone_rag import query_literature
from db.database import SessionLocal
from db.user_models import JobRecord
from auth import decode_token
from tools.ppi import get_ppi_network

router = APIRouter()

_jobs: dict[str, dict] = {}


# ── Models ───────────────────────────────────────────────────────────────────

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    result: Optional[dict] = None
    errors: list[str] = []
    network_topology: Optional[dict] = None
    execution_events: list[dict] = []
    prompt_payloads: list[dict] = []


class SandboxDesignPayload(BaseModel):
    name: str = "RNAgent sandbox design"
    nodes: list[dict]
    edges: list[dict]
    viewport: Optional[dict] = None
    directive: str = ""
    disease_term: str = ""
    condition_a: str = "disease"
    condition_b: str = "control"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_sample_conditions(raw: str) -> dict[str, str]:
    """
    Accepts JSON string or comma-separated 'sample:condition' pairs.
    e.g. '{"S1":"disease","S2":"control"}' or 'S1:disease,S2:control'
    """
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    result = {}
    for pair in raw.split(","):
        if ":" in pair:
            k, v = pair.split(":", 1)
            result[k.strip()] = v.strip()
    return result


def _sandbox_design_dir() -> Path:
    path = settings.results_dir / "sandbox_designs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_design_id(raw: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in raw.strip())
    return safe[:80] or "default"


async def _read_optional_context_file(job_id: str, upload: UploadFile | None, key: str) -> dict | None:
    if upload is None or not upload.filename:
        return None

    safe_name = Path(upload.filename).name
    save_path = settings.raw_dir / f"{job_id}_{key}_{safe_name}"
    content = await upload.read()
    save_path.write_bytes(content)

    preview = content[:4000].decode("utf-8", errors="replace")
    return {
        "filename": safe_name,
        "path": str(save_path),
        "preview": preview,
    }


def _base_initial_state(
    disease_term: str,
    condition_a: str,
    condition_b: str,
    count_matrix_path: str,
    sample_conditions: dict[str, str],
    study_context: dict | None = None,
    sandbox_config: dict | None = None,
) -> AgentState:
    return {
        "disease_term": disease_term,
        "condition_a": condition_a,
        "condition_b": condition_b,
        "count_matrix_path": count_matrix_path,
        "sample_conditions": sample_conditions,
        "study_context": study_context or {},
        "sandbox_config": sandbox_config or {},
        "network_topology": (sandbox_config or {}).get("network_topology", {}),
        "artifact_registry": {},
        "node_outputs": {},
        "node_status": {},
        "pending_tasks": {},
        "approval_requests": {},
        "provenance_ledger": [],
        "edge_decisions": {},
        "external_results": {},
        "active_node_id": "",
        "dge_results": [],
        "all_dge_results": [],
        "detected_genes": [],
        "top_genes": [],
        "enrichment_method": "",
        "pathway_results": [],
        "ppi_results": [],
        "literature_results": [],
        "drug_interactions": [],
        "depmap_results": [],
        "opentargets_results": [],
        "clinical_trials_results": [],
        "pathway_crosstalk_results": [],
        "evo2_fitness_results": [],
        "esm3_design_results": [],
        "scenic_regulon_results": [],
        "spatial_tme_results": [],
        "lincs_reversion_results": [],
        "tcga_survival_results": [],
        "pharmacogenomics_pgx_results": [],
        "crispr_design_results": [],
        "alphafold_complex_results": [],
        "viper_protein_activity_results": [],
        "mageck_crispr_results": [],
        "reinvent_generative_results": [],
        "gnina_docking_results": [],
        "rdkit_feature_results": [],
        "hypotheses": [],
        "final_report": None,
        "errors": [],
        "current_gene_index":    0,
        "dge_attempt":           1,
        "next_step":             "",
        "supervisor_subquery":   "",
        "supervisor_reasoning":  "",
        "supervisor_iterations": 0,
        "supervisor_context":    [],
        "pruned_genes":          [],
        "routing_history":       [],
        "prompt_payloads":       [],
        "execution_events":      [],
        "critic_feedback":       [],
        "critic_retries":        {},
        "retry_counts":          {},
        "critic_route":          "",
        "flow_killed":           False,
        "previous_node_id":      "",
        "status":                "pending",
        "progress":              0,
    }


_RESULT_KEYS = (
    "top_genes", "dge_results", "pathway_results", "enrichment_method",
    "hypotheses", "final_report", "ppi_results", "drug_interactions",
    "literature_results", "depmap_results", "opentargets_results",
    "clinical_trials_results", "pathway_crosstalk_results", "evo2_fitness_results",
    "esm3_design_results", "scenic_regulon_results", "spatial_tme_results",
    "lincs_reversion_results", "tcga_survival_results", "pharmacogenomics_pgx_results",
    "crispr_design_results", "alphafold_complex_results", "viper_protein_activity_results",
    "mageck_crispr_results", "reinvent_generative_results", "gnina_docking_results",
    "rdkit_feature_results", "routing_history", "prompt_payloads", "execution_events",
    "network_topology", "node_outputs", "node_status", "artifact_registry",
    "pending_tasks", "approval_requests", "provenance_ledger",
)

# Fields accumulated by appending (operator.add reducers in AgentState)
_APPEND_KEYS = ("supervisor_context", "execution_events", "prompt_payloads", "routing_history", "provenance_ledger")
# Fields overwritten by the latest node output
_OVERWRITE_KEYS = ("node_outputs", "node_status", "artifact_registry", "pending_tasks", "approval_requests")


async def _run_pipeline(job_id: str, state: AgentState):
    def _run_streaming():
        accumulated = {**state}
        topology = state.get("network_topology") or state.get("sandbox_config", {}).get("network_topology")
        for step in get_pipeline(topology).stream(state):
            for _node_name, node_out in step.items():
                accumulated.update(node_out)
                job = _jobs[job_id]
                if node_out.get("status"):
                    job["status"] = node_out["status"]
                if node_out.get("progress") is not None:
                    job["progress"] = node_out["progress"]
                if node_out.get("errors"):
                    job["errors"] = list(set(job.get("errors", [])) | set(node_out["errors"]))
                if node_out.get("supervisor_reasoning"):
                    job["supervisor_reasoning"] = node_out["supervisor_reasoning"]
                for key in _APPEND_KEYS:
                    if node_out.get(key):
                        job[key] = job.get(key, []) + node_out[key]
                for key in _OVERWRITE_KEYS:
                    if node_out.get(key):
                        job[key] = node_out[key]
                latest_state = {**accumulated, **node_out}
                job["latest_state"] = latest_state
                job["checkpoint"] = save_checkpoint(job_id, latest_state)
        return accumulated

    try:
        _jobs[job_id]["status"] = "running"
        _sync_job_status(job_id, "running")
        final_state = await asyncio.to_thread(_run_streaming)
        final_status = final_state.get("status", "complete")
        _jobs[job_id].update({
            "status": final_status,
            "progress": 100,
            "result": {key: final_state.get(key) for key in _RESULT_KEYS},
            "errors": final_state.get("errors", []),
            "latest_state": final_state,
            "checkpoint": save_checkpoint(job_id, final_state),
        })
        _sync_job_status(job_id, final_status)
    except Exception as e:
        _jobs[job_id].update({"status": "failed", "errors": [str(e)], "progress": 0})
        save_checkpoint(job_id, _jobs[job_id])
        _sync_job_status(job_id, "failed")


def _sync_job_status(job_id: str, status: str):
    try:
        db = SessionLocal()
        record = db.query(JobRecord).filter(JobRecord.job_id == job_id).first()
        if record:
            record.status = status
            db.commit()
        db.close()
    except Exception:
        pass


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/analyze", summary="Upload count matrix and start analysis pipeline")
async def start_analysis(
    request: Request,
    background_tasks: BackgroundTasks,
    count_matrix: UploadFile = File(..., description="TSV/CSV count matrix (genes × samples)"),
    disease_term: str = Form(..., description="Disease name, e.g. 'Glioblastoma'"),
    sample_conditions: str = Form(..., description='JSON or "sample:condition" pairs'),
    condition_a: str = Form("disease", description="Name of disease condition label"),
    condition_b: str = Form("control", description="Name of control condition label"),
    sample_metadata: UploadFile | None = File(None, description="Optional sample metadata table"),
    phenotype_table: UploadFile | None = File(None, description="Optional phenotype or outcome table"),
    mutation_table: UploadFile | None = File(None, description="Optional mutation table"),
    custom_gene_sets: UploadFile | None = File(None, description="Optional custom gene set file"),
    study_notes: str = Form("", description="Optional study context notes"),
):
    job_id = str(uuid.uuid4())

    save_path = settings.raw_dir / f"{job_id}_{count_matrix.filename}"
    content = await count_matrix.read()
    save_path.write_bytes(content)
    matrix_artifact = register_artifact(
        str(save_path),
        "count_matrix",
        f"Uploaded count matrix {count_matrix.filename}",
        {"filename": count_matrix.filename},
    )

    conditions = _parse_sample_conditions(sample_conditions)
    study_context = {
        "sample_metadata": await _read_optional_context_file(job_id, sample_metadata, "sample_metadata"),
        "phenotype_table": await _read_optional_context_file(job_id, phenotype_table, "phenotype_table"),
        "mutation_table": await _read_optional_context_file(job_id, mutation_table, "mutation_table"),
        "custom_gene_sets": await _read_optional_context_file(job_id, custom_gene_sets, "custom_gene_sets"),
        "study_notes": study_notes.strip(),
    }
    study_context = {k: v for k, v in study_context.items() if v}

    initial_state = _base_initial_state(
        disease_term=disease_term,
        condition_a=condition_a,
        condition_b=condition_b,
        count_matrix_path=str(save_path),
        sample_conditions=conditions,
        study_context=study_context,
    )
    initial_state["artifact_registry"] = {matrix_artifact["artifact_id"]: matrix_artifact}

    _jobs[job_id] = {"status": "queued", "progress": 0, "result": None, "errors": []}

    # Associate job with user if authenticated
    auth_header = request.headers.get("Authorization", "")
    user_id = None
    if auth_header.startswith("Bearer "):
        user_id = decode_token(auth_header[7:])
    if user_id is not None:
        try:
            db = SessionLocal()
            db.add(JobRecord(job_id=job_id, user_id=user_id, disease_term=disease_term))
            db.commit()
            db.close()
        except Exception:
            pass

    background_tasks.add_task(_run_pipeline, job_id, initial_state)
    return {"job_id": job_id, "message": "Analysis started"}


@router.get("/sandbox/templates", summary="List configurable sandbox agent templates")
async def sandbox_templates():
    return {
        "agents": [
            {
                "id": "enrich_ppi",
                "label": "PPI Network",
                "description": "STRING interactions and GO/Reactome partner annotation.",
            },
            {
                "id": "depmap_query",
                "label": "DepMap CRISPR",
                "description": "Cancer dependency and essentiality evidence.",
            },
            {
                "id": "opentargets_query",
                "label": "OpenTargets",
                "description": "Disease-gene association evidence and score decomposition.",
            },
            {
                "id": "literature_rag",
                "label": "Literature RAG",
                "description": "PubMed and semantic literature retrieval with dark-gene handling.",
            },
            {
                "id": "drug_annotation",
                "label": "Drug Annotation",
                "description": "UniProt structure/function and ChEMBL drug landscape.",
            },
            {
                "id": "clinical_trials",
                "label": "Clinical Trials",
                "description": "Stubbed clinical trial search for active disease/target programs.",
            },
            {
                "id": "pathway_crosstalk",
                "label": "Pathway Crosstalk",
                "description": "Stubbed crosstalk analyzer for overlapping pathways and PPI bridges.",
            },
        ],
        "control": ["study_context", "supervisor", "critic", "report"],
        "required_core": ["run_dge", "generate_report"],
    }


def _require_user_id(request: Request) -> int:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required to manage sandbox designs.")
    user_id = decode_token(auth_header[7:])
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return user_id


@router.get("/sandbox/designs", summary="List saved sandbox designs")
async def list_sandbox_designs(request: Request):
    user_id = _require_user_id(request)
    prefix = f"{_safe_design_id(str(user_id))}__"
    designs = []
    for path in _sandbox_design_dir().glob(f"{prefix}*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        designs.append({
            "id": path.stem.removeprefix(prefix),
            "name": payload.get("name", path.stem.removeprefix(prefix)),
            "updated_at": payload.get("updated_at"),
            "node_count": len(payload.get("nodes", [])),
            "edge_count": len(payload.get("edges", [])),
        })
    return {"designs": sorted(designs, key=lambda item: item.get("updated_at") or "", reverse=True)}


@router.get("/sandbox/designs/{design_id}", summary="Load a saved sandbox design")
async def get_sandbox_design(design_id: str, request: Request):
    user_id = _require_user_id(request)
    path = _sandbox_design_dir() / f"{_safe_design_id(str(user_id))}__{_safe_design_id(design_id)}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sandbox design not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.put("/sandbox/designs/{design_id}", summary="Save a sandbox design")
async def save_sandbox_design(design_id: str, payload: SandboxDesignPayload, request: Request):
    user_id = _require_user_id(request)
    safe_id = _safe_design_id(design_id)
    path = _sandbox_design_dir() / f"{_safe_design_id(str(user_id))}__{safe_id}.json"
    data = payload.dict()
    data.update({
        "id": safe_id,
        "version": 1,
        "updated_at": str(uuid.uuid1().time),
    })
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return {"id": safe_id, "saved": True, "node_count": len(payload.nodes), "edge_count": len(payload.edges)}


@router.post("/sandbox/run", summary="Run a constrained supervisor sandbox")
async def start_sandbox_analysis(
    request: Request,
    background_tasks: BackgroundTasks,
    count_matrix: UploadFile = File(..., description="TSV/CSV count matrix (genes x samples)"),
    disease_term: str = Form(..., description="Disease name, e.g. 'Glioblastoma'"),
    sample_conditions: str = Form(..., description='JSON or "sample:condition" pairs'),
    condition_a: str = Form("disease", description="Name of disease condition label"),
    condition_b: str = Form("control", description="Name of control condition label"),
    sandbox_config: str = Form(..., description="JSON supervisor sandbox configuration"),
    network_topology: str = Form("", description="Serialized visual network topology"),
):
    job_id = str(uuid.uuid4())

    try:
        config = json.loads(sandbox_config)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="sandbox_config must be valid JSON")

    topology = config.get("network_topology") or {}
    if network_topology:
        try:
            topology = json.loads(network_topology)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="network_topology must be valid JSON")
    if topology:
        config["network_topology"] = topology

    allowed = set(config.get("allowed_agents", []))
    valid = set(NODE_IMPLS.keys()) | {"report"}
    config["allowed_agents"] = sorted(allowed & valid)
    if not config["allowed_agents"]:
        raise HTTPException(status_code=400, detail="Select at least one sandbox agent")

    try:
        config["max_iterations"] = max(1, min(8, int(config.get("max_iterations", 4))))
    except (TypeError, ValueError):
        config["max_iterations"] = 4

    save_path = settings.raw_dir / f"{job_id}_{Path(count_matrix.filename).name}"
    content = await count_matrix.read()
    save_path.write_bytes(content)
    matrix_artifact = register_artifact(
        str(save_path),
        "count_matrix",
        f"Uploaded count matrix {Path(count_matrix.filename).name}",
        {"filename": Path(count_matrix.filename).name},
    )

    conditions = _parse_sample_conditions(sample_conditions)
    directive = str(config.get("directive", "")).strip()
    study_context = {"study_notes": f"Sandbox directive: {directive}"} if directive else {}

    initial_state = _base_initial_state(
        disease_term=disease_term,
        condition_a=condition_a,
        condition_b=condition_b,
        count_matrix_path=str(save_path),
        sample_conditions=conditions,
        study_context=study_context,
        sandbox_config=config,
    )
    initial_state["artifact_registry"] = {matrix_artifact["artifact_id"]: matrix_artifact}

    _jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "result": None,
        "errors": [],
        "sandbox_config": config,
        "network_topology": topology,
        "execution_events": [],
        "prompt_payloads": [],
        "routing_history": [],
        "artifact_registry": initial_state["artifact_registry"],
        "node_outputs": {},
        "node_status": {},
        "pending_tasks": {},
        "approval_requests": {},
        "provenance_ledger": [],
        "edge_decisions": {},
        "external_results": {},
        "checkpoint": checkpoint_payload(initial_state),
    }

    auth_header = request.headers.get("Authorization", "")
    user_id = decode_token(auth_header[7:]) if auth_header.startswith("Bearer ") else None
    if user_id is not None:
        try:
            db = SessionLocal()
            db.add(JobRecord(job_id=job_id, user_id=user_id, disease_term=f"[Sandbox] {disease_term}"))
            db.commit()
            db.close()
        except Exception:
            pass

    background_tasks.add_task(_run_pipeline, job_id, initial_state)
    return {"job_id": job_id, "message": "Sandbox analysis started"}


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    j = _jobs[job_id]
    return JobStatus(
        job_id=job_id,
        status=j["status"],
        progress=j.get("progress", 0),
        result=j.get("result"),
        errors=j.get("errors", []),
        network_topology=j.get("network_topology") or (j.get("result") or {}).get("network_topology"),
        execution_events=j.get("execution_events", []),
        prompt_payloads=j.get("prompt_payloads", []),
    )


@router.get("/network/{job_id}/state", summary="Fetch latest checkpointed network state")
async def get_network_state(job_id: str):
    disk_checkpoint = load_checkpoint(job_id)
    if job_id not in _jobs and not disk_checkpoint:
        raise HTTPException(status_code=404, detail="Job not found")
    j = _jobs.get(job_id, {})
    checkpoint = j.get("checkpoint") or {
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "network_topology": j.get("network_topology"),
        "node_outputs": j.get("node_outputs", {}),
        "node_status": j.get("node_status", {}),
        "artifact_registry": j.get("artifact_registry", {}),
        "pending_tasks": j.get("pending_tasks", {}),
        "approval_requests": j.get("approval_requests", {}),
        "provenance_ledger": j.get("provenance_ledger", []),
        "edge_decisions": j.get("edge_decisions", {}),
        "external_results": j.get("external_results", {}),
        "execution_events": j.get("execution_events", []),
        "prompt_payloads": j.get("prompt_payloads", []),
        "errors": j.get("errors", []),
    } if j else disk_checkpoint
    return {"job_id": job_id, "checkpoint": checkpoint}


@router.post("/network/{job_id}/approval/{node_id}", summary="Approve or reject a paused approval gate")
async def resolve_approval(
    job_id: str,
    node_id: str,
    background_tasks: BackgroundTasks,
    decision: str = Form(...),
):
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="decision must be approved or rejected")
    checkpoint = load_checkpoint(job_id)
    if job_id not in _jobs and not checkpoint:
        raise HTTPException(status_code=404, detail="Job not found")

    stored = _jobs.get(job_id, {})
    state = stored.get("latest_state") or (checkpoint or stored.get("checkpoint") or {}).get("resume_state") or checkpoint or {}
    approvals = dict(state.get("approval_requests", {}) or {})
    current = approvals.get(node_id, {"node_id": node_id})
    current["decision"] = decision
    current["status"] = "resolved"
    approvals[node_id] = current
    state["approval_requests"] = approvals
    state["status"] = "queued"
    state.setdefault("node_status", {})[node_id] = "approval_resolved"
    state["checkpoint"] = save_checkpoint(job_id, state)
    job = _jobs.setdefault(job_id, {})
    job.update({
        "status": "queued",
        "progress": state.get("progress", 0),
        "network_topology": state.get("network_topology", {}),
        "node_outputs": state.get("node_outputs", {}),
        "node_status": state.get("node_status", {}),
        "pending_tasks": state.get("pending_tasks", {}),
        "approval_requests": approvals,
        "provenance_ledger": state.get("provenance_ledger", []),
        "latest_state": state,
        "checkpoint": state["checkpoint"],
    })
    background_tasks.add_task(_run_pipeline, job_id, state)
    return {"job_id": job_id, "node_id": node_id, "decision": decision, "checkpoint": state["checkpoint"]}


@router.post("/network/{job_id}/task/{node_id}/complete", summary="Attach an external worker result and resume the network")
async def complete_external_task(
    job_id: str,
    node_id: str,
    background_tasks: BackgroundTasks,
    payload: dict,
):
    checkpoint = load_checkpoint(job_id)
    if job_id not in _jobs and not checkpoint:
        raise HTTPException(status_code=404, detail="Job not found")

    stored = _jobs.get(job_id, {})
    state = stored.get("latest_state") or (checkpoint or stored.get("checkpoint") or {}).get("resume_state") or checkpoint or {}
    external_results = dict(state.get("external_results", {}) or {})
    external_results[node_id] = payload
    state["external_results"] = external_results
    state.setdefault("node_outputs", {})[node_id] = {
        "summary": payload.get("summary", "External worker completed."),
        "data": payload,
    }
    state.setdefault("node_status", {})[node_id] = "external_complete"
    pending = dict(state.get("pending_tasks", {}) or {})
    if node_id in pending:
        pending[node_id] = {**pending[node_id], "status": "complete", "completed_at": asyncio.get_event_loop().time()}
    state["pending_tasks"] = pending
    state["status"] = "queued"
    state["checkpoint"] = save_checkpoint(job_id, state)
    job = _jobs.setdefault(job_id, {})
    job.update({
        "status": "queued",
        "progress": state.get("progress", 0),
        "network_topology": state.get("network_topology", {}),
        "node_outputs": state.get("node_outputs", {}),
        "node_status": state.get("node_status", {}),
        "pending_tasks": pending,
        "approval_requests": state.get("approval_requests", {}),
        "latest_state": state,
        "checkpoint": state["checkpoint"],
    })
    background_tasks.add_task(_run_pipeline, job_id, state)
    return {"job_id": job_id, "node_id": node_id, "checkpoint": state["checkpoint"]}


@router.get("/jobs/{job_id}/stream", summary="SSE stream of job progress")
async def stream_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        while True:
            j = _jobs.get(job_id, {})
            data = json.dumps({
                "status": j.get("status"),
                "progress": j.get("progress", 0),
                "errors": j.get("errors", []),
                "supervisor_reasoning": j.get("supervisor_reasoning", ""),
                "supervisor_context": j.get("supervisor_context", []),
                "execution_events": j.get("execution_events", []),
                "prompt_payloads": j.get("prompt_payloads", []),
                "routing_history": j.get("routing_history", []),
                "network_topology": j.get("network_topology") or (j.get("result") or {}).get("network_topology"),
                "node_outputs": j.get("node_outputs", {}),
                "node_status": j.get("node_status", {}),
                "artifact_registry": j.get("artifact_registry", {}),
                "pending_tasks": j.get("pending_tasks", {}),
                "approval_requests": j.get("approval_requests", {}),
                "provenance_ledger": j.get("provenance_ledger", []),
                "edge_decisions": j.get("edge_decisions", {}),
                "external_results": j.get("external_results", {}),
            })
            yield f"data: {data}\n\n"
            if j.get("status") in ("complete", "failed", "dge_failed"):
                break
            await asyncio.sleep(2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/jobs/{job_id}/report")
async def get_report(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    result = _jobs[job_id].get("result") or {}
    report = result.get("final_report", "Report not yet available.")
    return {"job_id": job_id, "report": report}


# ── Single-gene lookup endpoints ─────────────────────────────────────────────

@router.get("/gene/{symbol}/ppi")
async def gene_ppi(symbol: str):
    return get_ppi_network(symbol)


@router.get("/gene/{symbol}/uniprot")
async def gene_uniprot(symbol: str):
    result = search_protein(symbol)
    if not result:
        raise HTTPException(status_code=404, detail="Gene not found in UniProt")
    return result


@router.get("/gene/{symbol}/drugs")
async def gene_drugs(symbol: str):
    return get_drug_interactions(symbol)


@router.get("/gene/{symbol}/pubmed")
async def gene_pubmed(symbol: str, max_results: int = 5):
    return fetch_pubmed_abstracts(symbol, max_results=max_results)


@router.get("/sra/search")
async def sra_search(disease: str, max_results: int = 10):
    return search_sra(disease, max_results=max_results)


@router.get("/gene/{symbol}/literature", summary="Fetch and semantically search literature for a gene via Pinecone")
async def gene_literature(symbol: str, context: str = ""):
    return query_literature(symbol, context=context)

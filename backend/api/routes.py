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
from agents.graph import get_pipeline
from agents.state import AgentState
from db.ncbi import search_sra, fetch_pubmed_abstracts
from db.uniprot import search_protein
from db.chembl import get_drug_interactions
from db.pinecone_rag import query_literature
from db.database import SessionLocal
from db.user_models import JobRecord
from auth import decode_token
from tools.ppi import get_ppi_network

router = APIRouter()

# In-memory job store (replace with Redis for production)
_jobs: dict[str, dict] = {}


# ── Models ───────────────────────────────────────────────────────────────────

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    result: Optional[dict] = None
    errors: list[str] = []


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
        "status":                "pending",
        "progress":              0,
    }


async def _run_pipeline(job_id: str, state: AgentState):
    def _run_streaming():
        """Run the graph with stream() so each node's status/progress is reflected live."""
        accumulated = {**state}
        for step in get_pipeline().stream(state):
            for _node_name, node_out in step.items():
                accumulated.update(node_out)
                # Push live status + progress back to the job store the SSE stream reads
                if node_out.get("status"):
                    _jobs[job_id]["status"] = node_out["status"]
                if node_out.get("progress") is not None:
                    _jobs[job_id]["progress"] = node_out["progress"]
                if node_out.get("errors"):
                    _jobs[job_id].setdefault("errors", [])
                    _jobs[job_id]["errors"] = list(
                        set(_jobs[job_id]["errors"]) | set(node_out["errors"])
                    )
                # Stream supervisor reasoning + accumulated context to the SSE client
                if node_out.get("supervisor_reasoning"):
                    _jobs[job_id]["supervisor_reasoning"] = node_out["supervisor_reasoning"]
                if node_out.get("supervisor_context"):
                    _jobs[job_id].setdefault("supervisor_context", [])
                    # supervisor_context uses operator.add in state, so node_out only
                    # contains the NEW entries appended by this node — accumulate them.
                    _jobs[job_id]["supervisor_context"] = (
                        _jobs[job_id]["supervisor_context"] + node_out["supervisor_context"]
                    )
        return accumulated

    try:
        _jobs[job_id]["status"] = "running"
        _sync_job_status(job_id, "running")
        final_state = await asyncio.to_thread(_run_streaming)
        final_status = final_state.get("status", "complete")
        _jobs[job_id].update({
            "status": final_status,
            "progress": 100,
            "result": {
                "top_genes": final_state.get("top_genes", []),
                "dge_results": final_state.get("dge_results", []),
                "pathway_results": final_state.get("pathway_results", []),
                "enrichment_method": final_state.get("enrichment_method", ""),
                "hypotheses": final_state.get("hypotheses", []),
                "final_report": final_state.get("final_report", ""),
                "ppi_results": final_state.get("ppi_results", []),
                "drug_interactions": final_state.get("drug_interactions", []),
                "literature_results": final_state.get("literature_results", []),
                "depmap_results": final_state.get("depmap_results", []),
                "opentargets_results": final_state.get("opentargets_results", []),
            },
            "errors": final_state.get("errors", []),
        })
        _sync_job_status(job_id, final_status)
    except Exception as e:
        _jobs[job_id].update({"status": "failed", "errors": [str(e)], "progress": 0})
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
        ],
        "required_core": ["run_dge", "pathway_enrichment", "synthesize_hypotheses", "generate_report"],
    }


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
):
    job_id = str(uuid.uuid4())

    try:
        config = json.loads(sandbox_config)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="sandbox_config must be valid JSON")

    allowed = set(config.get("allowed_agents", []))
    valid = {"enrich_ppi", "literature_rag", "drug_annotation", "depmap_query", "opentargets_query"}
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

    _jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "result": None,
        "errors": [],
        "sandbox_config": config,
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
    )


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

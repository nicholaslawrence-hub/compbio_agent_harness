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
):
    job_id = str(uuid.uuid4())

    save_path = settings.raw_dir / f"{job_id}_{count_matrix.filename}"
    content = await count_matrix.read()
    save_path.write_bytes(content)

    conditions = _parse_sample_conditions(sample_conditions)

    initial_state: AgentState = {
        "disease_term": disease_term,
        "condition_a": condition_a,
        "condition_b": condition_b,
        "count_matrix_path": str(save_path),
        "sample_conditions": conditions,
        "dge_results": [],
        "all_dge_results": [],
        "detected_genes": [],
        "top_genes": [],
        "enrichment_method": "",
        "pathway_results": [],
        "ppi_results": [],
        "literature_results": [],
        "drug_interactions": [],
        "hypotheses": [],
        "final_report": None,
        "errors": [],
        "current_gene_index": 0,
        "status": "pending",
        "progress": 0,
    }

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

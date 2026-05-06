"""PharmaGPT-Agent FastAPI application entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router

app = FastAPI(
    title="Drug-Target Discovery Tool",
    description="Automated Drug-Target Discovery via Multi-Omics Agentic Reasoning",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

_extra = os.getenv("FRONTEND_URL", "")
_origins = ["http://localhost:5173", "http://localhost:3000"]
if _extra:
    _origins.extend([u.strip() for u in _extra.split(",") if u.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if _extra else ["*"],
    allow_credentials=False if not _extra else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "PharmaGPT-Agent"}

"""PharmaGPT-Agent FastAPI application entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router

app = FastAPI(
    title="Drug-Target Discovery Tool",
    description="Automated Drug-Target Discovery via Multi-Omics Agentic Reasoning",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# FRONTEND_URL env var lets you set allowed origins without changing code.
# e.g. FRONTEND_URL=https://pharmagpt.vercel.app
_extra = os.getenv("FRONTEND_URL", "")
_origins = ["http://localhost:5173", "http://localhost:3000"]
if _extra:
    _origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "PharmaGPT-Agent"}

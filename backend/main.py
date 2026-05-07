"""PharmaGPT-Agent FastAPI application entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from api.auth_routes import router as auth_router
from api.oauth_routes import router as oauth_router
from db.database import init_db

app = FastAPI(
    title="Drug-Target Discovery Tool",
    description="Automated Drug-Target Discovery via Multi-Omics Agentic Reasoning",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://compbio-agent-harness.vercel.app",
        "http://localhost:5173",
    ]
)

app.include_router(router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(oauth_router, prefix="/api/v1")


def _migrate_db():
    """Idempotently add OAuth columns to existing databases."""
    from sqlalchemy import text
    from db.database import engine
    dialect = engine.dialect.name
    with engine.connect() as conn:
        for col in ("oauth_provider VARCHAR", "oauth_id VARCHAR"):
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col}"))
                conn.commit()
            except Exception:
                pass
        if dialect == "postgresql":
            try:
                conn.execute(text("ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL"))
                conn.commit()
            except Exception:
                pass


@app.on_event("startup")
def startup():
    init_db()
    _migrate_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "PharmaGPT-Agent"}

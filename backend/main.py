"""PharmaGPT-Agent FastAPI application entry point."""
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from api.auth_routes import router as auth_router
from api.oauth_routes import router as oauth_router
from db.database import init_db

logger = logging.getLogger("rnagent.main")

app = FastAPI(
    title="Drug-Target Discovery Tool",
    description="Automated Drug-Target Discovery via Multi-Omics Agentic Reasoning",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

_frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
_cors_origins = [
    "https://compbio-agent-harness.vercel.app",
    "http://localhost:5173",
]
if _frontend_url and _frontend_url not in _cors_origins:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


def _validate_runtime_config():
    env = os.getenv("ENV", "").lower()
    backend_url = os.getenv("BACKEND_URL", "")
    frontend_url = os.getenv("FRONTEND_URL", "")
    if env == "production":
        if not backend_url or "localhost" in backend_url:
            logger.warning("BACKEND_URL is unset or points at localhost in production: %r. OAuth redirects will fail.", backend_url)
        if not frontend_url or "localhost" in frontend_url:
            logger.warning("FRONTEND_URL is unset or points at localhost in production: %r. OAuth redirects and CORS will fail.", frontend_url)
        for var in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "JWT_SECRET"):
            if not os.getenv(var):
                logger.warning("%s is not set in production environment.", var)


@app.on_event("startup")
def startup():
    init_db()
    _migrate_db()
    _validate_runtime_config()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "PharmaGPT-Agent"}

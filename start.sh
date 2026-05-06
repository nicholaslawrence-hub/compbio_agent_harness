#!/usr/bin/env bash
# Start both the FastAPI backend and Vite frontend in parallel.
set -e

echo "Starting PharmaGPT-Agent..."

# Backend
(
  cd backend
  if [ ! -d ".venv" ]; then
    python -m venv .venv
    .venv/Scripts/pip install -r requirements.txt 2>/dev/null || .venv/bin/pip install -r requirements.txt
  fi
  source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
  echo "[Backend] Starting FastAPI on http://localhost:8000"
  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
) &

# Frontend
(
  cd frontend
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  echo "[Frontend] Starting Vite on http://localhost:5173"
  npm run dev
) &

wait

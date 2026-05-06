# Agentic RNA-Seq Analysis Harness

An end-to-end drug-target discovery platform. Upload a raw RNA-seq count matrix and a disease context, the pipeline will run differential expression, map protein interaction networks, retrieve relevant chunks from the biomedical literature, annotate  known drugs, and synthesize ranked therapeutic hypotheses. While this project is in early development, data availability to disease context is relatively limited, so I would recommend investigating the sample diseases. 

**Live:** [compbio-agent-harness.vercel.app](https://compbio-agent-harness.vercel.app/) &nbsp;·&nbsp;

---

## Pipeline

```
Count Matrix + Disease Term
         ↓
[1] Differential Expression   PyDESeq2 (negative binomial)
         ↓                    Benjamini–Hochberg correction · padj < 0.05, |log₂FC| > 1
[2] PPI Network               STRING DB · high-confidence partners · oncogene tagging
         ↓
[3] Literature RAG            PubMed + Semantic Scholar → Pinecone vector index
         ↓                    Semantic search per gene · dark gene flagging
[4] Drug Annotation           UniProt (protein/structure) · ChEMBL (drugs/trials)
         ↓
[5] Hypothesis Synthesis      Chain-of-Thought reasoning · mechanism + returns a novelty score from 0-1
         ↓
[6] Report Generation         Returns an executive copyable inline executive summary/report of relevant mechanism of action of inputted genes
```

This pipeline is orchestrated as a directed LangGraph graph with conditional routing (e.g. DGE failure skips downstream nodes).

---

## Project Stack

| Layer | Tools Used |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router v6 |
| Backend | FastAPI, uvicorn, LangGraph, LangChain |
| Bioinformatics | PyDESeq2, SciPy, pandas, NumPy, Biopython |
| AI | GPT-4o (hypothesis synthesis), Pinecone (literature RAG) |
| Databases | STRING, PubMed/NCBI, Semantic Scholar, UniProt, ChEMBL |
| Auth | JWT (python-jose), bcrypt (passlib), SQLAlchemy + SQLite |
| Deployment | Railway (backend, Docker), Vercel (frontend) |

---

## Local Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # fill in API keys
uvicorn main:app --reload --port 8000
```

Required environment variables:

```
OPENAI_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=pharmagpt-literature
NCBI_EMAIL=you@example.com
JWT_SECRET=<long-random-string>
```

### Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

The Vite dev server proxies `/api` to `localhost:8000` automatically.

### Demo data

You can create demo data through the provided script below for testing purposes. 

```bash
python scripts/generate_demo_data.py
# → data/demo_count_matrix.tsv + sample condition JSON
```

---

## Project Structure

```
compbio_agent_harness/
├── backend/
│   ├── agents/
│   │   ├── graph.py              # LangGraph pipeline definition
│   │   ├── nodes.py              # Six pipeline node functions
│   │   └── state.py              # AgentState TypedDict schema
│   ├── api/
│   │   ├── routes.py             # Analysis + gene lookup endpoints
│   │   └── auth_routes.py        # Register, login, /me, history
│   ├── db/
│   │   ├── database.py           # SQLAlchemy engine + session
│   │   ├── user_models.py        # User + JobRecord ORM models
│   │   ├── ncbi.py               # NCBI Entrez (SRA + PubMed)
│   │   ├── uniprot.py            # UniProt REST client
│   │   ├── chembl.py             # ChEMBL drug-gene interactions
│   │   └── pinecone_rag.py       # Pinecone vector search
│   ├── tools/
│   │   ├── dge.py                # PyDESeq2 + t-test fallback
│   │   └── ppi.py                # STRING DB PPI queries
│   ├── auth.py                   # JWT creation/verification, bcrypt
│   ├── main.py                   # FastAPI app entry point
│   └── config.py                 # Pydantic settings
├── frontend/
│   └── src/
│       ├── contexts/
│       │   └── AuthContext.jsx   # Auth state, login/register/logout
│       ├── pages/
│       │   ├── AnalyzePage.jsx   # Landing page
│       │   ├── RunPage.jsx       # Upload form
│       │   ├── ResultsPage.jsx   # Live progress + tabbed results
│       │   ├── GeneLookupPage.jsx# Single-gene deep-dive
│       │   ├── LoginPage.jsx     # Sign in / create account
│       │   └── AccountPage.jsx   # Profile + analysis history
│       ├── components/
│       │   ├── Layout.jsx        # Navbar + footer
│       │   ├── UploadForm.jsx    # Drag-and-drop + sample annotator
│       │   ├── HypothesisCard.jsx# Therapeutic hypothesis display
│       │   ├── DGETable.jsx      # Sortable DGE results table
│       │   └── VolcanoPlot.jsx   # Interactive volcano plot
│       └── utils/
│           └── api.js            # Fetch wrappers + auth header
├── scripts/
│   └── generate_demo_data.py     # Synthetic count matrix generator
├── Dockerfile                    # Backend container (Railway)
├── railway.toml
└── vercel.json
```

---

## API Reference

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyze` | Start pipeline · multipart form (matrix file + metadata) |
| `GET` | `/api/v1/jobs/{id}` | Poll job status and results |
| `GET` | `/api/v1/jobs/{id}/stream` | SSE real-time progress stream |
| `GET` | `/api/v1/jobs/{id}/report` | Markdown report |

### Gene Lookup

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/gene/{symbol}/ppi` | STRING DB protein interaction network |
| `GET` | `/api/v1/gene/{symbol}/uniprot` | UniProt annotation + structure |
| `GET` | `/api/v1/gene/{symbol}/drugs` | ChEMBL drugs and clinical trials |
| `GET` | `/api/v1/gene/{symbol}/pubmed` | PubMed abstracts |
| `GET` | `/api/v1/gene/{symbol}/literature` | Pinecone semantic search |
| `GET` | `/api/v1/sra/search?disease=` | NCBI SRA dataset search |

---

## Deployment

### Railway (backend)

1. Connect the repo, set service root to `backend/` (uses `backend/Dockerfile`)
2. Add environment variables: `OPENAI_API_KEY`, `PINECONE_API_KEY`, `NCBI_EMAIL`, `JWT_SECRET`

### Vercel (frontend)

Configured via `vercel.json` — build command `cd frontend && npm install && npm run build`, output `frontend/dist`, SPA rewrite rule included.

Set `VITE_API_BASE` to your Railway backend URL if not using a proxy:
```
VITE_API_BASE=https://compbioagentbackend-production.up.railway.app/api/v1
```

---

## Author

Nicholas Lawrence · [github.com/nicholaslawrence-hub](https://github.com/nicholaslawrence-hub)

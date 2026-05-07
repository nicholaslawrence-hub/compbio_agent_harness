# RNAgent — Agentic RNA-Seq Drug Discovery

I built this as a personal project to explore what an AI-powered bioinformatics workflow could look like end-to-end. You upload a raw RNA-seq count matrix and a disease name, and a coordinated network of specialist agents runs the whole drug-target discovery workflow automatically, differential expression, pathway enrichment, protein network mapping, literature mining, drug lookup, and finally an LLM that synthesises ranked therapeutic hypotheses with novelty scores.

It's still a work in progress, but it's fully functional and deployed. I'd recommend testing it with the included sample data since it's calibrated to surface genuinely understudied genes rather than just returning EGFR and KRAS every time.

**Live:** [compbio-agent-harness.vercel.app](https://compbio-agent-harness.vercel.app/)

---

## How the agent network works

```
Count Matrix + Disease Term
         |
[1] Differential Gene Expression   PyDESeq2 · neg-binomial model
         |                         Benjamini-Hochberg FDR · padj < 0.05, |log2FC| > 1
[2] Pathway Enrichment             ORA (KEGG / GO BP / Reactome) with detected-gene background
         |                         Falls back to GSEA-prerank · Jaccard dedup of redundant terms
[3] PPI Network + Annotation       STRING DB · high-confidence partners · oncogene tagging
         |                         MyGene.info batch GO/Reactome annotation per gene + partner
[4] Literature RAG                 PubMed + Semantic Scholar -> Pinecone vector index
         |                         Parallel per-gene semantic search · dark gene flagging
[5] Drug Annotation                UniProt (function, structure) · ChEMBL (binding assays)
         |                         Approved drugs surface first; no drugs = opportunity, not failure
[6] Hypothesis Synthesis           GPT chain-of-thought · novelty score (0-1) from pub count
         |                         Disease-specific · mechanism names actual PPI partners
[7] Report Generation              Markdown executive summary with ranked targets + evidence
```

There's a supervisor agent at the centre that decides which specialist tools to call and in what order, based on what's been gathered so far. It's not a fixed directed graph, since the supervisor looks at the accumulated evidence each iteration and routes dynamically, so the actual execution path varies per run. Nodes 3-5 run in parallel across genes using `ThreadPoolExecutor` so it doesn't take forever. The tools are split into three clusters that respectively involve common bioinformatics tools to both align RNA-sequences, notice genes that aren't targeted in current drug prototypes or clinical trials, and a synthesis/hypothesizing cluster that will return the final result to the user. 

---

## Stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router v6 |
| Backend | FastAPI, uvicorn, LangGraph, LangChain |
| Bioinformatics | PyDESeq2, GSEApy, SciPy, pandas, NumPy, Biopython |
| AI | gpt-5.4-mini (hypothesis synthesis), Pinecone (literature RAG) |
| Databases | STRING DB, PubMed/NCBI, Semantic Scholar, UniProt, ChEMBL, MyGene.info |
| Auth | JWT (python-jose), bcrypt (passlib), SQLAlchemy + SQLite |
| Deployment | Railway (backend, Docker), Vercel (frontend) |

---

## Running locally

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # fill in your API keys
uvicorn main:app --reload --port 8000
```

You'll need these environment variables in your `.env`:

```
OPENAI_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=rnagent-literature
NCBI_EMAIL=you@example.com
NCBI_API_KEY=                    # optional but recommended — raises the rate limit
JWT_SECRET=<long-random-string>
```

### Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite proxies `/api` to `localhost:8000` automatically in dev, so no CORS issues.

If you're pointing at a remote backend instead:

```
VITE_API_BASE=https://your-backend.up.railway.app/api/v1
```

### Sample data

I included a count matrix at `data/sample_counts.tsv` that I put together specifically so the agent network produces interesting output. It mixes very dark genes (novelty > 0.85) with some well-known controls like EGFR and KRAS so you can see the novelty scoring actually differentiate between them.

Paste this into the sample conditions field when running it:

```
S1:disease,S2:disease,S3:disease,S4:control,S5:control,S6:control
```

---

## Project structure

```
compbio_agent_harness/
├── backend/
│   ├── agents/
│   │   ├── graph.py              # LangGraph supervisor loop + tool registration
│   │   ├── nodes.py              # Seven agent node functions (DGE -> Report)
│   │   └── state.py              # AgentState TypedDict schema
│   ├── api/
│   │   ├── routes.py             # Analysis + gene lookup endpoints
│   │   └── auth_routes.py        # Register, login, /me, job history
│   ├── db/
│   │   ├── database.py           # SQLAlchemy engine + session factory
│   │   ├── user_models.py        # User + JobRecord ORM models
│   │   ├── ncbi.py               # NCBI Entrez (SRA search + PubMed abstracts)
│   │   ├── uniprot.py            # UniProt REST client (function, GO, PDB IDs)
│   │   ├── chembl.py             # ChEMBL drug interactions (official webresource client)
│   │   ├── mygene.py             # MyGene.info batch GO + Reactome annotation
│   │   ├── literature_fetch.py   # Semantic Scholar fetch with 429 backoff
│   │   └── pinecone_rag.py       # Pinecone vector search + dark-gene scoring
│   ├── tools/
│   │   ├── dge.py                # PyDESeq2 + t-test fallback, count matrix parsing
│   │   ├── pathway.py            # ORA / GSEA-prerank + Jaccard deduplication
│   │   ├── ppi.py                # STRING DB PPI queries + oncogene tagging
│   │   └── quantification.py     # Read quantification utilities
│   ├── auth.py                   # JWT creation/verification, bcrypt hashing
│   ├── main.py                   # FastAPI app entry point
│   └── config.py                 # Pydantic settings (env-driven)
├── frontend/
│   └── src/
│       ├── contexts/
│       │   └── AuthContext.jsx   # Auth state, login/register/logout
│       ├── pages/
│       │   ├── AnalyzePage.jsx   # Landing page + interactive agent network explainer
│       │   ├── RunPage.jsx       # Upload form + sample condition annotator
│       │   ├── ResultsPage.jsx   # Live SSE progress + tabbed results
│       │   ├── GeneLookupPage.jsx# Single-gene deep-dive (PPI, drugs, literature)
│       │   ├── LoginPage.jsx     # Sign in / create account
│       │   └── AccountPage.jsx   # Profile + analysis history
│       ├── components/
│       │   ├── Layout.jsx        # Navbar + footer
│       │   ├── AgentWeb.jsx      # Force-directed agent network visualisation
│       │   ├── HypothesisCard.jsx# Ranked therapeutic hypothesis display
│       │   ├── ProgressBar.jsx   # SSE-driven progress indicator
│       │   ├── DGETable.jsx      # Sortable differential expression table
│       │   ├── UploadForm.jsx    # Drag-and-drop matrix upload
│       │   └── VolcanoPlot.jsx   # Interactive volcano plot (D3)
│       └── utils/
│           └── api.js            # Fetch wrappers + Bearer auth header
├── data/
│   └── sample_counts.tsv         # Demo count matrix (dark + control genes)
├── scripts/
│   └── generate_demo_data.py     # Synthetic count matrix generator
├── Dockerfile                    # Backend container (Railway)
├── railway.toml
└── vercel.json
```

---

## API

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyze` | Launch agent network · multipart form (matrix file + metadata) |
| `GET` | `/api/v1/jobs/{id}` | Poll job status and results |
| `GET` | `/api/v1/jobs/{id}/stream` | SSE real-time progress stream |
| `GET` | `/api/v1/jobs/{id}/report` | Markdown executive report |

### Gene Lookup

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/gene/{symbol}/ppi` | STRING DB protein interaction network |
| `GET` | `/api/v1/gene/{symbol}/uniprot` | UniProt annotation + structure |
| `GET` | `/api/v1/gene/{symbol}/drugs` | ChEMBL binding assays + approval phase |
| `GET` | `/api/v1/gene/{symbol}/pubmed` | PubMed abstracts |
| `GET` | `/api/v1/gene/{symbol}/literature` | Pinecone semantic search |
| `GET` | `/api/v1/sra/search?disease=` | NCBI SRA dataset search |

---

## Deploying

### Railway (backend)

1. Connect the repo, set the service root to `backend/` — it picks up `backend/Dockerfile` automatically
2. Add env vars: `OPENAI_API_KEY`, `PINECONE_API_KEY`, `NCBI_EMAIL`, `JWT_SECRET`
3. Railway injects `$PORT` at runtime; the Dockerfile CMD handles it

### Vercel (frontend)

Build command: `cd frontend && npm install && npm run build`, output dir: `frontend/dist`. The SPA rewrite rule is already in `vercel.json`.

One thing that tripped me up: `VITE_API_BASE` needs to include the full path with `/api/v1`, not just the base domain. Without the suffix every request will 404.

```
VITE_API_BASE=https://compbioagentbackend-production.up.railway.app/api/v1
```

---

## Author

Nicholas Lawrence · [github.com/nicholaslawrence-hub](https://github.com/nicholaslawrence-hub)

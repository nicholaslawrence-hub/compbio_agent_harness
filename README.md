# PharmaGPT-Agent

**Automated Drug-Target Discovery via Multi-Omics Agentic Reasoning**

A full-stack AI pipeline that takes raw RNA-seq count matrices, runs bioinformatics analysis, queries biomedical databases, and uses a LangGraph + GPT-4o agent to propose novel therapeutic targets — powered by **Pinecone Assistant** for literature RAG.

---

## Architecture

```
Upload Count Matrix
       ↓
[Node 1] DGE Analysis (PyDESeq2 / t-test + BH correction)
       ↓
[Node 2] PPI Enrichment (STRING DB) — oncogene tagging
       ↓
[Node 3] Literature RAG (Pinecone Assistant) — dark gene classification
       ↓
[Node 4] Drug Annotation (ChEMBL + UniProt)
       ↓
[Node 5] LLM Hypothesis Synthesis (GPT-4o, Chain-of-Thought)
       ↓
[Node 6] Report Generation (Markdown research report)
```

**LangGraph** orchestrates the pipeline as a directed graph with conditional routing (e.g. skip downstream nodes on DGE failure).

**Pinecone Assistant** replaces raw PubMed queries with semantic search over an indexed biomedical literature corpus, enabling richer dark-gene detection and mechanistic context.

---

## Quick Start

### 1. Configure environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and fill in:
#   OPENAI_API_KEY
#   PINECONE_API_KEY
#   PINECONE_ASSISTANT_NAME  (default: pharmagpt-literature)
#   NCBI_EMAIL
```

### 2. Create the Pinecone Assistant (once)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
PINECONE_API_KEY=<your-key> python ../scripts/setup_pinecone_assistant.py
```

### 3. (Optional) Upload literature to the assistant

Upload PDFs or text files of PubMed papers via the API:
```bash
curl -X POST http://localhost:8000/api/v1/assistant/upload \
  -F "files=@paper1.pdf" -F "files=@paper2.pdf"
```

### 4. Generate demo data

```bash
python scripts/generate_demo_data.py
# Outputs: data/demo_count_matrix.tsv + sample condition JSON
```

### 5. Start the app

```bash
bash start.sh
```

- Frontend: http://localhost:5173  
- Backend API docs: http://localhost:8000/docs

---

## Project Structure

```
compbio_agent_harness/
├── backend/
│   ├── agents/
│   │   ├── graph.py          # LangGraph pipeline definition
│   │   ├── nodes.py          # All 6 pipeline node functions
│   │   ├── state.py          # AgentState TypedDict schema
│   │   └── tools_registry.py # LangChain tool wrappers
│   ├── api/
│   │   └── routes.py         # FastAPI endpoints + SSE streaming
│   ├── db/
│   │   ├── ncbi.py           # NCBI Entrez (SRA + PubMed fallback)
│   │   ├── uniprot.py        # UniProt REST client
│   │   ├── chembl.py         # ChEMBL drug-gene interactions
│   │   └── pinecone_rag.py   # Pinecone Assistant literature RAG
│   ├── tools/
│   │   ├── dge.py            # DGE: PyDESeq2 + t-test fallback
│   │   ├── quantification.py # Kallisto / Salmon subprocess wrappers
│   │   └── ppi.py            # STRING DB PPI network queries
│   ├── main.py               # FastAPI app + CORS
│   └── config.py             # Pydantic settings
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── AnalyzePage.jsx   # Upload form + feature overview
│       │   ├── ResultsPage.jsx   # Live progress + tabbed results
│       │   └── GeneLookupPage.jsx # Single-gene deep-dive
│       └── components/
│           ├── UploadForm.jsx    # Drag-and-drop + sample annotator
│           ├── HypothesisCard.jsx # Therapeutic hypothesis display
│           ├── DGETable.jsx      # Sortable DGE results table
│           ├── VolcanoPlot.jsx   # Interactive volcano plot
│           └── ProgressBar.jsx  # Pipeline stage tracker
├── scripts/
│   ├── generate_demo_data.py    # Synthetic GBM count matrix
│   └── setup_pinecone_assistant.py # One-time Pinecone setup
└── data/
    ├── raw/                     # Uploaded count matrices
    ├── processed/               # Intermediate outputs
    └── results/                 # Final reports
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyze` | Start pipeline (multipart: file + metadata) |
| `GET` | `/api/v1/jobs/{id}` | Poll job status + results |
| `GET` | `/api/v1/jobs/{id}/stream` | SSE progress stream |
| `GET` | `/api/v1/jobs/{id}/report` | Markdown report |
| `GET` | `/api/v1/gene/{symbol}/ppi` | STRING DB PPI |
| `GET` | `/api/v1/gene/{symbol}/uniprot` | UniProt annotation |
| `GET` | `/api/v1/gene/{symbol}/drugs` | ChEMBL drug interactions |
| `GET` | `/api/v1/gene/{symbol}/literature` | Pinecone Assistant query |
| `POST` | `/api/v1/assistant/upload` | Upload PDFs to Pinecone |
| `GET` | `/api/v1/sra/search?disease=` | NCBI SRA dataset search |

---

## Pinecone Assistant Integration

The literature RAG node (`node_literature_rag`) queries the **Pinecone Assistant** with a structured prompt per gene, asking it to:

1. Estimate publication volume (dark gene detection)
2. Identify known drug interactions from indexed literature
3. Summarize the mechanism of action
4. Return key PMIDs as citations

The assistant's response is parsed as JSON and fed directly into the GPT-4o hypothesis synthesis prompt, grounding the LLM's reasoning in real literature.

**Without a Pinecone key**, the system falls back to direct NCBI Entrez PubMed queries automatically.

---

## Optional: Fine-tuning with LoRA

See `scripts/` for a placeholder LoRA fine-tuning script targeting Llama-3 on NCBI metadata. Requires a GPU environment with `transformers` + `peft`.

"""LangGraph node functions for the PharmaGPT agent pipeline."""
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import pandas as pd
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from config import settings
from agents.state import AgentState
from tools.dge import (
    parse_count_matrix_from_upload,
    run_dge,
    top_upregulated,
)
from tools.ppi import get_ppi_network, enrich_ppi_with_oncogenes, KNOWN_ONCOGENES
from db.pinecone_rag import query_literature
from db.uniprot import search_protein
from db.chembl import get_drug_interactions


def _llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        api_key=settings.openai_api_key,
    )


# ── Node 1: Run DGE ─────────────────────────────────────────────────────────

def node_run_dge(state: AgentState) -> dict:
    """Load count matrix and compute differential gene expression."""
    try:
        matrix_path = state.get("count_matrix_path")
        if not matrix_path or not Path(matrix_path).exists():
            return {"errors": ["count_matrix_path not set or file missing"], "status": "dge_failed", "progress": 5}

        content = Path(matrix_path).read_bytes()
        matrix = parse_count_matrix_from_upload(content, Path(matrix_path).name)
        dge_df = run_dge(matrix, state["sample_conditions"], state["condition_a"], state["condition_b"])
        top_df = top_upregulated(dge_df, n=settings.max_genes_for_rag)

        dge_results = top_df.to_dict("records")
        top_genes = top_df["gene"].tolist()

        return {
            "dge_results": dge_results,
            "top_genes": top_genes,
            "current_gene_index": 0,
            "status": "dge_complete",
            "progress": 20,
        }
    except Exception as e:
        return {"errors": [f"DGE error: {str(e)}"], "status": "dge_failed", "progress": 5}


# ── Node 2: PPI enrichment ───────────────────────────────────────────────────

def node_enrich_ppi(state: AgentState) -> dict:
    """Fetch PPI network for all top upregulated genes."""
    ppi_results = []
    genes = state.get("top_genes", [])
    for gene in genes[:10]:  # limit API calls
        try:
            result = get_ppi_network(gene, limit=15)
            result = enrich_ppi_with_oncogenes(result, KNOWN_ONCOGENES)
            ppi_results.append(result)
        except Exception as e:
            ppi_results.append({"gene": gene, "partners": [], "error": str(e)})
    return {"ppi_results": ppi_results, "status": "ppi_complete", "progress": 40}


# ── Node 3: Literature RAG ───────────────────────────────────────────────────

def node_literature_rag(state: AgentState) -> dict:
    """
    Self-RAG via Pinecone Assistant: queries the biomedical literature index
    to classify each gene as 'dark' (under-studied) or well-studied for drug discovery.
    Falls back to direct PubMed fetch when PINECONE_API_KEY is not configured.
    """
    literature_results = []
    disease = state.get("disease_term", "")

    for gene in state.get("top_genes", [])[:settings.max_genes_for_rag]:
        try:
            # Build context from DGE results
            dge_entry = next((r for r in state.get("dge_results", []) if r.get("gene") == gene), {})
            context = f"Disease: {disease}. log2FC={dge_entry.get('log2FoldChange', 'N/A')}, padj={dge_entry.get('padj', 'N/A')}"

            result = query_literature(gene, context=context)
            literature_results.append(result)
        except Exception as e:
            literature_results.append({
                "gene": gene,
                "pubmed_hits": 0,
                "abstracts": [],
                "is_dark": True,
                "error": str(e),
            })
    return {"literature_results": literature_results, "status": "rag_complete", "progress": 60}


# ── Node 4: Drug & protein annotation ───────────────────────────────────────

def node_drug_annotation(state: AgentState) -> dict:
    """Fetch UniProt annotations and ChEMBL drug interactions per gene."""
    drug_interactions = []
    for gene in state.get("top_genes", [])[:10]:
        try:
            uniprot = search_protein(gene)
            drugs = get_drug_interactions(gene, max_results=5)
            drug_interactions.append({"gene": gene, "drugs": drugs, "uniprot": uniprot})
        except Exception as e:
            drug_interactions.append({"gene": gene, "drugs": [], "uniprot": None, "error": str(e)})
    return {"drug_interactions": drug_interactions, "status": "annotation_complete", "progress": 75}


# ── Node 5: LLM hypothesis synthesis ────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are PharmaGPT, an expert computational biologist specializing in drug target discovery.
You analyze multi-omics data and propose novel, mechanistically grounded therapeutic hypotheses.
Be precise, cite your reasoning, and highlight genuine novelty.
Always output valid JSON matching the requested schema.
"""

def node_synthesize_hypotheses(state: AgentState) -> dict:
    """Use the LLM (Chain-of-Thought) to generate therapeutic hypotheses."""
    llm = _llm()
    hypotheses = []

    # Build gene context dict
    gene_context = _build_gene_context(state)
    dark_genes = [g for g in state.get("literature_results", []) if g.get("is_dark")]

    for gene_data in gene_context[:5]:  # top 5 most interesting genes
        try:
            prompt = _build_hypothesis_prompt(gene_data, dark_genes)
            response = llm.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])
            hypothesis = _parse_hypothesis(response.content, gene_data["gene"])
            hypotheses.append(hypothesis)
        except Exception as e:
            hypotheses.append({
                "gene": gene_data["gene"],
                "hypothesis": f"Analysis failed: {str(e)}",
                "mechanism": "",
                "novelty_score": 0.0,
                "supporting_evidence": [],
            })

    return {"hypotheses": hypotheses, "status": "synthesis_complete", "progress": 90}


def _build_gene_context(state: AgentState) -> list[dict]:
    dge_map = {r["gene"]: r for r in state.get("dge_results", [])}
    ppi_map = {r["gene"]: r for r in state.get("ppi_results", [])}
    lit_map = {r["gene"]: r for r in state.get("literature_results", [])}
    drug_map = {r["gene"]: r for r in state.get("drug_interactions", [])}

    results = []
    for gene in state.get("top_genes", [])[:10]:
        results.append({
            "gene": gene,
            "dge": dge_map.get(gene, {}),
            "ppi": ppi_map.get(gene, {}),
            "literature": lit_map.get(gene, {}),
            "drugs": drug_map.get(gene, {}),
        })
    return results


def _build_hypothesis_prompt(gene_data: dict, dark_genes: list) -> str:
    g = gene_data["gene"]
    dge = gene_data["dge"]
    ppi = gene_data["ppi"]
    lit = gene_data["literature"]
    drugs = gene_data["drugs"]

    lfc = dge.get("log2FoldChange", "N/A")
    padj = dge.get("padj", "N/A")
    partners = [p["partner"] for p in ppi.get("partners", [])[:5]]
    oncogene_partners = [p["partner"] for p in ppi.get("partners", []) if p.get("is_oncogene")]
    pubmed_hits = lit.get("pubmed_hits", 0)
    is_dark = lit.get("is_dark", False)
    lit_summary = lit.get("summary") or lit.get("mechanism_summary", "")
    lit_drugs = lit.get("known_drugs", [])
    key_pmids = lit.get("key_pmids", [])
    known_drugs = [d["molecule_name"] for d in drugs.get("drugs", [])] + lit_drugs
    uniprot = drugs.get("uniprot") or {}
    protein_function = uniprot.get("function", "Unknown")
    pdb_ids = uniprot.get("pdb_ids", [])

    dark_genes_str = ", ".join([d["gene"] for d in dark_genes])

    return f"""
Analyze gene **{g}** as a potential therapeutic target in the context of the current disease study.

## DGE Data
- log2 Fold Change (disease vs control): {lfc:.3f}
- Adjusted p-value: {padj}

## Protein Information (UniProt)
- Function: {protein_function}
- Known structural data (PDB IDs): {pdb_ids if pdb_ids else "None"}

## Protein-Protein Interactions (STRING DB, high confidence)
- Top interaction partners: {partners}
- Partners that are known oncogenes: {oncogene_partners if oncogene_partners else "None"}

## Literature Analysis (Pinecone Assistant — Biomedical Literature Index)
- Estimated drug-gene publication hits: {pubmed_hits}
- Classified as "dark gene" (under-studied for drug discovery): {is_dark}
- Key PMIDs from literature index: {key_pmids if key_pmids else "None retrieved"}
- Literature summary: {lit_summary or "Not available"}
- Other dark genes in this dataset: {dark_genes_str}

## Known Drugs Targeting This Gene (ChEMBL)
- {known_drugs if known_drugs else "No approved/investigational drugs found"}

## Your Task
Using Chain-of-Thought reasoning, generate a novel therapeutic hypothesis. Output ONLY valid JSON:
{{
  "gene": "{g}",
  "hypothesis": "<1-3 sentence therapeutic hypothesis>",
  "mechanism": "<proposed mechanism of action>",
  "novelty_score": <float 0.0-1.0 representing novelty based on dark gene status and missing drug coverage>,
  "supporting_evidence": ["<evidence item 1>", "<evidence item 2>", ...]
}}

Think step-by-step before writing the JSON:
1. Is this gene sufficiently upregulated and statistically significant?
2. Does the PPI network connect it to known disease drivers?
3. Is there a druggable pocket (PDB structures)?
4. How many drugs already target this gene — is there an unmet need?
5. Synthesize a mechanism and score novelty.
"""


def _parse_hypothesis(content: str, gene: str) -> dict:
    import re
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {
        "gene": gene,
        "hypothesis": content[:500],
        "mechanism": "",
        "novelty_score": 0.5,
        "supporting_evidence": [],
    }


# ── Node 6: Report generation ────────────────────────────────────────────────

def node_generate_report(state: AgentState) -> dict:
    """Use LLM to synthesize a final markdown research report."""
    llm = _llm()
    hypotheses_json = json.dumps(state.get("hypotheses", []), indent=2)
    disease = state.get("disease_term", "the disease")

    prompt = f"""
You are PharmaGPT. Generate a concise, publication-quality research report in Markdown format.

Disease context: {disease}
Top upregulated genes: {state.get("top_genes", [])[:10]}

Therapeutic hypotheses generated by the pipeline:
{hypotheses_json}

The report should include:
1. Executive Summary
2. Key Findings (DGE results summary)
3. Top Therapeutic Targets (ranked by novelty score)
4. For each top target: mechanism, evidence, and next steps
5. Conclusion and recommended follow-up experiments

Be concise but scientifically rigorous. Use markdown headers and bullet points.
"""
    try:
        response = llm.invoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        return {"final_report": response.content, "status": "complete", "progress": 100}
    except Exception as e:
        return {"errors": [f"Report generation failed: {str(e)}"], "status": "complete", "progress": 100}

"""LangGraph node functions for the PharmaGPT agent pipeline."""
import json
import math
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
from tools.pathway import run_pathway_enrichment as _enrich_pathways
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

        # Full unfiltered output for GSEA ranking and ORA background universe
        all_records = dge_df.to_dict("records")
        detected_genes = dge_df["gene"].tolist()

        return {
            "dge_results": dge_results,
            "all_dge_results": all_records,
            "detected_genes": detected_genes,
            "top_genes": top_genes,
            "current_gene_index": 0,
            "status": "dge_complete",
            "progress": 20,
        }
    except Exception as e:
        return {"errors": [f"DGE error: {str(e)}"], "status": "dge_failed", "progress": 5}


# ── Node 2: Pathway enrichment ──────────────────────────────────────────────

def node_pathway_enrichment(state: AgentState) -> dict:
    """
    Pathway enrichment with statistically correct choices:
    - ORA uses detected-gene background (not whole genome)
    - Falls back to GSEA prerank when DEG count < 15 or > 1000
    - Jaccard deduplication collapses overlapping GO terms
    """
    deg_genes      = state.get("top_genes", [])
    detected_genes = state.get("detected_genes", [])
    all_dge        = state.get("all_dge_results", [])

    full_dge_df = None
    if all_dge:
        full_dge_df = pd.DataFrame(all_dge)
        # Ensure required columns exist
        if "pvalue" not in full_dge_df.columns:
            full_dge_df["pvalue"] = full_dge_df.get("padj", 1.0)

    try:
        pathway_results, method = _enrich_pathways(
            deg_genes=deg_genes,
            detected_genes=detected_genes,
            full_dge_df=full_dge_df,
            top_n=5,
        )
    except Exception:
        pathway_results, method = [], "ORA"

    return {
        "pathway_results": pathway_results,
        "enrichment_method": method,
        "status": "pathway_complete",
        "progress": 30,
    }


# ── Node 3: PPI enrichment ───────────────────────────────────────────────────

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
            chembl_result = get_drug_interactions(gene, max_results=5)
            drug_interactions.append({
                "gene": gene,
                "drugs": chembl_result.get("drugs", []),
                "query_note": chembl_result.get("query_note", ""),
                "query_found_target": chembl_result.get("query_found_target", False),
                "uniprot": uniprot,
            })
        except Exception as e:
            drug_interactions.append({
                "gene": gene,
                "drugs": [],
                "query_note": f"ChEMBL query failed with exception: {str(e)}",
                "query_found_target": False,
                "uniprot": None,
            })
    return {"drug_interactions": drug_interactions, "status": "annotation_complete", "progress": 75}


# ── Node 5: LLM hypothesis synthesis ────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are PharmaGPT, an expert computational biologist specializing in drug target discovery.
You analyze multi-omics data and propose novel, mechanistically grounded therapeutic hypotheses.
Be precise, cite your reasoning, and highlight genuine novelty.
Always output valid JSON matching the requested schema.

STRICT RULES — violating any of these will invalidate your output:
1. DRUG DATA: The prompt will show `known_drugs` from ChEMBL and a `query_note` explaining \
what the API returned. If `known_drugs` is an empty list [], you MUST use the exact phrase \
"Database query returned no results" and MUST NOT claim "no drugs exist" or "no approved drugs \
target this gene." The absence of API results is not evidence of absence in the literature.
2. MECHANISM: You are FORBIDDEN from using vague phrases like "downstream signaling", \
"activates downstream pathways", or "interacts with ligands to drive proliferation." \
You MUST name at least two specific proteins from the PPI data provided and describe the \
precise enzymatic or structural consequence of their interaction (e.g., "FGFR3 phosphorylates \
STAT3 at Y705, promoting nuclear translocation and transcription of anti-apoptotic BCL2").
3. NOVELTY SCORE: The prompt will supply a `calculated_novelty_score` derived from PubMed \
publication counts. You MUST use this exact float value. Do not generate your own score.
4. PMIDS: You MUST include the `key_pmids` list from the literature data verbatim in your JSON output.
"""


def _get_pubmed_count(gene_symbol: str) -> int:
    """Query PubMed for '{gene} AND cancer' and return the hit count."""
    try:
        from Bio import Entrez
        with Entrez.esearch(
            db="pubmed",
            term=f"{gene_symbol}[Title/Abstract] AND cancer[Title/Abstract]",
            retmax=0,
        ) as h:
            record = Entrez.read(h)
        return int(record.get("Count", 0))
    except Exception:
        return -1   # -1 signals query failure; treated as unknown


def _novelty_from_pub_count(pub_count: int) -> float:
    """
    Deterministic novelty score from publication count.
    0 pubs  → 1.0  (dark gene)
    10 pubs → 0.75
    100     → 0.50
    1 000   → 0.25
    10 000+ → 0.00  (highly studied)
    """
    if pub_count < 0:
        return 0.5   # unknown
    if pub_count == 0:
        return 1.0
    return round(max(0.0, 1.0 - math.log10(max(1, pub_count)) / 4.0), 2)

def node_synthesize_hypotheses(state: AgentState) -> dict:
    """Use the LLM (Chain-of-Thought) to generate therapeutic hypotheses."""
    llm = _llm()
    hypotheses = []

    # Build gene context dict
    gene_context = _build_gene_context(state)
    dark_genes = [g for g in state.get("literature_results", []) if g.get("is_dark")]

    pathway_results = state.get("pathway_results", [])

    for gene_data in gene_context[:5]:  # top 5 most interesting genes
        gene = gene_data["gene"]
        # Calculate deterministic novelty score BEFORE the LLM call
        pub_count = _get_pubmed_count(gene)
        novelty_score = _novelty_from_pub_count(pub_count)
        gene_data["_pub_count"] = pub_count
        gene_data["_novelty_score"] = novelty_score

        try:
            prompt = _build_hypothesis_prompt(gene_data, dark_genes, pathway_results)
            response = llm.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])
            hypothesis = _parse_hypothesis(response.content, gene, novelty_score, pub_count)
            hypotheses.append(hypothesis)
        except Exception as e:
            hypotheses.append({
                "gene": gene,
                "hypothesis": f"Analysis failed: {str(e)}",
                "mechanism": "",
                "novelty_score": novelty_score,
                "pub_count": pub_count,
                "supporting_evidence": [],
                "key_pmids": gene_data.get("literature", {}).get("key_pmids", []),
            })

    return {"hypotheses": hypotheses, "status": "synthesis_complete", "progress": 90}


def _build_gene_context(state: AgentState) -> list[dict]:
    dge_map  = {r["gene"]: r for r in state.get("dge_results", [])}
    ppi_map  = {r["gene"]: r for r in state.get("ppi_results", [])}
    lit_map  = {r["gene"]: r for r in state.get("literature_results", [])}
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


def _format_pathways(pathway_results: list[dict]) -> str:
    if not pathway_results:
        return "No pathway enrichment results available."
    lines = []
    for p in pathway_results[:10]:
        genes = ", ".join(p.get("overlap_genes", [])[:6])
        lines.append(
            f"  - {p['pathway']} ({p['source']}) | "
            f"padj={p['adjusted_p_value']:.4f} | "
            f"overlap genes: {genes}"
        )
    return "\n".join(lines)


def _build_hypothesis_prompt(gene_data: dict, dark_genes: list, pathway_results: list = None) -> str:
    g = gene_data["gene"]
    dge = gene_data["dge"]
    ppi = gene_data["ppi"]
    lit = gene_data["literature"]
    drugs = gene_data["drugs"]
    pub_count     = gene_data.get("_pub_count", -1)
    novelty_score = gene_data.get("_novelty_score", 0.5)

    lfc_raw  = dge.get("log2FoldChange", "N/A")
    padj     = dge.get("padj", "N/A")
    lfc      = f"{lfc_raw:.3f}" if isinstance(lfc_raw, float) else str(lfc_raw)

    # PPI — list by name for specificity
    ppi_partners = ppi.get("partners", [])
    partners = [p["partner"] for p in ppi_partners[:6]]
    oncogene_partners = [p["partner"] for p in ppi_partners if p.get("is_oncogene")]

    lit_summary  = lit.get("summary") or lit.get("mechanism_summary", "")
    key_pmids    = lit.get("key_pmids", [])

    # Drug data with honest API context
    chembl_drugs   = [d["molecule_name"] for d in drugs.get("drugs", [])]
    chembl_note    = drugs.get("query_note", "")
    target_found   = drugs.get("query_found_target", False)
    lit_drugs      = lit.get("known_drugs", [])
    all_drugs      = list(dict.fromkeys(chembl_drugs + lit_drugs))   # de-dupe, preserve order

    uniprot          = drugs.get("uniprot") or {}
    protein_function = uniprot.get("function", "Unknown")
    pdb_ids          = uniprot.get("pdb_ids", [])

    dark_genes_str = ", ".join([d["gene"] for d in dark_genes])
    pathways_str   = _format_pathways(pathway_results or [])
    gene_pathways  = [
        p["pathway"] for p in (pathway_results or [])
        if g in p.get("overlap_genes", [])
    ]

    pub_count_str = str(pub_count) if pub_count >= 0 else "query failed"

    return f"""
Analyze gene **{g}** as a potential therapeutic target.

## DGE Data
- log2 Fold Change (disease vs control): {lfc}
- Adjusted p-value: {padj}

## Protein Information (UniProt)
- Function: {protein_function}
- Structural data (PDB IDs): {pdb_ids if pdb_ids else "None on file"}

## Pathway Enrichment (KEGG / GO BP / Reactome, redundancy-filtered)
All DEGs — top enriched pathways:
{pathways_str}
Pathways where **{g}** is an overlap gene: {gene_pathways if gene_pathways else "None detected"}

## Protein-Protein Interactions (STRING DB, high confidence)
- Interaction partners: {partners if partners else "None retrieved"}
- Partners that are known oncogenes: {oncogene_partners if oncogene_partners else "None"}

## Literature (PubMed + Semantic Scholar via Pinecone)
- PubMed hit count for "{g} AND cancer": {pub_count_str}
- Classified dark gene (under-studied): {lit.get("is_dark", False)}
- Key PMIDs retrieved: {key_pmids if key_pmids else "None"}
- Summary: {lit_summary[:600] if lit_summary else "Not available"}
- Other dark genes in dataset: {dark_genes_str if dark_genes_str else "None"}

## ChEMBL Drug Data
- ChEMBL target resolved: {target_found}
- API note: {chembl_note}
- Compounds found (pChEMBL ≥ 5): {all_drugs if all_drugs else []}

## Pre-calculated Novelty Score
calculated_novelty_score = {novelty_score}
(Derived from PubMed count {pub_count_str}: 0=dark/novel, 1=well-studied/low-novelty inverted to 0-1)
YOU MUST use exactly {novelty_score} as the novelty_score in your JSON — do not modify it.

## Your Task
Think step-by-step, then output ONLY valid JSON (no markdown fences):
{{
  "gene": "{g}",
  "hypothesis": "<1-3 sentences — cite specific fold change, pathway, and interaction partner>",
  "mechanism": "<MUST name ≥2 specific proteins from the PPI list above and describe the precise enzymatic/structural consequence — no generic phrases allowed>",
  "novelty_score": {novelty_score},
  "pub_count": {pub_count},
  "supporting_evidence": [
    "<cite specific LFC/padj values>",
    "<cite a named pathway and overlap gene count>",
    "<cite a specific named PPI partner and its relevance>",
    "<drug context — use exact ChEMBL API note if drugs list is empty>"
  ],
  "key_pmids": {json.dumps(key_pmids)}
}}
"""


def _parse_hypothesis(content: str, gene: str, novelty_score: float, pub_count: int) -> dict:
    import re
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            # Always enforce the pre-calculated novelty score — the LLM can't override it
            parsed["novelty_score"] = novelty_score
            parsed["pub_count"]     = pub_count
            parsed.setdefault("key_pmids", [])
            return parsed
        except json.JSONDecodeError:
            pass
    return {
        "gene": gene,
        "hypothesis": content[:500],
        "mechanism": "",
        "novelty_score": novelty_score,
        "pub_count": pub_count,
        "supporting_evidence": [],
        "key_pmids": [],
    }


# ── Node 6: Report generation ────────────────────────────────────────────────

def node_generate_report(state: AgentState) -> dict:
    """Use LLM to synthesize a final markdown research report."""
    llm = _llm()
    hypotheses_json = json.dumps(state.get("hypotheses", []), indent=2)
    disease = state.get("disease_term", "the disease")

    pathway_results = state.get("pathway_results", [])
    pathways_str = _format_pathways(pathway_results)

    prompt = f"""
You are PharmaGPT. Generate a concise, publication-quality research report in Markdown format.

Disease context: {disease}
Top upregulated genes: {state.get("top_genes", [])[:10]}

Enriched pathways (KEGG / GO BP / Reactome):
{pathways_str}

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

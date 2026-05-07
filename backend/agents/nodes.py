"""LangGraph node functions for the PharmaGPT agent pipeline."""
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from db.mygene import get_gene_annotations


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


# ── Node 3: PPI enrichment + functional annotation ──────────────────────────

def node_enrich_ppi(state: AgentState) -> dict:
    """
    Fetch STRING PPI networks for top genes, then batch-annotate focal genes
    and their top partners via MyGene.info (GO Molecular Function + Reactome).

    This gives the LLM concrete enzymatic descriptions — e.g. "KRAS (GTPase activity)"
    instead of just a gene name — so the mechanism field can be truly molecular.
    """
    genes = state.get("top_genes", [])[:10]

    def _fetch_ppi(gene: str) -> dict:
        try:
            result = get_ppi_network(gene, limit=15)
            return enrich_ppi_with_oncogenes(result, KNOWN_ONCOGENES)
        except Exception as e:
            return {"gene": gene, "partners": [], "error": str(e)}

    # Step 1: STRING — parallel
    ppi_results = [None] * len(genes)
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_fetch_ppi, g): i for i, g in enumerate(genes)}
        for fut in as_completed(futures):
            ppi_results[futures[fut]] = fut.result()

    # Step 2: Collect all unique symbols (focal genes + top 5 partners each)
    all_symbols: set[str] = set(genes)
    for r in ppi_results:
        if r:
            for p in r.get("partners", [])[:5]:
                name = p.get("partner")
                if name:
                    all_symbols.add(name)

    # Step 3: Single batch call to MyGene.info
    gene_annotations = get_gene_annotations(list(all_symbols))

    # Step 4: Attach GO annotation to each focal gene result; tag partner MF terms
    for r in ppi_results:
        if not r:
            continue
        r["go_annotation"] = gene_annotations.get(r["gene"].upper(), {
            "mf_terms": [], "bp_terms": [], "reactome_pathways": [],
        })
        for p in r.get("partners", []):
            ann = gene_annotations.get((p.get("partner") or "").upper(), {})
            # Keep only top 2 MF terms per partner to stay prompt-efficient
            p["mf_terms"] = ann.get("mf_terms", [])[:2]

    return {"ppi_results": ppi_results, "status": "ppi_complete", "progress": 40}


# ── Node 4: Literature RAG ───────────────────────────────────────────────────

def node_literature_rag(state: AgentState) -> dict:
    """
    Self-RAG via Pinecone: parallel PubMed + Pinecone queries per gene.
    Falls back to direct PubMed fetch when PINECONE_API_KEY is not configured.

    Passes the gene's top PPI partners so that, when primary '{gene} AND {disease}'
    search returns <3 hits, the RAG layer can retry with '{gene} AND {interactor}' —
    allowing the agent to surface indirect evidence through known network neighbours.
    """
    disease   = state.get("disease_term", "")
    dge_index = {r["gene"]: r for r in state.get("dge_results", [])}
    ppi_index = {r["gene"]: r for r in state.get("ppi_results", []) if r}
    genes     = state.get("top_genes", [])[:settings.max_genes_for_rag]

    def _fetch(gene: str) -> dict:
        try:
            dge_entry = dge_index.get(gene, {})
            context   = (
                f"Disease: {disease}. "
                f"log2FC={dge_entry.get('log2FoldChange', 'N/A')}, "
                f"padj={dge_entry.get('padj', 'N/A')}"
            )
            ppi_entry   = ppi_index.get(gene, {})
            top_partners = [p["partner"] for p in ppi_entry.get("partners", [])[:3] if p.get("partner")]
            return query_literature(gene, context=context, ppi_partners=top_partners)
        except Exception as e:
            return {"gene": gene, "pubmed_hits": 0, "abstracts": [], "is_dark": True, "error": str(e)}

    literature_results = [None] * len(genes)
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_fetch, g): i for i, g in enumerate(genes)}
        for fut in as_completed(futures):
            literature_results[futures[fut]] = fut.result()

    return {"literature_results": literature_results, "status": "rag_complete", "progress": 60}


# ── Node 5: Drug & protein annotation ───────────────────────────────────────

def node_drug_annotation(state: AgentState) -> dict:
    """Fetch UniProt + ChEMBL in parallel across genes."""
    genes = state.get("top_genes", [])[:10]

    def _fetch(gene: str) -> dict:
        try:
            uniprot      = search_protein(gene)
            chembl_result = get_drug_interactions(gene, max_results=5)
            return {
                "gene": gene,
                "drugs": chembl_result.get("drugs", []),
                "query_note": chembl_result.get("query_note", ""),
                "query_found_target": chembl_result.get("query_found_target", False),
                "uniprot": uniprot,
            }
        except Exception as e:
            return {
                "gene": gene,
                "drugs": [],
                "query_note": f"Annotation failed: {str(e)}",
                "query_found_target": False,
                "uniprot": None,
            }

    drug_interactions = [None] * len(genes)
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_fetch, g): i for i, g in enumerate(genes)}
        for fut in as_completed(futures):
            drug_interactions[futures[fut]] = fut.result()

    return {"drug_interactions": drug_interactions, "status": "annotation_complete", "progress": 75}


# ── Node 5: LLM hypothesis synthesis ────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are PharmaGPT, a senior computational biologist writing drug-target discovery briefs.
Each brief should read like it was written by a human scientist who deeply understands THIS
specific gene — not a template applied to every gene. Vary your opening, vary your framing,
vary which evidence you foreground. Some genes deserve excitement; some deserve caution; some
are genuinely mysterious. Reflect that.

NON-NEGOTIABLE RULES (these are the only rigid constraints):
1. NOVELTY SCORE: Use the exact float in `calculated_novelty_score`. Never invent your own.
2. PMIDS: Copy the `key_pmids` list verbatim into your JSON. Do not add or remove entries.
3. MECHANISM: Name at least two specific proteins from the PPI data and describe a concrete
   molecular consequence — name the substrate acted upon, the phosphorylation site modified,
   the complex that is assembled or dissociated, or the transcriptional target de-repressed.
   Never write "activates downstream signaling," "alters metabolic states," or "promotes
   proliferation" — these are meaningless without a named molecular event.
4. DRUG LANDSCAPE: If ChEMBL returned no compounds, do NOT call this a problem.
   A dark gene with no drugs is a high-opportunity target. Frame the absence of drugs as
   competitive white space, then recommend what class of molecule could be developed.
   NEVER write the phrase "Database query returned no results" — that is database jargon,
   not scientific writing.
5. OUTPUT: Return only valid JSON — no markdown fences, no commentary outside the object.
6. HYPOTHESIS FIELD: Biological interpretation only. Do NOT include log2FC values, padj
   values, fold-change numbers, or any raw statistics in the hypothesis field. Those belong
   exclusively in supporting_evidence. The hypothesis is the scientific "so what" — the
   argument for why this gene matters as a target in the named disease context.
7. PATHWAY DISTANCE: If the gene is not an overlap gene in any enriched pathway, you MUST
   explicitly state the network relationship — e.g. "While [gene] is not a direct member of
   any enriched pathway, its first-order STRING interactors [name them] are enriched in
   [pathway name], placing it one step from [process]." Never mention a pathway as if the
   gene participates in it when it is only an interactor-level connection.
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
    disease_term = state.get("disease_term", "")

    # Build gene context dict
    gene_context = _build_gene_context(state)
    dark_genes = [g for g in state.get("literature_results", []) if g.get("is_dark")]

    pathway_results = state.get("pathway_results", [])

    # Fetch all PubMed counts in parallel before any LLM calls
    top_context = gene_context[:5]
    with ThreadPoolExecutor(max_workers=5) as pool:
        count_futures = {pool.submit(_get_pubmed_count, gd["gene"]): gd for gd in top_context}
        for fut in as_completed(count_futures):
            gd = count_futures[fut]
            pc = fut.result()
            gd["_pub_count"]      = pc
            gd["_novelty_score"]  = _novelty_from_pub_count(pc)

    for gene_data in top_context:
        gene          = gene_data["gene"]
        novelty_score = gene_data.get("_novelty_score", 0.5)
        pub_count     = gene_data.get("_pub_count", -1)

        try:
            prompt = _build_hypothesis_prompt(gene_data, dark_genes, pathway_results, disease_term)
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


def _build_hypothesis_prompt(gene_data: dict, dark_genes: list, pathway_results: list = None, disease_term: str = "") -> str:
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

    # GO / Reactome annotation (from MyGene.info)
    go_ann           = ppi.get("go_annotation", {})
    mf_terms         = go_ann.get("mf_terms", [])
    bp_terms         = go_ann.get("bp_terms", [])
    reactome_members = go_ann.get("reactome_pathways", [])

    # PPI — annotate partners with their top MF term where available
    ppi_partners = ppi.get("partners", [])
    partners = []
    for p in ppi_partners[:6]:
        name   = p.get("partner", "")
        mf     = p.get("mf_terms", [])
        partners.append(f"{name} ({mf[0]})" if mf else name)
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
    disease_label = disease_term.strip() if disease_term.strip() else "the disease"
    in_pathways = bool(gene_pathways)

    return f"""
Analyze gene **{g}** as a potential therapeutic target in **{disease_label}**.

## DGE Data
- log2 Fold Change (disease vs control): {lfc}
- Adjusted p-value: {padj}

## Molecular Function (MyGene.info / Gene Ontology)
- GO Molecular Function: {mf_terms if mf_terms else "Not retrieved"}
- GO Biological Process (top terms): {bp_terms if bp_terms else "Not retrieved"}
- Reactome pathway membership (confirmed): {reactome_members if reactome_members else "None on file"}
  Note: These are direct memberships from Reactome — not enrichment-based inferences.

## Protein Information (UniProt)
- Function: {protein_function}
- Structural data (PDB IDs): {pdb_ids if pdb_ids else "None on file"}

## Pathway Enrichment (KEGG / GO BP / Reactome, redundancy-filtered)
All DEGs — top enriched pathways:
{pathways_str}
Pathways where **{g}** is a direct overlap gene: {gene_pathways if gene_pathways else "None detected"}

## Protein-Protein Interactions (STRING DB, high confidence)
Partners shown as "Name (molecular function)" where MyGene.info annotation is available:
- Interaction partners: {partners if partners else "None retrieved"}
- Partners that are known oncogenes: {oncogene_partners if oncogene_partners else "None"}

## Literature (PubMed + Semantic Scholar via Pinecone)
- PubMed hit count for "{g} AND cancer": {pub_count_str}
- Classified dark gene (under-studied): {lit.get("is_dark", False)}
- Key PMIDs retrieved: {key_pmids if key_pmids else "None"}
- Summary: {lit_summary[:600] if lit_summary else "Not available"}
- Other dark genes in dataset: {dark_genes_str if dark_genes_str else "None"}

## Drug Landscape (ChEMBL)
- Target resolved in ChEMBL: {target_found}
- Compounds with pChEMBL ≥ 5: {all_drugs if all_drugs else "none found in database"}
- Context: {chembl_note}

## Novelty (pre-calculated — DO NOT change)
calculated_novelty_score = {novelty_score}
PubMed cancer publication count: {pub_count_str}
A score near 1.0 means this gene is understudied with little existing drug coverage — genuine
competitive white space. A score near 0 means it is heavily studied and well-drugged.

## Your Task
Write a discovery brief for **{g}** in **{disease_label}** that a medicinal chemist or grant
reviewer would find compelling. Lead with what is *most interesting or surprising* about this
specific gene — an unusual PPI partner, a structural druggability angle, an extremely high
expression shift, or the complete absence of drugs on a target that clearly matters.

Do not follow a formula. Do not open with "{g} is upregulated X-fold." Find an angle.

PATHWAY DISTANCE REMINDER: {g} {'is a direct overlap gene in: ' + str(gene_pathways) if in_pathways else 'is NOT a direct overlap gene in any enriched pathway. If you mention pathways in mechanism, you MUST frame them via interactor distance: "While ' + g + ' itself is not an overlap gene, its STRING interactors [name them] are enriched in [pathway]..."'}

MECHANISM REMINDER: Name ≥2 specific proteins from the PPI list above and describe the exact
molecular event — substrate phosphorylated, complex assembled/dissociated, transcriptional
target de-repressed. "Alters metabolic states" or "activates downstream signaling" are
forbidden — name the thing that changes.

Output ONLY valid JSON (no markdown fences, no text before or after):
{{
  "gene": "{g}",
  "hypothesis": "<2-4 sentences of biological argument for why {g} matters as a target in {disease_label}. NO raw statistics (no log2FC, no padj). Scientific 'so what' only.>",
  "mechanism": "<Molecular mechanism naming ≥2 specific PPI partners and a concrete molecular event — phosphorylation site, complex dissociation, transcriptional target, substrate. Be precise.>",
  "novelty_score": {novelty_score},
  "pub_count": {pub_count},
  "supporting_evidence": [
    "<3-5 evidence points for {g} specifically — DGE stats (log2FC={lfc}, padj={padj}), pathway overlap or interactor-level enrichment, PPI oncogene connections, literature findings, drug landscape. Not every category needed.>"
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

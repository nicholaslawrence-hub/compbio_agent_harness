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
from db.depmap import get_gene_essentiality
from db.opentargets import get_ot_association


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


# ── Node 1b: DGE retry with lenient threshold ────────────────────────────────

def node_dge_retry(state: AgentState) -> dict:
    """
    Re-run top-gene selection with lenient thresholds (padj < 0.10, |log2FC| > 0.5).
    Called by supervisor when fewer than 10 genes passed strict DGE on first attempt.
    Uses the already-computed all_dge_results — no re-running PyDESeq2.
    """
    all_dge = state.get("all_dge_results", [])
    if not all_dge:
        return {"status": "dge_failed", "errors": ["No DGE results to retry from"], "progress": 5}

    df = pd.DataFrame(all_dge)
    lenient = df[
        (df["padj"] < 0.10) &
        (df["log2FoldChange"].abs() > 0.5) &
        (df["log2FoldChange"] > 0)
    ].sort_values("log2FoldChange", ascending=False)

    if lenient.empty:
        return {"status": "dge_failed", "errors": ["No genes passed lenient DGE thresholds"], "progress": 5}

    top_df   = lenient.head(settings.max_genes_for_rag)
    top_genes = top_df["gene"].tolist()

    return {
        "dge_results":  top_df.to_dict("records"),
        "top_genes":    top_genes,
        "dge_attempt":  2,
        "status":       "dge_complete",
        "progress":     20,
    }


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
    Fetch STRING PPI networks for top genes (or a supervisor-specified target gene),
    then batch-annotate via MyGene.info (GO Molecular Function + Reactome).

    When the supervisor provides a subquery (e.g. a PPI partner gene name), this node
    fetches PPI specifically for that gene and merges it into the existing ppi_results —
    enabling targeted follow-up on interactors discovered in previous iterations.
    """
    subquery = (state.get("supervisor_subquery") or "").strip()

    # If supervisor specified a particular gene (e.g. a partner worth investigating),
    # query just that one and merge into existing results. Otherwise default to top genes.
    existing_ppi = {r["gene"]: r for r in state.get("ppi_results", []) if r}
    if subquery and subquery not in existing_ppi:
        genes = [subquery]
        is_followup = True
    else:
        genes = state.get("top_genes", [])[:10]
        is_followup = False

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

    # Merge follow-up results into existing ppi_results
    if is_followup:
        merged = list(existing_ppi.values())
        for r in ppi_results:
            if r and r["gene"] not in existing_ppi:
                merged.append(r)
        ppi_results = merged

    # Build a supervisor-readable summary
    summaries = []
    for r in ppi_results:
        if not r:
            continue
        partners = [p.get("partner", "") for p in r.get("partners", [])[:5]]
        oncogenes = [p.get("partner") for p in r.get("partners", []) if p.get("is_oncogene")]
        mf = r.get("go_annotation", {}).get("mf_terms", [])
        summaries.append(
            f"{r['gene']}: partners=[{', '.join(partners)}]"
            + (f" oncogene_partners=[{', '.join(oncogenes)}]" if oncogenes else "")
            + (f" GO_MF=[{mf[0]}]" if mf else "")
        )

    ctx_entry = {
        "step": "enrich_ppi",
        "subquery": subquery or "all top genes",
        "summary": "; ".join(summaries) if summaries else "No PPI data retrieved",
        "is_followup": is_followup,
    }

    return {
        "ppi_results": ppi_results,
        "supervisor_context": [ctx_entry],
        "status": "ppi_complete",
        "progress": 40,
    }


# ── Node 4: Literature RAG ───────────────────────────────────────────────────

def node_literature_rag(state: AgentState) -> dict:
    """
    Self-RAG via Pinecone + PubMed. When the supervisor provides a targeted subquery
    (e.g. "SBSPON HSDL2 steroid dehydrogenase"), this node runs that specific search
    and MERGES the results into existing literature_results — enabling refinement loops
    where the agent searches progressively more specific queries per discovery round.
    """
    disease   = state.get("disease_term", "")
    dge_index = {r["gene"]: r for r in state.get("dge_results", [])}
    ppi_index = {r["gene"]: r for r in state.get("ppi_results", []) if r}
    subquery  = (state.get("supervisor_subquery") or "").strip()

    existing_lit = {r["gene"]: r for r in state.get("literature_results", []) if r}

    if subquery:
        # Targeted search: the supervisor wants a specific gene+context combination.
        # Parse out the focal gene (first token) and use the rest as extra context.
        parts = subquery.split(None, 1)
        focal_gene   = parts[0]
        extra_context = parts[1] if len(parts) > 1 else ""
        context = f"Disease: {disease}. Targeted query: {extra_context}"
        ppi_entry    = ppi_index.get(focal_gene, {})
        top_partners = [p["partner"] for p in ppi_entry.get("partners", [])[:3] if p.get("partner")]
        try:
            result = query_literature(focal_gene, context=context, ppi_partners=top_partners)
            # Merge: targeted search enriches (or creates) the gene's lit entry
            if focal_gene in existing_lit:
                merged = dict(existing_lit[focal_gene])
                merged["abstracts"]  = (merged.get("abstracts", []) + result.get("abstracts", []))[:10]
                merged["key_pmids"]  = list(set(merged.get("key_pmids", []) + result.get("key_pmids", [])))
                merged["pubmed_hits"] = max(merged.get("pubmed_hits", 0), result.get("pubmed_hits", 0))
                existing_lit[focal_gene] = merged
            else:
                existing_lit[focal_gene] = result
        except Exception as e:
            existing_lit.setdefault(focal_gene, {"gene": focal_gene, "error": str(e), "is_dark": True})

        literature_results = list(existing_lit.values())
        is_targeted = True
    else:
        # Broad search: standard per-gene parallel fetch
        genes = state.get("top_genes", [])[:settings.max_genes_for_rag]

        def _fetch(gene: str) -> dict:
            try:
                dge_entry = dge_index.get(gene, {})
                context   = (
                    f"Disease: {disease}. "
                    f"log2FC={dge_entry.get('log2FoldChange', 'N/A')}, "
                    f"padj={dge_entry.get('padj', 'N/A')}"
                )
                ppi_entry    = ppi_index.get(gene, {})
                top_partners = [p["partner"] for p in ppi_entry.get("partners", [])[:3] if p.get("partner")]
                return query_literature(gene, context=context, ppi_partners=top_partners)
            except Exception as e:
                return {"gene": gene, "pubmed_hits": 0, "abstracts": [], "is_dark": True, "error": str(e)}

        results_list = [None] * len(genes)
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_fetch, g): i for i, g in enumerate(genes)}
            for fut in as_completed(futures):
                results_list[futures[fut]] = fut.result()
        literature_results = results_list
        is_targeted = False

    # Build supervisor-readable summary
    hit_summaries = []
    for r in literature_results:
        if not r:
            continue
        hits  = r.get("pubmed_hits", 0)
        dark  = r.get("is_dark", False)
        pmids = r.get("key_pmids", [])
        hit_summaries.append(
            f"{r.get('gene', '?')}: {hits} PubMed hits"
            + (" [DARK]" if dark else "")
            + (f" PMIDs={pmids[:3]}" if pmids else "")
        )

    ctx_entry = {
        "step": "literature_rag",
        "subquery": subquery or "all top genes",
        "summary": "; ".join(hit_summaries) if hit_summaries else "No literature results",
        "is_targeted": is_targeted,
    }

    return {
        "literature_results": literature_results,
        "supervisor_context": [ctx_entry],
        "status": "rag_complete",
        "progress": 60,
    }


# ── Node 5: Drug & protein annotation ───────────────────────────────────────

def node_drug_annotation(state: AgentState) -> dict:
    """
    Fetch UniProt + ChEMBL for top genes.  When the supervisor targets a specific gene
    (e.g. a PPI partner like HSDL2 that might be druggable as a proxy target), this node
    fetches drug data for that gene and MERGES it into the existing drug_interactions list.
    This is how the agent discovers "undruggable gene → druggable interactor" opportunities.
    """
    subquery = (state.get("supervisor_subquery") or "").strip()
    existing_drugs = {r["gene"]: r for r in state.get("drug_interactions", []) if r}

    def _fetch(gene: str) -> dict:
        try:
            uniprot       = search_protein(gene)
            chembl_result = get_drug_interactions(gene, max_results=5)
            return {
                "gene":               gene,
                "drugs":              chembl_result.get("drugs", []),
                "query_note":         chembl_result.get("query_note", ""),
                "query_found_target": chembl_result.get("query_found_target", False),
                "uniprot":            uniprot,
            }
        except Exception as e:
            return {
                "gene":               gene,
                "drugs":              [],
                "query_note":         f"Annotation failed: {str(e)}",
                "query_found_target": False,
                "uniprot":            None,
            }

    if subquery and subquery not in existing_drugs:
        # Supervisor is following up on a specific gene (typically a PPI partner)
        result = _fetch(subquery)
        existing_drugs[subquery] = result
        drug_interactions = list(existing_drugs.values())
        is_followup = True
    else:
        # Standard pass: fetch all top genes in parallel
        genes = state.get("top_genes", [])[:10]
        results_list = [None] * len(genes)
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_fetch, g): i for i, g in enumerate(genes)}
            for fut in as_completed(futures):
                results_list[futures[fut]] = fut.result()
        # Merge with any follow-up entries already in state
        for r in results_list:
            if r:
                existing_drugs[r["gene"]] = r
        drug_interactions = list(existing_drugs.values())
        is_followup = False

    # Build supervisor-readable summary
    drug_summaries = []
    for r in drug_interactions:
        if not r:
            continue
        drugs    = r.get("drugs", [])
        resolved = r.get("query_found_target", False)
        names    = [d["molecule_name"] for d in drugs[:3]]
        drug_summaries.append(
            f"{r['gene']}: {'target resolved' if resolved else 'no ChEMBL target'}"
            + (f" drugs=[{', '.join(names)}]" if names else " (0 compounds)")
        )

    ctx_entry = {
        "step":        "drug_annotation",
        "subquery":    subquery or "all top genes",
        "summary":     "; ".join(drug_summaries) if drug_summaries else "No drug data retrieved",
        "is_followup": is_followup,
    }

    return {
        "drug_interactions":  drug_interactions,
        "supervisor_context": [ctx_entry],
        "status":             "annotation_complete",
        "progress":           75,
    }


# ── Node: DepMap CRISPR essentiality ────────────────────────────────────────

def node_depmap_query(state: AgentState) -> dict:
    """
    Query DepMap Chronos essentiality scores for top genes (or a supervisor-targeted gene).

    Key signals for the supervisor:
    - mean_chronos << -0.5  → cancer cell lines die when this gene is knocked out
    - is_strongly_selective → dependency is cancer-type specific (precision medicine angle)
    - is_common_essential   → essential in all lines — therapeutic window concern
    - percent_dependent     → what fraction of cell lines show dependency

    This is especially valuable for dark genes: low PubMed count + high essentiality =
    genuinely understudied critical dependency, not just an obscure gene.
    """
    subquery = (state.get("supervisor_subquery") or "").strip()
    existing = {r["gene"]: r for r in state.get("depmap_results", []) if r}

    if subquery and subquery not in existing:
        genes       = [subquery]
        is_followup = True
    else:
        genes       = [g for g in state.get("top_genes", [])[:10] if g not in existing]
        is_followup = False

    new_results: list[dict] = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(get_gene_essentiality, g): g for g in genes}
        for fut in as_completed(futures):
            new_results.append(fut.result())

    merged = {**existing, **{r["gene"]: r for r in new_results if r}}
    depmap_results = list(merged.values())

    # Build supervisor-readable summary
    summaries = []
    for r in new_results:
        if r.get("error") and not r.get("mean_chronos"):
            summaries.append(f"{r['gene']}: DepMap unavailable ({r['error']})")
            continue
        mc  = r.get("mean_chronos")
        pct = r.get("percent_dependent")
        flags = []
        if r.get("is_common_essential"):
            flags.append("COMMON_ESSENTIAL")
        elif r.get("is_strongly_selective"):
            flags.append("SELECTIVE")
        mc_str  = f"chronos={mc:.3f}" if mc is not None else "chronos=N/A"
        pct_str = f"{pct}% dependent" if pct is not None else ""
        lins    = r.get("top_lineages", [])
        lin_str = f" top_lineages=[{', '.join(lins[:3])}]" if lins else ""
        summaries.append(
            f"{r['gene']}: {mc_str}, {pct_str}"
            + (f" [{', '.join(flags)}]" if flags else "")
            + lin_str
        )

    ctx_entry = {
        "step":        "depmap_query",
        "subquery":    subquery or "all top genes",
        "summary":     "; ".join(summaries) if summaries else "No DepMap data retrieved",
        "is_followup": is_followup,
    }

    return {
        "depmap_results":      depmap_results,
        "supervisor_context":  [ctx_entry],
        "status":              "depmap_complete",
        "progress":            45,
    }


# ── Node: OpenTargets association ────────────────────────────────────────────

def node_opentargets_query(state: AgentState) -> dict:
    """
    Query the OpenTargets Platform for disease-gene association scores.

    The overall_score (0-1) aggregates seven evidence streams:
      genetic_association  GWAS / rare variant burden tests
      somatic_mutation     COSMIC cancer driver evidence
      known_drug           approved or clinical-stage drugs
      affected_pathway     target in a disease-relevant pathway
      literature           PubMed co-mention frequency
      rna_expression       TCGA / GTEx differential expression
      animal_model         mouse/zebrafish knockout phenotypes

    Score interpretation for supervisor:
      0.00–0.10  No meaningful evidence → genuine white space, investigate boldly
      0.10–0.35  Low evidence → worth developing
      0.35–0.65  Moderate evidence → validate mechanism, competitive landscape emerging
      0.65–1.00  Strong evidence → highly studied, focus hypothesis on novelty angle
    """
    subquery = (state.get("supervisor_subquery") or "").strip()
    disease  = state.get("disease_term", "")
    existing = {r["gene"]: r for r in state.get("opentargets_results", []) if r}

    if subquery and subquery not in existing:
        genes       = [subquery]
        is_followup = True
    else:
        genes       = [g for g in state.get("top_genes", [])[:10] if g not in existing]
        is_followup = False

    new_results: list[dict] = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(get_ot_association, g, disease): g for g in genes}
        for fut in as_completed(futures):
            new_results.append(fut.result())

    merged = {**existing, **{r["gene"]: r for r in new_results if r}}
    ot_results = list(merged.values())

    # Build supervisor-readable summary
    summaries = []
    for r in new_results:
        if r.get("error") and r["overall_score"] == 0.0:
            summaries.append(f"{r['gene']}: OT unavailable ({r['error']})")
            continue
        sc   = r["overall_score"]
        # Surface the highest-scoring subtypes for context
        subtypes = {
            "genetics":  r["genetic_association"],
            "mutations": r["somatic_mutation"],
            "drugs":     r["known_drug"],
            "pathways":  r["affected_pathway"],
            "expr":      r["rna_expression"],
        }
        top_subs = sorted(subtypes.items(), key=lambda x: x[1], reverse=True)[:3]
        top_str  = ", ".join(f"{k}={v:.2f}" for k, v in top_subs if v > 0.01)
        summaries.append(
            f"{r['gene']}: OT_score={sc:.3f}"
            + (f" [{top_str}]" if top_str else " [no evidence types scored]")
        )

    ctx_entry = {
        "step":        "opentargets_query",
        "subquery":    subquery or "all top genes",
        "summary":     "; ".join(summaries) if summaries else "No OpenTargets data retrieved",
        "is_followup": is_followup,
    }

    return {
        "opentargets_results": ot_results,
        "supervisor_context":  [ctx_entry],
        "status":              "ot_complete",
        "progress":            50,
    }


# ── Supervisor node ──────────────────────────────────────────────────────────

_SUPERVISOR_PROMPT = """\
You are the research director of a computational drug-discovery team.
Your job is to orchestrate an iterative investigation into a set of upregulated genes
and decide — based on accumulated findings — what to investigate next.

You have five worker tools:

  "enrich_ppi"        Fetch STRING protein-protein interaction network + GO annotation.
                      Subquery = a specific gene name (focal gene or an interesting partner).
                      Use first — PPI context informs every downstream decision.

  "literature_rag"    Search PubMed + semantic literature index (Pinecone).
                      Subquery = targeted search string, e.g. "SBSPON HSDL2 steroid dehydrogenase".
                      Best for dark genes or follow-up on a specific mechanistic angle.

  "drug_annotation"   Check ChEMBL + UniProt for known drugs and protein structure.
                      Subquery = gene name (can be a PPI partner for proxy druggability).

  "depmap_query"      Query DepMap CRISPR Chronos essentiality scores.
                      Subquery = gene name to focus on (or empty for all top genes).
                      KEY USE: dark genes with sparse literature — high essentiality confirms
                      the gene is a real cancer dependency despite lack of papers.
                      Chronos < -0.5 = meaningful dependency; "strongly_selective" = cancer-
                      type specific (best target profile); "common_essential" = toxicity risk.

  "opentargets_query" Query OpenTargets Platform for disease-gene association evidence.
                      Subquery = gene name (or empty for all top genes).
                      Returns overall_score (0-1) + breakdown: genetic_association,
                      somatic_mutation, known_drug, affected_pathway, rna_expression.
                      KEY USE: validate whether a DGE hit has supporting multi-omic evidence.
                      Score near 0 = no prior evidence (genuine white space for dark genes).
                      Score near 1 = heavily studied (focus hypothesis on novelty angle).

  "finalize"          Enough evidence gathered — proceed to hypothesis synthesis.

RECOMMENDED STRATEGY:
1. Round 1: enrich_ppi for all top genes (no subquery) — always do this first.
2. Round 2: depmap_query + opentargets_query for all top genes — these give you the
   essentiality and multi-omic validation landscape before diving into literature.
3. Round 3+: Targeted follow-up based on what you found:
   - Dark gene (low OT score, low PubMed) + high DepMap essentiality → literature_rag
     with "GENE PARTNER mechanism" to find mechanistic clues.
   - No ChEMBL drugs on focal gene but has PPI partner → drug_annotation with partner name.
   - Specific PPI partner looks interesting (oncogene, high OT score) → enrich_ppi subquery.
4. Finalize after 2-3 refinement rounds or when all top genes have good evidence coverage.

PRUNING: After each round you may prune genes with no PPI partners, no DepMap essentiality,
OT score < 0.01, and no literature. Only prune when confident — when in doubt, keep the gene.

OUTPUT: Respond with ONLY valid JSON (no fences, no commentary):
{"next_step": "<enrich_ppi|literature_rag|drug_annotation|depmap_query|opentargets_query|finalize>",
 "subquery": "<specific gene or search string, or empty string for broad pass>",
 "reasoning": "<one sentence explaining this decision>",
 "prune_genes": ["<gene_symbol>", "..."]}
"""


def _format_supervisor_context(state: AgentState) -> str:
    """Format accumulated supervisor_context into a readable history for the supervisor LLM."""
    entries = state.get("supervisor_context", [])
    if not entries:
        return "No investigation history yet — this is the first decision point."
    lines = []
    for i, entry in enumerate(entries, 1):
        lines.append(
            f"Round {i} [{entry.get('step', '?')}]"
            + (f" (query: {entry['subquery']})" if entry.get("subquery") else "")
            + f"\n  → {entry.get('summary', 'No summary')}"
        )
    return "\n".join(lines)


def node_supervisor(state: AgentState) -> dict:
    """
    LLM-based research director. Reads accumulated findings and decides:
    - Which worker node to call next (enrich_ppi / literature_rag / drug_annotation)
    - What targeted subquery to pass (specific gene or search string)
    - OR: enough evidence gathered — route to 'finalize' (hypothesis synthesis)

    This is the core agentic loop: the supervisor can call the same node multiple times
    with progressively refined queries (e.g. broad PPI → targeted lit search on a partner).
    """
    iteration = state.get("supervisor_iterations", 0)

    # Hard cap: always finalize after 8 iterations to prevent infinite loops
    if iteration >= 8:
        return {
            "next_step":             "finalize",
            "supervisor_subquery":   "",
            "supervisor_reasoning":  "Iteration cap reached — finalizing.",
            "supervisor_iterations": iteration + 1,
            "status":                "supervisor_finalizing",
            "progress":              80,
        }

    # On the very first call (no context yet), always start with broad PPI
    context_entries = state.get("supervisor_context", [])
    if not context_entries:
        return {
            "next_step":             "enrich_ppi",
            "supervisor_subquery":   "",
            "supervisor_reasoning":  "First pass: fetching PPI for all top genes.",
            "supervisor_iterations": iteration + 1,
            "status":                "supervisor_routing",
            "progress":              35,
        }

    llm = _llm()
    disease   = state.get("disease_term", "unknown disease")
    top_genes = state.get("top_genes", [])[:5]
    context   = _format_supervisor_context(state)

    prompt = f"""Disease under investigation: {disease}
Top upregulated genes: {top_genes}
Supervisor loop iteration: {iteration + 1} of 8 max

INVESTIGATION HISTORY SO FAR:
{context}

Based on these findings, what should be investigated next?
Remember the strategy: follow sparse literature with targeted partner-gene queries,
check PPI partners for druggability when focal genes are undruggable, then finalize
when you have substantive findings for all top genes."""

    try:
        response = llm.invoke([
            SystemMessage(content=_SUPERVISOR_PROMPT),
            HumanMessage(content=prompt),
        ])
        import re
        match = re.search(r"\{.*\}", response.content, re.DOTALL)
        parsed = json.loads(match.group()) if match else {}
        next_step   = parsed.get("next_step", "finalize")
        subquery    = parsed.get("subquery", "")
        reasoning   = parsed.get("reasoning", "")
        prune_genes = [g for g in parsed.get("prune_genes", []) if isinstance(g, str)]
    except Exception as e:
        next_step   = "finalize"
        subquery    = ""
        reasoning   = f"Supervisor parse error ({e}) — finalizing."
        prune_genes = []

    valid_steps = {"enrich_ppi", "literature_rag", "drug_annotation",
                   "depmap_query", "opentargets_query", "finalize"}
    if next_step not in valid_steps:
        next_step = "finalize"

    # Apply pruning: remove dead-end genes from active investigation list
    # Never prune below 2 genes so the pipeline always has candidates to work with
    current_genes = state.get("top_genes", [])
    if prune_genes and len(current_genes) > 2:
        pruned_set = set(prune_genes)
        filtered   = [g for g in current_genes if g not in pruned_set]
        current_genes = filtered if len(filtered) >= 2 else current_genes[:2]

    prune_note = f" Pruned: {prune_genes}." if prune_genes else ""
    ctx_entry = {
        "step":     "supervisor",
        "subquery": "",
        "summary":  f"Decision: {next_step}" + (f" (query: {subquery})" if subquery else "") + f". {reasoning}{prune_note}",
    }

    return {
        "top_genes":             current_genes,
        "pruned_genes":          (state.get("pruned_genes", []) + prune_genes),
        "next_step":             next_step,
        "supervisor_subquery":   subquery,
        "supervisor_reasoning":  reasoning,
        "supervisor_iterations": iteration + 1,
        "supervisor_context":    [ctx_entry],
        "status":                "supervisor_routing" if next_step != "finalize" else "supervisor_finalizing",
        "progress":              35 + min(iteration * 5, 40),
    }


# ── Node 6: LLM hypothesis synthesis ────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are RNAgent, a senior computational biologist writing drug-target discovery briefs.
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
    """
    LLM hypothesis synthesis driven entirely by the supervisor investigation log.

    Generates one hypothesis per gene that survived supervisor pruning — no
    hardcoded count. The supervisor_context already contains rich natural-language
    summaries of PPI, DepMap, OpenTargets, literature, and drug findings from
    every iteration, so we use that as the primary evidence rather than re-injecting
    raw data structures.
    """
    llm         = _llm()
    disease_term = state.get("disease_term", "")
    # Use the pruned gene list — only generate hypotheses for surviving genes
    top_genes   = state.get("top_genes", [])
    sup_context = _format_supervisor_context(state)
    dge_map     = {r["gene"]: r for r in state.get("dge_results", [])}
    lit_map     = {r["gene"]: r for r in state.get("literature_results", []) if r}

    hypotheses: list[dict] = []

    # Fetch PubMed counts in parallel for all surviving genes
    with ThreadPoolExecutor(max_workers=5) as pool:
        count_futures = {pool.submit(_get_pubmed_count, g): g for g in top_genes}
        pub_counts    = {count_futures[f]: f.result() for f in as_completed(count_futures)}

    for gene in top_genes:
        dge_entry     = dge_map.get(gene, {})
        lit_entry     = lit_map.get(gene, {})
        pub_count     = pub_counts.get(gene, -1)
        novelty_score = _novelty_from_pub_count(pub_count)
        key_pmids     = lit_entry.get("key_pmids", [])

        try:
            prompt = _build_hypothesis_prompt(
                gene, dge_entry, disease_term, sup_context, novelty_score, pub_count, key_pmids
            )
            response = llm.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])
            hypothesis = _parse_hypothesis(response.content, gene, novelty_score, pub_count)
            hypotheses.append(hypothesis)
        except Exception as e:
            hypotheses.append({
                "gene":               gene,
                "hypothesis":         f"Analysis failed: {str(e)}",
                "mechanism":          "",
                "novelty_score":      novelty_score,
                "pub_count":          pub_count,
                "supporting_evidence": [],
                "key_pmids":          key_pmids,
            })

    return {"hypotheses": hypotheses, "status": "synthesis_complete", "progress": 90}


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


def _build_hypothesis_prompt(
    gene: str,
    dge_entry: dict,
    disease_term: str,
    supervisor_context: str,
    novelty_score: float,
    pub_count: int,
    key_pmids: list,
) -> str:
    lfc_raw = dge_entry.get("log2FoldChange", "N/A")
    padj    = dge_entry.get("padj", "N/A")
    lfc     = f"{lfc_raw:.3f}" if isinstance(lfc_raw, float) else str(lfc_raw)
    pub_str = str(pub_count) if pub_count >= 0 else "unknown"
    disease = disease_term.strip() or "the disease"

    return f"""
Analyze gene **{gene}** as a potential therapeutic target in **{disease}**.

## DGE Stats (for supporting_evidence only — do NOT include these numbers in the hypothesis field)
log2FC = {lfc}  |  padj = {padj}

## Novelty (pre-calculated — DO NOT change this value)
novelty_score = {novelty_score}
PubMed cancer hits: {pub_str}

## Agent Network Investigation (primary evidence — this is the full picture; weight it heavily)
The supervisor directed specialist agents across multiple rounds. All PPI network data,
DepMap essentiality scores, OpenTargets disease associations, literature findings, and
drug annotation results are captured in the log below:

{supervisor_context if supervisor_context else "No investigation data available — use general biological knowledge."}

## Task
Write a discovery brief for **{gene}** in **{disease}** that a medicinal chemist or grant
reviewer finds compelling. Lead with what is surprising or distinctive about this gene
based on the investigation above. Do not open with "{gene} is upregulated X-fold." Find an angle.

MECHANISM: Name at least 2 specific proteins from the PPI findings above. Describe the exact
molecular event — phosphorylation site, complex assembled/dissociated, transcriptional target.
Never write "activates downstream signaling" — name the specific molecular change.

DRUG LANDSCAPE: If the agent network found no drugs, frame it as competitive white space
and recommend what class of molecule could be developed.
Never write "Database query returned no results."

Output ONLY valid JSON:
{{
  "gene": "{gene}",
  "hypothesis": "<2-4 sentences: biological argument for why {gene} matters in {disease}. No statistics.>",
  "mechanism": "<Concrete molecular mechanism naming >=2 proteins and a specific molecular event.>",
  "novelty_score": {novelty_score},
  "pub_count": {pub_count},
  "supporting_evidence": ["<3-5 evidence points including: DGE stats (log2FC={lfc}, padj={padj}), DepMap/OT scores if retrieved, literature hits, drug landscape>"],
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
You are RNAgent. Generate a concise, publication-quality research report in Markdown format.

Disease context: {disease}
Genes investigated (surviving supervisor pruning): {state.get("top_genes", [])}

Enriched pathways (KEGG / GO BP / Reactome):
{pathways_str}

Therapeutic hypotheses generated by the agent network:
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

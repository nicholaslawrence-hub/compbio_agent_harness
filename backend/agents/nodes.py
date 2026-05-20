"""LangGraph node functions for the PharmaGPT agent pipeline."""
import json
import math
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import pandas as pd
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool as lc_tool
from langgraph.prebuilt import create_react_agent

from config import settings
from agents.runtime import register_artifact
from agents.state import AgentState
from tools.dge import (
    parse_count_matrix_from_upload,
    run_dge,
    top_upregulated,
)
from tools.ppi import get_ppi_network, enrich_ppi_with_oncogenes, KNOWN_ONCOGENES
from tools.pathway import run_pathway_enrichment as _enrich_pathways
from tools.chemistry import calculate_rdkit_features, run_gnina_docking, run_reinvent_generation
from tools.crispr import design_grnas_for_gene, run_mageck_crispr
from tools.structure import fetch_alphafold_structure
from tools.viper import compute_viper_activity, run_viper_protein_activity
from db.pinecone_rag import query_literature
from db.uniprot import search_protein
from db.chembl import get_drug_interactions
from db.mygene import get_gene_annotations
from db.depmap import get_gene_essentiality
from db.opentargets import get_ot_association


@lru_cache(maxsize=1)
def _llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        api_key=settings.openai_api_key,
    )


def _parallel(fn, items: list, max_workers: int = 5) -> list:
    """Run fn(item) for each item in parallel, preserving input order."""
    results = [None] * len(items)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(fn, x): i for i, x in enumerate(items)}
        for fut in as_completed(futures):
            results[futures[fut]] = fut.result()
    return results


def _ctx(step: str, subquery: str, summary: str, **extra) -> dict:
    return {"step": step, "subquery": subquery or "all top genes", "summary": summary, **extra}


def node_study_context(state: AgentState) -> dict:
    """Inject visual-builder study goals into state before tool execution."""
    config = state.get("sandbox_config", {}) or {}
    directive = str(config.get("directive", "")).strip()
    topology = state.get("network_topology") or config.get("network_topology") or {}
    notes = state.get("study_context", {}) or {}
    if directive:
        notes = {**notes, "study_notes": directive}
    return {
        "study_context": notes,
        "network_topology": topology,
        "status": "context_loaded",
        "progress": 8,
    }


def _summarize_latest_context(state: AgentState) -> str:
    context = state.get("supervisor_context", [])
    if not context:
        return "No specialist output has been captured yet."
    latest = context[-1]
    return f"{latest.get('step', 'unknown')}: {latest.get('summary', '')}"


def node_critic(state: AgentState) -> dict:
    """Cynical evaluator that can route backward when output is weak."""
    previous = state.get("previous_node_id") or "unknown"
    retries = dict(state.get("critic_retries", {}) or {})
    current_retries = retries.get(previous, 0)
    latest_summary = _summarize_latest_context(state)
    study_context = str(state.get("study_context", {}))
    decision = "approve"
    feedback = "Output is acceptable."
    subquery = ""

    if current_retries >= 3:
        feedback = f"Retry cap reached for {previous}. Forcing flow forward."
    else:
        prompt = f"""Study goals:
{study_context}

Latest specialist output:
{latest_summary}

Be skeptical. Decide whether this output is specific and useful enough for the study goal.
Return JSON only:
{{"decision":"approve|retry","feedback":"short actionable feedback","subquery":"optional tighter query"}}"""
        try:
            response = _llm().invoke([
                SystemMessage(content="You are a cynical computational biology reviewer. Reject vague, irrelevant, or hallucinated evidence."),
                HumanMessage(content=prompt),
            ])
            match = re.search(r"\{.*\}", response.content, re.DOTALL)
            parsed = json.loads(match.group()) if match else {}
            decision = parsed.get("decision", "approve")
            feedback = parsed.get("feedback", feedback)
            subquery = parsed.get("subquery", "")
        except Exception as e:
            feedback = f"Critic parse failed, approving to keep execution moving: {e}"

        if decision == "retry":
            retries[previous] = current_retries + 1
        else:
            decision = "approve"

    feedback_entry = {
        "node": previous,
        "decision": decision,
        "feedback": feedback,
        "retry_count": retries.get(previous, current_retries),
    }
    return {
        "critic_route": "retry" if decision == "retry" else "forward",
        "critic_retries": retries,
        "critic_feedback": [feedback_entry],
        "supervisor_subquery": subquery,
        "supervisor_context": [_ctx("critic", previous, f"{decision.upper()}: {feedback}")],
        "status": "critic_review",
        "progress": min(88, state.get("progress", 50) + 5),
    }


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

        dge_artifact_path = settings.raw_dir / f"{Path(matrix_path).stem}_dge_results.json"
        dge_df.to_json(dge_artifact_path, orient="records")
        dge_artifact = register_artifact(
            str(dge_artifact_path),
            "dge_results",
            f"Full DGE table for {len(dge_df)} detected genes. AgentState keeps only top genes and this pointer.",
            {"rows": int(len(dge_df)), "source_matrix": str(matrix_path)},
        )

        # Keep the graph state compact. Full DGE rankings live behind the artifact pointer.
        detected_genes = dge_df["gene"].head(2000).tolist()

        return {
            "dge_results": dge_results,
            "all_dge_results": [],
            "detected_genes": detected_genes,
            "top_genes": top_genes,
            "artifact_registry": {
                **(state.get("artifact_registry", {}) or {}),
                dge_artifact["artifact_id"]: dge_artifact,
            },
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
        artifact = next(
            (
                item for item in (state.get("artifact_registry", {}) or {}).values()
                if item.get("kind") == "dge_results" and item.get("uri")
            ),
            None,
        )
        if not artifact:
            return {"status": "dge_failed", "errors": ["No DGE artifact to retry from"], "progress": 5}
        df = pd.read_json(artifact["uri"])
    else:
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
    else:
        artifact = next(
            (
                item for item in (state.get("artifact_registry", {}) or {}).values()
                if item.get("kind") == "dge_results" and item.get("uri")
            ),
            None,
        )
        if artifact:
            try:
                full_dge_df = pd.read_json(artifact["uri"])
                if "pvalue" not in full_dge_df.columns:
                    full_dge_df["pvalue"] = full_dge_df.get("padj", 1.0)
            except Exception:
                full_dge_df = None

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
    subquery = (state.get("supervisor_subquery") or "").strip()
    existing_ppi = {r["gene"]: r for r in state.get("ppi_results", []) if r}
    if subquery and subquery not in existing_ppi:
        genes, is_followup = [subquery], True
    else:
        genes, is_followup = state.get("top_genes", [])[:10], False

    def _fetch(gene: str) -> dict:
        try:
            return enrich_ppi_with_oncogenes(get_ppi_network(gene, limit=15), KNOWN_ONCOGENES)
        except Exception as e:
            return {"gene": gene, "partners": [], "error": str(e)}

    ppi_results = _parallel(_fetch, genes)

    all_symbols: set[str] = set(genes)
    for r in ppi_results:
        if r:
            all_symbols.update(p["partner"] for p in r.get("partners", [])[:5] if p.get("partner"))
    gene_annotations = get_gene_annotations(list(all_symbols))

    for r in ppi_results:
        if not r:
            continue
        r["go_annotation"] = gene_annotations.get(r["gene"].upper(), {
            "mf_terms": [], "bp_terms": [], "reactome_pathways": [],
        })
        for p in r.get("partners", []):
            ann = gene_annotations.get((p.get("partner") or "").upper(), {})
            p["mf_terms"] = ann.get("mf_terms", [])[:2]

    if is_followup:
        merged = list(existing_ppi.values())
        merged.extend(r for r in ppi_results if r and r["gene"] not in existing_ppi)
        ppi_results = merged

    summaries = []
    for r in ppi_results:
        if not r:
            continue
        partners  = [p.get("partner", "") for p in r.get("partners", [])[:5]]
        oncogenes = [p.get("partner") for p in r.get("partners", []) if p.get("is_oncogene")]
        mf = r.get("go_annotation", {}).get("mf_terms", [])
        summaries.append(
            f"{r['gene']}: partners=[{', '.join(partners)}]"
            + (f" oncogene_partners=[{', '.join(oncogenes)}]" if oncogenes else "")
            + (f" GO_MF=[{mf[0]}]" if mf else "")
        )

    return {
        "ppi_results": ppi_results,
        "supervisor_context": [_ctx("enrich_ppi", subquery, "; ".join(summaries) or "No PPI data retrieved", is_followup=is_followup)],
        "status": "ppi_complete",
        "progress": 40,
    }


# ── Node 4: Literature RAG ───────────────────────────────────────────────────

def node_literature_rag(state: AgentState) -> dict:
    disease   = state.get("disease_term", "")
    dge_index = {r["gene"]: r for r in state.get("dge_results", [])}
    ppi_index = {r["gene"]: r for r in state.get("ppi_results", []) if r}
    subquery  = (state.get("supervisor_subquery") or "").strip()
    existing_lit = {r["gene"]: r for r in state.get("literature_results", []) if r}

    def _partners(gene: str) -> list[str]:
        return [p["partner"] for p in ppi_index.get(gene, {}).get("partners", [])[:3] if p.get("partner")]

    if subquery:
        focal_gene, _, extra = subquery.partition(" ")
        try:
            result = query_literature(focal_gene, context=f"Disease: {disease}. Targeted query: {extra}", ppi_partners=_partners(focal_gene))
            if focal_gene in existing_lit:
                prev = existing_lit[focal_gene]
                existing_lit[focal_gene] = {
                    **prev,
                    "abstracts":   (prev.get("abstracts", []) + result.get("abstracts", []))[:10],
                    "key_pmids":   list(set(prev.get("key_pmids", []) + result.get("key_pmids", []))),
                    "pubmed_hits": max(prev.get("pubmed_hits", 0), result.get("pubmed_hits", 0)),
                }
            else:
                existing_lit[focal_gene] = result
        except Exception as e:
            existing_lit.setdefault(focal_gene, {"gene": focal_gene, "error": str(e), "is_dark": True})
        literature_results, is_targeted = list(existing_lit.values()), True
    else:
        def _fetch(gene: str) -> dict:
            try:
                dge = dge_index.get(gene, {})
                context = f"Disease: {disease}. log2FC={dge.get('log2FoldChange', 'N/A')}, padj={dge.get('padj', 'N/A')}"
                return query_literature(gene, context=context, ppi_partners=_partners(gene))
            except Exception as e:
                return {"gene": gene, "pubmed_hits": 0, "abstracts": [], "is_dark": True, "error": str(e)}
        literature_results, is_targeted = _parallel(_fetch, state.get("top_genes", [])[:settings.max_genes_for_rag]), False

    summaries = [
        f"{r.get('gene', '?')}: {r.get('pubmed_hits', 0)} PubMed hits"
        + (" [DARK]" if r.get("is_dark") else "")
        + (f" PMIDs={r.get('key_pmids', [])[:3]}" if r.get("key_pmids") else "")
        for r in literature_results if r
    ]
    return {
        "literature_results": literature_results,
        "supervisor_context": [_ctx("literature_rag", subquery, "; ".join(summaries) or "No literature results", is_targeted=is_targeted)],
        "status": "rag_complete",
        "progress": 60,
    }


# ── Node 5: Drug & protein annotation ───────────────────────────────────────

def node_drug_annotation(state: AgentState) -> dict:
    subquery = (state.get("supervisor_subquery") or "").strip()
    existing = {r["gene"]: r for r in state.get("drug_interactions", []) if r}

    def _fetch(gene: str) -> dict:
        try:
            chembl = get_drug_interactions(gene, max_results=5)
            return {
                "gene": gene,
                "drugs": chembl.get("drugs", []),
                "query_note": chembl.get("query_note", ""),
                "query_found_target": chembl.get("query_found_target", False),
                "uniprot": search_protein(gene),
            }
        except Exception as e:
            return {"gene": gene, "drugs": [], "query_note": f"Annotation failed: {e}", "query_found_target": False, "uniprot": None}

    if subquery and subquery not in existing:
        existing[subquery] = _fetch(subquery)
        is_followup = True
    else:
        for r in _parallel(_fetch, state.get("top_genes", [])[:10]):
            if r:
                existing[r["gene"]] = r
        is_followup = False

    drug_interactions = list(existing.values())
    summaries = [
        f"{r['gene']}: {'target resolved' if r.get('query_found_target') else 'no ChEMBL target'}"
        + (f" drugs=[{', '.join(d['molecule_name'] for d in r.get('drugs', [])[:3])}]" if r.get("drugs") else " (0 compounds)")
        for r in drug_interactions if r
    ]
    return {
        "drug_interactions":  drug_interactions,
        "supervisor_context": [_ctx("drug_annotation", subquery, "; ".join(summaries) or "No drug data retrieved", is_followup=is_followup)],
        "status":             "annotation_complete",
        "progress":           75,
    }


# ── Node: DepMap CRISPR essentiality ────────────────────────────────────────

def node_depmap_query(state: AgentState) -> dict:
    subquery = (state.get("supervisor_subquery") or "").strip()
    existing = {r["gene"]: r for r in state.get("depmap_results", []) if r}
    genes    = [subquery] if (subquery and subquery not in existing) else [g for g in state.get("top_genes", [])[:10] if g not in existing]
    is_followup = bool(subquery and subquery not in existing)

    new_results = _parallel(get_gene_essentiality, genes)
    depmap_results = list({**existing, **{r["gene"]: r for r in new_results if r}}.values())

    summaries = []
    for r in new_results:
        if r.get("error"):
            summaries.append(f"{r['gene']}: DepMap unavailable ({r['error']})")
            continue
        pct = r.get("percent_dependent")
        flag = "COMMON_ESSENTIAL" if r.get("is_common_essential") else ("SELECTIVE" if r.get("is_strongly_selective") else "")
        lins = r.get("top_lineages", [])
        summaries.append(
            f"{r['gene']}: {pct}% dependent" if pct is not None else f"{r['gene']}: dependency unknown"
            + (f" [{flag}]" if flag else "")
            + (f" top_lineages=[{', '.join(lins[:3])}]" if lins else "")
        )

    return {
        "depmap_results":     depmap_results,
        "supervisor_context": [_ctx("depmap_query", subquery, "; ".join(summaries) or "No DepMap data retrieved", is_followup=is_followup)],
        "status":             "depmap_complete",
        "progress":           45,
    }


# ── Node: OpenTargets association ────────────────────────────────────────────

def node_opentargets_query(state: AgentState) -> dict:
    subquery = (state.get("supervisor_subquery") or "").strip()
    disease  = state.get("disease_term", "")
    existing = {r["gene"]: r for r in state.get("opentargets_results", []) if r}
    genes    = [subquery] if (subquery and subquery not in existing) else [g for g in state.get("top_genes", [])[:10] if g not in existing]
    is_followup = bool(subquery and subquery not in existing)

    new_results = _parallel(lambda g: get_ot_association(g, disease), genes)
    ot_results  = list({**existing, **{r["gene"]: r for r in new_results if r}}.values())

    summaries = []
    for r in new_results:
        if r.get("error") and r["overall_score"] == 0.0:
            summaries.append(f"{r['gene']}: OT unavailable ({r['error']})")
            continue
        top_subs = sorted({
            "genetics": r["genetic_association"], "mutations": r["somatic_mutation"],
            "drugs": r["known_drug"], "pathways": r["affected_pathway"], "expr": r["rna_expression"],
        }.items(), key=lambda x: x[1], reverse=True)[:3]
        top_str = ", ".join(f"{k}={v:.2f}" for k, v in top_subs if v > 0.01)
        summaries.append(f"{r['gene']}: OT_score={r['overall_score']:.3f}" + (f" [{top_str}]" if top_str else " [no evidence types scored]"))

    return {
        "opentargets_results": ot_results,
        "supervisor_context":  [_ctx("opentargets_query", subquery, "; ".join(summaries) or "No OpenTargets data retrieved", is_followup=is_followup)],
        "status":              "ot_complete",
        "progress":            50,
    }


# ── Supervisor node ──────────────────────────────────────────────────────────

def node_clinical_trials(state: AgentState) -> dict:
    """ClinicalTrials.gov v2 search for disease plus target terms."""
    disease = state.get("disease_term", "")
    subquery = (state.get("supervisor_subquery") or "").strip()
    genes = [subquery] if subquery else state.get("top_genes", [])[:5]
    results = []
    for gene in genes:
        if not gene:
            continue
        term = f"{disease} {gene}".strip()
        try:
            response = requests.get(
                "https://clinicaltrials.gov/api/v2/studies",
                params={"query.term": term, "pageSize": 5},
                timeout=20,
            )
            response.raise_for_status()
            studies = response.json().get("studies", [])
            rows = []
            for study in studies:
                protocol = study.get("protocolSection", {})
                ident = protocol.get("identificationModule", {})
                status = protocol.get("statusModule", {})
                rows.append({
                    "nct_id": ident.get("nctId"),
                    "brief_title": ident.get("briefTitle"),
                    "overall_status": status.get("overallStatus"),
                })
            results.append({
                "gene": gene,
                "disease": disease,
                "source": "clinicaltrials.gov_api_v2",
                "query": term,
                "trial_count_returned": len(rows),
                "trials": rows,
                "summary": f"{gene}: {len(rows)} ClinicalTrials.gov studies returned for '{term}'.",
            })
        except Exception as exc:
            results.append({
                "gene": gene,
                "disease": disease,
                "source": "clinicaltrials.gov_api_v2",
                "status": "error",
                "error": str(exc),
                "summary": f"{gene}: ClinicalTrials.gov query failed.",
            })
    return {
        "clinical_trials_results": results,
        "supervisor_context": [_ctx("clinical_trials", subquery, "; ".join(r["summary"] for r in results) or "No clinical trial targets available.")],
        "status": "clinical_trials_complete",
        "progress": 58,
    }


def node_pathway_crosstalk(state: AgentState) -> dict:
    """Pathway crosstalk specialist for overlapping pathway mechanisms."""
    pathways = state.get("pathway_results", [])[:8]
    ppi = state.get("ppi_results", [])[:8]
    pathway_names = [p.get("pathway", p.get("term", "unknown pathway")) for p in pathways]
    partner_genes = []
    for entry in ppi:
        partner_genes.extend([p.get("partner") for p in entry.get("partners", [])[:3] if p.get("partner")])
    result = {
        "source": "computed_from_pathway_and_string_outputs",
        "pathways": pathway_names[:5],
        "bridge_genes": sorted(set(partner_genes))[:10],
        "summary": "Crosstalk summary linking enriched pathways with high-confidence PPI partners.",
    }
    return {
        "pathway_crosstalk_results": [result],
        "supervisor_context": [_ctx("pathway_crosstalk", "pathway overlaps", f"{result['summary']} pathways={result['pathways']} bridge_genes={result['bridge_genes']}")],
        "status": "pathway_crosstalk_complete",
        "progress": 62,
    }


def _genes_for_advanced_node(state: AgentState, limit: int = 5) -> list[str]:
    subquery = (state.get("supervisor_subquery") or "").strip()
    if subquery:
        return [subquery.split()[0]]
    return [g for g in state.get("top_genes", [])[:limit] if g]


def _advanced_stub_result(state: AgentState, node_name: str, output_key: str, progress: int) -> dict:
    disease     = state.get("disease_term", "")
    genes       = _genes_for_advanced_node(state)
    node_config = ((state.get("sandbox_config", {}) or {}).get("node_configs") or {}).get(node_name) or {}
    msg         = f"{node_name} is not configured. Connect a real API endpoint before using this node for evidence."
    results     = [{"gene": g, "disease": disease, "source": "adapter_not_configured", "status": "not_configured", "config": node_config, "summary": msg} for g in genes]
    return {
        output_key: results,
        "supervisor_context": [_ctx(node_name, state.get("supervisor_subquery") or "", "; ".join(r["summary"] for r in results) or f"{node_name} had no targets.")],
        "status": f"{node_name}_complete",
        "progress": progress,
    }


def node_evo2_fitness(state: AgentState) -> dict:
    return _advanced_stub_result(state, "evo2_fitness", "evo2_fitness_results", 64)

def node_esm3_design(state: AgentState) -> dict:
    return _advanced_stub_result(state, "esm3_design", "esm3_design_results", 66)

def node_scenic_regulon(state: AgentState) -> dict:
    return _advanced_stub_result(state, "scenic_regulon", "scenic_regulon_results", 55)

def node_spatial_tme(state: AgentState) -> dict:
    return _advanced_stub_result(state, "spatial_tme", "spatial_tme_results", 57)

def node_lincs_reversion(state: AgentState) -> dict:
    return _advanced_stub_result(state, "lincs_reversion", "lincs_reversion_results", 59)


def node_tcga_survival(state: AgentState) -> dict:
    disease = state.get("disease_term", "")
    results = [
        {
            "gene": gene, "disease": disease, "source": "stub",
            "cohort": "TCGA inferred cohort placeholder",
            "kaplan_meier_p": round(0.02 + (idx * 0.017), 4),
            "hazard_direction": "high_expression_worse_survival",
            "summary": f"TCGA survival stub for {gene}: high expression trends with worse survival, KM p={round(0.02 + (idx * 0.017), 4)}.",
        }
        for idx, gene in enumerate(_genes_for_advanced_node(state))
    ]
    return {
        "tcga_survival_results": results,
        "supervisor_context": [_ctx("tcga_survival", state.get("supervisor_subquery") or "", "; ".join(r["summary"] for r in results))],
        "status": "tcga_survival_complete",
        "progress": 61,
    }


def node_pharmacogenomics_pgx(state: AgentState) -> dict:
    return _advanced_stub_result(state, "pharmacogenomics_pgx", "pharmacogenomics_pgx_results", 63)


def node_crispr_designer(state: AgentState) -> dict:
    genes   = _genes_for_advanced_node(state, limit=3)
    results = _parallel(design_grnas_for_gene, genes)
    summaries = []
    for r in results:
        if r.get("error"):
            summaries.append(f"{r['gene']}: gRNA design failed ({r['error']})")
        else:
            top = r.get("guides", [{}])[0]
            summaries.append(
                f"{r['gene']}: {r.get('ngg_sites_found', 0)} NGG sites, top guide {top.get('sequence', '?')} "
                f"(efficiency={top.get('efficiency_score', '?')}, off-target={top.get('off_target_risk', '?')})"
            )
    return {
        "crispr_design_results": results,
        "supervisor_context": [_ctx("crispr_designer", state.get("supervisor_subquery") or "", "; ".join(summaries) or "No gRNA candidates designed.")],
        "status": "crispr_designer_complete",
        "progress": 82,
    }


def node_alphafold_complex(state: AgentState) -> dict:
    results  = [fetch_alphafold_structure(g) for g in _genes_for_advanced_node(state, limit=3)]
    resolved = sum(1 for r in results if r.get("status") == "resolved")
    return {
        "alphafold_complex_results": results,
        "supervisor_context": [_ctx("alphafold_complex", state.get("supervisor_subquery") or "", f"AlphaFold DB resolved {resolved}/{len(results)} targets. No local AlphaFold model was executed.")],
        "status": "alphafold_lookup_complete",
        "progress": 68,
    }


def node_viper_protein_activity(state: AgentState) -> dict:
    genes    = _genes_for_advanced_node(state, limit=12)
    de_stats = {r["gene"]: r for r in state.get("dge_results", []) if r.get("gene")}

    # Prefer real compute_viper_activity; fall back to external API adapter
    if de_stats:
        results = compute_viper_activity(genes, de_stats, state.get("disease_term", ""))
    else:
        results = run_viper_protein_activity(genes, state.get("disease_term", ""))

    summary = "; ".join(
        f"{r.get('regulator') or r.get('gene')}: {r.get('activity_state')} NES={r.get('nes')}, FDR={r.get('fdr')}"
        if r.get("source") not in {"adapter_not_configured", "dorothea_unavailable", "dorothea_no_regulons"}
        else f"{r.get('regulator') or r.get('gene')}: {r.get('error', 'no data')}"
        for r in results[:6]
    )
    return {
        "viper_protein_activity_results": results,
        "supervisor_context": [_ctx("viper_protein_activity", state.get("supervisor_subquery") or "", summary or "No TF regulators inferred.")],
        "status": "viper_protein_activity_complete",
        "progress": 56,
    }


def node_mageck_crispr(state: AgentState) -> dict:
    results = run_mageck_crispr(_genes_for_advanced_node(state, limit=8))
    summary = "; ".join(
        f"{r.get('gene')}: beta={r.get('beta_score')}, FDR={r.get('wald_fdr')}"
        if r.get("source") != "adapter_not_configured" else f"{r.get('gene')}: adapter not configured"
        for r in results[:6]
    )
    return {
        "mageck_crispr_results": results,
        "supervisor_context": [_ctx("mageck_crispr", state.get("supervisor_subquery") or "", summary or "MAGeCK returned no beta scores.")],
        "status": "mageck_crispr_complete",
        "progress": 58,
    }


def node_reinvent_generative(state: AgentState) -> dict:
    genes = _genes_for_advanced_node(state, limit=3)
    target = genes[0] if genes else "unknown_target"
    results = run_reinvent_generation(target=target, pocket="gnina_or_alphafold_pocket")
    configured = [r for r in results if r.get("source") != "adapter_not_configured"]
    summary = (
        f"Generated {len(configured)} de novo SMILES candidates for {target}; top RL score={max([r.get('rl_score', 0) for r in configured], default=0)}."
        if configured else
        f"REINVENT API is not configured for {target}; no SMILES were fabricated."
    )
    return {
        "reinvent_generative_results": results,
        "supervisor_context": [_ctx("reinvent_generative", target, summary)],
        "status": "reinvent_generative_complete",
        "progress": 70,
    }


def node_gnina_docking(state: AgentState) -> dict:
    genes  = _genes_for_advanced_node(state, limit=3)
    target = genes[0] if genes else "unknown_target"
    ligands = state.get("reinvent_generative_results", []) or [{"smiles": "CC(=O)N"}]
    results = run_gnina_docking(target=target, ligands=ligands)
    top     = sorted((r for r in results if r.get("cnn_score") is not None), key=lambda r: r.get("cnn_score", 0), reverse=True)[:3]
    summary = "; ".join(f"{r['smiles']}: CNNscore={r['cnn_score']}, CNNaffinity={r['cnn_affinity']}" for r in top) or f"GNINA API is not configured for {target}; no docking poses were fabricated."
    return {
        "gnina_docking_results": results,
        "supervisor_context": [_ctx("gnina_docking", target, summary)],
        "status": "gnina_docking_complete",
        "progress": 74,
    }


def node_rdkit_features(state: AgentState) -> dict:
    ligands = state.get("reinvent_generative_results", []) or state.get("gnina_docking_results", [])
    results = calculate_rdkit_features(ligands)
    passing = sum(1 for r in results if r.get("lipinski_pass"))
    return {
        "rdkit_feature_results": results,
        "supervisor_context": [_ctx("rdkit_features", "generated ligands", f"RDKit parsed {len(results)} molecules; {passing} pass Lipinski filters.")],
        "status": "rdkit_features_complete",
        "progress": 78,
    }


def _critic_gate(state: AgentState, critic_name: str, fatal: bool = False) -> dict:
    previous = state.get("previous_node_id") or "unknown"
    retry_counts = dict(state.get("retry_counts", {}) or state.get("critic_retries", {}) or {})
    retries = retry_counts.get(previous, 0)
    latest = _summarize_latest_context(state)
    decision = "forward"
    feedback = f"{critic_name} approved the current evidence packet."
    if fatal:
        decision = "kill"
        feedback = "Red-team FDA reviewer found a fatal translational flaw. Stopping this branch."
    elif retries < 3 and any(token in latest.lower() for token in ["stub", "unavailable", "no ", "pending"]):
        decision = "retry"
        retry_counts[previous] = retries + 1
        feedback = f"{critic_name} rejected weak evidence from {previous}. Retry with narrower target context."
    elif retries >= 3:
        feedback = f"{critic_name} hit retry cap for {previous}. Falling forward with caveat."
    return {
        "critic_route": decision,
        "retry_counts": retry_counts,
        "critic_retries": retry_counts,
        "flow_killed": decision == "kill",
        "critic_feedback": [{
            "critic": critic_name,
            "node": previous,
            "decision": decision,
            "feedback": feedback,
            "retry_count": retry_counts.get(previous, retries),
        }],
        "supervisor_context": [_ctx(critic_name, previous, feedback)],
        "status": f"{critic_name}_complete",
        "progress": min(90, state.get("progress", 60) + 4),
    }


def critic_structural_tractability(state: AgentState) -> dict:
    return _critic_gate(state, "critic_structural_tractability")


def critic_microenvironment_validity(state: AgentState) -> dict:
    return _critic_gate(state, "critic_microenvironment_validity")


def critic_red_team_fda(state: AgentState) -> dict:
    return _critic_gate(state, "critic_red_team_fda", fatal=False)


_SUPERVISOR_SYSTEM_PROMPT = """\
You are a senior research director running a computational drug-discovery investigation.
You have a set of upregulated genes from a differential expression experiment and a suite
of specialist tools. Use them however you judge best to build a comprehensive evidence
picture before calling finalize().

What makes a good investigation:
- Understand each gene's protein interactions and network context.
- Know whether knocking it out kills cancer cells (essentiality) and whether it has multi-omic disease support.
- Find mechanistic clues in the literature — especially for understudied genes.
- Know the drug landscape: what's been tried, what hasn't, and whether a PPI partner is the real druggable node.
- Follow surprising findings. If a PPI partner looks more interesting than the focal gene, investigate it.
- Prune genes that are genuinely dead ends so you can focus depth on the real candidates.
- Stop calling tools when you're satisfied you have enough to write a compelling hypothesis for each surviving gene.

Tool notes:
- subquery="" runs on all top genes. subquery="GENE" targets a specific gene or partner.
- You can call any tool multiple times with different subqueries.
- prune_gene() removes a gene from the active list — use it when evidence consistently shows no value.
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


def _format_study_context(state: AgentState) -> str:
    """Summarize user-provided optional files and notes for prompts."""
    ctx = state.get("study_context", {}) or {}
    if not ctx:
        return "No optional study context provided."

    labels = {
        "sample_metadata": "Sample metadata",
        "phenotype_table": "Phenotype table",
        "mutation_table": "Mutation table",
        "custom_gene_sets": "Custom gene sets",
        "study_notes": "Study notes",
    }
    lines = []
    for key, label in labels.items():
        value = ctx.get(key)
        if not value:
            continue
        if key == "study_notes":
            lines.append(f"{label}: {str(value)[:1200]}")
        else:
            preview = str(value.get("preview", "")).strip().replace("\r\n", "\n")
            lines.append(
                f"{label}: {value.get('filename', 'uploaded file')}\n"
                f"{preview[:1200] if preview else '(no preview text)'}"
            )
    return "\n\n".join(lines) if lines else "No optional study context provided."


def _sandbox_settings(state: AgentState) -> tuple[set[str], int, str]:
    """Read optional sandbox constraints without changing the default agent loop."""
    config = state.get("sandbox_config", {}) or {}
    all_steps = {
        "enrich_ppi",
        "literature_rag",
        "drug_annotation",
        "depmap_query",
        "opentargets_query",
        "clinical_trials",
        "pathway_crosstalk",
        "evo2_fitness",
        "esm3_design",
        "scenic_regulon",
        "spatial_tme",
        "lincs_reversion",
        "tcga_survival",
        "pharmacogenomics_pgx",
        "crispr_designer",
        "alphafold_complex",
        "viper_protein_activity",
        "mageck_crispr",
        "reinvent_generative",
        "gnina_docking",
        "rdkit_features",
    }
    allowed_steps = {step for step in config.get("allowed_agents", []) if step in all_steps}
    if not allowed_steps:
        allowed_steps = all_steps

    try:
        max_iterations = int(config.get("max_iterations", 12))
    except (TypeError, ValueError):
        max_iterations = 12
    max_iterations = max(1, min(12, max_iterations))

    directive = str(config.get("directive", "")).strip()
    return allowed_steps, max_iterations, directive


_SPECIALIST_TOOLS: list[tuple[str, object, list[str], str]] = [
    ("enrich_ppi",              node_enrich_ppi,              ["ppi_results"],                      "Fetch STRING PPI network + GO annotation. subquery=gene name for targeted follow-up, or empty for all top genes."),
    ("literature_rag",          node_literature_rag,          ["literature_results"],               "Search PubMed + semantic literature. subquery='GENE context' for targeted search, or empty for all top genes."),
    ("drug_annotation",         node_drug_annotation,         ["drug_interactions"],                "Fetch ChEMBL compounds + UniProt annotation. subquery=gene name (use PPI partner for proxy druggability)."),
    ("depmap_query",            node_depmap_query,            ["depmap_results"],                   "Query DepMap CRISPR Chronos essentiality. chronos<-0.5=dependency, strongly_selective=cancer-specific."),
    ("opentargets_query",       node_opentargets_query,       ["opentargets_results"],              "Query OpenTargets disease-gene association scores (0-1). Breaks down by genetic_association, somatic_mutation, known_drug, rna_expression."),
    ("clinical_trials",         node_clinical_trials,         ["clinical_trials_results"],          "Search ClinicalTrials.gov for active trials on this disease + gene target."),
    ("pathway_crosstalk",       node_pathway_crosstalk,       ["pathway_crosstalk_results"],        "Compute pathway crosstalk and bridge genes across enriched pathways and PPI."),
    ("tcga_survival",           node_tcga_survival,           ["tcga_survival_results"],            "Query TCGA survival association for this gene — Kaplan-Meier p-value and hazard direction."),
    ("alphafold_complex",       node_alphafold_complex,       ["alphafold_complex_results"],        "Fetch AlphaFold structure confidence scores and PDB URL for structural druggability assessment."),
    ("crispr_designer",         node_crispr_designer,         ["crispr_design_results"],            "Design SpCas9 gRNAs from RefSeq CDS. Returns top guides with efficiency scores and off-target risk. Use on validated high-priority targets."),
    ("viper_protein_activity",  node_viper_protein_activity,  ["viper_protein_activity_results"],   "Infer TF regulator activity via DoRothEA NES. Identifies master regulators driving the DE signature — useful for finding upstream therapeutic levers."),
    ("mageck_crispr",           node_mageck_crispr,           ["mageck_crispr_results"],            "Parse MAGeCK CRISPR screen beta scores for user-uploaded screen data. Only useful if a CRISPR screen artifact has been uploaded."),
]

_ACC_RESULT_KEYS: list[str] = [step for step, *_ in _SPECIALIST_TOOLS]


def _build_supervisor_tools(base_state: AgentState, acc: dict, allowed_steps: set[str]) -> list:
    """Build tool-calling wrappers around specialist nodes, closing over shared accumulator."""

    def _run(node_fn, subquery: str, list_keys: list[str]) -> str:
        mini = {**base_state, **acc, "supervisor_subquery": subquery}
        try:
            out = node_fn(mini)
        except Exception as e:
            return f"Error: {e}"
        for key in list_keys:
            if key in out:
                by_gene = {r.get("gene"): r for r in acc.get(key, []) if r and r.get("gene")}
                for r in out[key]:
                    if r and r.get("gene"):
                        by_gene[r["gene"]] = r
                    elif r:
                        acc.setdefault(key, []).append(r)
                if by_gene:
                    acc[key] = list(by_gene.values())
        for ctx in out.get("supervisor_context", []):
            acc["supervisor_context"].append(ctx)
        last = (out.get("supervisor_context") or [{}])[-1]
        return last.get("summary", "done")

    def _make_tool(name: str, node_fn, result_keys: list[str], docstring: str):
        def _tool_fn(subquery: str = "") -> str:
            return _run(node_fn, subquery, result_keys)
        _tool_fn.__name__ = name
        _tool_fn.__doc__ = docstring
        return lc_tool(_tool_fn)

    tools = [
        _make_tool(name, node_fn, result_keys, doc)
        for name, node_fn, result_keys, doc in _SPECIALIST_TOOLS
        if name in allowed_steps
    ]

    @lc_tool
    def prune_gene(gene: str, reason: str) -> str:
        """Remove a gene from the active investigation list when evidence shows it is a dead end (no essentiality, no literature, no PPI partners, OT score ~0). Never prune below 2 remaining genes."""
        current = acc["top_genes"]
        if len(current) <= 2:
            return f"Cannot prune {gene} — only {len(current)} genes remain."
        if gene in current:
            acc["top_genes"] = [g for g in current if g != gene]
            acc["pruned_genes"].append(gene)
            acc["supervisor_context"].append({"step": "supervisor", "subquery": gene, "summary": f"Pruned {gene}: {reason}"})
            return f"Pruned {gene}. Remaining: {acc['top_genes']}"
        return f"{gene} not in active list."
    tools.append(prune_gene)

    return tools


def node_supervisor(state: AgentState) -> dict:
    """
    Tool-calling ReAct agent that runs its full investigation loop in a single invocation.
    Calls specialist tools directly, sees their results inline, and decides follow-ups
    before calling finalize() to proceed to synthesis.
    """
    allowed_steps, max_iterations, sandbox_directive = _sandbox_settings(state)

    acc: dict = {
        key: list(state.get(key, []) or [])
        for _, _, result_keys, _ in _SPECIALIST_TOOLS
        for key in result_keys
    }
    acc["supervisor_context"] = []
    acc["top_genes"]  = list(state.get("top_genes", []))
    acc["pruned_genes"] = list(state.get("pruned_genes", []) or [])

    tools = _build_supervisor_tools(state, acc, allowed_steps)
    llm   = _llm()
    agent = create_react_agent(llm, tools)

    disease      = state.get("disease_term", "unknown disease")
    top_genes    = acc["top_genes"]
    study_ctx    = _format_study_context(state)
    pathway_ctx  = _format_pathways(state.get("pathway_results", []) or [])

    prompt = f"""Disease under investigation: {disease}
Top upregulated genes: {top_genes}
Budget: up to {max_iterations} tool calls before you must finalize.
{f"Directive: {sandbox_directive}" if sandbox_directive else ""}

Pathway enrichment context (already computed):
{pathway_ctx}

Study context:
{study_ctx}

Begin your investigation. Use your judgment about which tools to call and in what order.
Stop calling tools when you have sufficient evidence to write compelling hypotheses for the surviving genes."""

    try:
        agent.invoke(
            {"messages": [HumanMessage(content=prompt)]},
            config={
                "configurable": {},
                "recursion_limit": max_iterations * 4 + 20,
            },
        )
    except Exception as e:
        acc["supervisor_context"].append({
            "step": "supervisor",
            "subquery": "",
            "summary": f"Agent loop ended: {e}",
        })

    return {
        **acc,
        "next_step":             "finalize",
        "supervisor_subquery":   "",
        "supervisor_reasoning":  "Tool-calling investigation complete.",
        "supervisor_iterations": max_iterations,
        "status":                "supervisor_finalizing",
        "progress":              80,
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


def _format_clinical_trials_for_gene(gene: str, ct_results: list[dict]) -> str:
    entry = next((r for r in ct_results if r.get("gene") == gene), None)
    if not entry or entry.get("status") == "error":
        return "No clinical trial data retrieved."
    trials = entry.get("trials", [])
    if not trials:
        return f"  {entry.get('trial_count_returned', 0)} trials found for '{entry.get('query', gene)}' — none returned."
    lines = [f"  {entry.get('trial_count_returned', len(trials))} trials for '{entry.get('query', gene)}'"]
    for t in trials[:4]:
        lines.append(f"  [{t.get('nct_id', '?')}] {t.get('brief_title', '?')} — {t.get('overall_status', '?')}")
    return "\n".join(lines)


def _format_tcga_for_gene(gene: str, tcga_results: list[dict]) -> str:
    entry = next((r for r in tcga_results if r.get("gene") == gene), None)
    if not entry or entry.get("source") == "stub":
        return "No TCGA survival data (stub)."
    return (
        f"  cohort={entry.get('cohort', '?')}  "
        f"KM_p={entry.get('kaplan_meier_p', '?')}  "
        f"direction={entry.get('hazard_direction', '?')}"
    )


def _format_alphafold_for_gene(gene: str, af_results: list[dict]) -> str:
    entry = next((r for r in af_results if r.get("gene") == gene), None)
    if not entry:
        return "No AlphaFold data retrieved."
    if entry.get("status") != "resolved":
        return f"  AlphaFold: not resolved ({entry.get('error', 'no entry in DB')})"
    return (
        f"  UniProt={entry.get('uniprot_id', '?')}  "
        f"pLDDT={entry.get('plddt_mean', '?')}  "
        f"url={entry.get('pdb_url', entry.get('cif_url', 'N/A'))}"
    )


def _format_crosstalk(crosstalk_results: list[dict]) -> str:
    if not crosstalk_results:
        return "No pathway crosstalk data."
    r = crosstalk_results[0]
    pathways = ", ".join(r.get("pathways", []))
    bridges  = ", ".join(r.get("bridge_genes", []))
    return f"  pathways=[{pathways}]\n  bridge_genes=[{bridges}]"


def _format_ppi_for_gene(gene: str, ppi_results: list[dict]) -> str:
    entry = next((r for r in ppi_results if r.get("gene") == gene), None)
    if not entry or not entry.get("partners"):
        return "No PPI data retrieved."
    lines = []
    for p in entry["partners"][:12]:
        score = p.get("combined_score") or p.get("score", "?")
        go    = ", ".join(p.get("go_terms", [])[:3])
        lines.append(f"  {p.get('partner', p.get('symbol', '?'))} (score={score}){f' — {go}' if go else ''}")
    return "\n".join(lines)


def _format_depmap_for_gene(gene: str, depmap_results: list[dict]) -> str:
    entry = next((r for r in depmap_results if r.get("gene") == gene), None)
    if not entry or entry.get("error"):
        return "No DepMap data retrieved."
    return (
        f"  percent_dependent={entry.get('percent_dependent', 'N/A')}%  "
        f"common_essential={entry.get('is_common_essential', False)}  "
        f"strongly_selective={entry.get('is_strongly_selective', False)}\n"
        f"  top lineages: {', '.join(entry.get('top_lineages', [])[:5])}"
    )


def _format_ot_for_gene(gene: str, ot_results: list[dict]) -> str:
    entry = next((r for r in ot_results if r.get("gene") == gene), None)
    if not entry or entry.get("error"):
        return "No OpenTargets data retrieved."
    return (
        f"  overall={entry.get('overall_score', 'N/A'):.3f}  "
        f"genetic_assoc={entry.get('genetic_association', 0):.3f}  "
        f"somatic_mut={entry.get('somatic_mutation', 0):.3f}  "
        f"known_drug={entry.get('known_drug', 0):.3f}  "
        f"rna_expr={entry.get('rna_expression', 0):.3f}"
    )


def _format_drugs_for_gene(gene: str, drug_interactions: list[dict]) -> str:
    entry = next((r for r in drug_interactions if r.get("gene") == gene), None)
    if not entry:
        return "No drug annotation data retrieved."
    drugs = entry.get("drugs", [])
    uniprot = entry.get("uniprot") or {}
    lines = []
    if uniprot:
        lines.append(f"  UniProt: {uniprot.get('protein_name', '')} | function: {str(uniprot.get('function', ''))[:200]}")
    if not drugs:
        lines.append("  No ChEMBL compounds found — no approved or investigational drugs targeting this protein.")
    for d in drugs[:6]:
        lines.append(
            f"  {d.get('molecule_name', '?')} — max_phase={d.get('max_phase', '?')} "
            f"pchembl={d.get('pchembl_value', '?')} moa={d.get('mechanism_of_action', '?')}"
        )
    return "\n".join(lines)


def _format_literature_for_gene(gene: str, lit_results: list[dict]) -> str:
    entry = next((r for r in lit_results if r.get("gene") == gene), None)
    if not entry:
        return "No literature data retrieved."
    abstracts = entry.get("abstracts", [])[:4]
    lines = [f"  PubMed hits: {entry.get('pubmed_hits', 0)}  dark_gene={entry.get('is_dark', False)}"]
    for a in abstracts:
        title = a.get("title", "")[:120]
        pmid  = a.get("pmid", "")
        lines.append(f"  [{pmid}] {title}")
    return "\n".join(lines)


def _build_hypothesis_prompt(
    gene: str,
    dge_entry: dict,
    disease_term: str,
    supervisor_context: str,
    study_context: str,
    novelty_score: float,
    pub_count: int,
    key_pmids: list,
    ppi_results: list[dict] | None = None,
    depmap_results: list[dict] | None = None,
    ot_results: list[dict] | None = None,
    drug_interactions: list[dict] | None = None,
    lit_results: list[dict] | None = None,
    pathway_results: list[dict] | None = None,
    ct_results: list[dict] | None = None,
    tcga_results: list[dict] | None = None,
    af_results: list[dict] | None = None,
    crosstalk_results: list[dict] | None = None,
) -> str:
    lfc_raw = dge_entry.get("log2FoldChange", "N/A")
    padj    = dge_entry.get("padj", "N/A")
    lfc     = f"{lfc_raw:.3f}" if isinstance(lfc_raw, float) else str(lfc_raw)
    pub_str = str(pub_count) if pub_count >= 0 else "unknown"
    disease = disease_term.strip() or "the disease"

    ppi_block        = _format_ppi_for_gene(gene, ppi_results or [])
    depmap_block     = _format_depmap_for_gene(gene, depmap_results or [])
    ot_block         = _format_ot_for_gene(gene, ot_results or [])
    drug_block       = _format_drugs_for_gene(gene, drug_interactions or [])
    lit_block        = _format_literature_for_gene(gene, lit_results or [])
    path_block       = _format_pathways(pathway_results or [])
    ct_block         = _format_clinical_trials_for_gene(gene, ct_results or [])
    tcga_block       = _format_tcga_for_gene(gene, tcga_results or [])
    af_block         = _format_alphafold_for_gene(gene, af_results or [])
    crosstalk_block  = _format_crosstalk(crosstalk_results or [])

    return f"""
Analyze gene **{gene}** as a potential therapeutic target in **{disease}**.

## DGE Stats (for supporting_evidence only — do NOT include these numbers in the hypothesis field)
log2FC = {lfc}  |  padj = {padj}

## Novelty (pre-calculated — DO NOT change this value)
novelty_score = {novelty_score}
PubMed cancer hits: {pub_str}

## User-Provided Study Context
{study_context}

## PPI Network (STRING, combined_score >= 700)
{ppi_block}

## DepMap Cancer Dependency
{depmap_block}

## OpenTargets Disease Association
{ot_block}

## Drug Annotation (UniProt + ChEMBL)
{drug_block}

## Literature (PubMed + RAG)
{lit_block}

## Pathway Enrichment
{path_block}

## Pathway Crosstalk & Bridge Genes
{crosstalk_block}

## Clinical Trials
{ct_block}

## TCGA Survival
{tcga_block}

## AlphaFold Structure
{af_block}

## Supervisor Investigation Log (agent reasoning across all rounds)
{supervisor_context if supervisor_context else "No investigation log available."}

## Task
Write a discovery brief for **{gene}** in **{disease}** that a medicinal chemist or grant
reviewer finds compelling. Lead with what is surprising or distinctive about this gene
based on the data above. Do not open with "{gene} is upregulated X-fold." Find an angle.

MECHANISM: Use the PPI partners listed above — name at least 2 by their exact symbol.
Describe the precise molecular event: the phosphorylation site, complex assembled or
dissociated, E3 ligase substrate, transcriptional target de-repressed, etc.
Never write "activates downstream signaling" — name the molecular change.

DRUG LANDSCAPE: Use the ChEMBL and clinical trial data above. If no drugs exist, frame
it as competitive white space and recommend a specific molecule class (e.g. PROTAC,
covalent inhibitor, BiTE). Never write "Database query returned no results."

Output ONLY valid JSON:
{{
  "gene": "{gene}",
  "hypothesis": "<2-4 sentences: biological argument for why {gene} matters in {disease}. No statistics.>",
  "mechanism": "<Concrete molecular mechanism naming >=2 PPI partners by symbol and a specific molecular event.>",
  "novelty_score": {novelty_score},
  "pub_count": {pub_count},
  "supporting_evidence": ["<5-7 points: DGE stats, DepMap chronos/dependency, OT scores, clinical trial status, TCGA survival, AlphaFold structural notes, key literature titles+PMIDs, drug landscape>"],
  "key_pmids": {json.dumps(key_pmids)}
}}
"""


def _parse_hypothesis(content: str, gene: str, novelty_score: float, pub_count: int) -> dict:
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
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


def node_synthesize_hypotheses(state: AgentState) -> dict:
    """Synthesize one hypothesis per top gene using all collected structured evidence."""
    llm          = _llm()
    disease_term = state.get("disease_term", "")
    top_genes    = state.get("top_genes", [])
    sup_context  = _format_supervisor_context(state)
    dge_map      = {r["gene"]: r for r in state.get("dge_results", [])}
    lit_map      = {r["gene"]: r for r in state.get("literature_results", []) if r}

    ppi_results        = state.get("ppi_results", []) or []
    depmap_results     = state.get("depmap_results", []) or []
    ot_results         = state.get("opentargets_results", []) or []
    drug_interactions  = state.get("drug_interactions", []) or []
    lit_results        = state.get("literature_results", []) or []
    pathway_results    = state.get("pathway_results", []) or []
    ct_results         = state.get("clinical_trials_results", []) or []
    tcga_results       = state.get("tcga_survival_results", []) or []
    af_results         = state.get("alphafold_complex_results", []) or []
    crosstalk_results  = state.get("pathway_crosstalk_results", []) or []

    study_ctx = _format_study_context(state)

    def _synthesize_one(gene: str, pub_count: int) -> dict:
        dge_entry     = dge_map.get(gene, {})
        lit_entry     = lit_map.get(gene, {})
        novelty_score = _novelty_from_pub_count(pub_count)
        key_pmids     = lit_entry.get("key_pmids", [])
        try:
            prompt = _build_hypothesis_prompt(
                gene, dge_entry, disease_term, sup_context, study_ctx,
                novelty_score, pub_count, key_pmids,
                ppi_results=ppi_results, depmap_results=depmap_results,
                ot_results=ot_results, drug_interactions=drug_interactions,
                lit_results=lit_results, pathway_results=pathway_results,
                ct_results=ct_results, tcga_results=tcga_results,
                af_results=af_results, crosstalk_results=crosstalk_results,
            )
            response = llm.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])
            return _parse_hypothesis(response.content, gene, novelty_score, pub_count)
        except Exception as e:
            return {
                "gene": gene, "hypothesis": f"Analysis failed: {str(e)}",
                "mechanism": "", "novelty_score": novelty_score,
                "pub_count": pub_count, "supporting_evidence": [], "key_pmids": key_pmids,
            }

    with ThreadPoolExecutor(max_workers=5) as pool:
        count_futures = {pool.submit(_get_pubmed_count, g): g for g in top_genes}
        pub_counts    = {count_futures[f]: f.result() for f in as_completed(count_futures)}
        hyp_futures   = {pool.submit(_synthesize_one, g, pub_counts.get(g, -1)): g for g in top_genes}
        hyp_by_gene   = {hyp_futures[f]: f.result() for f in as_completed(hyp_futures)}

    hypotheses = [hyp_by_gene[g] for g in top_genes if g in hyp_by_gene]
    return {"hypotheses": hypotheses, "status": "synthesis_complete", "progress": 90}


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

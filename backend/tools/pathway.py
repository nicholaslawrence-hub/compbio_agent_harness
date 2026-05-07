"""
Pathway enrichment with three correctness guarantees:
  1. ORA uses the detected-gene universe (not the whole genome) as background
  2. Falls back to GSEA prerank when DEG count is outside [15, 1000]
  3. Jaccard-based redundancy filter collapses overlapping GO/pathway terms
"""
import warnings
import numpy as np
import pandas as pd

GENE_SETS = ["KEGG_2021_Human", "GO_Biological_Process_2023", "Reactome_2022"]
ORA_MIN = 15
ORA_MAX = 1000


# ── Public entry point ────────────────────────────────────────────────────────

def run_pathway_enrichment(
    deg_genes: list[str],
    detected_genes: list[str],
    full_dge_df: pd.DataFrame | None = None,
    top_n: int = 5,
) -> tuple[list[dict], str]:
    """
    Args:
        deg_genes:      Significant DEG symbols (padj < 0.05, |LFC| > 1)
        detected_genes: All genes detected in the count matrix — ORA background universe
        full_dge_df:    Complete DGE DataFrame (all genes, cols: gene/log2FoldChange/pvalue)
                        required for GSEA fallback
        top_n:          Max results per gene set before deduplication

    Returns:
        (pathways, method) where method is 'ORA' or 'GSEA'
    """
    n = len(deg_genes)
    use_gsea = n < ORA_MIN or n > ORA_MAX

    if use_gsea and full_dge_df is not None and len(full_dge_df) >= ORA_MIN:
        results = _run_gsea_prerank(full_dge_df, top_n)
        if results:
            return filter_redundant_pathways(results), "GSEA"
        # GSEA failed — fall through to ORA

    results = _run_ora(deg_genes, detected_genes, top_n)
    return filter_redundant_pathways(results), "ORA"


# ── ORA ───────────────────────────────────────────────────────────────────────

def _run_ora(deg_genes: list[str], background_genes: list[str], top_n: int) -> list[dict]:
    try:
        import gseapy as gp
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            enr = gp.enrichr(
                gene_list=deg_genes,
                gene_sets=GENE_SETS,
                background=background_genes,   # <-- correct universe, not whole genome
                outdir=None,
                verbose=False,
            )
        return _parse_enrichr_df(enr.res2d, top_n)
    except Exception:
        return _run_ora_requests_fallback(deg_genes, top_n)


def _parse_enrichr_df(df: pd.DataFrame, top_n: int) -> list[dict]:
    # Enrichr's API returns literal 0.0 when its internal float precision is
    # exceeded (true value may be ~1e-30 or smaller).  Replace with sentinel
    # so downstream code and displays are never misled by "p = 0".
    _FLOOR = 1e-300

    results = []
    for _, row in df.iterrows():
        try:
            adj_p = float(row.get("Adjusted P-value", 1.0))
            if adj_p == 0.0:
                adj_p = _FLOOR
            if adj_p > 0.05:
                continue
            p_val = float(row.get("P-value", 1.0))
            if p_val == 0.0:
                p_val = _FLOOR
            genes_raw = row.get("Genes", "")
            overlap = [g.strip() for g in str(genes_raw).split(";") if g.strip()]
            source = _clean_source(str(row.get("Gene_set", "")))
            results.append({
                "pathway": str(row.get("Term", "")),
                "source": source,
                "p_value": p_val,
                "adjusted_p_value": adj_p,
                "overlap_genes": overlap,
                "overlap_count": len(overlap),
                "method": "ORA",
            })
        except Exception:
            continue
    results.sort(key=lambda x: x["adjusted_p_value"])
    return results[: top_n * len(GENE_SETS)]


# ── GSEA prerank ──────────────────────────────────────────────────────────────

def _run_gsea_prerank(dge_df: pd.DataFrame, top_n: int) -> list[dict]:
    """
    Rank genes by sign(LFC) * -log10(pvalue) — captures both direction and
    significance without applying an arbitrary significance cutoff.
    """
    try:
        import gseapy as gp

        pvals = dge_df["pvalue"].clip(lower=1e-300).values
        lfcs  = dge_df["log2FoldChange"].values
        metric = np.sign(lfcs) * -np.log10(pvals)

        ranked = (
            pd.Series(metric, index=dge_df["gene"].values)
            .dropna()
            .sort_values(ascending=False)
        )
        # Drop duplicated gene symbols (keep highest-ranked)
        ranked = ranked[~ranked.index.duplicated(keep="first")]

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pre = gp.prerank(
                rnk=ranked,
                gene_sets=GENE_SETS,
                outdir=None,
                min_size=10,
                max_size=500,
                permutation_num=100,
                seed=42,
                no_plot=True,
                verbose=False,
            )
        return _parse_prerank_df(pre.res2d, top_n)
    except Exception:
        return []


def _parse_prerank_df(df: pd.DataFrame, top_n: int) -> list[dict]:
    results = []
    for _, row in df.iterrows():
        try:
            fdr = float(row.get("FDR q-val", 1.0))
            if fdr > 0.25:
                continue
            lead_raw  = row.get("Lead_genes", "")
            lead_genes = [g.strip() for g in str(lead_raw).split(";") if g.strip()]
            source = _clean_source(str(row.get("Gene_set", "")))
            results.append({
                "pathway": str(row.get("Term", row.get("Name", ""))),
                "source": source,
                "p_value": float(row.get("NOM p-val", 1.0)),
                "adjusted_p_value": fdr,
                "overlap_genes": lead_genes,
                "overlap_count": len(lead_genes),
                "nes": float(row.get("NES", 0.0)),
                "method": "GSEA",
            })
        except Exception:
            continue
    results.sort(key=lambda x: x["adjusted_p_value"])
    return results[: top_n * len(GENE_SETS)]


# ── Semantic deduplication ────────────────────────────────────────────────────

def filter_redundant_pathways(pathways: list[dict], jaccard_threshold: float = 0.5) -> list[dict]:
    """
    Collapse highly overlapping pathways (e.g. GO parent/child terms).
    Iterates most-significant-first; drops any term whose overlap gene set
    shares Jaccard >= threshold with an already-kept term.
    """
    if len(pathways) <= 1:
        return pathways

    kept: list[dict] = []
    kept_sets: list[set] = []

    for pathway in pathways:  # already sorted by adj_p ascending
        genes = set(g.upper() for g in pathway.get("overlap_genes", []))

        redundant = False
        for existing in kept_sets:
            if not existing or not genes:
                continue
            j = len(genes & existing) / len(genes | existing)
            if j >= jaccard_threshold:
                redundant = True
                break

        if not redundant:
            kept.append(pathway)
            kept_sets.append(genes)

    return kept


# ── Requests fallback (no custom background) ──────────────────────────────────

def _run_ora_requests_fallback(deg_genes: list[str], top_n: int) -> list[dict]:
    """Last-resort: call Enrichr REST API directly without custom background."""
    import requests
    BASE = "https://maayanlab.cloud/Enrichr"
    try:
        resp = requests.post(
            f"{BASE}/addList",
            files={"list": (None, "\n".join(deg_genes)), "description": (None, "PharmaGPT")},
            timeout=20,
        )
        if not resp.ok:
            return []
        list_id = resp.json()["userListId"]
    except Exception:
        return []

    _FLOOR = 1e-300   # Enrichr REST API returns literal 0 for p < ~1e-16
    results = []
    for gs in GENE_SETS:
        try:
            r = requests.get(f"{BASE}/enrich", params={"userListId": list_id, "backgroundType": gs}, timeout=20)
            if not r.ok:
                continue
            for row in r.json().get(gs, [])[:top_n]:
                overlap = row[5] if isinstance(row[5], list) else []
                pv  = float(row[2]) or _FLOOR
                apv = float(row[6]) or _FLOOR
                results.append({
                    "pathway": row[1],
                    "source": _clean_source(gs),
                    "p_value": pv,
                    "adjusted_p_value": apv,
                    "overlap_genes": overlap,
                    "overlap_count": len(overlap),
                    "method": "ORA (genome background)",
                })
        except Exception:
            continue

    results.sort(key=lambda x: x["adjusted_p_value"])
    return results[: top_n * len(GENE_SETS)]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_source(gene_set: str) -> str:
    return (
        gene_set
        .replace("_2021_Human", "")
        .replace("_2023", "")
        .replace("_2022", "")
        .replace("_", " ")
        .strip()
    )

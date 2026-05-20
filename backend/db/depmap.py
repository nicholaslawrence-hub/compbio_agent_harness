"""DepMap CRISPR essentiality via the DepMap Portal public REST API.

Two-stage approach:
  1. GET /download/gene_dep_summary  → summary CSV (all genes, all datasets)
     Columns: Entrez Id, Gene, Dataset, Dependent Cell Lines,
              Cell Lines with Data, Strongly Selective, Common Essential
     We cache this once per process and filter client-side.

  2. POST /download/custom           → per-cell-line effect scores for one gene
     Used when the summary row for a gene is missing (rare / newly added genes).
     Dataset ID: breadbox/a2a0a725-b585-40c8-8c45-a924f8178656
                 (CRISPR DepMap Public 26Q1+Score, Chronos)
"""
import io
import requests
import pandas as pd
from functools import lru_cache

_BASE    = "https://depmap.org/portal/api"
_TIMEOUT = 30
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; RNAgent/1.0)",
    "Accept":     "text/csv,application/json",
    "Referer":    "https://depmap.org/portal/",
}

# CRISPR Chronos dataset ID from the DepMap download catalogue
_CHRONOS_DATASET_ID = "breadbox/a2a0a725-b585-40c8-8c45-a924f8178656"

# Keywords that identify CRISPR rows in the gene_dep_summary CSV
_CRISPR_KEYWORDS = {"crispr", "chronos", "crisprgeneffect", "omicsgeneffect"}

_SESSION = requests.Session()
_SESSION.headers.update(_HEADERS)

# Module-level cache for the summary DataFrame (fetched once per process)
_SUMMARY_DF: pd.DataFrame | None = None


def _load_summary_df() -> pd.DataFrame | None:
    """Fetch and cache the gene dependency summary CSV."""
    global _SUMMARY_DF
    if _SUMMARY_DF is not None:
        return _SUMMARY_DF
    try:
        r = _SESSION.get(f"{_BASE}/download/gene_dep_summary", timeout=_TIMEOUT)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        # Normalise column names: lowercase + strip
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        _SUMMARY_DF = df
        return df
    except Exception:
        return None


def _find_crispr_row(df: pd.DataFrame, symbol: str) -> pd.Series | None:
    """Return the CRISPR/Chronos row for a gene from the summary DataFrame."""
    gene_col = "gene" if "gene" in df.columns else df.columns[1]
    rows = df[df[gene_col].str.upper() == symbol.upper()]
    if rows.empty:
        return None

    # Try to pick the CRISPR row
    dataset_col = "dataset" if "dataset" in df.columns else None
    if dataset_col:
        for _, row in rows.iterrows():
            ds_val = str(row.get(dataset_col, "")).lower().replace("_", "")
            if any(kw in ds_val for kw in _CRISPR_KEYWORDS):
                return row

    # If only one row, return it regardless of dataset label
    if len(rows) == 1:
        return rows.iloc[0]

    # Fall back to the first row
    return rows.iloc[0]


def _from_summary_row(symbol: str, row: pd.Series) -> dict:
    """Build a result dict from a gene_dep_summary row."""
    dep_lines  = _int_or_none(row.get("dependent_cell_lines"))
    total_lines = _int_or_none(row.get("cell_lines_with_data"))
    pct = round(dep_lines / total_lines * 100, 1) if dep_lines is not None and total_lines else None

    return {
        "gene":                  symbol,
        "percent_dependent":     pct,
        "dependent_cell_lines":  dep_lines,
        "total_cell_lines":      total_lines,
        "is_common_essential":   _bool(row.get("common_essential")),
        "is_strongly_selective": _bool(row.get("strongly_selective")),
        "top_lineages":          [],
        "n_cell_lines":          total_lines,
        "source":                "depmap_summary",
        "error":                 None,
    }


def _from_custom_download(symbol: str) -> dict | None:
    """
    Fetch per-cell-line Chronos scores for one gene via POST /download/custom
    and compute summary statistics.
    """
    try:
        r = _SESSION.post(
            f"{_BASE}/download/custom",
            params={
                "datasetId":           _CHRONOS_DATASET_ID,
                "featureLabels":       symbol,
                "addCellLineMetadata": "true",
            },
            timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        df = pd.read_csv(io.StringIO(r.text))
        # Find the gene column (case-insensitive)
        gene_col = next((c for c in df.columns if c.upper() == symbol.upper()), None)
        if not gene_col:
            return None
        scores = df[gene_col].dropna().tolist()
        if not scores:
            return None
        return _compute_from_scores(symbol, scores, df)
    except Exception:
        return None


def _compute_from_scores(symbol: str, scores: list[float], df: pd.DataFrame) -> dict:
    """Derive summary statistics from a list of Chronos effect scores."""
    n_dep  = sum(1 for s in scores if s < -0.5)
    pct    = round(n_dep / len(scores) * 100, 1)

    # Extract top lineages if metadata columns are present
    lineage_col = next((c for c in df.columns if "lineage" in c.lower()), None)
    top_lins: list[str] = []
    if lineage_col:
        gene_col = next((c for c in df.columns if c.upper() == symbol.upper()), None)
        if gene_col:
            lin_df = df[[lineage_col, gene_col]].dropna()
            lin_means = lin_df.groupby(lineage_col)[gene_col].mean().sort_values()
            top_lins = lin_means.index.tolist()[:5]

    return {
        "gene":                  symbol,
        "percent_dependent":     pct,
        "dependent_cell_lines":  n_dep,
        "total_cell_lines":      len(scores),
        "is_common_essential":   pct > 90,
        "is_strongly_selective": 10 < pct <= 60,
        "top_lineages":          top_lins,
        "n_cell_lines":          len(scores),
        "source":                "depmap_custom",
        "error":                 None,
    }


@lru_cache(maxsize=512)
def get_gene_essentiality(gene_symbol: str) -> dict:
    """
    Return CRISPR Chronos essentiality data for a gene from DepMap.

    Score interpretation:
      is_strongly_selective → essential in a cancer-type subset (best target profile)
      is_common_essential   → essential in all lines (on-target toxicity concern)
      percent_dependent     → % of cell lines with Chronos score < -0.5
    """
    symbol = gene_symbol.strip().upper()

    # ── Stage 1: summary CSV (fast, 26Q1 Chronos_Combined) ───────────────────
    df = _load_summary_df()
    if df is not None:
        row = _find_crispr_row(df, symbol)
        if row is not None:
            return _from_summary_row(symbol, row)

    # ── Stage 2: per-cell-line custom download (fallback for genes not in summary) ──
    result = _from_custom_download(symbol)
    if result:
        return result

    return _error_result(symbol, "DepMap data unavailable for this gene")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes")
    return bool(v)


def _int_or_none(v) -> int | None:
    try:
        s = str(v).strip()
        if not s or s.lower() == "nan":
            return None
        return int(float(s))  # handles "7.0" from CSV floats
    except (ValueError, TypeError):
        return None


def _error_result(symbol: str, error: str) -> dict:
    return {
        "gene":                  symbol,
        "percent_dependent":     None,
        "dependent_cell_lines":  None,
        "total_cell_lines":      None,
        "is_common_essential":   False,
        "is_strongly_selective": False,
        "top_lineages":          [],
        "n_cell_lines":          None,
        "source":                "depmap",
        "error":                 error,
    }

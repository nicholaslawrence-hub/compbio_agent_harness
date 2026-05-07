"""DepMap CRISPR essentiality queries via the DepMap Portal API."""
import requests
from functools import lru_cache

_BASE    = "https://depmap.org/portal/api"
_TIMEOUT = 15


@lru_cache(maxsize=512)
def get_gene_essentiality(gene_symbol: str) -> dict:
    """
    Return CRISPR Chronos essentiality data for a gene from DepMap.

    Interpretation guide:
      mean_chronos < -1.0  → strong common essential (proteasome-like; broad toxicity risk)
      mean_chronos < -0.5  → solid cancer dependency
      mean_chronos > -0.1  → not essential in most lines
      is_strongly_selective → essential in a cancer-type subset (best drug target profile)
      is_common_essential   → essential everywhere (on-target toxicity concern)
    """
    symbol = gene_symbol.strip().upper()

    # ── Primary: summary_stats endpoint ──────────────────────────────────────
    try:
        r = requests.get(
            f"{_BASE}/gene/summary_stats",
            params={"gene_name": symbol, "dataset_id": "Chronos_Combined"},
            timeout=_TIMEOUT,
        )
        if r.status_code == 200:
            d = r.json()
            # Some API versions return top_lineages, some don't
            lineages = d.get("top_lineages") or d.get("lineages") or []
            return {
                "gene":                 symbol,
                "mean_chronos":         _safe_round(d.get("mean") or d.get("mean_chronos")),
                "percent_dependent":    _safe_round(d.get("percent_dependent")),
                "is_common_essential":  bool(d.get("common_essential", False)),
                "is_strongly_selective":bool(d.get("strongly_selective", False)),
                "top_lineages":         lineages[:5],
                "n_cell_lines":         d.get("n_lines") or d.get("count"),
                "source":               "depmap_summary",
                "error":                None,
            }
    except Exception:
        pass

    # ── Fallback: raw per-cell-line essentiality ───────────────────────────
    try:
        r = requests.get(
            f"{_BASE}/gene/gene_essentiality",
            params={"gene_name": symbol},
            timeout=_TIMEOUT,
        )
        if r.status_code == 200:
            rows = r.json()
            if isinstance(rows, list) and rows:
                return _compute_from_raw(symbol, rows)
    except Exception:
        pass

    # ── Second fallback: gene info endpoint (basic flags only) ─────────────
    try:
        r = requests.get(
            f"{_BASE}/gene/",
            params={"gene_name": symbol},
            timeout=_TIMEOUT,
        )
        if r.status_code == 200:
            d = r.json()
            return {
                "gene":                 symbol,
                "mean_chronos":         None,
                "percent_dependent":    None,
                "is_common_essential":  bool(d.get("is_common_essential", False)),
                "is_strongly_selective":bool(d.get("is_strongly_selective", False)),
                "top_lineages":         [],
                "n_cell_lines":         None,
                "source":               "depmap_info",
                "error":                None,
            }
    except Exception:
        pass

    return _error_result(symbol, "DepMap API unavailable or gene not found")


def _compute_from_raw(symbol: str, rows: list[dict]) -> dict:
    """Compute summary statistics from per-cell-line Chronos scores."""
    scores = [
        r.get("chronos_score") or r.get("score")
        for r in rows
        if (r.get("chronos_score") or r.get("score")) is not None
    ]
    if not scores:
        return _error_result(symbol, "No Chronos scores in response")

    mean_s   = sum(scores) / len(scores)
    n_dep    = sum(1 for s in scores if s < -0.5)
    pct      = round(n_dep / len(scores) * 100, 1)

    # Collect lineage labels if present
    lineage_scores: dict[str, list[float]] = {}
    for r in rows:
        lin = r.get("lineage") or r.get("cancer_type")
        sc  = r.get("chronos_score") or r.get("score")
        if lin and sc is not None:
            lineage_scores.setdefault(lin, []).append(sc)
    top_lins = sorted(
        lineage_scores, key=lambda l: sum(lineage_scores[l]) / len(lineage_scores[l])
    )[:5]

    return {
        "gene":                 symbol,
        "mean_chronos":         round(mean_s, 3),
        "percent_dependent":    pct,
        "is_common_essential":  pct > 90,
        "is_strongly_selective":10 < pct <= 60,
        "top_lineages":         top_lins,
        "n_cell_lines":         len(scores),
        "source":               "depmap_raw",
        "error":                None,
    }


def _safe_round(v) -> float | None:
    try:
        return round(float(v), 3) if v is not None else None
    except (TypeError, ValueError):
        return None


def _error_result(symbol: str, error: str) -> dict:
    return {
        "gene":                 symbol,
        "mean_chronos":         None,
        "percent_dependent":    None,
        "is_common_essential":  False,
        "is_strongly_selective":False,
        "top_lineages":         [],
        "n_cell_lines":         None,
        "source":               "depmap",
        "error":                error,
    }

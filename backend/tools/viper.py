"""VIPER protein activity inference via OmniPath DoRothEA regulons."""
from __future__ import annotations

import math
import os
from collections import defaultdict
from typing import Any

import requests


def _fetch_dorothea_regulons(genes: list[str], levels: str = "A,B,C") -> list[dict]:
    """Fetch TF→target edges from OmniPath DoRothEA for a list of target genes."""
    try:
        resp = requests.get(
            "https://omnipathdb.org/interactions",
            params={
                "datasets":        "dorothea",
                "targets":         ",".join(genes),
                "organisms":       "9606",
                "dorothea_levels": levels,
                "format":          "json",
                "fields":          "sources,dorothea_level",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))


def compute_viper_activity(
    genes: list[str],
    de_stats: dict[str, dict],
    disease: str,
) -> list[dict[str, Any]]:
    """
    Simplified VIPER using OmniPath DoRothEA regulons.

    For each TF with ≥3 target genes in the DE list, computes a normalised
    enrichment score (NES) from log2FC values weighted by regulation sign:
        NES = Σ(sign × log2FC) / √n_targets

    This mirrors VIPER's core logic without a full NB-normalised expression
    matrix — a useful approximation when only DE statistics are available.
    """
    edges = _fetch_dorothea_regulons(genes)
    if not edges:
        return [{"gene": g, "source": "dorothea_unavailable", "error": "OmniPath request failed or returned no regulons"} for g in genes[:6]]

    tf_targets: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for edge in edges:
        tf     = edge.get("source", "")
        target = edge.get("target", "")
        sign   = 1.0 if edge.get("is_stimulation") else (-1.0 if edge.get("is_inhibition") else 0.0)
        lfc    = de_stats.get(target, {}).get("log2FoldChange", 0.0)
        if tf and target and sign != 0.0 and lfc != 0.0:
            tf_targets[tf].append((target, sign * lfc))

    results = []
    for tf, weighted_targets in tf_targets.items():
        if len(weighted_targets) < 3:
            continue
        n    = len(weighted_targets)
        nes  = sum(w for _, w in weighted_targets) / math.sqrt(n)
        z    = abs(nes) / (1.0 / math.sqrt(n) + 1e-9)
        pval = round(2 * (1 - _norm_cdf(z)), 4)
        results.append({
            "regulator":      tf,
            "gene":           tf,
            "n_targets":      n,
            "nes":            round(nes, 3),
            "activity_state": "active" if nes > 0 else "repressed",
            "fdr":            round(min(1.0, pval * len(tf_targets)), 4),
            "pval":           pval,
            "disease":        disease,
            "source":         "omnipathdb_dorothea",
            "targets":        [t for t, _ in sorted(weighted_targets, key=lambda x: abs(x[1]), reverse=True)[:5]],
        })

    results.sort(key=lambda r: abs(r["nes"]), reverse=True)
    return results[:12] if results else [
        {"gene": g, "source": "dorothea_no_regulons", "error": "No DoRothEA TFs found regulating these genes at confidence A-C"}
        for g in genes[:3]
    ]


def run_viper_protein_activity(genes: list[str], disease: str, regulon_source: str = "DoRothEA A-C") -> list[dict[str, Any]]:
    """External VIPER API adapter (fallback when DE statistics are unavailable)."""
    endpoint = os.getenv("VIPER_API_URL")
    if not endpoint:
        return [_adapter_missing(g, "viper_protein_activity", "Set VIPER_API_URL or ensure DE statistics are loaded for DoRothEA-based inference.") for g in genes]
    rows = []
    for gene in genes:
        try:
            resp = requests.post(endpoint, json={"gene": gene, "disease": disease, "regulon_source": regulon_source}, timeout=30)
            resp.raise_for_status()
            rows.append(resp.json())
        except Exception as exc:
            rows.append({"gene": gene, "source": "viper_api", "status": "error", "error": str(exc)})
    return rows


def _adapter_missing(gene: str, node_type: str, message: str) -> dict[str, Any]:
    return {"gene": gene, "node_type": node_type, "source": "adapter_not_configured", "status": "not_configured", "summary": message}

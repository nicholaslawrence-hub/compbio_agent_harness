"""CRISPR guide design (SpCas9/NGG) and MAGeCK screen adapter."""
from __future__ import annotations

import os
import re
import time
from typing import Any

import requests


# ── Guide design ─────────────────────────────────────────────────────────────

def _gc(seq: str) -> float:
    return (seq.count("G") + seq.count("C")) / len(seq) if seq else 0.0


def _score_guide(protospacer: str, pam_pos: int, cds_len: int) -> float:
    """Rule-based SpCas9 on-target efficiency (0–1).

    Factors: GC content, seed-region quality, homopolymer/Pol-III-terminator
    penalties, and position bias (early CDS preferred for knockouts).
    Not a substitute for Azimuth/Rule Set 2 — validate with CRISPOR before ordering.
    """
    gc       = _gc(protospacer)
    seed_gc  = _gc(protospacer[8:])   # 12 nt proximal to PAM

    gc_score    = 1.0 - abs(gc - 0.55) * 2.5
    pos_score   = max(0.0, 1.0 - (pam_pos / cds_len))
    seed_pen    = max(0.0, seed_gc - 0.75) * 0.6
    homo_pen    = 0.3 if re.search(r"(.)\1{3,}", protospacer) else 0.0
    pol3_pen    = 0.25 if "TTTT" in protospacer else 0.0
    cloning_pen = 0.1 if re.search(r"CACCG|AAAC", protospacer) else 0.0  # BsmBI overhangs

    raw = gc_score * 0.45 + pos_score * 0.25 + 0.30 - seed_pen - homo_pen - pol3_pen - cloning_pen
    return round(max(0.0, min(1.0, raw)), 3)


def _off_target_risk(protospacer: str) -> str:
    seed_gc = _gc(protospacer[8:])
    if seed_gc > 0.75:
        return "high"
    if seed_gc > 0.55:
        return "medium"
    return "low"


def _fetch_cds(gene: str) -> tuple[str, str]:
    """Return (cds_seq, accession) for a gene's canonical RefSeq mRNA."""
    from Bio import Entrez, SeqIO
    from config import settings
    Entrez.email = settings.ncbi_email
    if settings.ncbi_api_key:
        Entrez.api_key = settings.ncbi_api_key

    with Entrez.esearch(
        db="nuccore",
        term=f"{gene}[Gene Name] AND Homo sapiens[Organism] AND mRNA[Filter] AND RefSeq[Filter]",
        retmax=1,
        sort="relevance",
    ) as h:
        ids = Entrez.read(h)["IdList"]
    if not ids:
        raise ValueError(f"No RefSeq mRNA found for {gene}")

    time.sleep(0.35)  # NCBI rate limit
    with Entrez.efetch(db="nuccore", id=ids[0], rettype="gb", retmode="text") as h:
        record = SeqIO.read(h, "genbank")

    cds_feat = next((f for f in record.features if f.type == "CDS"), None)
    seq = str(cds_feat.extract(record.seq)) if cds_feat else str(record.seq)
    return seq.upper(), record.id


def design_grnas_for_gene(gene: str, n_guides: int = 5) -> dict[str, Any]:
    """Design SpCas9 gRNAs from RefSeq CDS with rule-based efficiency scoring."""
    try:
        cds_seq, accession = _fetch_cds(gene)
    except Exception as e:
        return {"gene": gene, "source": "ncbi_refseq", "error": str(e), "guides": []}

    cds_len    = len(cds_seq)
    candidates = []
    for m in re.finditer(r"(?=([ACGT]{20}GG))", cds_seq):
        proto = m.group(1)[:20]
        pos   = m.start()
        candidates.append({
            "sequence":         proto,
            "pam":              cds_seq[pos + 20: pos + 23],
            "pam_position":     pos,
            "gc_content":       round(_gc(proto), 3),
            "efficiency_score": _score_guide(proto, pos, cds_len),
            "off_target_risk":  _off_target_risk(proto),
        })

    candidates.sort(key=lambda g: g["efficiency_score"], reverse=True)
    return {
        "gene":             gene,
        "source":           "ncbi_refseq_rule_based",
        "refseq_accession": accession,
        "cds_length_bp":    cds_len,
        "ngg_sites_found":  len(candidates),
        "guides":           candidates[:n_guides],
        "notes": (
            "Efficiency scores use GC content, position, seed-region GC, and homopolymer/Pol-III penalties. "
            "Validate final guides with CRISPOR or Cas-OFFinder before ordering. "
            "Off-target risk is estimated from seed-region GC — not a BLAST-based analysis."
        ),
    }


# ── MAGeCK CRISPR screen adapter ────────────────────────────────────────────

def run_mageck_crispr(genes: list[str], design: str = "treatment_vs_control") -> list[dict[str, Any]]:
    """MAGeCK MLE adapter. Requires MAGECK_API_URL or an uploaded screen artifact."""
    endpoint = os.getenv("MAGECK_API_URL")
    if not endpoint:
        return [_adapter_missing(g, "mageck_crispr", "Set MAGECK_API_URL or upload a CRISPR screen count artifact.") for g in genes]
    rows = []
    for gene in genes:
        try:
            resp = requests.post(endpoint, json={"gene": gene, "design": design}, timeout=30)
            resp.raise_for_status()
            rows.append(resp.json())
        except Exception as exc:
            rows.append({"gene": gene, "source": "mageck_api", "status": "error", "error": str(exc)})
    return rows


def _adapter_missing(gene: str, node_type: str, message: str) -> dict[str, Any]:
    return {"gene": gene, "node_type": node_type, "source": "adapter_not_configured", "status": "not_configured", "summary": message}

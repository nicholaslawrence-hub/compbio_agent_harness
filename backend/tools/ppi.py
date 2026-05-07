"""Protein-Protein Interaction network via STRING DB REST API."""
import httpx
from typing import Optional

STRING_BASE = "https://string-db.org/api"
SPECIES_HUMAN = 9606


def get_ppi_network(gene_symbol: str, limit: int = 20, score_threshold: int = 700) -> dict:
    """
    Fetch interaction partners from STRING DB.
    score_threshold: combined score 0-1000 (700 = high confidence).
    """
    identifier = _resolve_identifier(gene_symbol)
    if not identifier:
        return {"gene": gene_symbol, "partners": [], "error": "not found in STRING"}

    resp = httpx.get(
        f"{STRING_BASE}/json/interaction_partners",
        params={
            "identifier": identifier,
            "species": SPECIES_HUMAN,
            "limit": limit,
            "required_score": score_threshold,
        },
        timeout=12,
    )
    if resp.status_code != 200:
        return {"gene": gene_symbol, "partners": [], "error": resp.text[:200]}

    data = resp.json()
    partners = [
        {
            "partner": d.get("preferredName_B"),
            "score": d.get("score"),
            "experiments": d.get("experimentally_determined_interaction"),
        }
        for d in data
    ]
    return {"gene": gene_symbol, "string_id": identifier, "partners": partners}


def _resolve_identifier(gene_symbol: str) -> Optional[str]:
    resp = httpx.get(
        f"{STRING_BASE}/json/get_string_ids",
        params={"identifier": gene_symbol, "species": SPECIES_HUMAN, "limit": 1},
        timeout=12,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    if not data:
        return None
    return data[0].get("stringId")


def enrich_ppi_with_oncogenes(ppi_result: dict, oncogene_list: list[str]) -> dict:
    """Tag PPI partners that are known oncogenes."""
    oncogene_set = {g.upper() for g in oncogene_list}
    for partner in ppi_result.get("partners", []):
        name = (partner.get("partner") or "").upper()
        partner["is_oncogene"] = name in oncogene_set
    return ppi_result


KNOWN_ONCOGENES = [
    "TP53", "KRAS", "EGFR", "MYC", "VEGFA", "PIK3CA", "PTEN", "RB1",
    "BRAF", "ALK", "RET", "MET", "CDK4", "CDK6", "MDM2", "BCL2",
    "BRCA1", "BRCA2", "APC", "CTNNB1", "NOTCH1", "IDH1", "IDH2",
    "FLT3", "NPM1", "JAK2", "STK11", "CDKN2A", "NF1", "NF2",
]

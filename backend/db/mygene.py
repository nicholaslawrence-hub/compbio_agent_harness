"""
MyGene.info client for GO term and Reactome pathway annotation.

Fetches actual molecular function descriptions (e.g. "steroid 17β-dehydrogenase activity")
and confirmed Reactome pathway memberships for focal genes and their PPI partners.
No API key required — free public API with generous rate limits.
"""
import httpx

MYGENE_BASE = "https://mygene.info/v3"


def get_gene_annotations(gene_symbols: list[str]) -> dict[str, dict]:
    """
    Batch-fetch GO Molecular Function, GO Biological Process, and Reactome pathways
    for a list of gene symbols in a single POST request.

    Returns a dict keyed by uppercased symbol:
    {
        "KRAS": {
            "mf_terms": ["GTPase activity", "GDP binding"],
            "bp_terms": ["Ras protein signal transduction"],
            "reactome_pathways": ["RAF/MAP kinase cascade", "RAS activation upstream of MAP3K"],
        }
    }
    """
    if not gene_symbols:
        return {}

    try:
        resp = httpx.post(
            f"{MYGENE_BASE}/query",
            json={
                "q": list(gene_symbols),
                "scopes": "symbol",
                "fields": "symbol,go.MF,go.BP,pathway.reactome",
                "species": "human",
                "size": len(gene_symbols),
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception:
        return {}

    result: dict[str, dict] = {}
    for hit in resp.json():
        if hit.get("notfound"):
            continue

        symbol = hit.get("symbol", "").upper()
        if not symbol:
            continue

        go_block = hit.get("go") or {}

        mf_raw = go_block.get("MF", [])
        if isinstance(mf_raw, dict):
            mf_raw = [mf_raw]
        mf_terms = [t["term"] for t in mf_raw[:6] if isinstance(t, dict) and "term" in t]

        bp_raw = go_block.get("BP", [])
        if isinstance(bp_raw, dict):
            bp_raw = [bp_raw]
        bp_terms = [t["term"] for t in bp_raw[:4] if isinstance(t, dict) and "term" in t]

        reactome_raw = (hit.get("pathway") or {}).get("reactome", [])
        if isinstance(reactome_raw, dict):
            reactome_raw = [reactome_raw]
        reactome_pathways = [p["name"] for p in reactome_raw[:8] if isinstance(p, dict) and "name" in p]

        result[symbol] = {
            "mf_terms": mf_terms,
            "bp_terms": bp_terms,
            "reactome_pathways": reactome_pathways,
        }

    return result

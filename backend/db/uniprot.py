"""UniProt REST API client."""
import httpx
from typing import Optional

BASE = "https://rest.uniprot.org/uniprotkb"

# Valid UniProt REST field names (function → cc_function, sequence → sequence)
_FIELDS = "accession,id,gene_names,protein_name,cc_function,go,xref_pdb,sequence"


def search_protein(gene_symbol: str, organism: str = "human") -> Optional[dict]:
    """Return the top UniProt entry for a gene symbol."""
    params = {
        "query": f"gene:{gene_symbol} AND organism_name:{organism} AND reviewed:true",
        "format": "json",
        "size": 1,
        "fields": _FIELDS,
    }
    try:
        resp = httpx.get(f"{BASE}/search", params=params, timeout=30)
        resp.raise_for_status()
    except Exception:
        return None
    data = resp.json()
    results = data.get("results", [])
    if not results:
        return None
    entry = results[0]
    return {
        "accession": entry.get("primaryAccession"),
        "entry_name": entry.get("uniProtkbId"),
        "protein_name": _safe_protein_name(entry),
        "gene": gene_symbol,
        "function": _safe_function(entry),
        "pdb_ids": _safe_pdb(entry),
        "sequence_length": len(entry.get("sequence", {}).get("value", "")),
    }


def _safe_protein_name(entry: dict) -> str:
    try:
        return entry["proteinDescription"]["recommendedName"]["fullName"]["value"]
    except (KeyError, TypeError):
        return "Unknown"


def _safe_function(entry: dict) -> str:
    try:
        comments = entry.get("comments", [])
        for c in comments:
            if c.get("commentType") == "FUNCTION":
                return c["texts"][0]["value"][:500]
    except Exception:
        pass
    return ""


def _safe_pdb(entry: dict) -> list[str]:
    try:
        refs = entry.get("uniProtKBCrossReferences", [])
        return [r["id"] for r in refs if r.get("database") == "PDB"][:5]
    except Exception:
        return []

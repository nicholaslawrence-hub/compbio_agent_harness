"""ChEMBL drug-gene interaction client — live REST API (ebi.ac.uk)."""
import httpx

BASE = "https://www.ebi.ac.uk/chembl/api/data"

# Common gene-name synonyms that ChEMBL indexes differently
_SYNONYMS: dict[str, list[str]] = {
    "FGFR3": ["FGFR3", "fibroblast growth factor receptor 3"],
    "FGFR1": ["FGFR1", "fibroblast growth factor receptor 1"],
    "FGFR2": ["FGFR2", "fibroblast growth factor receptor 2"],
    "HRAS":  ["HRAS", "Harvey RAS", "H-ras"],
    "KRAS":  ["KRAS", "Kirsten RAS", "K-ras"],
    "NRAS":  ["NRAS", "neuroblastoma RAS"],
    "BRAF":  ["BRAF", "B-RAF"],
    "ERBB2": ["ERBB2", "HER2", "HER-2"],
    "PDGFRA":["PDGFRA", "PDGFR-alpha"],
}


def get_drug_interactions(gene_symbol: str, max_results: int = 10) -> dict:
    """
    Find drugs targeting a gene via ChEMBL target search.

    Returns a dict with:
      - drugs: list of drug dicts
      - query_attempted: True (always)
      - query_found_target: whether a ChEMBL target ID was resolved
      - query_note: human-readable explanation for LLM context
    """
    search_terms = _SYNONYMS.get(gene_symbol.upper(), [gene_symbol])

    target_id = None
    for term in search_terms:
        target_id = _find_target(term)
        if target_id:
            break

    if not target_id:
        return {
            "drugs": [],
            "query_attempted": True,
            "query_found_target": False,
            "query_note": (
                f"ChEMBL target search for '{gene_symbol}' returned no matching "
                "SINGLE PROTEIN target. Drug absence reflects a database lookup gap, "
                "NOT the absence of drugs in the scientific literature."
            ),
        }

    drugs = _get_activities(target_id, max_results)
    return {
        "drugs": drugs,
        "query_attempted": True,
        "query_found_target": True,
        "query_note": (
            f"ChEMBL target {target_id} resolved for '{gene_symbol}'. "
            f"{len(drugs)} bioactive compound(s) found with pChEMBL ≥ 5."
            if drugs else
            f"ChEMBL target {target_id} resolved for '{gene_symbol}' but no "
            "compounds passed the pChEMBL ≥ 5 activity filter. Approved drugs "
            "may exist — always cross-reference clinical databases."
        ),
    }


def _find_target(search_term: str) -> str | None:
    try:
        resp = httpx.get(
            f"{BASE}/target/search",
            params={"q": search_term, "format": "json", "limit": 10},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
    except Exception:
        return None

    targets = resp.json().get("targets", [])

    # Prefer human SINGLE PROTEIN targets
    for t in targets:
        if (t.get("target_type") == "SINGLE PROTEIN"
                and "homo sapiens" in t.get("organism", "").lower()):
            return t["target_chembl_id"]

    # Fall back to any SINGLE PROTEIN
    for t in targets:
        if t.get("target_type") == "SINGLE PROTEIN":
            return t["target_chembl_id"]

    return targets[0]["target_chembl_id"] if targets else None


def _get_activities(target_id: str, max_results: int) -> list[dict]:
    try:
        resp = httpx.get(
            f"{BASE}/activity",
            params={
                "target_chembl_id": target_id,
                "format": "json",
                "limit": max_results * 2,   # fetch extra, de-dupe by molecule
                "pchembl_value__gte": "5",  # loosened from 6 to catch more drugs
            },
            timeout=20,
        )
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    activities = resp.json().get("activities", [])
    seen: set[str] = set()
    results = []
    for a in activities:
        mol_id = a.get("molecule_chembl_id")
        if mol_id and mol_id not in seen:
            seen.add(mol_id)
            results.append({
                "molecule_id": mol_id,
                "molecule_name": a.get("molecule_pref_name") or mol_id,
                "standard_type": a.get("standard_type"),
                "standard_value": a.get("standard_value"),
                "standard_units": a.get("standard_units"),
                "pchembl_value": a.get("pchembl_value"),
                "target_id": target_id,
            })
        if len(results) >= max_results:
            break
    return results


def get_drug_approvals(molecule_ids: list[str]) -> dict[str, str]:
    """Return max_phase (approval status) for each molecule."""
    results = {}
    for mol_id in molecule_ids:
        try:
            resp = httpx.get(
                f"{BASE}/molecule/{mol_id}",
                params={"format": "json"},
                timeout=15,
            )
            if resp.status_code == 200:
                results[mol_id] = resp.json().get("max_phase", "unknown")
        except Exception:
            results[mol_id] = "unknown"
    return results

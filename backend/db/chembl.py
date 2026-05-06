"""ChEMBL drug-gene interaction client."""
import httpx

BASE = "https://www.ebi.ac.uk/chembl/api/data"


def get_drug_interactions(gene_symbol: str, max_results: int = 10) -> list[dict]:
    """Find approved drugs targeting a gene via ChEMBL target search."""
    target_id = _find_target(gene_symbol)
    if not target_id:
        return []
    return _get_activities(target_id, max_results)


def _find_target(gene_symbol: str) -> str | None:
    resp = httpx.get(
        f"{BASE}/target/search",
        params={"q": gene_symbol, "format": "json", "limit": 5},
        timeout=30,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    targets = data.get("targets", [])
    for t in targets:
        if t.get("target_type") == "SINGLE PROTEIN":
            return t["target_chembl_id"]
    return targets[0]["target_chembl_id"] if targets else None


def _get_activities(target_id: str, max_results: int) -> list[dict]:
    resp = httpx.get(
        f"{BASE}/activity",
        params={
            "target_chembl_id": target_id,
            "format": "json",
            "limit": max_results,
            "pchembl_value__gte": "6",  # at least µM potency
        },
        timeout=30,
    )
    if resp.status_code != 200:
        return []
    activities = resp.json().get("activities", [])
    seen = set()
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
                "target_id": target_id,
            })
    return results


def get_drug_approvals(molecule_ids: list[str]) -> dict[str, str]:
    """Return max_phase (approval status) for each molecule."""
    results = {}
    for mol_id in molecule_ids:
        resp = httpx.get(
            f"{BASE}/molecule/{mol_id}",
            params={"format": "json"},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            results[mol_id] = data.get("max_phase", "unknown")
    return results

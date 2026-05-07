"""ChEMBL drug-gene interaction client using chembl_webresource_client."""
from chembl_webresource_client.new_client import new_client

_target   = new_client.target
_activity = new_client.activity
_molecule = new_client.molecule


def get_drug_interactions(gene_symbol: str, max_results: int = 10) -> dict:
    """
    Find drugs targeting a gene via ChEMBL.

    Uses target_synonym__icontains for gene-symbol matching, which is reliable
    for both well-known and dark genes. Prefers human SINGLE PROTEIN targets.

    Returns:
      drugs               – list of drug dicts (approved first, then by pChEMBL)
      query_attempted     – True always
      query_found_target  – whether a ChEMBL target was resolved
      query_note          – human-readable summary for the LLM
    """
    target_id, target_name = _find_target(gene_symbol)

    if not target_id:
        return {
            "gene":               gene_symbol,
            "drugs":              [],
            "query_attempted":    True,
            "query_found_target": False,
            "query_note": (
                f"No ChEMBL SINGLE PROTEIN target found for '{gene_symbol}'. "
                "This is common for recently characterised or tissue-specific proteins "
                "that have not yet attracted medicinal chemistry interest — "
                "a genuine competitive white space opportunity."
            ),
        }

    drugs = _get_activities(target_id, max_results)
    found = len(drugs) > 0
    return {
        "gene":               gene_symbol,
        "drugs":              drugs,
        "query_attempted":    True,
        "query_found_target": True,
        "query_note": (
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}'. "
            f"{len(drugs)} bioactive compound(s) with pChEMBL ≥ 5 (binding assays)."
            if found else
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}' "
            "but no compounds passed the pChEMBL ≥ 5 binding-assay filter. "
            "The absence of tool compounds reflects the early-stage nature of this target."
        ),
    }


def _find_target(gene_symbol: str) -> tuple[str | None, str]:
    """
    Resolve a gene symbol to a ChEMBL SINGLE PROTEIN target ID.
    Scores candidates and returns the best human SINGLE PROTEIN match.
    Returns (target_chembl_id, pref_name) or (None, "").
    """
    try:
        results = list(
            _target.filter(target_synonym__icontains=gene_symbol)
                   .only(["target_chembl_id", "target_type", "organism", "pref_name"])
        )
    except Exception:
        return None, ""

    if not results:
        return None, ""

    def _score(t: dict) -> int:
        is_single = t.get("target_type") == "SINGLE PROTEIN"
        is_human  = "homo sapiens" in (t.get("organism") or "").lower()
        return (is_single * 2) + (is_human * 4)

    ranked = sorted(results, key=_score, reverse=True)
    best   = ranked[0]
    return best.get("target_chembl_id"), best.get("pref_name", "")


def _get_activities(target_id: str, max_results: int) -> list:
    """
    Retrieve bioactive compounds for a target.
    - Binding assays only (assay_type=B), pChEMBL ≥ 5
    - Fetches 100 candidates, de-dupes by molecule, batch-resolves names + max_phase
    - Sorts: approved drugs (max_phase=4) first, then by pChEMBL descending
    """
    try:
        acts = list(
            _activity.filter(
                target_chembl_id=target_id,
                assay_type="B",
                pchembl_value__gte=5,
            )[:100]
        )
    except Exception:
        return []

    # De-duplicate by molecule, keeping highest pChEMBL per molecule
    best: dict[str, dict] = {}
    for a in acts:
        mol_id = a.get("molecule_chembl_id")
        if not mol_id:
            continue
        existing = best.get(mol_id)
        if existing is None:
            best[mol_id] = a
        else:
            try:
                if float(a.get("pchembl_value") or 0) > float(existing.get("pchembl_value") or 0):
                    best[mol_id] = a
            except (ValueError, TypeError):
                pass

    if not best:
        return []

    # Batch-resolve molecule names and approval phase
    mol_ids   = list(best.keys())
    name_map  = {}
    phase_map = {}
    try:
        mols = list(
            _molecule.filter(molecule_chembl_id__in=mol_ids)
                     .only(["molecule_chembl_id", "pref_name", "max_phase"])
        )
        for m in mols:
            mid = m["molecule_chembl_id"]
            name_map[mid]  = m.get("pref_name") or ""
            phase_map[mid] = float(m.get("max_phase") or 0)
    except Exception:
        pass

    ranked = sorted(
        mol_ids,
        key=lambda mid: (-phase_map.get(mid, 0), -float(best[mid].get("pchembl_value") or 0))
    )

    return [
        {
            "molecule_id":    mol_id,
            "molecule_name":  name_map.get(mol_id) or mol_id,
            "standard_type":  best[mol_id].get("standard_type"),
            "standard_value": best[mol_id].get("standard_value"),
            "standard_units": best[mol_id].get("standard_units"),
            "pchembl_value":  best[mol_id].get("pchembl_value"),
            "max_phase":      phase_map.get(mol_id, 0),
            "target_id":      target_id,
        }
        for mol_id in ranked[:max_results]
    ]

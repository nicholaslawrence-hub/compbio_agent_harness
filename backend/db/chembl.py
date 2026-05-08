"""ChEMBL drug-gene interaction client using chembl_webresource_client."""
from chembl_webresource_client.new_client import new_client

_target = new_client.target
_activity = new_client.activity
_molecule = new_client.molecule


def get_drug_interactions(gene_symbol: str, max_results: int = 10) -> dict:
    """
    Find drugs targeting a gene via ChEMBL.

    Strict hits are binding assays with pChEMBL >= 5. Exploratory hits include
    binding or functional assays with pChEMBL >= 4, plus records with a reported
    standard value when pChEMBL is missing.
    """
    target_id, target_name = _find_target(gene_symbol)

    if not target_id:
        return {
            "gene": gene_symbol,
            "drugs": [],
            "exploratory_drugs": [],
            "target_activity_count": 0,
            "query_attempted": True,
            "query_found_target": False,
            "query_note": (
                f"No ChEMBL SINGLE PROTEIN target found for '{gene_symbol}'. "
                "This is common for recently characterised or tissue-specific proteins "
                "that have not yet attracted medicinal chemistry interest. "
                "A missing target can still be competitive white space."
            ),
        }

    drugs = _get_strict_activities(target_id, max_results)
    exploratory_drugs, activity_count = _get_exploratory_activities(target_id, max_results)
    found = len(drugs) > 0

    return {
        "gene": gene_symbol,
        "drugs": drugs,
        "exploratory_drugs": exploratory_drugs,
        "target_activity_count": activity_count,
        "query_attempted": True,
        "query_found_target": True,
        "query_note": (
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}'. "
            f"{len(drugs)} strong binding compound(s) with pChEMBL >= 5. "
            f"{len(exploratory_drugs)} exploratory record(s) shown from "
            f"{activity_count} total target activities."
            if found else
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}' "
            "but no compounds passed the strict pChEMBL >= 5 binding-assay filter. "
            f"{len(exploratory_drugs)} exploratory record(s) shown from "
            f"{activity_count} total target activities."
        ),
    }


def _find_target(gene_symbol: str) -> tuple[str | None, str]:
    """
    Resolve a gene symbol to a ChEMBL SINGLE PROTEIN target ID.
    Scores candidates and returns the best human SINGLE PROTEIN match.
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
        is_human = "homo sapiens" in (t.get("organism") or "").lower()
        return (is_single * 2) + (is_human * 4)

    ranked = sorted(results, key=_score, reverse=True)
    best = ranked[0]
    return best.get("target_chembl_id"), best.get("pref_name", "")


def _get_strict_activities(target_id: str, max_results: int) -> list:
    """Binding assays only, pChEMBL >= 5."""
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

    return _rank_activity_records(acts, max_results)


def _get_exploratory_activities(target_id: str, max_results: int) -> tuple[list, int]:
    """
    Looser ChEMBL evidence for exploratory lookup.
    Includes binding or functional assays and keeps records with pChEMBL >= 4
    or a reported standard value when pChEMBL is missing.
    """
    try:
        acts = list(
            _activity.filter(
                target_chembl_id=target_id,
                assay_type__in=["B", "F"],
            )[:300]
        )
    except Exception:
        return [], 0

    filtered = []
    for a in acts:
        pchembl = _float_or_none(a.get("pchembl_value"))
        has_standard_value = a.get("standard_value") not in (None, "")
        if pchembl is not None and pchembl < 4:
            continue
        if pchembl is None and not has_standard_value:
            continue
        filtered.append(a)

    return _rank_activity_records(filtered, max_results), len(acts)


def _rank_activity_records(acts: list, max_results: int) -> list:
    """De-dupe by molecule, resolve molecule names, and sort by phase then potency."""
    best: dict[str, dict] = {}
    for a in acts:
        mol_id = a.get("molecule_chembl_id")
        if not mol_id:
            continue
        existing = best.get(mol_id)
        current_score = _float_or_none(a.get("pchembl_value")) or 0
        existing_score = _float_or_none(existing.get("pchembl_value")) or 0 if existing else -1
        if existing is None or current_score > existing_score:
            best[mol_id] = a

    if not best:
        return []

    mol_ids = list(best.keys())
    name_map = {}
    phase_map = {}
    try:
        mols = list(
            _molecule.filter(molecule_chembl_id__in=mol_ids)
            .only(["molecule_chembl_id", "pref_name", "max_phase"])
        )
        for m in mols:
            mid = m["molecule_chembl_id"]
            name_map[mid] = m.get("pref_name") or ""
            phase_map[mid] = float(m.get("max_phase") or 0)
    except Exception:
        pass

    ranked = sorted(
        mol_ids,
        key=lambda mid: (
            -phase_map.get(mid, 0),
            -(_float_or_none(best[mid].get("pchembl_value")) or 0),
        ),
    )

    return [
        {
            "molecule_id": mol_id,
            "molecule_name": name_map.get(mol_id) or mol_id,
            "standard_type": best[mol_id].get("standard_type"),
            "standard_value": best[mol_id].get("standard_value"),
            "standard_units": best[mol_id].get("standard_units"),
            "pchembl_value": best[mol_id].get("pchembl_value"),
            "max_phase": phase_map.get(mol_id, 0),
            "assay_type": best[mol_id].get("assay_type"),
            "target_id": best[mol_id].get("target_chembl_id"),
        }
        for mol_id in ranked[:max_results]
    ]


def _float_or_none(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

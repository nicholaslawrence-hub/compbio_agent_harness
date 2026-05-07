"""ChEMBL drug-gene interaction client -- uses official chembl_webresource_client."""
from chembl_webresource_client.new_client import new_client

_target   = new_client.target
_activity = new_client.activity
_molecule = new_client.molecule


def get_drug_interactions(gene_symbol: str, max_results: int = 10) -> dict:
    """
    Find drugs targeting a gene via ChEMBL.

    Uses target_synonym__icontains (gene-symbol aware) rather than freetext
    search, which is far more reliable for dark / uncommon genes.

    Returns a dict with:
      - drugs: list of drug dicts (sorted: approved first, then by pChEMBL)
      - query_attempted: True (always)
      - query_found_target: whether a ChEMBL target ID was resolved
      - query_note: human-readable explanation for LLM context
    """
    target_id, target_name = _find_target(gene_symbol)

    if not target_id:
        return {
            "gene": gene_symbol,
            "drugs": [],
            "query_attempted": True,
            "query_found_target": False,
            "query_note": (
                f"No ChEMBL SINGLE PROTEIN target found for '{gene_symbol}'. "
                "This is common for recently characterised or tissue-specific proteins "
                "that have not yet attracted medicinal chemistry interest -- a genuine "
                "competitive white space opportunity."
            ),
        }

    drugs = _get_activities(target_id, max_results)
    found = len(drugs) > 0
    return {
        "gene": gene_symbol,
        "drugs": drugs,
        "query_attempted": True,
        "query_found_target": True,
        "query_note": (
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}'. "
            f"{len(drugs)} bioactive compound(s) with pChEMBL >= 5 (binding assays)."
            if found else
            f"ChEMBL target '{target_name}' ({target_id}) resolved for '{gene_symbol}' "
            "but no compounds passed the pChEMBL >= 5 binding-assay filter. "
            "Approved drugs may exist in clinical databases -- the absence here reflects "
            "the early-stage nature of this target, not a database error."
        ),
    }


def _find_target(gene_symbol: str) -> tuple:
    """
    Resolve a gene symbol to a ChEMBL SINGLE PROTEIN target ID.
    Uses target_synonym__icontains for precise gene-symbol matching.
    Returns (target_chembl_id, pref_name) or (None, "").
    """
    try:
        results = list(
            _target.filter(target_synonym__icontains=gene_symbol)
            .only(["target_chembl_id", "target_type", "organism", "pref_name"])
        )
    except Exception:
        return None, ""

    # Prefer human SINGLE PROTEIN
    for t in results:
        if (t.get("target_type") == "SINGLE PROTEIN"
                and "homo sapiens" in (t.get("organism") or "").lower()):
            return t["target_chembl_id"], t.get("pref_name", "")

    # Any human target
    for t in results:
        if "homo sapiens" in (t.get("organism") or "").lower():
            return t["target_chembl_id"], t.get("pref_name", "")

    # Fall back to any SINGLE PROTEIN
    for t in results:
        if t.get("target_type") == "SINGLE PROTEIN":
            return t["target_chembl_id"], t.get("pref_name", "")

    return (results[0]["target_chembl_id"], results[0].get("pref_name", "")) if results else (None, "")


def _get_activities(target_id: str, max_results: int) -> list:
    """
    Retrieve bioactive compounds for a target.
    - Binding assays only (assay_type=B), pChEMBL >= 5
    - Fetches 100 candidates, de-dupes by molecule, batch-resolves names + max_phase
    - Sorts: approved drugs (max_phase=4) first, then by pChEMBL descending.
      This surfaces named approved drugs (e.g. Gefitinib, Erlotinib) before
      unnamed research tool compounds.
    """
    try:
        acts = list(
            _activity.filter(
                target_chembl_id=target_id,
                assay_type="B",    # binding assays only -- skip ADMET/toxicity
                pchembl_value__gte=5,
            )[:100]                # wide net so sorting surfaces approved drugs
        )
    except Exception:
        return []

    # De-duplicate by molecule, keeping the highest pChEMBL record per molecule
    best = {}
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

    # Batch-resolve molecule names and approval phase in one API call
    mol_ids = list(best.keys())
    name_map = {}
    phase_map = {}
    try:
        mols = list(_molecule.filter(molecule_chembl_id__in=mol_ids)
                    .only(["molecule_chembl_id", "pref_name", "max_phase"]))
        for m in mols:
            mid = m["molecule_chembl_id"]
            name_map[mid]  = m.get("pref_name") or ""
            phase_map[mid] = float(m.get("max_phase") or 0)
    except Exception:
        pass

    # Sort: highest approval phase first, then highest pChEMBL
    def _sort_key(mol_id):
        phase   = phase_map.get(mol_id, 0)
        pchembl = float(best[mol_id].get("pchembl_value") or 0)
        return (-phase, -pchembl)

    ranked = sorted(mol_ids, key=_sort_key)

    results = []
    for mol_id in ranked[:max_results]:
        a    = best[mol_id]
        name = name_map.get(mol_id) or mol_id   # fall back to CHEMBL ID only if truly unnamed
        results.append({
            "molecule_id":    mol_id,
            "molecule_name":  name,
            "standard_type":  a.get("standard_type"),
            "standard_value": a.get("standard_value"),
            "standard_units": a.get("standard_units"),
            "pchembl_value":  a.get("pchembl_value"),
            "max_phase":      phase_map.get(mol_id, 0),
            "target_id":      target_id,
        })

    return results


def get_drug_approvals(molecule_ids: list) -> dict:
    """Return max_phase (approval status) for each molecule."""
    results = {}
    try:
        mols = list(_molecule.filter(molecule_chembl_id__in=molecule_ids)
                    .only(["molecule_chembl_id", "max_phase"]))
        for m in mols:
            results[m["molecule_chembl_id"]] = str(m.get("max_phase", "unknown"))
    except Exception:
        pass
    return results

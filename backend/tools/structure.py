"""AlphaFold structure lookup via AlphaFold DB and UniProt accession resolution."""
from __future__ import annotations

from typing import Any

import requests

from db.uniprot import search_protein


def fetch_alphafold_structure(gene: str, id_type: str = "uniprot", fmt: str = "pdb") -> dict[str, Any]:
    """Resolve a gene symbol to UniProt and return AlphaFold DB pointers.

    Does not run AlphaFold locally — resolves the target and returns download
    URLs and confidence metadata from the AlphaFold DB REST API.
    """
    protein   = search_protein(gene)
    accession = (protein or {}).get("accession")
    if not accession:
        return {
            "gene":   gene,
            "status": "not_resolved",
            "source": "alphafold_db",
            "error":  "UniProt accession could not be resolved for AlphaFold DB lookup.",
        }

    metadata_url = f"https://alphafold.ebi.ac.uk/api/prediction/{accession}"
    result = {
        "gene":                 gene,
        "uniprot_accession":    accession,
        "metadata_url":         metadata_url,
        "entry_url":            f"https://alphafold.ebi.ac.uk/entry/{accession}",
        "extractor_single_url": f"https://project.iith.ac.in/sharmaglab/alphafoldextractor/api/{id_type}/{accession}",
        "format":               fmt,
        "source":               "alphafold_db_api",
        "status":               "resolved",
    }
    try:
        resp = requests.get(metadata_url, timeout=20)
        resp.raise_for_status()
        rows = resp.json()
        if rows:
            first = rows[0]
            result.update({
                "model_url":     first.get("pdbUrl") or first.get("cifUrl"),
                "pae_url":       first.get("paeDocUrl"),
                "confidence":    first.get("confidenceScore"),
                "uniprot_start": first.get("uniprotStart"),
                "uniprot_end":   first.get("uniprotEnd"),
            })
    except Exception as exc:
        result["warning"] = f"AlphaFold metadata request failed, returning API pointers only: {exc}"
    return result

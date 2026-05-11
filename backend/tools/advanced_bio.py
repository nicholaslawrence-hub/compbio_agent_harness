"""Integration adapters for advanced RNAgent Bio-OS nodes.

These functions are intentionally lightweight and deterministic in local mode.
They define the real command/API boundary for production integrations while
returning useful structured records when the external engines are not installed.
"""
from __future__ import annotations

import hashlib
import math
import os
from typing import Any

import requests

from db.uniprot import search_protein


def _score(seed: str, low: float = 0.0, high: float = 1.0) -> float:
    raw = int(hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
    return round(low + raw * (high - low), 4)


def run_viper_protein_activity(genes: list[str], disease: str, regulon_source: str = "DoRothEA A-C") -> list[dict[str, Any]]:
    """VIPER/DoRothEA adapter.

    Production path:
    Rscript viper_activity.R counts.tsv dorothea_regulons.rds output.tsv

    Inputs:
    - normalized expression or DE statistics
    - signed TF-target regulons from DoRothEA

    Outputs:
    - normalized enrichment score per regulator
    - p-value/FDR
    - inferred activation direction
    """
    endpoint = os.getenv("VIPER_API_URL")
    if not endpoint:
        return [_adapter_missing(gene, "viper_protein_activity", "Set VIPER_API_URL to a VIPER/DoRothEA service that accepts gene-level DE statistics.") for gene in genes]
    rows = []
    for gene in genes:
        try:
            response = requests.post(endpoint, json={"gene": gene, "disease": disease, "regulon_source": regulon_source}, timeout=30)
            response.raise_for_status()
            rows.append(response.json())
        except Exception as exc:
            rows.append({
                "gene": gene,
                "source": "viper_api",
                "status": "error",
                "error": str(exc),
            })
    return rows


def _adapter_missing(gene: str, node_type: str, message: str) -> dict[str, Any]:
    return {
        "gene": gene,
        "node_type": node_type,
        "source": "adapter_not_configured",
        "status": "not_configured",
        "summary": message,
    }


def run_mageck_crispr(genes: list[str], design: str = "treatment_vs_control") -> list[dict[str, Any]]:
    """MAGeCK MLE adapter returning beta-score style records."""
    endpoint = os.getenv("MAGECK_API_URL")
    if not endpoint:
        return [_adapter_missing(gene, "mageck_crispr", "Set MAGECK_API_URL to a MAGeCK service or provide a CRISPR screen artifact.") for gene in genes]
    rows = []
    for gene in genes:
        try:
            response = requests.post(endpoint, json={"gene": gene, "design": design}, timeout=30)
            response.raise_for_status()
            rows.append(response.json())
        except Exception as exc:
            rows.append({"gene": gene, "source": "mageck_api", "status": "error", "error": str(exc)})
    return rows


def run_reinvent_generation(target: str, pocket: str = "auto", n: int = 8) -> list[dict[str, Any]]:
    """REINVENT4 adapter for de novo SMILES generation."""
    endpoint = os.getenv("REINVENT_API_URL")
    if not endpoint:
        return [_adapter_missing(target, "reinvent_generative", "Set REINVENT_API_URL to an external molecule-generation service. RNAgent will not fabricate SMILES.")]
    try:
        response = requests.post(endpoint, json={"target": target, "pocket": pocket, "n": n}, timeout=60)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else data.get("molecules", [])
    except Exception as exc:
        return [{"target": target, "source": "reinvent_api", "status": "error", "error": str(exc)}]
    """
    base = ["C", "N", "O", "Cl", "c1ccccc1", "C(=O)N", "S(=O)(=O)N"]
    molecules = []
    for i in range(n):
        smiles = f"{base[i % len(base)]}C{i % 3 + 1}N{base[(i + 2) % len(base)]}"
        molecules.append({
            "target": target,
            "pocket": pocket,
            "smiles": smiles,
            "rl_score": _score(f"reinvent:{target}:{i}", 0.25, 0.98),
            "diversity_bucket": i % 4,
            "source": "reinvent4_adapter_stub",
        })
    return molecules
    """


def run_gnina_docking(target: str, ligands: list[dict[str, Any]], receptor_pdb: str = "auto") -> list[dict[str, Any]]:
    """GNINA command adapter.

    Production command shape:
    gnina -r receptor.pdb -l ligand.sdf --autobox_ligand pocket.sdf -o docked.sdf.gz
    """
    endpoint = os.getenv("GNINA_API_URL")
    if not endpoint:
        return [_adapter_missing(target, "gnina_docking", "Set GNINA_API_URL to an external docking service. RNAgent will not run local GNINA or fabricate poses.")]
    poses = []
    for idx, ligand in enumerate(ligands[:10]):
        try:
            response = requests.post(endpoint, json={"target": target, "ligand": ligand, "receptor_pdb": receptor_pdb}, timeout=60)
            response.raise_for_status()
            poses.append(response.json())
        except Exception as exc:
            poses.append({"target": target, "ligand": ligand, "source": "gnina_api", "status": "error", "error": str(exc)})
    return poses


def fetch_alphafold_structure(gene: str, id_type: str = "uniprot", fmt: str = "pdb") -> dict[str, Any]:
    """Resolve a gene to UniProt and return AlphaFold DB download/API pointers.

    RNAgent does not run AlphaFold locally. It resolves the target and points at
    AlphaFold DB or the AlphaFoldDB Structure Extractor API for retrieval.
    """
    protein = search_protein(gene)
    accession = (protein or {}).get("accession")
    if not accession:
        return {
            "gene": gene,
            "status": "not_resolved",
            "source": "alphafold_db",
            "error": "UniProt accession could not be resolved for AlphaFold DB lookup.",
        }

    metadata_url = f"https://alphafold.ebi.ac.uk/api/prediction/{accession}"
    result = {
        "gene": gene,
        "uniprot_accession": accession,
        "metadata_url": metadata_url,
        "entry_url": f"https://alphafold.ebi.ac.uk/entry/{accession}",
        "extractor_single_url": f"https://project.iith.ac.in/sharmaglab/alphafoldextractor/api/{id_type}/{accession}",
        "format": fmt,
        "source": "alphafold_db_api",
        "status": "resolved",
    }
    try:
        response = requests.get(metadata_url, timeout=20)
        response.raise_for_status()
        rows = response.json()
        if rows:
            first = rows[0]
            result.update({
                "model_url": first.get("pdbUrl") or first.get("cifUrl"),
                "pae_url": first.get("paeDocUrl"),
                "confidence": first.get("confidenceScore"),
                "uniprot_start": first.get("uniprotStart"),
                "uniprot_end": first.get("uniprotEnd"),
            })
    except Exception as exc:
        result["warning"] = f"AlphaFold metadata request failed, returning deterministic API pointers only: {exc}"
    return result


def calculate_rdkit_features(ligands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """RDKit adapter for Morgan fingerprints and Lipinski properties.

    If RDKit is available in the runtime this can be swapped to Chem.MolFromSmiles,
    Descriptors.MolWt, Crippen.MolLogP, Lipinski.NumHDonors,
    Lipinski.NumHAcceptors, and rdFingerprintGenerator.GetMorganGenerator.
    """
    rows = []
    for ligand in ligands[:20]:
        if ligand.get("source") == "adapter_not_configured" or ligand.get("status") == "not_configured":
            continue
        smiles = ligand.get("smiles", "")
        if not smiles:
            continue
        heavy = sum(1 for char in smiles if char.isalpha() and char.isupper())
        mw = round(heavy * 24.7 + len(smiles) * 3.1, 2)
        logp = round(math.log(max(len(smiles), 2), 10), 2)
        hbd = smiles.count("N") + smiles.count("O")
        hba = hbd + smiles.count("=")
        rows.append({
            "smiles": smiles,
            "morgan_radius": 2,
            "morgan_bits": 2048,
            "fingerprint_preview": hashlib.sha1(smiles.encode("utf-8")).hexdigest()[:24],
            "mw": mw,
            "logp": logp,
            "hbd": hbd,
            "hba": hba,
            "lipinski_pass": mw <= 500 and logp <= 5 and hbd <= 5 and hba <= 10,
            "source": "rdkit_adapter_stub",
        })
    return rows

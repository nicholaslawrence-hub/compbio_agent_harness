"""Generative chemistry and ADMET tools: REINVENT, GNINA docking, RDKit features."""
from __future__ import annotations

import hashlib
import os
from typing import Any
from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, QED, rdFingerprintGenerator
import requests


def run_reinvent_generation(target: str, pocket: str = "auto", n: int = 8) -> list[dict[str, Any]]:
    """REINVENT4 adapter for de novo SMILES generation. Requires REINVENT_API_URL."""
    endpoint = os.getenv("REINVENT_API_URL")
    if not endpoint:
        return [_adapter_missing(target, "reinvent_generative", "Set REINVENT_API_URL to an external molecule-generation service. RNAgent will not fabricate SMILES.")]
    try:
        resp = requests.post(endpoint, json={"target": target, "pocket": pocket, "n": n}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("molecules", [])
    except Exception as exc:
        return [{"target": target, "source": "reinvent_api", "status": "error", "error": str(exc)}]


def run_gnina_docking(target: str, ligands: list[dict[str, Any]], receptor_pdb: str = "auto") -> list[dict[str, Any]]:
    """GNINA docking adapter. Requires GNINA_API_URL.

    Production command shape:
    gnina -r receptor.pdb -l ligand.sdf --autobox_ligand pocket.sdf -o docked.sdf.gz
    """
    endpoint = os.getenv("GNINA_API_URL")
    if not endpoint:
        return [_adapter_missing(target, "gnina_docking", "Set GNINA_API_URL to an external docking service. RNAgent will not run local GNINA or fabricate poses.")]
    poses = []
    for ligand in ligands[:10]:
        try:
            resp = requests.post(endpoint, json={"target": target, "ligand": ligand, "receptor_pdb": receptor_pdb}, timeout=60)
            resp.raise_for_status()
            poses.append(resp.json())
        except Exception as exc:
            poses.append({"target": target, "ligand": ligand, "source": "gnina_api", "status": "error", "error": str(exc)})
    return poses


def calculate_rdkit_features(ligands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute Lipinski + QED + Morgan fingerprint summaries via RDKit."""
    fpgen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows  = []
    for ligand in ligands[:20]:
        if ligand.get("source") == "adapter_not_configured" or ligand.get("status") == "not_configured":
            continue
        smiles = ligand.get("smiles", "")
        if not smiles:
            continue
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            rows.append({"smiles": smiles, "source": "rdkit", "status": "invalid_smiles"})
            continue
        fp  = fpgen.GetFingerprint(mol)
        mw  = round(Descriptors.MolWt(mol), 2)
        logp = round(Crippen.MolLogP(mol), 2)
        hbd = Lipinski.NumHDonors(mol)
        hba = Lipinski.NumHAcceptors(mol)
        rows.append({
            "smiles":               smiles,
            "mw":                   mw,
            "logp":                 logp,
            "hbd":                  hbd,
            "hba":                  hba,
            "tpsa":                 round(Descriptors.TPSA(mol), 2),
            "rotatable_bonds":      Lipinski.NumRotatableBonds(mol),
            "qed":                  round(QED.qed(mol), 3),
            "morgan_onbits":        int(fp.GetNumOnBits()),
            "fingerprint_preview":  hashlib.sha1(fp.ToBitString().encode()).hexdigest()[:24],
            "lipinski_pass":        mw <= 500 and logp <= 5 and hbd <= 5 and hba <= 10,
            "source":               "rdkit",
        })
    return rows


def _adapter_missing(gene: str, node_type: str, message: str) -> dict[str, Any]:
    return {"gene": gene, "node_type": node_type, "source": "adapter_not_configured", "status": "not_configured", "summary": message}

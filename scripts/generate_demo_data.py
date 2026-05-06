"""
Generate a synthetic count matrix for demo purposes.
Simulates a Glioblastoma vs normal RNA-seq experiment with 200 genes.
"""
import numpy as np
import pandas as pd
from pathlib import Path

np.random.seed(42)

DISEASE_GENES = [
    "EGFR", "PTEN", "TP53", "IDH1", "CDKN2A", "RB1", "NF1", "PIK3CA",
    "VEGFA", "MET", "MDM2", "CDK4", "CDK6", "CCND2", "PDGFRA", "ERBB2",
    "AKT1", "MTOR", "SOX2", "OLIG2", "NOTCH1", "STAT3", "HIF1A", "VIM",
    "SNAI1", "TWIST1", "ZEB1", "CD44", "PROM1", "NESTIN",
]

BACKGROUND_GENES = [f"GENE_{i:03d}" for i in range(1, 171)]
ALL_GENES = DISEASE_GENES + BACKGROUND_GENES

N_DISEASE = 4
N_CONTROL = 4
SAMPLES = (
    [f"GBM_{i:02d}" for i in range(1, N_DISEASE + 1)] +
    [f"NRM_{i:02d}" for i in range(1, N_CONTROL + 1)]
)

def sim_counts(base, fold, n_disease, n_control, dispersion=0.15):
    disease = np.random.negative_binomial(
        n=1 / dispersion, p=1 / (1 + base * fold * dispersion), size=n_disease
    ).astype(int)
    control = np.random.negative_binomial(
        n=1 / dispersion, p=1 / (1 + base * dispersion), size=n_control
    ).astype(int)
    return list(disease) + list(control)

rows = {}
for i, gene in enumerate(ALL_GENES):
    if gene in DISEASE_GENES:
        fold = np.random.uniform(3, 15)
        base = np.random.randint(100, 500)
    else:
        fold = np.random.uniform(0.8, 1.2)
        base = np.random.randint(50, 300)
    rows[gene] = sim_counts(base, fold, N_DISEASE, N_CONTROL)

df = pd.DataFrame(rows, index=SAMPLES).T
df.index.name = "gene"

out = Path(__file__).parent.parent / "data" / "demo_count_matrix.tsv"
out.parent.mkdir(exist_ok=True)
df.to_csv(out, sep="\t")

# Print sample conditions for the UI
conditions = {s: "disease" for s in SAMPLES[:N_DISEASE]}
conditions.update({s: "control" for s in SAMPLES[N_DISEASE:]})

import json
print("Count matrix saved to:", out)
print("\nSample conditions JSON (paste into UI):")
print(json.dumps(conditions, indent=2))

"""Generate a synthetic count matrix with known drug targets as top DE genes."""
import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(42)

samples_disease = ["D1", "D2", "D3", "D4"]
samples_control = ["C1", "C2", "C3", "C4"]
samples = samples_disease + samples_control

# Drug targets — strongly upregulated in disease (will be top DE genes)
drug_targets = ["EGFR", "MMP9", "VEGFA", "BRAF", "KRAS",
                "AKT1", "PIK3CA", "PDGFRA", "CDK4", "MET"]

rows = {}
# Drug targets: high disease counts, low control counts
for gene in drug_targets:
    d_counts = rng.negative_binomial(80, 0.45, 4).tolist()   # mean ~98
    c_counts = rng.negative_binomial(20, 0.45, 4).tolist()   # mean ~24
    rows[gene] = d_counts + c_counts

# Background genes: similar counts both conditions, varying baseline
for i in range(190):
    name = f"GENE{i:04d}"
    base = int(rng.uniform(15, 80))
    counts = rng.negative_binomial(base, 0.45, 8).tolist()
    rows[name] = counts

df = pd.DataFrame.from_dict(rows, orient="index", columns=samples)
df.index.name = "gene"

out = Path(__file__).resolve().parents[1] / "data" / "drug_target_counts.tsv"
df.to_csv(out, sep="\t")
print(f"Written {len(df)} genes x {len(samples)} samples to {out}")

# Spot-check
print("\nDrug target row means:")
for g in drug_targets:
    d_mean = np.mean(df.loc[g, samples_disease])
    c_mean = np.mean(df.loc[g, samples_control])
    print(f"  {g}: disease={d_mean:.1f}  control={c_mean:.1f}  ratio={d_mean/c_mean:.1f}x")

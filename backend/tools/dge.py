"""Differential Gene Expression analysis using PyDESeq2 or fallback t-test."""
import io
import numpy as np
import pandas as pd
from scipy import stats


def run_dge(
    count_matrix: pd.DataFrame,
    sample_conditions: dict[str, str],
    condition_a: str = "disease",
    condition_b: str = "control",
) -> pd.DataFrame:
    """
    Perform DGE between two conditions.

    count_matrix: rows=genes, cols=samples (raw integer counts or TPM).
    sample_conditions: {sample_name: condition_label}

    Returns DataFrame sorted by adjusted p-value with columns:
    gene, log2FoldChange, pvalue, padj, mean_a, mean_b
    """
    samples_a = [s for s, c in sample_conditions.items() if c == condition_a and s in count_matrix.columns]
    samples_b = [s for s, c in sample_conditions.items() if c == condition_b and s in count_matrix.columns]

    if not samples_a or not samples_b:
        raise ValueError(f"Need samples for both '{condition_a}' and '{condition_b}'")

    try:
        return _deseq2_dge(count_matrix, samples_a, samples_b)
    except Exception:
        return _ttest_dge(count_matrix, samples_a, samples_b)


def _deseq2_dge(matrix: pd.DataFrame, samples_a: list, samples_b: list) -> pd.DataFrame:
    from pydeseq2.dds import DeseqDataSet
    from pydeseq2.ds import DeseqStats

    all_samples = samples_a + samples_b
    counts = matrix[all_samples].T.astype(int)
    conditions = pd.Series(
        ["disease"] * len(samples_a) + ["control"] * len(samples_b),
        index=all_samples,
        name="condition",
    )
    meta = pd.DataFrame({"condition": conditions})

    dds = DeseqDataSet(counts=counts, metadata=meta, design="~condition")
    dds.deseq2()
    stat_res = DeseqStats(dds, contrast=("condition", "disease", "control"))
    stat_res.summary()
    results = stat_res.results_df.reset_index().rename(columns={"index": "gene"})
    results = results[["gene", "log2FoldChange", "pvalue", "padj"]].dropna()
    results = results.sort_values("padj")
    return results


def _ttest_dge(matrix: pd.DataFrame, samples_a: list, samples_b: list) -> pd.DataFrame:
    """Fallback: log2 fold-change + Welch t-test with Benjamini-Hochberg correction."""
    eps = 1.0
    a_vals = matrix[samples_a].values + eps
    b_vals = matrix[samples_b].values + eps

    mean_a = a_vals.mean(axis=1)
    mean_b = b_vals.mean(axis=1)
    log2fc = np.log2(mean_a / mean_b)

    pvals = []
    for i in range(len(matrix)):
        _, p = stats.ttest_ind(a_vals[i], b_vals[i], equal_var=False)
        pvals.append(p)
    pvals = np.array(pvals)

    padj = _bh_correction(pvals)

    return pd.DataFrame({
        "gene": matrix.index,
        "log2FoldChange": log2fc,
        "mean_disease": mean_a,
        "mean_control": mean_b,
        "pvalue": pvals,
        "padj": padj,
    }).sort_values("padj").reset_index(drop=True)


def _bh_correction(pvals: np.ndarray) -> np.ndarray:
    n = len(pvals)
    order = np.argsort(pvals)
    ranks = np.empty(n)
    ranks[order] = np.arange(1, n + 1)
    adjusted = np.minimum(1, pvals * n / ranks)
    # enforce monotonicity
    for i in range(n - 2, -1, -1):
        adjusted[order[i]] = min(adjusted[order[i]], adjusted[order[i + 1]])
    return adjusted


def top_upregulated(dge_results: pd.DataFrame, n: int = 20, padj_cutoff: float = 0.05, lfc_cutoff: float = 1.0) -> pd.DataFrame:
    sig = dge_results[(dge_results["padj"] < padj_cutoff) & (dge_results["log2FoldChange"] > lfc_cutoff)]
    return sig.nlargest(n, "log2FoldChange").reset_index(drop=True)


def parse_count_matrix_from_upload(content: bytes, filename: str) -> pd.DataFrame:
    """Parse uploaded TSV/CSV count matrix. First column = gene names."""
    sep = "\t" if filename.endswith(".tsv") or filename.endswith(".txt") else ","
    df = pd.read_csv(io.BytesIO(content), sep=sep, index_col=0)
    df.index.name = "gene"
    return df

"""Wrappers for Kallisto/Salmon transcript quantification via subprocess."""
import subprocess
import shutil
import json
from pathlib import Path


def run_kallisto_quant(
    fastq_files: list[str],
    index_path: str,
    output_dir: str,
    threads: int = 4,
    single_end: bool = False,
    fragment_length: float = 200,
    fragment_sd: float = 20,
) -> dict:
    """Run kallisto quant; returns parsed abundance.tsv as dict."""
    if not shutil.which("kallisto"):
        return {"error": "kallisto not found in PATH — skipping quantification"}

    cmd = ["kallisto", "quant", "-i", index_path, "-o", output_dir, "-t", str(threads)]
    if single_end:
        cmd += ["--single", "-l", str(fragment_length), "-s", str(fragment_sd)]
    cmd += fastq_files

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"error": result.stderr[:500]}

    abundance_path = Path(output_dir) / "abundance.tsv"
    if abundance_path.exists():
        return _parse_abundance(abundance_path)
    return {"stdout": result.stdout[:500]}


def run_salmon_quant(
    fastq_r1: str,
    index_path: str,
    output_dir: str,
    fastq_r2: str | None = None,
    threads: int = 4,
    lib_type: str = "A",
) -> dict:
    """Run salmon quant; returns parsed quant.sf as dict."""
    if not shutil.which("salmon"):
        return {"error": "salmon not found in PATH — skipping quantification"}

    cmd = [
        "salmon", "quant",
        "-i", index_path,
        "-l", lib_type,
        "-r" if fastq_r2 is None else "-1", fastq_r1,
        "-o", output_dir,
        "-p", str(threads),
        "--validateMappings",
    ]
    if fastq_r2:
        cmd += ["-2", fastq_r2]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"error": result.stderr[:500]}

    quant_path = Path(output_dir) / "quant.sf"
    if quant_path.exists():
        return _parse_quant_sf(quant_path)
    return {"stdout": result.stdout[:500]}


def _parse_abundance(path: Path) -> dict:
    import pandas as pd
    df = pd.read_csv(path, sep="\t")
    return {
        "tool": "kallisto",
        "n_transcripts": len(df),
        "top_expressed": df.nlargest(20, "tpm")[["target_id", "tpm"]].to_dict("records"),
    }


def _parse_quant_sf(path: Path) -> dict:
    import pandas as pd
    df = pd.read_csv(path, sep="\t")
    return {
        "tool": "salmon",
        "n_transcripts": len(df),
        "top_expressed": df.nlargest(20, "TPM")[["Name", "TPM"]].to_dict("records"),
    }


def build_kallisto_index(fasta_path: str, index_path: str) -> dict:
    """Build a kallisto index from a transcriptome FASTA."""
    if not shutil.which("kallisto"):
        return {"error": "kallisto not found"}
    result = subprocess.run(
        ["kallisto", "index", "-i", index_path, fasta_path],
        capture_output=True, text=True,
    )
    return {"returncode": result.returncode, "stderr": result.stderr[:300]}

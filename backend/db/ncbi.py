"""NCBI Entrez / SRA interface."""
import time
from typing import Optional
from Bio import Entrez
from config import settings

Entrez.email = settings.ncbi_email
if settings.ncbi_api_key:
    Entrez.api_key = settings.ncbi_api_key


def search_sra(disease_term: str, max_results: int = 10) -> list[dict]:
    """Search SRA for RNA-seq runs related to a disease term."""
    query = f"{disease_term}[Title] AND RNA-seq[Strategy]"
    with Entrez.esearch(db="sra", term=query, retmax=max_results) as handle:
        record = Entrez.read(handle)
    ids = record["IdList"]
    if not ids:
        return []

    results = []
    for uid in ids:
        time.sleep(0.34)  # respect NCBI rate limit
        with Entrez.efetch(db="sra", id=uid, rettype="runinfo", retmode="text") as h:
            text = h.read()
        runs = _parse_runinfo(text, uid)
        results.extend(runs)
    return results


def _parse_runinfo(text: str, uid: str) -> list[dict]:
    lines = [l for l in text.strip().splitlines() if l]
    if len(lines) < 2:
        return [{"sra_id": uid, "raw": text[:200]}]
    headers = lines[0].split(",")
    runs = []
    for line in lines[1:]:
        values = line.split(",")
        run = dict(zip(headers, values))
        runs.append(run)
    return runs


def fetch_pubmed_abstracts(gene_symbol: str, max_results: int = 5) -> list[dict]:
    """Fetch recent PubMed abstracts mentioning a gene."""
    query = f"{gene_symbol}[Title/Abstract] AND drug[Title/Abstract]"
    with Entrez.esearch(db="pubmed", term=query, retmax=max_results, sort="relevance") as h:
        record = Entrez.read(h)
    ids = record["IdList"]
    if not ids:
        return []

    with Entrez.efetch(db="pubmed", id=",".join(ids), rettype="abstract", retmode="text") as h:
        abstracts_text = h.read()

    results = []
    for i, uid in enumerate(ids):
        results.append({"pmid": uid, "abstract": _extract_abstract(abstracts_text, i)})
    return results


def _extract_abstract(text: str, index: int) -> str:
    sections = text.split("\n\n")
    if index < len(sections):
        return sections[index].strip()[:1000]
    return text[:500]


def search_gene_info(gene_symbol: str) -> Optional[dict]:
    """Fetch gene summary from NCBI Gene database."""
    with Entrez.esearch(db="gene", term=f"{gene_symbol}[Gene Name] AND Homo sapiens[Organism]") as h:
        record = Entrez.read(h)
    ids = record["IdList"]
    if not ids:
        return None
    with Entrez.efetch(db="gene", id=ids[0], rettype="gene_table", retmode="text") as h:
        return {"gene_id": ids[0], "summary": h.read()[:2000]}

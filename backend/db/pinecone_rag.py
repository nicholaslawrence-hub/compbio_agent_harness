"""
Literature RAG via Pinecone dense index with integrated inference.

Pinecone handles all embedding — we just provide text records.
Flow:
  1. Auto-fetch abstracts from PubMed + Semantic Scholar for each gene
  2. Upsert records into the Pinecone index (text field auto-embedded)
  3. Query the index semantically at analysis time
  4. Return top-k relevant abstracts + synthesized summary via LLM

Token-cost optimisations:
  - In-memory gene cache: skip re-fetch/re-embed if gene seen in last 2 hours
  - top_k reduced to 4 (was 6)
  - Score threshold: only pass hits with _score > 0.5 to the LLM prompt
  - Abstract text capped at 300 chars in format_for_prompt
"""
import json
import hashlib
import time
from pinecone import Pinecone
from config import settings
from db.literature_fetch import fetch_gene_literature, format_for_prompt

# Simple in-memory cache: {gene_symbol: unix_timestamp_of_last_upsert}
_upsert_cache: dict[str, float] = {}
_CACHE_TTL = 7200   # 2 hours


def _index():
    pc = Pinecone(api_key=settings.pinecone_api_key)
    return pc.Index(settings.pinecone_index_name)


def query_literature(gene_symbol: str, context: str = "") -> dict:
    """
    Main entry point for the literature RAG node.

    1. Fetches fresh abstracts from PubMed + Semantic Scholar.
    2. Upserts them into the Pinecone dense index (Pinecone embeds automatically).
    3. Queries the index for the most relevant results.
    4. Returns structured result including dark-gene classification.
    """
    if not settings.pinecone_api_key:
        return _fallback_pubmed(gene_symbol)

    try:
        disease = context.split(".")[0].replace("Disease: ", "") if context else ""

        # Step 1 — fetch abstracts (skip if recently upserted for this gene)
        now = time.time()
        already_cached = (now - _upsert_cache.get(gene_symbol, 0)) < _CACHE_TTL
        papers = []
        if not already_cached:
            papers = fetch_gene_literature(gene_symbol, disease_context=disease, max_papers=6)

        # Step 2 — upsert into Pinecone (inference happens server-side)
        if papers:
            _upsert_papers(papers, gene_symbol)
            _upsert_cache[gene_symbol] = now

        # Step 3 — semantic search (top_k=4 for token efficiency)
        query_text = f"{gene_symbol} drug target therapeutic {disease}".strip()
        hits = _search(query_text, gene_symbol, top_k=4)

        # Step 4 — classify and return
        pubmed_hits = sum(1 for p in hits if p.get("source") == "PubMed")
        total_hits = len(hits)
        is_dark = total_hits < 3

        return {
            "gene": gene_symbol,
            "pubmed_hits": total_hits,
            "is_dark": is_dark,
            "known_drugs": _extract_drugs_from_hits(hits),
            "mechanism_summary": "",
            "key_pmids": [h["pmid"] for h in hits if h.get("pmid")],
            "summary": format_for_prompt(hits),
            "auto_fetched_papers": hits,
            "citations": [],
        }

    except Exception as e:
        return {
            "gene": gene_symbol,
            "error": str(e),
            "pubmed_hits": 0,
            "is_dark": True,
            "abstracts": [],
            "summary": "",
        }


def _upsert_papers(papers: list[dict], gene_symbol: str) -> None:
    """Upsert abstract records — Pinecone embeds the 'text' field automatically."""
    index = _index()
    records = []
    for p in papers:
        text = f"{p.get('title', '')} {p.get('abstract', '')}".strip()
        if not text:
            continue
        record_id = hashlib.md5(text[:200].encode()).hexdigest()
        records.append({
            "_id": record_id,
            "text": text,
            "gene": gene_symbol,
            "title": p.get("title", ""),
            "abstract": p.get("abstract", "")[:1000],
            "source": p.get("source", ""),
            "pmid": p.get("pmid", ""),
            "doi": p.get("doi", ""),
            "year": p.get("year", ""),
            "url": p.get("url", ""),
        })

    if records:
        index.upsert_records(settings.pinecone_namespace, records)


_SCORE_THRESHOLD = 0.45   # drop low-relevance hits before they reach the LLM prompt


def _search(query_text: str, gene_symbol: str, top_k: int = 4) -> list[dict]:
    """Semantic search over the index; Pinecone embeds the query automatically."""
    index = _index()
    results = index.search(
        namespace=settings.pinecone_namespace,
        query={"top_k": top_k, "inputs": {"text": query_text}},
        fields=["gene", "title", "abstract", "source", "pmid", "doi", "year", "url"],
    )
    hits = []
    for match in results.get("result", {}).get("hits", []):
        score = match.get("_score", 0)
        if score < _SCORE_THRESHOLD:
            continue    # skip low-relevance results — saves tokens in the LLM prompt
        fields = match.get("fields", {})
        hits.append({
            "score": score,
            "title": fields.get("title", ""),
            "abstract": fields.get("abstract", ""),
            "source": fields.get("source", ""),
            "pmid": fields.get("pmid", ""),
            "doi": fields.get("doi", ""),
            "year": fields.get("year", ""),
            "url": fields.get("url", ""),
        })
    return hits


def _extract_drugs_from_hits(hits: list[dict]) -> list[str]:
    """Simple keyword scan of abstracts for drug names — LLM does deeper extraction later."""
    drug_keywords = [
        "inhibitor", "antibody", "mab", "nib", "drug", "compound",
        "therapy", "treatment", "agonist", "antagonist",
    ]
    candidates = set()
    for hit in hits:
        abstract = hit.get("abstract", "").lower()
        words = abstract.split()
        for i, word in enumerate(words):
            if any(kw in word for kw in drug_keywords):
                # grab surrounding words as candidate drug name
                start = max(0, i - 1)
                candidates.add(" ".join(words[start:i + 1]).strip(",.;()"))
    return list(candidates)[:10]


def _fallback_pubmed(gene_symbol: str) -> dict:
    """Used when PINECONE_API_KEY is not set — still auto-fetches literature."""
    papers = fetch_gene_literature(gene_symbol, max_papers=8)
    return {
        "gene": gene_symbol,
        "pubmed_hits": len(papers),
        "is_dark": len(papers) < 3,
        "known_drugs": [],
        "mechanism_summary": "",
        "key_pmids": [p["pmid"] for p in papers if p.get("pmid")],
        "summary": format_for_prompt(papers),
        "auto_fetched_papers": papers,
        "citations": [],
    }

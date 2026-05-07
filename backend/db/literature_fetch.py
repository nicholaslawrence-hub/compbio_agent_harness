"""
Agentic literature fetcher.

Automatically retrieves PubMed abstracts and Semantic Scholar papers
for a given gene, so no manual PDF upload is needed for standard use.
"""
import httpx
from Bio import Entrez
from config import settings

Entrez.email = settings.ncbi_email
if settings.ncbi_api_key:
    Entrez.api_key = settings.ncbi_api_key

SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"


def fetch_gene_literature(gene_symbol: str, disease_context: str = "", max_papers: int = 8) -> list[dict]:
    """
    Fetch relevant abstracts from PubMed + Semantic Scholar for a gene.
    Returns a unified list of abstract dicts with keys:
      source, title, abstract, year, pmid/doi, url
    """
    pubmed = _fetch_pubmed(gene_symbol, disease_context, max_results=max_papers // 2 + 1)
    semantic = _fetch_semantic_scholar(gene_symbol, disease_context, max_results=max_papers // 2 + 1)

    # Deduplicate by title similarity (simple exact-match on lowercased title)
    seen_titles = set()
    combined = []
    for paper in pubmed + semantic:
        key = paper.get("title", "").lower()[:60]
        if key and key not in seen_titles:
            seen_titles.add(key)
            combined.append(paper)

    return combined[:max_papers]


def _fetch_pubmed(gene_symbol: str, disease_context: str, max_results: int) -> list[dict]:
    query = f"{gene_symbol}[Title/Abstract] AND drug[Title/Abstract]"
    if disease_context:
        query += f" AND {disease_context}[Title/Abstract]"

    try:
        with Entrez.esearch(db="pubmed", term=query, retmax=max_results, sort="relevance") as h:
            record = Entrez.read(h)
        ids = record.get("IdList", [])
        if not ids:
            return []

        with Entrez.efetch(db="pubmed", id=",".join(ids), rettype="xml", retmode="xml") as h:
            articles = Entrez.read(h)

        results = []
        for article in articles.get("PubmedArticle", []):
            try:
                med = article["MedlineCitation"]
                art = med["Article"]
                title = str(art.get("ArticleTitle", ""))
                abstract_texts = art.get("Abstract", {}).get("AbstractText", [])
                abstract = " ".join(str(t) for t in abstract_texts) if isinstance(abstract_texts, list) else str(abstract_texts)
                pmid = str(med["PMID"])
                year = str(art.get("Journal", {}).get("JournalIssue", {}).get("PubDate", {}).get("Year", ""))
                results.append({
                    "source": "PubMed",
                    "title": title,
                    "abstract": abstract[:1500],
                    "year": year,
                    "pmid": pmid,
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                })
            except (KeyError, TypeError):
                continue
        return results
    except Exception:
        return []


def _fetch_semantic_scholar(gene_symbol: str, disease_context: str, max_results: int) -> list[dict]:
    """Fetch from Semantic Scholar with exponential backoff on 429."""
    import time

    query = f"{gene_symbol} drug target"
    if disease_context:
        query += f" {disease_context}"

    params = {
        "query": query,
        "limit": max_results,
        "fields": "title,abstract,year,externalIds,url",
    }

    for attempt in range(3):
        try:
            resp = httpx.get(
                f"{SEMANTIC_SCHOLAR_BASE}/paper/search",
                params=params,
                timeout=20,
            )
            if resp.status_code == 429:
                # Respect Retry-After if present, else exponential backoff
                retry_after = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                retry_after = min(retry_after, 30)   # cap at 30 s
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            papers = resp.json().get("data", [])

            results = []
            for p in papers:
                abstract = p.get("abstract") or ""
                if not abstract:
                    continue
                external_ids = p.get("externalIds") or {}
                results.append({
                    "source": "Semantic Scholar",
                    "title": p.get("title", ""),
                    "abstract": abstract[:1500],
                    "year": str(p.get("year", "")),
                    "pmid": external_ids.get("PubMed", ""),
                    "doi": external_ids.get("DOI", ""),
                    "url": p.get("url", ""),
                })
            return results
        except Exception:
            break   # non-429 error — give up immediately

    return []


_ABSTRACT_PROMPT_CHARS = 300   # cap per abstract in LLM prompts — main token cost lever


def format_for_prompt(papers: list[dict]) -> str:
    """Format fetched papers as a compact context block for the LLM prompt."""
    if not papers:
        return "No literature automatically retrieved."

    lines = []
    for i, p in enumerate(papers, 1):
        pmid_str = f" [PMID: {p['pmid']}]" if p.get("pmid") else ""
        abstract  = p.get("abstract", "")
        truncated = abstract[:_ABSTRACT_PROMPT_CHARS] + ("…" if len(abstract) > _ABSTRACT_PROMPT_CHARS else "")
        lines.append(
            f"[{i}] {p['source']} {p.get('year', '')}{pmid_str}\n"
            f"{p['title']}\n"
            f"{truncated}"
        )
    return "\n---\n".join(lines)

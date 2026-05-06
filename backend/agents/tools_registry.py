"""LangChain tool wrappers for all bioinformatics and DB functions."""
from langchain_core.tools import tool
from tools.ppi import get_ppi_network, enrich_ppi_with_oncogenes, KNOWN_ONCOGENES
from db.uniprot import search_protein
from db.chembl import get_drug_interactions
from db.ncbi import fetch_pubmed_abstracts, search_gene_info


@tool
def tool_get_ppi(gene_symbol: str) -> dict:
    """Get protein-protein interaction partners for a gene from STRING DB."""
    result = get_ppi_network(gene_symbol)
    return enrich_ppi_with_oncogenes(result, KNOWN_ONCOGENES)


@tool
def tool_get_uniprot(gene_symbol: str) -> dict:
    """Get UniProt protein annotation, function, and structural info for a gene."""
    result = search_protein(gene_symbol)
    return result or {"error": f"No UniProt entry found for {gene_symbol}"}


@tool
def tool_get_drugs(gene_symbol: str) -> list:
    """Find known drugs targeting a gene via ChEMBL."""
    return get_drug_interactions(gene_symbol)


@tool
def tool_search_pubmed(gene_symbol: str) -> list:
    """Search PubMed for recent abstracts linking a gene to drug interactions."""
    return fetch_pubmed_abstracts(gene_symbol)


@tool
def tool_get_gene_info(gene_symbol: str) -> dict:
    """Get NCBI Gene summary for a gene symbol."""
    result = search_gene_info(gene_symbol)
    return result or {"error": f"Gene {gene_symbol} not found in NCBI"}


ALL_TOOLS = [
    tool_get_ppi,
    tool_get_uniprot,
    tool_get_drugs,
    tool_search_pubmed,
    tool_get_gene_info,
]

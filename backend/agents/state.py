"""Shared state schema for the PharmaGPT LangGraph agent."""
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict
import operator


class DGEResult(TypedDict):
    gene: str
    log2FoldChange: float
    pvalue: float
    padj: float


class PPIResult(TypedDict):
    gene: str
    partners: list[dict]


class LiteratureResult(TypedDict):
    gene: str
    pubmed_hits: int
    abstracts: list[dict]
    is_dark: bool  # True if heavily upregulated but rarely in drug literature


class PathwayResult(TypedDict):
    pathway: str
    source: str
    p_value: float
    adjusted_p_value: float
    overlap_genes: list[str]
    overlap_count: int


class DrugInteraction(TypedDict):
    gene: str
    drugs: list[dict]
    uniprot: Optional[dict]


class TherapeuticHypothesis(TypedDict):
    gene: str
    hypothesis: str
    mechanism: str
    novelty_score: float
    supporting_evidence: list[str]
    key_pmids: list[str]          # PubMed IDs from RAG hits — rendered as citations in UI
    pub_count: int                # deterministic PubMed publication count used to set novelty_score


class AgentState(TypedDict):
    # Input
    disease_term: str
    condition_a: str
    condition_b: str
    count_matrix_path: Optional[str]
    sample_conditions: dict[str, str]

    # Intermediate results
    dge_results: list[DGEResult]        # top upregulated (filtered)
    all_dge_results: list[DGEResult]    # full unfiltered DEG output — used for GSEA ranking & ORA background
    detected_genes: list[str]           # all gene symbols detected in the count matrix
    top_genes: list[str]
    enrichment_method: str              # 'ORA' or 'GSEA'
    pathway_results: list[PathwayResult]
    ppi_results: list[PPIResult]
    literature_results: list[LiteratureResult]
    drug_interactions: list[DrugInteraction]

    # Output
    hypotheses: Annotated[list[TherapeuticHypothesis], operator.add]
    final_report: Optional[str]
    errors: Annotated[list[str], operator.add]

    # Control flow
    current_gene_index: int
    status: str
    progress: int  # 0-100

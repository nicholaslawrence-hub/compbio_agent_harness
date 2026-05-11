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
    is_dark: bool


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


class DepmapResult(TypedDict):
    gene: str
    mean_chronos: Optional[float]
    percent_dependent: Optional[float]
    is_common_essential: bool
    is_strongly_selective: bool
    top_lineages: list[str]
    n_cell_lines: Optional[int]
    source: str
    error: Optional[str]


class OTResult(TypedDict):
    gene: str
    disease: str
    overall_score: float
    genetic_association: float
    somatic_mutation: float
    known_drug: float
    affected_pathway: float
    literature: float
    rna_expression: float
    animal_model: float
    ensembl_id: Optional[str]
    efo_id: Optional[str]
    source: str
    error: Optional[str]


class TherapeuticHypothesis(TypedDict):
    gene: str
    hypothesis: str
    mechanism: str
    novelty_score: float
    supporting_evidence: list[str]
    key_pmids: list[str]
    pub_count: int


class ArtifactPointer(TypedDict):
    artifact_id: str
    uri: str
    kind: str
    summary: str
    bytes: Optional[int]
    metadata: dict[str, Any]


class AgentState(TypedDict):
    # ── Input ────────────────────────────────────────────────────────────────
    disease_term: str
    condition_a: str
    condition_b: str
    count_matrix_path: Optional[str]
    sample_conditions: dict[str, str]
    study_context: dict[str, Any]
    sandbox_config: dict[str, Any]
    network_topology: dict[str, Any]
    artifact_registry: dict[str, ArtifactPointer]
    node_outputs: dict[str, dict[str, Any]]
    node_status: dict[str, str]
    pending_tasks: dict[str, dict[str, Any]]
    approval_requests: dict[str, dict[str, Any]]
    provenance_ledger: Annotated[list[dict], operator.add]
    edge_decisions: dict[str, str]
    external_results: dict[str, dict[str, Any]]
    active_node_id: str

    # ── Intermediate results ─────────────────────────────────────────────────
    dge_results: list[DGEResult]        # top upregulated (filtered)
    all_dge_results: list[DGEResult]    # full unfiltered — for GSEA & ORA background
    detected_genes: list[str]           # all symbols detected in count matrix
    top_genes: list[str]
    enrichment_method: str              # 'ORA' or 'GSEA'
    pathway_results: list[PathwayResult]
    ppi_results: list[PPIResult]
    literature_results: list[LiteratureResult]
    drug_interactions: list[DrugInteraction]
    depmap_results: list[DepmapResult]
    opentargets_results: list[OTResult]
    clinical_trials_results: list[dict[str, Any]]
    pathway_crosstalk_results: list[dict[str, Any]]
    evo2_fitness_results: list[dict[str, Any]]
    esm3_design_results: list[dict[str, Any]]
    scenic_regulon_results: list[dict[str, Any]]
    spatial_tme_results: list[dict[str, Any]]
    lincs_reversion_results: list[dict[str, Any]]
    tcga_survival_results: list[dict[str, Any]]
    pharmacogenomics_pgx_results: list[dict[str, Any]]
    crispr_design_results: list[dict[str, Any]]
    alphafold_complex_results: list[dict[str, Any]]
    viper_protein_activity_results: list[dict[str, Any]]
    mageck_crispr_results: list[dict[str, Any]]
    reinvent_generative_results: list[dict[str, Any]]
    gnina_docking_results: list[dict[str, Any]]
    rdkit_feature_results: list[dict[str, Any]]

    # ── Output ───────────────────────────────────────────────────────────────
    hypotheses: Annotated[list[TherapeuticHypothesis], operator.add]
    final_report: Optional[str]
    errors: Annotated[list[str], operator.add]

    # ── DGE retry ────────────────────────────────────────────────────────────
    dge_attempt: int                    # 1 = standard, 2 = lenient re-run

    # ── Supervisor control flow ──────────────────────────────────────────────
    next_step: str                      # next step for the supervisor, based off context
    supervisor_subquery: str            # targeted query/gene for the next node
    supervisor_reasoning: str           # one-sentence explanation of decision
    supervisor_iterations: int          
    supervisor_context: Annotated[list[dict], operator.add]   
    pruned_genes: list[str]             # genes dropped by supervisor as dead ends
    routing_history: Annotated[list[dict], operator.add]
    prompt_payloads: Annotated[list[dict], operator.add]
    execution_events: Annotated[list[dict], operator.add]
    critic_feedback: Annotated[list[dict], operator.add]
    critic_retries: dict[str, int]
    retry_counts: dict[str, int]
    critic_route: str
    flow_killed: bool
    previous_node_id: str

    # ── Progress ─────────────────────────────────────────────────────────────
    current_gene_index: int
    status: str
    progress: int                       # 0-100

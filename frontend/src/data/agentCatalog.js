import {
  Activity,
  Atom,
  Beaker,
  BookOpen,
  BrainCircuit,
  ClipboardList,
  Dna,
  FileSpreadsheet,
  FlaskConical,
  GitBranch,
  Layers3,
  Microscope,
  Network,
  Pill,
  Save,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from 'lucide-react'

const PORTS = {
  counts: 'Raw count table',
  metadata: 'Sample or clinical metadata',
  directive: 'Study goal text',
  degs: 'Differential expression results',
  genes: 'Gene list',
  signature: 'Disease expression signature',
  regulator_activity: 'Regulator or protein activity',
  essentiality_score: 'CRISPR essentiality signal',
  regulon_program: 'Regulon program',
  spatial_context: 'Spatial tumor microenvironment context',
  perturbation_match: 'Transcriptomic reversal match',
  clinical_signal: 'Clinical outcome or PGx signal',
  network_context: 'Protein interaction network context',
  protein: 'Protein target',
  structure: 'AlphaFold DB structure pointer',
  structure_signal: 'Structural tractability signal',
  pocket: 'Target pocket',
  smiles: 'SMILES molecules',
  ligand: 'Ligand records',
  chemistry_profile: 'ADMET and lead-like chemistry profile',
  docking: 'Docking poses',
  literature_support: 'Literature or PMID support',
  wetlab_design: 'Wet-lab validation design',
  translation_brief: 'Typed translational evidence brief',
  decision: 'Routing decision',
  report: 'Report payload',
}

export const PORT_LABELS = PORTS

export const AGENT_CARDS = [
  { type: 'count_matrix_input', label: 'Count Matrix', category: 'Entry', icon: FileSpreadsheet, inputs: [], outputs: ['counts'], requires: ['Raw count table'], returns: ['count_matrix_path'], feeds: ['DGE'], doc: 'Upload raw counts. Provides count_matrix_path to DGE and all downstream nodes.' },
  { type: 'clinical_metadata', label: 'Clinical Metadata', category: 'Entry', icon: ClipboardList, inputs: [], outputs: ['metadata'], requires: ['sample annotations'], returns: ['covariates'], feeds: ['TCGA Survival', 'Spatial TME'], doc: 'Sample-level annotations: cohort, batch, tumor purity, clinical phenotype.' },
  { type: 'study_context', label: 'Study Directive', category: 'Entry', icon: BrainCircuit, inputs: [], outputs: ['directive'], requires: ['free text goal'], returns: ['global prompt'], feeds: ['Supervisor', 'Critics'], doc: 'Free-text goal injected into supervisor and critic prompts.' },
  { type: 'sync_gateway', label: 'Sync Gateway', category: 'Control', icon: GitBranch, inputs: ['clinical_signal', 'docking', 'structure_signal', 'chemistry_profile'], outputs: ['translation_brief'], requires: ['multiple upstream nodes'], returns: ['joined evidence brief'], feeds: ['downstream gated node'], doc: 'Waits for all upstream branches before releasing the graph.' },
  { type: 'approval_gate', label: 'Approval Gate', category: 'Control', icon: ShieldAlert, inputs: ['translation_brief'], outputs: ['decision'], requires: ['candidate decision packet'], returns: ['human approval request'], feeds: ['expensive downstream work'], doc: 'Pauses the graph for human review before costly or irreversible work.', wip: true },
  { type: 'run_dge', label: 'DGE', category: 'RNA', icon: FlaskConical, inputs: ['counts'], outputs: ['degs', 'genes', 'signature'], requires: ['counts', 'case/control'], returns: ['DEGs'], feeds: ['VIPER', 'SCENIC', 'TCGA'], doc: 'Runs PyDESeq2. Produces ranked DEGs and BH-adjusted p-values.' },
  { type: 'viper_protein_activity', label: 'VIPER Activity', category: 'Target Validation', icon: Activity, inputs: ['degs', 'genes'], outputs: ['regulator_activity'], requires: ['DE stats', 'DoRothEA regulons'], returns: ['TF activity NES'], feeds: ['Supervisor', 'SCENIC'], doc: 'Infers TF activity from DE stats via OmniPath DoRothEA regulons. Useful when mRNA level does not reflect protein activity.' },
  { type: 'mageck_crispr', label: 'MAGeCK CRISPR', category: 'Target Validation', icon: Dna, inputs: ['genes'], outputs: ['essentiality_score'], requires: ['sgRNA count table', 'design matrix'], returns: ['beta scores'], feeds: ['DepMap', 'Critics'], doc: 'Parses MAGeCK MLE beta scores from a CRISPR screen count artifact. Requires MAGECK_API_URL.', wip: true },
  { type: 'scenic_regulon', label: 'SCENIC Regulon', category: 'Systems', icon: Waypoints, inputs: ['counts', 'degs'], outputs: ['regulon_program'], requires: ['expression matrix'], returns: ['master regulators'], feeds: ['VIPER', 'Report'], doc: 'Identifies master regulators from single-cell or bulk expression.', wip: true },
  { type: 'spatial_tme', label: 'Spatial TME', category: 'Systems', icon: Layers3, inputs: ['genes', 'metadata'], outputs: ['spatial_context'], requires: ['spatial cohort'], returns: ['tumor nest localization'], feeds: ['TME Critic'], doc: 'Checks whether a target localizes to the correct tumor compartment.', wip: true },
  { type: 'lincs_reversion', label: 'LINCS Reversion', category: 'Perturbation', icon: Beaker, inputs: ['signature'], outputs: ['perturbation_match', 'smiles'], requires: ['disease signature'], returns: ['reversal molecules'], feeds: ['Drug Annotation'], doc: 'Finds perturbations predicted to reverse the disease expression signature.', wip: true },
  { type: 'tcga_survival', label: 'TCGA Survival', category: 'Clinical', icon: Activity, inputs: ['genes', 'metadata'], outputs: ['clinical_signal'], requires: ['gene', 'cohort'], returns: ['KM p-value'], feeds: ['Report'], doc: 'Tests whether target expression tracks patient outcome in a TCGA cohort.', wip: true },
  { type: 'pharmacogenomics_pgx', label: 'PharmGKB PGx', category: 'Clinical', icon: Pill, inputs: ['protein', 'smiles'], outputs: ['clinical_signal'], requires: ['target or drug'], returns: ['allele risk'], feeds: ['Report'], doc: 'Screens pharmacogenomic toxicity and metabolism liabilities via PharmGKB.', wip: true },
  { type: 'enrich_ppi', label: 'STRING PPI', category: 'Network', icon: Network, inputs: ['genes', 'regulator_activity', 'clinical_signal'], outputs: ['protein', 'network_context'], requires: ['gene list'], returns: ['partners'], feeds: ['AlphaFold3', 'GNINA'], doc: 'Queries STRING for high-confidence interaction partners (combined score ≥ 700).' },
  { type: 'alphafold_complex', label: 'AlphaFold DB', category: 'Structure', icon: Atom, inputs: ['protein', 'genes'], outputs: ['structure', 'structure_signal'], requires: ['UniProt accession or gene'], returns: ['AlphaFold DB structure pointer'], feeds: ['Structural Critic'], doc: 'Resolves a gene to its AlphaFold DB entry and returns PDB/mmCIF download URLs and pLDDT confidence.' },
  { type: 'evo2_fitness', label: 'Evo 2 Fitness', category: 'Foundation', icon: Dna, inputs: ['protein'], outputs: ['structure_signal'], requires: ['sequence variants'], returns: ['fitness landscape'], feeds: ['ESM3'], doc: 'API adapter for sequence fitness annotations. Requires EVO2_API_URL.', wip: true },
  { type: 'esm3_design', label: 'ESM3 Design', category: 'Foundation', icon: Sparkles, inputs: ['protein', 'structure'], outputs: ['structure_signal'], requires: ['protein context'], returns: ['binder design constraints'], feeds: ['GNINA'], doc: 'API adapter for protein binder design constraints. Requires ESM3_API_URL.', wip: true },
  { type: 'reinvent_generative', label: 'REINVENT', category: 'Chemistry', icon: Sparkles, inputs: ['pocket', 'structure'], outputs: ['smiles'], requires: ['target pocket'], returns: ['SMILES'], feeds: ['RDKit', 'GNINA'], doc: 'API adapter for de novo SMILES generation. Requires REINVENT_API_URL.', wip: true },
  { type: 'rdkit_features', label: 'RDKit ADMET', category: 'Chemistry', icon: Beaker, inputs: ['smiles'], outputs: ['ligand', 'chemistry_profile'], requires: ['SMILES'], returns: ['Morgan fingerprint', 'Lipinski'], feeds: ['GNINA', 'Report'], doc: 'Computes Lipinski, QED, TPSA, and Morgan fingerprint properties from SMILES.' },
  { type: 'gnina_docking', label: 'GNINA Docking', category: 'Chemistry', icon: ScanSearch, inputs: ['structure', 'ligand', 'smiles'], outputs: ['docking', 'chemistry_profile'], requires: ['PDB', 'SDF'], returns: ['CNNscore', 'CNNaffinity'], feeds: ['Structural Critic'], doc: 'API adapter for CNN-scored docking. Requires GNINA_API_URL and a receptor PDB.', wip: true },
  { type: 'drug_annotation', label: 'Drug Annotation', category: 'Chemistry', icon: Pill, inputs: ['genes', 'protein'], outputs: ['smiles', 'chemistry_profile'], requires: ['gene'], returns: ['ChEMBL', 'UniProt'], feeds: ['PGx'], doc: 'Fetches target annotation and known drug landscape via UniProt and ChEMBL.' },
  { type: 'critic_structural_tractability', label: 'Structural Critic', category: 'Critic', icon: ShieldAlert, inputs: ['structure', 'docking', 'structure_signal', 'chemistry_profile'], outputs: ['decision'], requires: ['structure or docking'], returns: ['retry or forward'], feeds: ['upstream retry', 'next gate'], doc: 'Rejects targets with poor structural tractability, weak docking, or high disorder.' },
  { type: 'critic_microenvironment_validity', label: 'TME Critic', category: 'Critic', icon: ShieldAlert, inputs: ['spatial_context'], outputs: ['decision'], requires: ['spatial evidence'], returns: ['retry or forward'], feeds: ['upstream retry', 'next gate'], doc: 'Rejects targets localized to the wrong tumor compartment or cell type.', wip: true },
  { type: 'crispr_designer', label: 'CRISPR Designer', category: 'Wet Lab', icon: Microscope, inputs: ['genes', 'decision'], outputs: ['wetlab_design'], requires: ['validated target'], returns: ['gRNA candidates'], feeds: ['Report'], doc: 'Designs SpCas9 gRNAs from RefSeq CDS with rule-based efficiency and off-target scoring.' },
  { type: 'literature_rag', label: 'Literature RAG', category: 'Evidence', icon: BookOpen, inputs: ['genes', 'network_context', 'clinical_signal'], outputs: ['literature_support'], requires: ['target query'], returns: ['PMIDs'], feeds: ['Critics'], doc: 'Retrieves PubMed abstracts and flags low-literature (dark) genes.' },
  { type: 'supervisor', label: 'Supervisor', category: 'Control', icon: GitBranch, inputs: ['translation_brief', 'directive'], outputs: ['decision'], requires: ['history'], returns: ['next node'], feeds: ['specialists'], doc: 'Routes the investigation to the next specialist tool based on accumulated evidence.' },
  { type: 'translator', label: 'Omics Translator', category: 'Control', icon: GitBranch, inputs: ['counts', 'degs', 'genes', 'signature', 'regulator_activity', 'essentiality_score', 'regulon_program', 'spatial_context', 'perturbation_match', 'clinical_signal', 'network_context', 'protein', 'structure', 'structure_signal', 'smiles', 'ligand', 'chemistry_profile', 'docking', 'literature_support', 'wetlab_design', 'decision'], outputs: ['genes', 'protein', 'pocket', 'smiles', 'ligand', 'translation_brief', 'decision'], requires: ['source payload'], returns: ['adapted biological payload'], feeds: ['any compatible input'], doc: 'Adapts one biological payload type to another across an edge.' },
  { type: 'report', label: 'Report', category: 'Output', icon: Save, inputs: ['translation_brief', 'clinical_signal', 'chemistry_profile', 'literature_support', 'wetlab_design', 'decision'], outputs: ['report'], requires: ['accepted evidence'], returns: ['markdown'], feeds: ['end'], doc: 'Synthesizes accumulated evidence into a ranked markdown report.' },
]

export function cardFor(type) {
  return AGENT_CARDS.find(card => card.type === type) || AGENT_CARDS[0]
}

function defaultImplementation(card) {
  return {
  realWorldInput: 'Typed AgentState payload from an upstream node.',
  realWorldOutput: 'Small structured record suitable for routing, UI display, and provenance logging.',
  code: `def node_${card.type}(state: AgentState) -> dict:
    node_id = state.get("current_node_id", "tool")
    inputs = state.get("node_outputs", {})
    result = call_registered_adapter("${card.type}", inputs)
    return {
        "node_outputs": {
            **state.get("node_outputs", {}),
            node_id: {
                "summary": result["summary"],
                "artifact_id": result.get("artifact_id"),
                "payload": result.get("payload", {}),
            },
        },
        "supervisor_context": [{
            "step": node_id,
            "summary": result["summary"],
        }],
    }`,
  }
}

const IMPLEMENTATIONS = {
  count_matrix_input: {
    realWorldInput: 'Browser File object uploaded as multipart FormData field count_matrix.',
    realWorldOutput: 'Artifact pointer to the stored matrix, sample IDs, detected gene count, and a tiny preview for UI validation.',
    code: `async function uploadCountMatrix(file: File) {
  const form = new FormData()
  form.append("count_matrix", file)
  form.append("sample_conditions", JSON.stringify({
    D1: "disease", D2: "disease", C1: "control", C2: "control",
  }))

  // Backend stores the full matrix and passes only a pointer through AgentState.
  return {
    count_matrix_path: "/data/uploads/sample_counts.tsv",
    artifact: {
      kind: "raw_counts",
      format: "genes x samples TSV",
    },
  }
}`,
  },
  clinical_metadata: {
    realWorldInput: 'CSV/TSV metadata where sample identifiers match count-matrix column names.',
    realWorldOutput: 'Validated sample-condition map and covariate artifact pointer.',
    code: `def parse_metadata_table(path: str) -> dict:
    df = pd.read_csv(path, sep=None, engine="python")
    assert "sample_id" in df.columns
    return {
        "sample_conditions": dict(zip(df.sample_id, df.condition)),
        "metadata_artifact": {
            "uri": path,
            "dimensions": {"samples": len(df), "covariates": len(df.columns) - 1},
            "columns": df.columns.tolist(),
        },
    }`,
  },
  study_context: {
    realWorldInput: 'User-authored study objective, constraints, disease context, or prioritization rule.',
    realWorldOutput: 'Small study_notes field injected into supervisor and critic prompts.',
    code: `def node_study_context(state: AgentState) -> dict:
    config = state.get("sandbox_config", {}) or {}
    directive = str(config.get("directive", "")).strip()
    return {
        "study_context": {
            **(state.get("study_context", {}) or {}),
            "study_notes": directive,
        },
        "network_topology": config.get("network_topology", {}),
        "status": "context_loaded",
    }`,
  },
  run_dge: {
    realWorldInput: 'count_matrix_path plus sample_conditions and case/control labels.',
    realWorldOutput: 'Compact top_genes and dge_results in state, full DGE table saved as an artifact pointer.',
    code: `def node_run_dge(state: AgentState) -> dict:
    matrix = parse_count_matrix_from_upload(
        Path(state["count_matrix_path"]).read_bytes(),
        Path(state["count_matrix_path"]).name,
    )
    dge_df = run_dge(
        matrix,
        state["sample_conditions"],
        state["condition_a"],
        state["condition_b"],
    )
    top_df = top_upregulated(dge_df, n=settings.max_genes_for_rag)
    artifact = register_artifact(
        uri=write_json_artifact(dge_df),
        kind="dge_results",
        summary=f"{len(dge_df)} genes x 6 DESeq2 statistics",
        metadata={"rows": len(dge_df), "columns": list(dge_df.columns)},
    )
    return {
        "top_genes": top_df["gene"].tolist(),
        "dge_results": top_df.to_dict("records"),
        "artifact_registry": {artifact["artifact_id"]: artifact},
    }`,
  },
  enrich_ppi: {
    realWorldInput: 'Gene list, regulator activity hits, or clinical-signal genes.',
    realWorldOutput: 'ppi_results list and network_context summary. Graph edges are protein-protein interactions, not workflow edges.',
    code: `def get_ppi_network(gene: str, limit: int = 15) -> dict:
    response = requests.get(
        "https://string-db.org/api/json/interaction_partners",
        params={
            "identifiers": gene,
            "species": 9606,
            "limit": limit,
            "required_score": 400,
        },
        timeout=20,
    )
    rows = response.json()
    return {
        "gene": gene,
        "partners": [
            {
                "partner": r["preferredName_B"],
                "string_id": r["stringId_B"],
                "score": r["score"],
            }
            for r in rows
        ],
    }`,
  },
  alphafold_complex: {
    realWorldInput: 'Protein target resolved through UniProt.',
    realWorldOutput: 'structure artifact pointer, pLDDT summary, PDB URL, mmCIF URL, and optional AlphaFold Extractor URL.',
    code: `def fetch_alphafold_structure(gene: str) -> dict:
    protein = search_protein(gene)
    accession = protein["accession"]
    return {
        "gene": gene,
        "uniprot_accession": accession,
        "pdb_url": f"https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-model_v4.pdb",
        "cif_url": f"https://alphafold.ebi.ac.uk/files/AF-{accession}-F1-model_v4.cif",
        "extractor_url": (
            "https://project.iith.ac.in/sharmaglab/alphafoldextractor/api/"
            f"uniprot/{accession}"
        ),
        "artifact_policy": "store URL and metadata, not atomic coordinates in AgentState",
    }`,
  },
  rdkit_features: {
    realWorldInput: 'SMILES list from REINVENT, LINCS, or ChEMBL.',
    realWorldOutput: 'Small ADMET table. Fingerprints are bit vectors and can be stored as artifact pointers if large.',
    code: `from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdFingerprintGenerator

def calculate_rdkit_features(ligands: list[dict]) -> list[dict]:
    fpgen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for ligand in ligands:
        mol = Chem.MolFromSmiles(ligand["smiles"])
        if mol is None:
            continue
        rows.append({
            "smiles": ligand["smiles"],
            "mw": Descriptors.MolWt(mol),
            "logp": Crippen.MolLogP(mol),
            "hbd": Lipinski.NumHDonors(mol),
            "hba": Lipinski.NumHAcceptors(mol),
            "morgan_bits": fpgen.GetFingerprint(mol).GetNumOnBits(),
        })
    return rows`,
  },
  gnina_docking: {
    realWorldInput: 'Prepared receptor structure and ligand records.',
    realWorldOutput: 'Docking score table and pose artifact pointers. Pose coordinates are not placed into AgentState.',
    code: `def dispatch_gnina_job(receptor_pdb: str, ligand_sdf: str) -> dict:
    # Local equivalent:
    # gnina -r receptor.pdb -l ligand.sdf --autobox_ligand pocket.sdf -o docked.sdf.gz
    job = docking_client.submit({
        "receptor": receptor_pdb,
        "ligand": ligand_sdf,
        "scoring": "cnn",
    })
    return {
        "job_id": job.id,
        "status": "pending_external_worker",
        "expected_output": {
            "rows": "poses x ligands",
            "columns": ["cnn_score", "cnn_affinity", "vina_affinity", "pose_uri"],
        },
    }`,
  },
  reinvent_generative: {
    realWorldInput: 'Pocket or pharmacophore summary from structure node. RNAgent should call an external REINVENT service, not run a model in-browser.',
    realWorldOutput: 'Generated molecule table. Keep molecule files and scoring traces as artifacts.',
    code: `def run_reinvent_generation(target: str, pocket: str, n: int = 64) -> list[dict]:
    response = requests.post(
        settings.reinvent_api_url,
        json={
            "target": target,
            "pocket_artifact": pocket,
            "num_smiles": n,
            "scoring": ["qed", "sa_score", "predicted_binding"],
        },
        timeout=60,
    )
    return response.json()["molecules"]`,
  },
  literature_rag: {
    realWorldInput: 'Gene symbol plus compact disease and network context.',
    realWorldOutput: 'Small literature_support payload. Abstract text is truncated for prompts and full paper metadata stays in retrieval storage.',
    code: `def query_literature(gene: str, disease: str, partners: list[str]) -> dict:
    papers = fetch_gene_literature(gene, disease_context=disease, max_papers=6)
    if len(papers) < 2:
        for partner in partners[:3]:
            papers += fetch_gene_literature_with_interactor(gene, partner, max_papers=4)
    return {
        "gene": gene,
        "pubmed_hits": len(papers),
        "key_pmids": [p["pmid"] for p in papers[:5]],
        "abstracts": [p["abstract"][:700] for p in papers[:5]],
        "is_dark": len(papers) < 3,
    }`,
  },
  drug_annotation: {
    realWorldInput: 'Gene symbol or UniProt/ChEMBL target identifier.',
    realWorldOutput: 'Known-drug landscape table plus target annotation. Activities are filtered by target and potency.',
    code: `def get_drug_interactions(gene: str) -> dict:
    target_id, target_name = resolve_chembl_target(gene)
    activities = new_client.activity.filter(
        target_chembl_id=target_id,
        standard_type__in=["IC50", "Ki", "Kd", "EC50"],
        pchembl_value__gte=4,
    ).only(["molecule_chembl_id", "standard_type", "standard_value", "pchembl_value"])
    return {
        "gene": gene,
        "target_id": target_id,
        "target_name": target_name,
        "drugs": collapse_best_activity_per_molecule(activities),
    }`,
  },
  tcga_survival: {
    realWorldInput: 'Gene symbols, tumor cohort code, survival_time and event metadata.',
    realWorldOutput: 'clinical_signal table with survival statistics and plot artifacts.',
    code: `def run_tcga_survival(gene: str, cohort: str) -> dict:
    expr = tcga_client.expression(cohort=cohort, gene=gene)
    survival = tcga_client.survival(cohort=cohort)
    merged = expr.join(survival, on="patient_id")
    groups = split_high_low(merged, value="expression", quantile=0.5)
    stats = logrank_and_coxph(groups)
    return {
        "gene": gene,
        "cohort": cohort,
        "n_patients": len(merged),
        "hazard_ratio": stats.hazard_ratio,
        "logrank_p": stats.p_value,
        "plot_artifact": stats.km_plot_uri,
    }`,
  },
  crispr_designer: {
    realWorldInput: 'HGNC symbol and genome build.',
    realWorldOutput: 'Wet-lab design table. Full off-target search index remains external.',
    code: `def design_crispr_guides(gene: str, genome: str = "GRCh38") -> list[dict]:
    transcript = genome_client.canonical_transcript(gene, genome=genome)
    guides = crispor_client.design(
        sequence=transcript.coding_sequence,
        pam="NGG",
        enzyme="SpCas9",
    )
    return [{
        "gene": gene,
        "guide": g.sequence,
        "pam": g.pam,
        "on_target_score": g.doench_2016,
        "off_target_count": g.off_targets_3mm,
    } for g in guides[:10]]`,
  },
}

const ALIASES = {
  viper_protein_activity: {
    realWorldInput: 'DESeq2 statistics joined to DoRothEA regulons.',
    realWorldOutput: 'Regulator activity table, not raw protein abundance.',
    code: `def run_viper_protein_activity(genes: list[str], disease: str) -> list[dict]:
    response = requests.post(settings.viper_api_url, json={
        "ranked_signature": "artifact://dge_results",
        "regulon_source": "DoRothEA A-C",
        "disease": disease,
    })
    return response.json()["regulator_activity"]`,
  },
  mageck_crispr: {
    realWorldInput: 'CRISPR screen read counts, usually sgRNAs x samples.',
    realWorldOutput: 'Essentiality score table. Raw sgRNA counts remain an artifact.',
    code: `def run_mageck_crispr(screen_artifact: str, design: str) -> dict:
    job = mageck_service.submit({"counts": screen_artifact, "design": design})
    return {"job_id": job.id, "status": "pending", "expected": "genes x beta_score"}`,
  },
  scenic_regulon: {
    realWorldInput: 'Single-cell or bulk expression matrix, genes x cells/samples.',
    realWorldOutput: 'Regulon program table and optional AUCell matrix artifact.',
    code: `def run_scenic(expression_artifact: str) -> dict:
    return scenic_service.submit({
        "expression_matrix": expression_artifact,
        "motif_database": "hg38__refseq-r80__10kb_up_and_down_tss.mc9nr",
        "output": "regulons_and_aucell",
    })`,
  },
  spatial_tme: {
    realWorldInput: 'Visium, Xenium, CosMx, MERSCOPE, or similar spatial artifact pointer.',
    realWorldOutput: 'Spatial context table and image/coordinate artifact pointers.',
    code: `def query_spatial_tme(gene: str, spatial_artifact: str) -> dict:
    return spatial_service.score_gene_localization({
        "artifact": spatial_artifact,
        "gene": gene,
        "regions": ["tumor_nest", "stroma", "immune_margin"],
    })`,
  },
  lincs_reversion: {
    realWorldInput: 'Up and down gene sets from DGE.',
    realWorldOutput: 'LINCS L1000 reversal matches and molecule IDs.',
    code: `def query_lincs(signature: dict) -> list[dict]:
    return lincs_client.signature_search({
        "up_genes": signature["up"][:150],
        "down_genes": signature["down"][:150],
        "method": "L1000CDS2",
    })`,
  },
  pharmacogenomics_pgx: {
    realWorldInput: 'Drug molecule name, ChEMBL ID, or target gene.',
    realWorldOutput: 'PGx toxicity and metabolism risk table.',
    code: `def query_pharmgkb(drug: str) -> list[dict]:
    return pharmgkb_client.annotations({
        "drug": drug,
        "include": ["clinicalAnnotations", "variantAnnotations"],
    })`,
  },
  critic_structural_tractability: {
    realWorldInput: 'Structure, docking, disorder, and tractability summaries.',
    realWorldOutput: 'Conditional routing decision with retry feedback.',
    code: `def critic_structural_tractability(state: AgentState) -> dict:
    return _critic_gate(
        state,
        critic_id="critic_structural_tractability",
        evidence_keys=["alphafold_complex_results", "gnina_docking_results"],
        reject_to="alphafold_complex",
        max_retries=3,
    )`,
  },
  critic_microenvironment_validity: {
    realWorldInput: 'Spatial expression and tumor microenvironment localization summaries.',
    realWorldOutput: 'Conditional routing decision with cell-compartment feedback.',
    code: `def critic_microenvironment_validity(state: AgentState) -> dict:
    return _critic_gate(
        state,
        critic_id="critic_microenvironment_validity",
        evidence_keys=["spatial_tme_results"],
        reject_to="spatial_tme",
        max_retries=3,
    )`,
  },
  evo2_fitness: {
    realWorldInput: 'External model/API payload. RNAgent should pass sequence pointers, not run foundation models in state.',
    realWorldOutput: 'Mutation fitness summary and vulnerable-domain intervals.',
    code: `def query_evo2_fitness(sequence_artifact: str) -> dict:
    return evo2_service.predict({
        "sequence_artifact": sequence_artifact,
        "output": "variant_fitness_landscape",
    })`,
  },
  esm3_design: {
    realWorldInput: 'External ESM3-compatible service request.',
    realWorldOutput: 'Design constraints or candidate binders as records, not model weights.',
    code: `def query_esm3_design(target_artifact: str) -> dict:
    return esm3_service.generate({
        "target": target_artifact,
        "task": "binder_design",
        "num_candidates": 16,
    })`,
  },
  sync_gateway: {
    realWorldInput: 'Node-instance outputs from parallel branches.',
    realWorldOutput: 'Joined translation_brief with branch completion metadata.',
    code: `def node_sync_gateway(state: AgentState) -> dict:
    required = node_instance_config(state, state["current_node_id"])["requires"]
    ready = all(key in state.get("node_outputs", {}) for key in required)
    return {
        "sync_status": "ready" if ready else "waiting",
        "translation_brief": summarize_required_outputs(state, required) if ready else None,
    }`,
  },
  approval_gate: {
    realWorldInput: 'Human review event from UI.',
    realWorldOutput: 'decision payload used by conditional graph routing.',
    code: `def node_approval_gate(state: AgentState) -> dict:
    approval = state.get("approval_decisions", {}).get(state["current_node_id"])
    return {
        "approval_status": approval.get("status", "pending"),
        "decision": approval.get("route", "pause"),
        "status": "awaiting_approval" if not approval else "approval_complete",
    }`,
  },
  supervisor: {
    realWorldInput: 'LLM prompt over summaries only, never raw matrices or structures.',
    realWorldOutput: 'Routing decision used by LangGraph conditional edges.',
    code: `def node_supervisor(state: AgentState) -> dict:
    prompt = build_supervisor_prompt(
        disease=state["disease_term"],
        top_genes=state.get("top_genes", [])[:5],
        history=state.get("supervisor_context", []),
        allowed_tools=state.get("sandbox_config", {}).get("allowed_agents", []),
    )
    decision = llm_json(prompt)
    return {
        "next_step": decision["next_step"],
        "supervisor_subquery": decision.get("subquery", ""),
        "supervisor_reasoning": decision.get("reasoning", ""),
    }`,
  },
  translator: {
    realWorldInput: 'An edge payload between two biological modalities.',
    realWorldOutput: 'Adapted payload with the target modality and provenance pointer.',
    code: `def translate_edge(payload: dict, source_port: str, target_port: str) -> dict:
    if (source_port, target_port) in DETERMINISTIC_TRANSLATORS:
        return DETERMINISTIC_TRANSLATORS[(source_port, target_port)](payload)
    return small_llm_json(
        model="gpt-4.1-mini",
        temperature=0,
        instruction=f"Compress {source_port} into {target_port} JSON.",
        payload=payload["summary"],
    )`,
  },
  report: {
    realWorldInput: 'Summaries, PMIDs, scores, artifact pointers, and accepted decisions.',
    realWorldOutput: 'final_report markdown and ranked hypothesis records.',
    code: `def node_generate_report(state: AgentState) -> dict:
    prompt = build_report_prompt(
        disease=state["disease_term"],
        hypotheses=state.get("hypotheses", []),
        artifacts=state.get("artifact_registry", {}),
    )
    return {
        "final_report": llm.invoke(prompt).content,
        "status": "complete",
        "progress": 100,
    }`,
  },
}

const TOOL_IMPLEMENTATIONS = Object.fromEntries(
  AGENT_CARDS.map(card => [card.type, { ...defaultImplementation(card), ...(IMPLEMENTATIONS[card.type] || ALIASES[card.type] || {}) }]),
)

export const TOOL_DOCS = AGENT_CARDS.map(card => ({
  ...card,
  implementation: TOOL_IMPLEMENTATIONS[card.type],
}))

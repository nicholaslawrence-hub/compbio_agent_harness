import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { TOOL_DOCS } from '../data/agentCatalog'

const NAV_GROUPS = [
  {
    title: 'Entry Nodes',
    description: 'Inputs that seed AgentState before computation starts.',
    types: ['count_matrix_input', 'clinical_metadata', 'study_context'],
  },
  {
    title: 'Transcriptomics (RNA)',
    description: 'Expression-derived evidence and regulatory programs.',
    types: ['run_dge', 'scenic_regulon', 'spatial_tme', 'lincs_reversion', 'literature_rag'],
  },
  {
    title: 'Target Validation',
    description: 'Evidence gates that decide whether a target is biologically worth pursuing.',
    types: ['viper_protein_activity', 'mageck_crispr', 'tcga_survival', 'enrich_ppi', 'alphafold_complex', 'evo2_fitness', 'esm3_design', 'crispr_designer'],
  },
  {
    title: 'Cheminformatics',
    description: 'Ligand generation, docking, ADMET, and known-drug annotation.',
    types: ['reinvent_generative', 'rdkit_features', 'gnina_docking', 'drug_annotation', 'pharmacogenomics_pgx'],
  },
  {
    title: 'Agentic Controls (Critics)',
    description: 'Conditional routers that approve, retry, or kill branches.',
    types: ['supervisor', 'critic_structural_tractability', 'critic_microenvironment_validity', 'report'],
  },
]

const FUNCTION_BY_TYPE = {
  count_matrix_input: 'uploadCountMatrix',
  clinical_metadata: 'uploadClinicalMetadata',
  study_context: 'node_study_context',
  sync_gateway: 'node_sync_gateway',
  approval_gate: 'node_approval_gate',
  run_dge: 'node_run_dge',
  scenic_regulon: 'run_scenic',
  spatial_tme: 'query_spatial_tme',
  lincs_reversion: 'query_lincs',
  literature_rag: 'node_literature_rag',
  viper_protein_activity: 'node_viper_protein_activity',
  mageck_crispr: 'node_mageck_crispr',
  tcga_survival: 'query_tcga_survival',
  enrich_ppi: 'node_enrich_ppi',
  alphafold_complex: 'node_alphafold_complex',
  evo2_fitness: 'query_evo2_fitness',
  esm3_design: 'query_esm3_design',
  crispr_designer: 'design_crispr_guides',
  reinvent_generative: 'node_reinvent_generative',
  rdkit_features: 'node_rdkit_features',
  gnina_docking: 'node_gnina_docking',
  drug_annotation: 'node_drug_annotation',
  pharmacogenomics_pgx: 'query_pharmgkb',
  supervisor: 'node_supervisor',
  critic_structural_tractability: 'critic_structural_tractability',
  critic_microenvironment_validity: 'critic_microenvironment_validity',
  translator: 'translate_edge',
  report: 'node_generate_report',
}

const NODE_META = {
  count_matrix_input: {
    module: 'agents.nodes',
    functionName: 'uploadCountMatrix',
    adapter: 'File upload handled in api.routes.start_sandbox_analysis',
    status: 'Input shim',
    description: 'Registers the uploaded count matrix path and makes it available to downstream expression nodes.',
    useCase: 'Wire this before DGE when the graph starts from user-uploaded RNA-seq counts.',
    reads: ['count_matrix_path', 'sample_conditions', 'condition_a', 'condition_b'],
    writes: ['study_context', 'network_topology'],
  },
  clinical_metadata: {
    module: 'agents.nodes',
    functionName: 'uploadClinicalMetadata',
    adapter: 'Optional context upload, future clinical metadata parser',
    status: 'Input shim',
    description: 'Carries patient/sample annotations into the graph so clinical and spatial nodes can use cohort context.',
    useCase: 'Wire this before TCGA or spatial nodes when batch, tumor purity, phenotype, or survival annotations should influence routing.',
    reads: ['study_context.sample_metadata', 'study_context.phenotype_table'],
    writes: ['study_context'],
  },
  study_context: {
    module: 'agents.nodes',
    functionName: 'node_study_context',
    adapter: 'sandbox_config.directive',
    status: 'Input shim',
    description: 'Injects the user directive into the shared graph state.',
    useCase: 'Wire this into supervisor and critics when a run should optimize for a specific therapeutic strategy.',
    reads: ['sandbox_config.directive', 'network_topology'],
    writes: ['study_context.study_notes', 'network_topology'],
  },
  run_dge: {
    module: 'agents.nodes',
    functionName: 'node_run_dge',
    adapter: 'tools.dge.run_dge',
    status: 'Implemented',
    description: 'Runs PyDESeq2 over uploaded counts and creates the target-gene universe.',
    useCase: 'Use this as the first computational node whenever downstream agents need top genes, fold changes, and FDR.',
    reads: ['count_matrix_path', 'sample_conditions', 'condition_a', 'condition_b'],
    writes: ['dge_results', 'all_dge_results', 'detected_genes', 'top_genes'],
  },
  viper_protein_activity: {
    module: 'agents.nodes',
    functionName: 'node_viper_protein_activity',
    adapter: 'tools.advanced_bio.run_viper_protein_activity',
    status: 'Adapter stub',
    description: 'Infers regulator protein activity from RNA evidence using VIPER and DoRothEA-style regulons.',
    useCase: 'Use this when transcript abundance may not reflect active biology and you need TF activity as a target-validation layer.',
    reads: ['top_genes', 'disease_term', 'supervisor_subquery'],
    writes: ['viper_protein_activity_results', 'supervisor_context'],
  },
  mageck_crispr: {
    module: 'agents.nodes',
    functionName: 'node_mageck_crispr',
    adapter: 'tools.advanced_bio.run_mageck_crispr',
    status: 'Adapter stub',
    description: 'Computes MAGeCK-style beta score records for CRISPR dependency evidence.',
    useCase: 'Use this after DGE to check whether an RNA-nominated target is also perturbationally essential.',
    reads: ['top_genes', 'supervisor_subquery'],
    writes: ['mageck_crispr_results', 'supervisor_context'],
  },
  reinvent_generative: {
    module: 'agents.nodes',
    functionName: 'node_reinvent_generative',
    adapter: 'tools.advanced_bio.run_reinvent_generation',
    status: 'Adapter stub',
    description: 'Generates de novo SMILES candidates from a target pocket using a REINVENT-style scoring loop.',
    useCase: 'Use this after PPI or structure nodes identify a tractable pocket and you want candidate chemistry.',
    reads: ['alphafold_complex_results', 'supervisor_subquery', 'top_genes'],
    writes: ['reinvent_generative_results', 'supervisor_context'],
  },
  gnina_docking: {
    module: 'agents.nodes',
    functionName: 'node_gnina_docking',
    adapter: 'tools.advanced_bio.run_gnina_docking',
    status: 'Adapter stub',
    description: 'Ranks ligand poses with GNINA-style CNN scores and affinity estimates.',
    useCase: 'Wire this after RDKit filtering so only plausible generated molecules are docked.',
    reads: ['reinvent_generative_results', 'supervisor_subquery', 'top_genes'],
    writes: ['gnina_docking_results', 'supervisor_context'],
  },
  rdkit_features: {
    module: 'agents.nodes',
    functionName: 'node_rdkit_features',
    adapter: 'tools.advanced_bio.calculate_rdkit_features',
    status: 'Adapter stub',
    description: 'Computes molecular fingerprints and lead-like property filters for generated SMILES.',
    useCase: 'Use this before docking to remove molecules that are obviously bad chemical matter.',
    reads: ['reinvent_generative_results', 'gnina_docking_results'],
    writes: ['rdkit_feature_results', 'supervisor_context'],
  },
}

const DEFAULT_META = {
  module: 'agents.nodes',
  adapter: 'internal node implementation',
  status: 'Implemented',
  description: '',
  useCase: '',
  reads: ['AgentState'],
  writes: ['supervisor_context'],
}

const CODE_OVERRIDES = {
  run_dge: `def node_run_dge(state: AgentState) -> dict:
    matrix_path = state.get("count_matrix_path")
    content = Path(matrix_path).read_bytes()
    matrix = parse_count_matrix_from_upload(content, Path(matrix_path).name)
    dge_df = run_dge(
        matrix,
        state["sample_conditions"],
        state["condition_a"],
        state["condition_b"],
    )
    top_df = top_upregulated(dge_df, n=settings.max_genes_for_rag)
    artifact = register_artifact(
        path=write_json_artifact(dge_df),
        kind="dge_results",
        summary=f"Full DGE table for {len(dge_df)} genes"
    )
    return {
        "dge_results": top_df.to_dict("records"),
        "all_dge_results": [],
        "detected_genes": dge_df["gene"].head(2000).tolist(),
        "top_genes": top_df["gene"].tolist(),
        "artifact_registry": {artifact["artifact_id"]: artifact},
        "status": "dge_complete",
        "progress": 20,
    }`,
  viper_protein_activity: `def node_viper_protein_activity(state: AgentState) -> dict:
    genes = _genes_for_advanced_node(state, limit=8)
    results = run_viper_protein_activity(
        genes,
        state.get("disease_term", "")
    )
    return {
        "viper_protein_activity_results": results,
        "supervisor_context": [{
            "step": "viper_protein_activity",
            "summary": "VIPER inferred TF activity from DoRothEA regulons."
        }],
        "status": "viper_protein_activity_complete",
        "progress": 56,
    }`,
  mageck_crispr: `def node_mageck_crispr(state: AgentState) -> dict:
    genes = _genes_for_advanced_node(state, limit=8)
    results = run_mageck_crispr(genes)
    return {
        "mageck_crispr_results": results,
        "supervisor_context": [{
            "step": "mageck_crispr",
            "summary": "MAGeCK MLE beta scores estimated dependency."
        }],
        "status": "mageck_crispr_complete",
        "progress": 58,
    }`,
  reinvent_generative: `def node_reinvent_generative(state: AgentState) -> dict:
    target = _genes_for_advanced_node(state, limit=3)[0]
    results = run_reinvent_generation(
        target=target,
        pocket="gnina_or_alphafold_pocket",
        n=8,
    )
    return {
        "reinvent_generative_results": results,
        "status": "reinvent_generative_complete",
        "progress": 70,
    }`,
  gnina_docking: `def node_gnina_docking(state: AgentState) -> dict:
    target = _genes_for_advanced_node(state, limit=3)[0]
    ligands = state.get("reinvent_generative_results", [])
    results = run_gnina_docking(
        target=target,
        ligands=ligands,
        receptor_pdb="auto",
    )
    return {
        "gnina_docking_results": results,
        "status": "gnina_docking_complete",
        "progress": 74,
    }`,
  rdkit_features: `def node_rdkit_features(state: AgentState) -> dict:
    ligands = state.get("reinvent_generative_results", [])
    results = calculate_rdkit_features(ligands)
    return {
        "rdkit_feature_results": results,
        "status": "rdkit_features_complete",
        "progress": 78,
    }`,
}

function metaFor(tool) {
  const implementation = tool.implementation || {}
  const nodeMeta = NODE_META[tool.type] || {}
  return {
    ...DEFAULT_META,
    ...tool,
    ...nodeMeta,
    ...implementation,
    functionName: nodeMeta.functionName
      || implementation.functionName
      || FUNCTION_BY_TYPE[tool.type]
      || `node_${tool.type}`,
  }
}

function codeFor(tool) {
  const meta = metaFor(tool)
  if (tool.implementation?.code) return tool.implementation.code
  if (CODE_OVERRIDES[tool.type]) return CODE_OVERRIDES[tool.type]
  return `def ${meta.functionName}(state: AgentState) -> dict:
    results = run_${tool.type}(
        state=state,
        disease=state.get("disease_term", ""),
    )
    return {
        "${meta.writes[0]}": results,
        "supervisor_context": [{
            "step": "${tool.type}",
            "summary": "${tool.label} emitted structured evidence."
        }],
        "status": "${tool.type}_complete",
        "progress": 60,
    }`
}

function examplesFor(tool) {
  const meta = metaFor(tool)
  const reads = meta.reads.slice(0, 4)
  const writes = meta.writes.slice(0, 4)
  const stateLines = reads.length
    ? reads.map(key => `    "${key}": "...",`).join('\n')
    : '    "node_outputs": {},'

  return [
    {
      title: 'Minimal state:',
      code: `state: AgentState = {\n${stateLines}\n}`,
    },
    {
      title: 'Run the node:',
      code: `result = ${meta.functionName}(state)\n\nfor key in ${JSON.stringify(writes)}:\n    assert key in result`,
    },
    {
      title: 'Implementation:',
      code: codeFor(tool),
    },
  ]
}

function compactSentence(text, fallback = 'Maps state input to typed tool output.') {
  const source = (text || fallback).replace(/\s+/g, ' ').trim()
  const words = source.split(' ')
  return `${words.slice(0, 15).join(' ')}${words.length > 15 ? '.' : ''}`
}

function highlightPython(code) {
  const tokenPattern = /#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:def|return|if|else|for|in|import|from|as|None|True|False|async|await|function|const|let)\b|\b(?:dict|list|str|int|float|AgentState|Path|File|FormData)\b|\b\d+\.?\d*\b|[A-Za-z_][A-Za-z0-9_]*(?=\()/g
  const lines = code.split('\n')

  return lines.map((line, lineIndex) => {
    const pieces = []
    let lastIndex = 0

    for (const match of line.matchAll(tokenPattern)) {
      if (match.index > lastIndex) pieces.push(line.slice(lastIndex, match.index))
      const token = match[0]
      let className = ''
      if (token.startsWith('#')) className = 'text-[#6a9955]'
      else if (token.startsWith('"') || token.startsWith("'")) className = 'text-[#ce9178]'
      else if (/^\d/.test(token)) className = 'text-[#b5cea8]'
      else if (/^(def|return|if|else|for|in|import|from|as|None|True|False|async|await|function|const|let)$/.test(token)) className = 'text-[#569cd6]'
      else if (/^(dict|list|str|int|float|AgentState|Path|File|FormData)$/.test(token)) className = token === 'AgentState' ? 'text-purple-400' : 'text-[#4ec9b0]'
      else className = 'text-[#dcdcaa]'
      pieces.push(<span key={`${lineIndex}-${match.index}`} className={className}>{token}</span>)
      lastIndex = match.index + token.length
    }

    if (lastIndex < line.length) pieces.push(line.slice(lastIndex))
    return <span key={lineIndex}>{pieces}{lineIndex < lines.length - 1 ? '\n' : ''}</span>
  })
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="relative rounded border border-slate-600 bg-[#202732]">
      <button type="button" onClick={copy} className="absolute right-2 top-2 grid h-7 w-7 place-items-center text-slate-300 hover:bg-slate-700 hover:text-white" aria-label={copied ? 'Copied' : 'Copy code'}>
        <Copy aria-hidden="true" size={14} strokeWidth={2} />
      </button>
      <pre
        className="overflow-auto p-4 pr-12 text-sm leading-6 text-slate-100"
        style={{ fontFamily: '"Fira Code", Consolas, "Courier New", Menlo, Monaco, monospace' }}
      >
        <code>{highlightPython(code)}</code>
      </pre>
    </div>
  )
}

function AgentStateLink() {
  return (
    <a href="#code" className="text-purple-400 underline decoration-purple-700 underline-offset-2 hover:text-purple-300">
      AgentState
    </a>
  )
}

export default function ToolsPage() {
  const grouped = useMemo(() => NAV_GROUPS.map(group => ({
    ...group,
    tools: group.types.map(type => TOOL_DOCS.find(tool => tool.type === type)).filter(Boolean),
  })), [])
  const [activeType, setActiveType] = useState(grouped[0].tools[0].type)
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(grouped.map(group => [group.title, true])))
  const active = TOOL_DOCS.find(tool => tool.type === activeType) || grouped[0].tools[0]
  const meta = metaFor(active)
  const examples = examplesFor(active)

  return (
    <div className="-mx-4 -my-6 grid min-h-[calc(100vh-4rem)] grid-cols-[14rem_minmax(0,1fr)] bg-[#15191f] sm:-mx-10 sm:-my-10">
      <aside className="sticky left-0 top-16 z-30 h-[calc(100vh-4rem)] overflow-y-auto border-r border-slate-800 bg-slate-950 px-3 py-4 sm:top-20 sm:h-[calc(100vh-5rem)]">
        <div className="mb-3">
          <Link to="/sandbox" className="text-xs font-bold uppercase tracking-wide text-slate-500 hover:text-slate-200">Back</Link>
          <h1 className="mt-2 text-base font-bold text-slate-100">Tool Docs</h1>
        </div>

        <nav className="space-y-1">
          {grouped.map(group => (
            <section key={group.title}>
              <button
                type="button"
                onClick={() => setOpenGroups(current => ({ ...current, [group.title]: !current[group.title] }))}
                className="block w-full px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100"
              >
                <span className="inline-block w-4">{openGroups[group.title] ? '-' : '+'}</span>
                {group.title}
              </button>
              {openGroups[group.title] ? (
                <div>
                  {group.tools.map(tool => {
                    const selected = tool.type === active.type
                    return (
                      <button
                        key={tool.type}
                        type="button"
                        onClick={() => setActiveType(tool.type)}
                        className={`block w-full px-2 py-1 pl-6 text-left text-xs transition-colors ${
                          selected ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                        }`}
                      >
                        {metaFor(tool).functionName}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </section>
          ))}
        </nav>
      </aside>

      <main className="min-h-[calc(100vh-4rem)] min-w-0 bg-[#15191f] px-8 py-5 font-sans text-slate-100">
        <article className="max-w-5xl">
          <header className="pb-2">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-100">{active.label}</h2>
            <div className="mt-2 text-sm">
              <p>
                <strong>{meta.functionName}</strong>
                <span>(state: <AgentStateLink />) -&gt; dict</span>
              </p>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              {compactSentence(meta.description || active.doc)}
            </p>
          </header>

          <section className="mt-3">
            <p className="bg-slate-800 px-2 py-1 text-sm font-bold">Parameters:</p>
            <dl className="mt-1.5 space-y-1.5 text-sm">
              {meta.reads.map(item => (
                <div key={item}>
                  <dt className="font-bold">{item} <span className="italic">: <AgentStateLink /> key</span></dt>
                  <dd className="pl-4 leading-6 text-slate-300">Read by {meta.functionName}.</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-3">
            <p className="bg-slate-800 px-2 py-1 text-sm font-bold">Returns:</p>
            <dl className="mt-1.5 space-y-1.5 text-sm">
              {meta.writes.map(item => (
                <div key={item}>
                  <dt className="font-bold">{item}</dt>
                  <dd className="pl-4 leading-6 text-slate-300">Mutated on <AgentStateLink />.</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="code" className="mt-4">
            <h3 className="border-b border-slate-600 pb-1 text-lg font-bold">Examples</h3>
            <div className="mt-4 space-y-5">
              {examples.map(example => (
                <div key={example.title}>
                  <p className="mb-3 text-sm text-slate-100">{example.title}</p>
                  <CodeBlock code={example.code} />
                </div>
              ))}
            </div>
          </section>
        </article>
      </main>
    </div>
  )
}

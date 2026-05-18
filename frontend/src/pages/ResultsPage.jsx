import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronLeft, Download, RefreshCw } from 'lucide-react'
import { getJobStatus, getNetworkState, resolveApproval, streamJobProgress } from '../utils/api.js'
import HypothesisCard from '../components/HypothesisCard.jsx'
import DGETable from '../components/DGETable.jsx'
import VolcanoPlot from '../components/VolcanoPlot.jsx'

const TABS = ['Hypotheses', 'DGE Results', 'Raw Data']

// Pipeline topology — supervisor's children are the agentic specialist pool
const PIPELINE_SPINE = ['run_dge', 'dge_retry', 'pathway_enrichment']
const SUPERVISOR_CHILDREN = [
  'enrich_ppi', 'literature_rag', 'drug_annotation',
  'depmap_query', 'opentargets_query', 'clinical_trials',
  'pathway_crosstalk', 'tcga_survival', 'crispr_designer',
]
const PIPELINE_TAIL = ['synthesize_hypotheses', 'generate_report']

const NODE_LABEL_OVERRIDES = { supervisor: 'SUPERVISOR' }
const nodeLabel = id => NODE_LABEL_OVERRIDES[id] ?? id

const STEP_LOGS = {
  queued:              [['INFO',    'job queued — worker pool available'],
                        ['DEBUG',   'validating count_matrix_path and sample_conditions map']],
  running:             [['INFO',    'tools/dge.py: parse_count_matrix_from_upload()'],
                        ['DEBUG',   'PyDESeq2: median-of-ratios size factor estimation'],
                        ['DEBUG',   'fitting negative binomial GLM per gene, all samples'],
                        ['DEBUG',   'BH FDR correction across full detected-gene universe'],
                        ['INFO',    'filtering: padj < 0.05, |log2FC| > 1.0, case/control']],
  dge_complete:        [['INFO',    'tools/pathway.py: building detected-gene background for ORA'],
                        ['DEBUG',   'Fisher exact on KEGG + GO-BP + Reactome (GSEApy)'],
                        ['DEBUG',   'Jaccard deduplication of redundant GO terms (thresh=0.5)'],
                        ['INFO',    'selected top 5 non-redundant pathways by adj. p-value']],
  pathway_complete:    [['INFO',    'tools/ppi.py: STRING DB REST query (combined_score >= 700)'],
                        ['DEBUG',   'collecting up to 15 high-confidence partners per gene'],
                        ['DEBUG',   'cross-referencing KNOWN_ONCOGENES — tagging partners'],
                        ['INFO',    'db/mygene.py: batch GO-MF + Reactome via MyGene.info']],
  depmap_complete:     [['INFO',    'db/depmap.py: GET /api/gene/summary_stats (Chronos_Combined)'],
                        ['DEBUG',   'parsing mean_chronos and percent_dependent per gene'],
                        ['DEBUG',   'classifying: chronos < -0.5 → dependency, pct > 90 → essential'],
                        ['INFO',    'flagging strongly_selective: cancer-type-specific lethality']],
  ot_complete:         [['INFO',    'db/opentargets.py: POST /api/v4/graphql'],
                        ['DEBUG',   'resolving HUGO symbols → Ensembl IDs via search()'],
                        ['DEBUG',   'associatedDiseases(enableIndirect=true, size=200)'],
                        ['INFO',    'decomposing: genetic_assoc, somatic_mut, known_drug, rna_expr']],
  ppi_complete:        [['INFO',    'db/pinecone_rag.py: PubMed Entrez + Semantic Scholar'],
                        ['DEBUG',   'generating text-embedding-3-small vectors per abstract'],
                        ['DEBUG',   'upserting → Pinecone: rnagent-literature namespace'],
                        ['INFO',    'semantic top-k per gene, is_dark scored by hit count']],
  rag_complete:        [['INFO',    'db/uniprot.py: reviewed SwissProt entry per gene'],
                        ['DEBUG',   'db/chembl.py: target_synonym__icontains lookup'],
                        ['DEBUG',   'resolving pref_name + max_phase via batch molecule query'],
                        ['INFO',    'sorted: (-max_phase, -pchembl_value)']],
  annotation_complete: [['INFO',    'agents/nodes.py: node_synthesize_hypotheses()'],
                        ['DEBUG',   'PubMed hit count: "{gene}[Title/Abstract] AND cancer"'],
                        ['DEBUG',   'novelty = 1.0 - log10(pub_count) / 4.0, clamped [0,1]'],
                        ['INFO',    'GPT chain-of-thought per gene via ThreadPoolExecutor']],
  supervisor_routing:  [['ROUTING', 'node_supervisor() — parsing investigation history'],
                        ['DEBUG',   '_format_supervisor_context(): accumulating context entries'],
                        ['ROUTING', 'LLM selecting: enrich_ppi | literature_rag | drug_annotation | depmap_query | opentargets_query'],
                        ['DEBUG',   'JSON parse: next_step, subquery, reasoning, prune_genes']],
  supervisor_finalizing:[['ROUTING','supervisor: evidence coverage threshold met across priority genes'],
                        ['DEBUG',   'releasing iteration guard (max_iterations=8)'],
                        ['ROUTING', 'routing → node_synthesize_hypotheses()']],
  synthesis_complete:  [['INFO',    'agents/nodes.py: node_generate_report()'],
                        ['DEBUG',   'aggregating hypotheses + pathway_hits + pruned_genes log'],
                        ['INFO',    'GPT: publication-style markdown with ranked targets'],
                        ['INFO',    'AgentState.final_report written — status = complete']],
}

const SEVERITY_COLOR = {
  INFO:    '#c8d3df',
  DEBUG:   '#e2e8f0',
  ROUTING: '#fbbf24',
  ERROR:   '#f87171',
  WARN:    '#facc15',
}

const STEP_META = {
  supervisor:        { color: '#f59e0b', label: 'SUPERVISOR' },
  enrich_ppi:        { color: '#818cf8', label: 'enrich_ppi' },
  literature_rag:    { color: '#22d3ee', label: 'literature_rag' },
  drug_annotation:   { color: '#34d399', label: 'drug_annotation' },
  depmap_query:      { color: '#fb7185', label: 'depmap_query' },
  opentargets_query: { color: '#a78bfa', label: 'opentargets_query' },
  clinical_trials:   { color: '#60a5fa', label: 'clinical_trials' },
  pathway_crosstalk: { color: '#f97316', label: 'pathway_crosstalk' },
  tcga_survival:     { color: '#e879f9', label: 'tcga_survival' },
  run_dge:           { color: '#94a3b8', label: 'run_dge' },
  pathway_enrichment:{ color: '#94a3b8', label: 'pathway_enrichment' },
}

function nodeStatus(nodeId, executionEvents) {
  const events = executionEvents.filter(e => e.node_id === nodeId)
  if (!events.length) return 'pending'
  const last = events[events.length - 1]
  if (last.status?.includes('failed')) return 'failed'
  // supervisor_routing means the supervisor just ran and is deciding — show it as active
  if (last.status === 'supervisor_routing') return 'active'
  // skipped nodes are effectively complete
  if (last.status === 'skipped_completed') return 'complete'
  // any status containing a known completion suffix counts as complete
  const DONE_SUFFIXES = ['_complete', '_loaded', '_resolved', 'complete', 'synthesis_complete']
  if (DONE_SUFFIXES.some(s => last.status?.endsWith(s) || last.status?.includes(s))) return 'complete'
  return 'pending'
}

function NodeDot({ status }) {
  const colors = {
    complete: '#22c55e',
    active:   '#f59e0b',
    failed:   '#ef4444',
    pending:  '#64748b',
  }
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        background: colors[status] || colors.pending,
        border: status === 'pending' ? '1px solid #334155' : 'none',
        flexShrink: 0,
        animation: status === 'active' ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }}
    />
  )
}

function DAGView({ executionEvents, currentStatus }) {
  const isSupervisorActive = currentStatus?.startsWith('supervisor')

  const nodeColor = (s, accentColor) => {
    if (s === 'complete') return '#e2e8f0'
    if (s === 'active') return accentColor || '#fbbf24'
    return '#94a3b8'
  }

  return (
    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, lineHeight: '1.9', color: '#ffffff' }}>
      {PIPELINE_SPINE.map(id => {
        const s = nodeStatus(id, executionEvents)
        if (s === 'pending' && id === 'dge_retry') return null
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NodeDot status={s} />
            <span style={{ color: nodeColor(s) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <NodeDot status={isSupervisorActive ? 'active' : nodeStatus('supervisor', executionEvents)} />
        <span style={{ color: isSupervisorActive ? '#fbbf24' : nodeColor(nodeStatus('supervisor', executionEvents)), fontWeight: 'bold' }}>
          SUPERVISOR
        </span>
        {isSupervisorActive && <span style={{ color: '#f59e0b', fontSize: 10, marginLeft: 4 }}>routing…</span>}
      </div>

      {SUPERVISOR_CHILDREN.map((id, i) => {
        const s = nodeStatus(id, executionEvents)
        const isLast = i === SUPERVISOR_CHILDREN.length - 1
        const meta = STEP_META[id] || {}
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#64748b', flexShrink: 0 }}>{isLast ? '└─' : '├─'}</span>
            <NodeDot status={s} />
            <span style={{ color: nodeColor(s, meta.color) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}

      {PIPELINE_TAIL.map(id => {
        const s = nodeStatus(id, executionEvents)
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: id === PIPELINE_TAIL[0] ? 2 : 0 }}>
            <NodeDot status={s} />
            <span style={{ color: nodeColor(s) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}
    </div>
  )
}

function TelemetryBlock({ entry, index, isNewest, startEpoch }) {
  const meta = STEP_META[entry.step] || STEP_META.supervisor
  const isRouter = entry.step === 'supervisor'
  const tsOffset = index * 3200
  const ts = new Date(startEpoch + tsOffset)
  const tsStr = ts.toTimeString().slice(0, 8) + '.' + String(ts.getMilliseconds()).padStart(3, '0')

  let routedTo = null
  let reasoning = entry.summary || ''
  if (isRouter && entry.summary) {
    const m = entry.summary.match(/^Decision:\s*(\w+)\.\s*(.*)/)
    if (m) { routedTo = m[1]; reasoning = m[2] }
  }

  return (
    <div style={{
      borderBottom: '1px solid #0a0f1a',
      padding: '6px 14px',
      opacity: isNewest ? 1 : 0.45,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      {/* Header line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
        <span style={{ color: meta.color || '#94a3b8', fontWeight: 700, flexShrink: 0 }}>
          {meta.label || entry.step}
        </span>
        {routedTo && (
          <span style={{ color: '#e2e8f0', flexShrink: 0 }}>→ <span style={{ color: (STEP_META[routedTo] || {}).color || '#e2e8f0' }}>{routedTo}</span></span>
        )}
        {entry.subquery && entry.subquery !== 'all top genes' && !routedTo && (
          <span style={{ color: '#e2e8f0', flexShrink: 0 }}>:<span style={{ color: '#ffffff' }}>{entry.subquery}</span></span>
        )}
      </div>

      {/* Scratchpad */}
      {reasoning && (
        <div style={{ marginLeft: '2ch', borderLeft: '1px solid #1e293b', paddingLeft: 6, marginTop: 2, marginBottom: 2 }}>
          <span style={{ color: '#64748b' }}>&lt;scratchpad&gt;</span>
          <span style={{ color: '#e2e8f0', marginLeft: 4 }}>{reasoning}</span>
          <span style={{ color: '#64748b' }}>&lt;/scratchpad&gt;</span>
        </div>
      )}

      {/* call_tool */}
      {isRouter && routedTo && (
        <div style={{ marginLeft: '2ch', borderLeft: '1px solid #1e293b', paddingLeft: 6, color: '#22d3ee', whiteSpace: 'pre', marginBottom: 1 }}>
          {'call_tool: { "name": "' + routedTo + '"' + (entry.subquery && entry.subquery !== 'all top genes' ? ', "args": { "target": "' + entry.subquery + '" }' : '') + ' }'}
        </div>
      )}
    </div>
  )
}

function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${s}s`
}

export default function ResultsPage() {
  const { jobId } = useParams()
  const [job, setJob] = useState(null)
  const [tab, setTab] = useState('Hypotheses')
  const [error, setError] = useState('')
  const [supervisorLog, setSupervisorLog] = useState([])
  const [executionEvents, setExecutionEvents] = useState([])
  const [promptPayloads, setPromptPayloads] = useState([])
  const [networkTopology, setNetworkTopology] = useState(null)
  const [checkpoint, setCheckpoint] = useState(null)
  const [approvalBusy, setApprovalBusy] = useState('')
  const telemetryRef = useRef(null)
  const terminalRef = useRef(null)
  const startEpochRef = useRef(Date.now())

  useEffect(() => {
    getNetworkState(jobId)
      .then(data => {
        setCheckpoint(data.checkpoint)
        if (data.checkpoint?.network_topology) setNetworkTopology(data.checkpoint.network_topology)
        if (data.checkpoint?.execution_events?.length) setExecutionEvents(data.checkpoint.execution_events)
        if (data.checkpoint?.prompt_payloads?.length) setPromptPayloads(data.checkpoint.prompt_payloads)
      })
      .catch(() => {})
    getJobStatus(jobId)
      .then(data => {
        setJob(data)
        if (data.network_topology) setNetworkTopology(data.network_topology)
        if (data.execution_events?.length) setExecutionEvents(data.execution_events)
        if (data.prompt_payloads?.length) setPromptPayloads(data.prompt_payloads)
      })
      .catch(e => setError(e.message))
    const stop = streamJobProgress(
      jobId,
      (data) => {
        setJob(prev => ({ ...prev, ...data }))
        if (data.supervisor_context?.length) {
          setSupervisorLog(data.supervisor_context)
        }
        if (data.execution_events?.length) setExecutionEvents(data.execution_events)
        if (data.prompt_payloads?.length) setPromptPayloads(data.prompt_payloads)
        if (data.network_topology) setNetworkTopology(data.network_topology)
        setCheckpoint(prev => ({
          ...(prev || {}),
          node_outputs:     data.node_outputs      || prev?.node_outputs      || {},
          artifact_registry: data.artifact_registry || prev?.artifact_registry || {},
          pending_tasks:    data.pending_tasks      || prev?.pending_tasks      || {},
          approval_requests: data.approval_requests || prev?.approval_requests || {},
          provenance_ledger: data.provenance_ledger || prev?.provenance_ledger  || [],
        }))
      },
      (data) => {
        setJob(prev => ({ ...prev, ...data }))
        getJobStatus(jobId).then(setJob).catch(() => {})
      }
    )
    return stop
  }, [jobId])

  useEffect(() => {
    if (telemetryRef.current) telemetryRef.current.scrollTop = telemetryRef.current.scrollHeight
  }, [supervisorLog.length])

  const isRunning = job && !['complete', 'failed', 'dge_failed'].includes(job.status)
  const result = job?.result ?? {}
  const hypotheses = result.hypotheses ?? []
  const dgeResults = result.dge_results ?? []
  const report = result.final_report ?? ''

  const startTimeRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!isRunning) { startTimeRef.current = null; setElapsed(0); return }
    if (!startTimeRef.current) startTimeRef.current = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const [logLineIdx, setLogLineIdx] = useState(0)
  const prevStatusRef = useRef(null)
  useEffect(() => {
    if (job?.status !== prevStatusRef.current) { prevStatusRef.current = job?.status; setLogLineIdx(0) }
  }, [job?.status])
  useEffect(() => {
    if (!isRunning) return
    const logs = STEP_LOGS[job?.status] ?? []
    if (logLineIdx >= logs.length - 1) return
    const id = setTimeout(() => setLogLineIdx(i => i + 1), 1600)
    return () => clearTimeout(id)
  }, [isRunning, job?.status, logLineIdx])

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [logLineIdx])

  const currentLogs = STEP_LOGS[job?.status] ?? []
  const allTerminalLines = currentLogs.slice(0, logLineIdx + 1)

  const approvalRequests = Object.entries(checkpoint?.approval_requests || {})
    .filter(([, req]) => req?.status === 'awaiting_user_approval' || req?.decision)

  const handleApproval = async (nodeId, decision) => {
    setApprovalBusy(`${nodeId}:${decision}`)
    try {
      const res = await resolveApproval(jobId, nodeId, decision)
      setCheckpoint(res.checkpoint)
      setJob(prev => ({ ...(prev || {}), status: 'queued' }))
    } finally {
      setApprovalBusy('')
    }
  }

  const downloadReport = () => {
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rnagent_report_${jobId.slice(0, 8)}.md`; a.click()
  }

  const statusColor = job?.status === 'complete' ? '#22c55e' : job?.status === 'failed' ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ maxWidth: '100%', padding: '0' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 0', marginBottom: 8,
        borderBottom: '1px solid #0f172a',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
      }}>
        <Link to="/" style={{
          color: '#0f172a', background: '#f59e0b', textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', fontWeight: 700, fontSize: 12,
        }}>
          <ChevronLeft size={13} /> new analysis
        </Link>
        {isRunning && (
          <RefreshCw size={12} style={{ color: '#f59e0b', animation: 'spin 2s linear infinite' }} />
        )}
      </div>

      {/* Execution dashboard */}
      {isRunning && (
        <div style={{ background: '#080c12', border: '1px solid #0f172a', marginBottom: 8 }}>

          {/* Main two-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', borderBottom: '1px solid #0f172a' }}>

            {/* LEFT: DAG view */}
            <div style={{
              borderRight: '1px solid #0f172a',
              padding: '12px 16px',
              background: '#060a10',
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: '#64748b',
                letterSpacing: '0.08em',
                marginBottom: 10,
                textTransform: 'uppercase',
              }}>
                NODE GRAPH
              </div>
              <DAGView executionEvents={executionEvents} currentStatus={job?.status} />
            </div>

            {/* RIGHT: Terminal + Telemetry stacked */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>

              {/* Telemetry feed */}
              <div
                ref={telemetryRef}
                style={{
                  height: 320,
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#1e293b transparent',
                }}
              >
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                  color: '#64748b',
                  letterSpacing: '0.08em',
                  padding: '8px 14px 5px',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid #0a0f1a',
                }}>
                  AGENT TELEMETRY — supervisor_context[{supervisorLog.length}]
                </div>
                {supervisorLog.length === 0 && (
                  <div style={{ padding: '12px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#64748b' }}>
                    awaiting first supervisor tick…
                  </div>
                )}
                {supervisorLog.map((entry, i) => (
                  <TelemetryBlock
                    key={i}
                    entry={entry}
                    index={i}
                    isNewest={i === supervisorLog.length - 1}
                    startEpoch={startEpochRef.current}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom grid: Artifacts | Pending | Provenance */}
          {checkpoint && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              {[
                { label: 'ARTIFACTS', data: checkpoint.artifact_registry || {} },
                { label: 'PENDING_TASKS', data: checkpoint.pending_tasks || {} },
                { label: 'PROVENANCE[-3:]', data: (checkpoint.provenance_ledger || []).slice(-3) },
              ].map(({ label, data }, i) => (
                <div key={label} style={{
                  borderRight: i < 2 ? '1px solid #0f172a' : 'none',
                  padding: '8px 14px',
                  background: '#060a10',
                }}>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 11,
                    color: '#64748b',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    {label}
                  </div>
                  <pre style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 12,
                    color: '#94a3b8',
                    maxHeight: 110,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                    scrollbarWidth: 'none',
                  }}>
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approval gates */}
      {approvalRequests.length > 0 && (
        <div style={{
          border: '1px solid #451a03',
          background: '#1c0a00',
          padding: '8px 10px',
          marginBottom: 8,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
        }}>
          <div style={{ color: '#f59e0b', fontSize: 10, letterSpacing: '0.1em', marginBottom: 6 }}>
            [GATE] APPROVAL_REQUIRED
          </div>
          {approvalRequests.map(([nodeId, req]) => (
            <div key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: '#92400e' }}>node:{nodeId}</span>
              <span style={{ color: '#78350f' }}>{req.summary || 'Supervisor paused for human review.'}</span>
              {req.decision
                ? <span style={{ color: '#f59e0b' }}>decision:{req.decision}</span>
                : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleApproval(nodeId, 'approved')}
                      disabled={approvalBusy !== ''}
                      style={{ border: '1px solid #166534', background: '#052e16', color: '#86efac', padding: '2px 10px', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}
                    >approve</button>
                    <button
                      type="button"
                      onClick={() => handleApproval(nodeId, 'rejected')}
                      disabled={approvalBusy !== ''}
                      style={{ border: '1px solid #7f1d1d', background: '#1c0606', color: '#fca5a5', padding: '2px 10px', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}
                    >reject</button>
                  </div>
                )
              }
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ border: '1px solid #7f1d1d', background: '#0a0202', color: '#f87171', padding: '6px 10px', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          [ERROR] {error}
        </div>
      )}
      {job?.errors?.length > 0 && (
        <div style={{ border: '1px solid #451a03', background: '#0c0600', padding: '6px 10px', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          <div style={{ color: '#f59e0b', marginBottom: 3 }}>[WARN]</div>
          {job.errors.map((e, i) => <div key={i} style={{ color: '#92400e' }}>{e}</div>)}
        </div>
      )}

      {/* Results tabs */}
      {!isRunning && (hypotheses.length > 0 || dgeResults.length > 0) && (
        <>
          <div className="flex gap-1 border-b border-slate-800 pb-0 mt-2">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  tab === t ? 'bg-slate-900 text-white border border-b-slate-900 border-slate-800' : 'text-white/40 hover:text-white/80'
                }`}
              >
                {t}
                {t === 'Hypotheses' && hypotheses.length > 0 && (
                  <span className="ml-1.5 bg-indigo-900/40 text-indigo-400 text-xs px-1.5 py-0.5 rounded-full">
                    {hypotheses.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'Hypotheses' && (
              <div className="space-y-4">
{hypotheses.length === 0
                  ? <p className="text-white/40 text-sm text-center py-12">No hypotheses generated.</p>
                  : hypotheses.slice().sort((a, b) => (b.novelty_score ?? 0) - (a.novelty_score ?? 0))
                      .map((h, i) => <HypothesisCard key={i} hypothesis={h} rank={i + 1} />)
                }
              </div>
            )}

            {tab === 'DGE Results' && (
              <div className="space-y-6">
                <div className="card">
                  <h3 className="text-sm font-semibold text-white mb-4">Volcano Plot</h3>
                  <VolcanoPlot results={dgeResults} />
                </div>
                <div className="card">
                  <h3 className="text-sm font-semibold text-white mb-4">
                    Top Upregulated Genes
                    <span className="ml-2 text-xs text-white/40">({dgeResults.length} genes)</span>
                  </h3>
                  <DGETable results={dgeResults} />
                </div>
              </div>
            )}

{tab === 'Raw Data' && (
              <div className="card">
                <h3 className="text-sm font-semibold text-white mb-4">Raw Agent Network Output</h3>
                <pre className="font-mono text-xs text-white/50 overflow-auto max-h-[600px] bg-gray-950 rounded-lg p-4">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </>
      )}

      {!isRunning && !error && hypotheses.length === 0 && dgeResults.length === 0 && (
        <div className="card text-center py-16">
          <p className="text-white/40" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            awaiting results…
          </p>
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
      `}</style>
    </div>
  )
}

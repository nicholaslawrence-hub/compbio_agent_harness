import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronLeft, RefreshCw } from 'lucide-react'
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
  'pathway_crosstalk', 'tcga_survival', 'alphafold_complex',
  'crispr_designer', 'viper_protein_activity', 'mageck_crispr',
]
const PIPELINE_TAIL = ['synthesize_hypotheses', 'generate_report']

const NODE_LABEL_OVERRIDES = { supervisor: 'SUPERVISOR' }
const nodeLabel = id => NODE_LABEL_OVERRIDES[id] ?? id


const STEP_META = {
  supervisor:        { color: '#f59e0b', label: 'SUPERVISOR' },
  enrich_ppi:        { color: '#818cf8', label: 'enrich_ppi' },
  literature_rag:    { color: '#22d3ee', label: 'literature_rag' },
  drug_annotation:   { color: '#34d399', label: 'drug_annotation' },
  depmap_query:      { color: '#fb7185', label: 'depmap_query' },
  opentargets_query: { color: '#a78bfa', label: 'opentargets_query' },
  clinical_trials:   { color: '#60a5fa', label: 'clinical_trials' },
  pathway_crosstalk: { color: '#f97316', label: 'pathway_crosstalk' },
  tcga_survival:          { color: '#e879f9', label: 'tcga_survival' },
  alphafold_complex:      { color: '#38bdf8', label: 'alphafold_complex' },
  crispr_designer:        { color: '#4ade80', label: 'crispr_designer' },
  viper_protein_activity: { color: '#c084fc', label: 'viper_protein_activity' },
  mageck_crispr:          { color: '#f472b6', label: 'mageck_crispr' },
  run_dge:                { color: '#94a3b8', label: 'run_dge' },
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

const STATUS_GLYPH = {
  complete: { text: 'ok',  color: '#22c55e' },
  active:   { text: '>>', color: '#f59e0b' },
  failed:   { text: '!!',  color: '#ef4444' },
  pending:  { text: '--',  color: '#334155' },
}

function StatusTag({ status }) {
  const { text, color } = STATUS_GLYPH[status] || STATUS_GLYPH.pending
  return (
    <span style={{ color, flexShrink: 0, minWidth: '2ch', letterSpacing: '0.05em' }}>{text}</span>
  )
}

function flattenTopologyNodes(topology) {
  return (topology?.nodes ?? [])
    .filter(n => n.type !== 'supervisorGroup')
    .map(n => ({
      id:    n.id,
      type:  n.data?.type  || n.type  || n.id,
      label: n.data?.label || n.label || n.id,
    }))
}

function DAGView({ executionEvents, networkTopology }) {
  const nameColor = (s, accentColor) => {
    if (s === 'complete') return '#e2e8f0'
    if (s === 'active')   return accentColor || '#e2e8f0'
    return '#94a3b8'
  }

  const BASE = { fontFamily: 'JetBrains Mono, monospace', fontSize: 17, lineHeight: '2.0', color: '#ffffff' }
  const ROW  = { display: 'flex', alignItems: 'center', gap: 8 }

  // Sandbox run: derive nodes from the saved topology
  if (networkTopology?.nodes?.length) {
    return (
      <div style={BASE}>
        {flattenTopologyNodes(networkTopology).map(node => {
          const s    = nodeStatus(node.type, executionEvents)
          const meta = STEP_META[node.type] || {}
          return (
            <div key={node.id} style={ROW}>
              <StatusTag status={s} />
              <span style={{ color: nameColor(s, meta.color) }}>{node.label}</span>
            </div>
          )
        })}
      </div>
    )
  }

  // Standard run: hardcoded pipeline shape
  const supStatus = nodeStatus('supervisor', executionEvents)
  return (
    <div style={BASE}>
      {PIPELINE_SPINE.map(id => {
        const s = nodeStatus(id, executionEvents)
        if (s === 'pending' && id === 'dge_retry') return null
        return (
          <div key={id} style={ROW}>
            <StatusTag status={s} />
            <span style={{ color: nameColor(s) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}

      <div style={ROW}>
        <StatusTag status={supStatus} />
        <span style={{ color: nameColor(supStatus, '#f59e0b'), fontWeight: 'bold' }}>SUPERVISOR</span>
      </div>

      {SUPERVISOR_CHILDREN.map((id, i) => {
        const s      = nodeStatus(id, executionEvents)
        const isLast = i === SUPERVISOR_CHILDREN.length - 1
        const meta   = STEP_META[id] || {}
        return (
          <div key={id} style={{ ...ROW, paddingLeft: 14, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#334155', flexShrink: 0 }}>{isLast ? '└' : '├'}</span>
            <StatusTag status={s} />
            <span style={{ color: nameColor(s, meta.color) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}

      {PIPELINE_TAIL.map(id => {
        const s = nodeStatus(id, executionEvents)
        return (
          <div key={id} style={ROW}>
            <StatusTag status={s} />
            <span style={{ color: nameColor(s) }}>{nodeLabel(id)}</span>
          </div>
        )
      })}
    </div>
  )
}

function TerminalLine({ entry, isNewest, isActive }) {
  const meta      = STEP_META[entry.step] || {}
  const isRouter  = entry.step === 'supervisor'
  const nodeColor = meta.color || '#94a3b8'

  let callTarget = null
  let reasoning  = ''
  if (isRouter && entry.summary) {
    const m = entry.summary.match(/^Decision:\s*(\w+)\.\s*(.*)/)
    if (m) { callTarget = m[1]; reasoning = m[2] }
  }

  const hasQuery = entry.subquery && entry.subquery !== 'all top genes'

  return (
    <div style={{
      padding: '4px 14px',
      opacity: isNewest ? 1 : 0.4,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      lineHeight: 1.7,
      borderBottom: '1px solid #060a10',
    }}>
      {isRouter && callTarget ? (
        <>
          <div>
            <span style={{ color: '#334155' }}>[</span>
            <span style={{ color: '#f59e0b' }}>supervisor</span>
            <span style={{ color: '#334155' }}>]</span>
            {'  '}
            <span style={{ color: '#f59e0b' }}>call_tool</span>
            <span style={{ color: '#64748b' }}>(</span>
            <span style={{ color: (STEP_META[callTarget] || {}).color || '#22d3ee' }}>"{callTarget}"</span>
            {hasQuery && (
              <><span style={{ color: '#64748b' }}>, </span>
              <span style={{ color: '#475569' }}>{`{"query":"${entry.subquery}"}`}</span></>
            )}
            <span style={{ color: '#64748b' }}>)</span>
          </div>
          {reasoning && (
            <div style={{ paddingLeft: '2ch', color: '#334155', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {reasoning.length > 140 ? reasoning.slice(0, 140) + '…' : reasoning}
            </div>
          )}
        </>
      ) : (
        <div>
          <span style={{ color: '#334155' }}>[</span>
          <span style={{ color: nodeColor }}>{entry.step}</span>
          <span style={{ color: '#334155' }}>]</span>
          {'  '}
          <span style={{ color: '#22c55e' }}>ok</span>
          {'  '}
          <span style={{ color: '#94a3b8' }}>{entry.summary || entry.subquery || entry.status || ''}</span>
          {isActive && <span style={{ color: '#f59e0b', animation: 'blink 1s step-end infinite' }}> ▌</span>}
        </div>
      )}
    </div>
  )
}


export default function ResultsPage() {
  const { jobId } = useParams()
  const [job, setJob] = useState(null)
  const [tab, setTab] = useState('Hypotheses')
  const [error, setError] = useState('')
  const [supervisorLog, setSupervisorLog] = useState([])
  const [executionEvents, setExecutionEvents] = useState([])
  const [networkTopology, setNetworkTopology] = useState(null)
  const [checkpoint, setCheckpoint] = useState(null)
  const [approvalBusy, setApprovalBusy] = useState('')
  const telemetryRef = useRef(null)

  useEffect(() => {
    getNetworkState(jobId)
      .then(data => {
        setCheckpoint(data.checkpoint)
        if (data.checkpoint?.network_topology) setNetworkTopology(data.checkpoint.network_topology)
        if (data.checkpoint?.execution_events?.length) setExecutionEvents(data.checkpoint.execution_events)
      })
      .catch(() => {})
    getJobStatus(jobId)
      .then(data => {
        setJob(data)
        if (data.network_topology) setNetworkTopology(data.network_topology)
        if (data.execution_events?.length) setExecutionEvents(data.execution_events)
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
        if (data.network_topology) setNetworkTopology(data.network_topology)
        setCheckpoint(prev => ({
          ...(prev || {}),
          node_outputs:      data.node_outputs      || prev?.node_outputs      || {},
          node_status:       data.node_status       || prev?.node_status       || {},
          artifact_registry: data.artifact_registry || prev?.artifact_registry || {},
          approval_requests: data.approval_requests || prev?.approval_requests || {},
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

  // Merge spine execution events + supervisor context into one chronological stream.
  // executionEvents covers run_dge / pathway_enrichment; supervisorLog covers the rest.
  const terminalEntries = (() => {
    const spineIds = new Set([...PIPELINE_SPINE, ...PIPELINE_TAIL])
    const spineEvents = executionEvents
      .filter(e => spineIds.has(e.node_id || e.step))
      .map(e => ({ step: e.node_id || e.step, subquery: '', summary: e.status || '', _isSpine: true }))
    return [...spineEvents, ...supervisorLog]
  })()

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

          {/* Two-column: DAG | Telemetry */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr' }}>

            {/* LEFT: DAG view */}
            <div style={{ borderRight: '1px solid #0f172a', padding: '14px 18px', background: '#060a10' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#64748b', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
                NODE GRAPH
              </div>
              <DAGView executionEvents={executionEvents} networkTopology={networkTopology} />
            </div>

            {/* RIGHT: Terminal event stream */}
            <div
              ref={telemetryRef}
              style={{ height: 520, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
            >
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#64748b', letterSpacing: '0.08em', padding: '8px 14px 5px', textTransform: 'uppercase', borderBottom: '1px solid #0a0f1a' }}>
                EXECUTION LOG — {terminalEntries.length} events
              </div>
              {terminalEntries.length === 0 && (
                <div style={{ padding: '14px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#334155' }}>
                  {'>'} waiting for first node…<span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
                </div>
              )}
              {terminalEntries.map((entry, i) => (
                <TerminalLine
                  key={i}
                  entry={entry}
                  isNewest={i === terminalEntries.length - 1}
                  isActive={isRunning && i === terminalEntries.length - 1}
                />
              ))}
            </div>
          </div>
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
                onClick={() => { setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
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

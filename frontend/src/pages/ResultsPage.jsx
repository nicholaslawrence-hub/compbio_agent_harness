import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronLeft, Download, RefreshCw } from 'lucide-react'
import { getJobStatus, getNetworkState, resolveApproval, streamJobProgress } from '../utils/api.js'
import NetworkExecutionVisualizer from '../components/NetworkExecutionVisualizer.jsx'
import HypothesisCard from '../components/HypothesisCard.jsx'
import DGETable from '../components/DGETable.jsx'
import VolcanoPlot from '../components/VolcanoPlot.jsx'

const TABS = ['Hypotheses', 'DGE Results', 'Report', 'Raw Data']

const AGENT_STEP_META = {
  supervisor:          { label: 'Director',        color: 'text-amber-300',   dot: 'bg-amber-400',   border: 'border-amber-900/50',   bg: 'bg-amber-950/30'   },
  enrich_ppi:          { label: 'PPI Network',     color: 'text-indigo-300',  dot: 'bg-indigo-400',  border: 'border-indigo-900/50',  bg: 'bg-indigo-950/25'  },
  literature_rag:      { label: 'Literature RAG',  color: 'text-cyan-300',    dot: 'bg-cyan-400',    border: 'border-cyan-900/50',    bg: 'bg-cyan-950/25'    },
  drug_annotation:     { label: 'Drug Annotation', color: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-900/50', bg: 'bg-emerald-950/25' },
  depmap_query:        { label: 'DepMap CRISPR',   color: 'text-rose-300',    dot: 'bg-rose-400',    border: 'border-rose-900/50',    bg: 'bg-rose-950/25'    },
  opentargets_query:   { label: 'OpenTargets',     color: 'text-violet-300',  dot: 'bg-violet-400',  border: 'border-violet-900/50',  bg: 'bg-violet-950/25'  },
}

const STEP_LOGS = {
  queued: [
    '> job queued, worker pool available...',
    '> validating count matrix path and sample condition map...',
  ],
  running: [
    '> tools/dge.py: parse_count_matrix_from_upload()...',
    '> PyDESeq2: median-of-ratios size factor estimation...',
    '> fitting negative binomial GLM per gene, all samples...',
    '> BH FDR correction across full detected-gene universe...',
    '> filtering: padj < 0.05, |log2FC| > 1.0, condition_a / condition_b...',
  ],
  dge_complete: [
    '> tools/pathway.py: building detected-gene background for ORA...',
    '> Fisher exact test on KEGG, GO BP, Reactome gene sets (GSEApy)...',
    '> Jaccard deduplication of redundant GO terms (threshold 0.5)...',
    '> selecting top 5 non-redundant pathways by adjusted p-value...',
  ],
  pathway_complete: [
    '> tools/ppi.py: STRING DB REST query (combined_score >= 700)...',
    '> collecting up to 15 high-confidence interaction partners per gene...',
    '> cross-referencing KNOWN_ONCOGENES set, tagging partners...',
    '> db/mygene.py: batch GO MF + Reactome annotation via MyGene.info...',
  ],
  depmap_complete: [
    '> db/depmap.py: GET /api/gene/summary_stats (Chronos_Combined)...',
    '> parsing mean Chronos score and percent_dependent per gene...',
    '> classifying: chronos < -0.5 = dependency, pct > 90 = common essential...',
    '> flagging strongly_selective: cancer-type specific lethality...',
  ],
  ot_complete: [
    '> db/opentargets.py: POST /api/v4/graphql...',
    '> resolving HUGO symbols to Ensembl IDs via search()...',
    '> querying associatedDiseases (enableIndirect=true, size=200)...',
    '> decomposing scores: genetic_association, somatic_mutation, known_drug, rna_expression...',
  ],
  ppi_complete: [
    '> db/pinecone_rag.py: PubMed Entrez + Semantic Scholar fetch...',
    '> generating text-embedding-3-small vectors for each abstract...',
    '> upserting to Pinecone index: rnagent-literature...',
    '> semantic top-k search per gene, is_dark scoring by hit count...',
  ],
  rag_complete: [
    '> db/uniprot.py: reviewed SwissProt entry per gene...',
    '> db/chembl.py: target_synonym__icontains lookup...',
    '> resolving pref_name + max_phase via batch molecule query...',
    '> sorting by (-max_phase, -pchembl_value), 0 compounds = white space...',
  ],
  annotation_complete: [
    '> agents/nodes.py: node_synthesize_hypotheses()...',
    '> PubMed hit count per gene: "{gene}[Title/Abstract] AND cancer"...',
    '> novelty score: 1.0 - log10(pub_count) / 4.0, clamped [0, 1]...',
    '> GPT-5.4-mini chain-of-thought per gene via ThreadPoolExecutor...',
  ],
  supervisor_routing: [
    '> agents/nodes.py: node_supervisor(), parsing investigation history...',
    '> _format_supervisor_context(): formatting accumulated context entries...',
    '> LLM selecting from enrich_ppi / literature_rag / drug_annotation / depmap_query / opentargets_query...',
    '> JSON parse: next_step, subquery, reasoning, prune_genes...',
  ],
  supervisor_finalizing: [
    '> supervisor: evidence coverage threshold met across priority genes...',
    '> releasing iteration guard (max 8 loops)...',
    '> routing to node_synthesize_hypotheses()...',
  ],
  synthesis_complete: [
    '> agents/nodes.py: node_generate_report()...',
    '> aggregating hypotheses list, pathway hits, pruned_genes log...',
    '> GPT-5.4-mini: publication-style markdown with ranked targets...',
    '> writing to AgentState.final_report, status = complete...',
  ],
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
  const [newLogIdx, setNewLogIdx] = useState(-1)
  const agentLogRef = useRef(null)

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
          setSupervisorLog(prev => {
            const incoming = data.supervisor_context
            if (incoming.length > prev.length) {
              setNewLogIdx(incoming.length - 1)
              setTimeout(() => setNewLogIdx(-1), 1800)
            }
            return incoming
          })
        }
        if (data.execution_events?.length) setExecutionEvents(data.execution_events)
        if (data.prompt_payloads?.length) setPromptPayloads(data.prompt_payloads)
        if (data.network_topology) setNetworkTopology(data.network_topology)
        setCheckpoint(prev => ({
          ...(prev || {}),
          node_outputs: data.node_outputs || prev?.node_outputs || {},
          artifact_registry: data.artifact_registry || prev?.artifact_registry || {},
          pending_tasks: data.pending_tasks || prev?.pending_tasks || {},
          approval_requests: data.approval_requests || prev?.approval_requests || {},
          provenance_ledger: data.provenance_ledger || prev?.provenance_ledger || [],
        }))
      },
      (data) => {
        setJob(prev => ({ ...prev, ...data }))
        getJobStatus(jobId).then(setJob).catch(() => {})
      }
    )
    return stop
  }, [jobId])

  // Auto-scroll agent log to bottom when new entries arrive
  useEffect(() => {
    if (agentLogRef.current) {
      agentLogRef.current.scrollTop = agentLogRef.current.scrollHeight
    }
  }, [supervisorLog.length])

  const isRunning = job && !['complete', 'failed', 'dge_failed'].includes(job.status)
  const result = job?.result ?? {}
  const hypotheses = result.hypotheses ?? []
  const dgeResults = result.dge_results ?? []
  const report = result.final_report ?? ''

  // Elapsed timer
  const startTimeRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isRunning) {
      startTimeRef.current = null
      setElapsed(0)
      return
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now()
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isRunning])

  // Mini-terminal log cycling
  const [logLineIdx, setLogLineIdx] = useState(0)
  const prevStatusRef = useRef(null)

  useEffect(() => {
    if (job?.status !== prevStatusRef.current) {
      prevStatusRef.current = job?.status
      setLogLineIdx(0)
    }
  }, [job?.status])

  useEffect(() => {
    if (!isRunning) return
    const logs = STEP_LOGS[job?.status] ?? []
    if (logLineIdx >= logs.length - 1) return
    const id = setTimeout(() => setLogLineIdx(i => i + 1), 1600)
    return () => clearTimeout(id)
  }, [isRunning, job?.status, logLineIdx])

  const currentLogs = STEP_LOGS[job?.status] ?? []
  const visibleTerminalLines = currentLogs.slice(0, logLineIdx + 1).slice(-4)
  const approvalRequests = Object.entries(checkpoint?.approval_requests || {})
    .filter(([, request]) => request?.status === 'awaiting_user_approval' || request?.decision)

  const handleApproval = async (nodeId, decision) => {
    setApprovalBusy(`${nodeId}:${decision}`)
    try {
      const res = await resolveApproval(jobId, nodeId, decision)
      setCheckpoint(res.checkpoint)
      setJob((prev) => ({ ...(prev || {}), status: 'queued' }))
    } finally {
      setApprovalBusy('')
    }
  }

  const downloadReport = () => {
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rnagent_report_${jobId.slice(0, 8)}.md`
    a.click()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors">
          <ChevronLeft size={16} /> New Analysis
        </Link>
        <span className="text-xs text-white/30">Job: {jobId.slice(0, 8)}…</span>
      </div>

      {/* Progress card */}
      {isRunning && (
        <div
          className="space-y-6 rounded-xl p-7"
          style={{
            background: 'rgba(15,23,42,0.80)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <RefreshCw size={18} className="text-indigo-400 animate-spin shrink-0" />
            <h2 className="text-lg font-bold text-white tracking-tight">Analysis Running</h2>
            <span className="text-base text-indigo-300/80 font-semibold ml-1">
              {job?.progress ?? 0}%
            </span>
            {elapsed > 0 && (
              <span className="text-xs text-white/30 ml-auto">
                {formatElapsed(elapsed)} elapsed
              </span>
            )}
          </div>

          <NetworkExecutionVisualizer
            progress={job?.progress ?? 0}
            status={job?.status}
            topology={networkTopology || job?.network_topology}
            executionEvents={executionEvents}
            promptPayloads={promptPayloads}
          />

          {approvalRequests.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-950/20 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-200 mb-3">Approval Gates</p>
              <div className="space-y-3">
                {approvalRequests.map(([nodeId, request]) => (
                  <div key={nodeId} className="flex flex-col gap-3 rounded-md border border-slate-700 bg-slate-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{nodeId}</p>
                      <p className="text-xs text-slate-300">{request.summary || 'Supervisor paused for human review.'}</p>
                      {request.decision && <p className="mt-1 text-xs text-amber-200">Decision: {request.decision}</p>}
                    </div>
                    {!request.decision && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApproval(nodeId, 'approved')}
                          disabled={approvalBusy !== ''}
                          className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproval(nodeId, 'rejected')}
                          disabled={approvalBusy !== ''}
                          className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          Reject & Reroute
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {checkpoint && (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Artifacts</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(checkpoint.artifact_registry || {}, null, 2)}</pre>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Pending Work</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(checkpoint.pending_tasks || {}, null, 2)}</pre>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Provenance Ledger</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify((checkpoint.provenance_ledger || []).slice(-3), null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Mini-terminal */}
          {visibleTerminalLines.length > 0 && (
            <div
              className="rounded-lg p-4 font-mono text-xs leading-relaxed space-y-1"
              style={{
                background: 'rgba(2,6,23,0.85)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {visibleTerminalLines.map((line, i) => (
                <div
                  key={i}
                  className={i === visibleTerminalLines.length - 1 ? 'text-white/80' : 'text-white/30'}
                >
                  {line}
                  {i === visibleTerminalLines.length - 1 && (
                    <span className="cursor-blink text-white/40 ml-0.5">█</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Agent Reasoning Feed */}
          {supervisorLog.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold tracking-widest uppercase text-white/40">Agent Reasoning</span>
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-xs text-white/30 tabular-nums">{supervisorLog.length} step{supervisorLog.length !== 1 ? 's' : ''}</span>
              </div>
              <div
                ref={agentLogRef}
                className="space-y-1.5 max-h-56 overflow-y-auto pr-1"
                style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(100,116,139,0.3) transparent' }}
              >
                {supervisorLog.map((entry, i) => {
                  const meta = AGENT_STEP_META[entry.step] ?? AGENT_STEP_META.supervisor
                  const isNewest = i === supervisorLog.length - 1
                  const isNew    = i === newLogIdx
                  return (
                    <div
                      key={i}
                      className={`rounded-lg px-3 py-2 border text-xs ${meta.bg} ${meta.border} ${isNew ? 'animate-fade-in-up' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot} ${isNewest ? 'animate-pulse' : ''}`} />
                        <span className={`font-semibold text-xs uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                        {entry.subquery && entry.subquery !== 'all top genes' && (
                          <span className="text-white/40 text-xs truncate max-w-[140px]">→ {entry.subquery}</span>
                        )}
                        <span className="ml-auto text-slate-700 text-xs tabular-nums">#{i + 1}</span>
                      </div>
                      <p className={`leading-relaxed pl-3.5 ${isNewest ? 'text-white/80' : 'text-white/40'}`}>
                        {entry.summary}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card border-red-700/40 text-red-300 text-sm">{error}</div>
      )}

      {job?.errors?.length > 0 && (
        <div className="card border-yellow-700/40">
          <p className="text-xs font-semibold text-yellow-500 mb-1">Warnings</p>
          {job.errors.map((e, i) => <p key={i} className="text-xs text-yellow-300">{e}</p>)}
        </div>
      )}

      {/* Results tabs */}
      {!isRunning && (hypotheses.length > 0 || dgeResults.length > 0 || report) && (
        <>
          <div className="flex gap-1 border-b border-gray-800 pb-0">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  tab === t ? 'bg-gray-900 text-white border border-b-gray-900 border-gray-800' : 'text-white/40 hover:text-white/80'
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

          <div>
            {tab === 'Hypotheses' && (
              <div className="space-y-4">
                <p className="text-sm text-white/70">
                  Ranked by novelty score. Higher = fewer PubMed hits, lower OpenTargets evidence, no ChEMBL drugs. Computed as 1 - log10(pub_count) / 4.
                </p>
                {hypotheses.length === 0
                  ? <p className="text-white/40 text-sm text-center py-12">No hypotheses generated yet.</p>
                  : hypotheses
                      .slice()
                      .sort((a, b) => (b.novelty_score ?? 0) - (a.novelty_score ?? 0))
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

            {tab === 'Report' && (
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-white">Research Report</h3>
                  {report && (
                    <button onClick={downloadReport} className="btn-secondary flex items-center gap-1.5 text-xs">
                      <Download size={13} /> Download .md
                    </button>
                  )}
                </div>
                {report
                  ? <div className="prose-dark"><ReactMarkdown>{report}</ReactMarkdown></div>
                  : <p className="text-white/40 text-sm text-center py-12">Report not yet generated.</p>
                }
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
          <p className="text-white/40">Waiting for results…</p>
        </div>
      )}
    </div>
  )
}

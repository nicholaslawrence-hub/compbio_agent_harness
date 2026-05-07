import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronLeft, Download, RefreshCw } from 'lucide-react'
import { getJobStatus, streamJobProgress } from '../utils/api.js'
import ProgressBar from '../components/ProgressBar.jsx'
import HypothesisCard from '../components/HypothesisCard.jsx'
import DGETable from '../components/DGETable.jsx'
import VolcanoPlot from '../components/VolcanoPlot.jsx'

const TABS = ['Hypotheses', 'DGE Results', 'Report', 'Raw Data']



const STEP_LOGS = {
  queued: [
    '> Job queued — waiting for worker...',
    '> Validating input files...',
  ],
  running: [
    '> Loading count matrix...',
    '> Running PyDESeq2 negative binomial model...',
    '> Applying Benjamini–Hochberg correction...',
    '> Filtering DEGs (padj < 0.05, |log₂FC| > 1)...',
  ],
  dge_complete: [
    '> DEG analysis complete',
    '> Querying GO Biological Process gene sets...',
    '> Testing KEGG pathways (Fisher\'s exact test)...',
    '> Ranking pathways by adjusted p-value...',
  ],
  pathway_complete: [
    '> Querying STRING database...',
    '> Fetching high-confidence PPI partners...',
    '> Cross-referencing oncogene list...',
    '> Scoring interaction networks...',
  ],
  ppi_complete: [
    '> Fetching PubMed abstracts for top genes...',
    '> Querying Semantic Scholar API...',
    '> Upserting vectors into Pinecone index...',
    '> Running semantic search over index...',
  ],
  rag_complete: [
    '> Looking up proteins in UniProt...',
    '> Fetching domain annotations...',
    '> Searching ChEMBL for drug candidates...',
    '> Computing drug novelty scores...',
  ],
  annotation_complete: [
    '> Assembling gene context bundles...',
    '> Running GPT-5.4-mini chain-of-thought synthesis...',
    '> Scoring novelty (0–1 scale)...',
    '> Ranking hypotheses by novelty score...',
  ],
  synthesis_complete: [
    '> Building publication-style report...',
    '> Generating executive summary...',
    '> Formatting citations and evidence...',
    '> Finalizing markdown output...',
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

  useEffect(() => {
    getJobStatus(jobId).then(setJob).catch(e => setError(e.message))
    const stop = streamJobProgress(
      jobId,
      (data) => setJob(prev => ({ ...prev, ...data })),
      (data) => {
        setJob(prev => ({ ...prev, ...data }))
        getJobStatus(jobId).then(setJob).catch(() => {})
      }
    )
    return stop
  }, [jobId])

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

  const downloadReport = () => {
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pharmagpt_report_${jobId.slice(0, 8)}.md`
    a.click()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
          <ChevronLeft size={16} /> New Analysis
        </Link>
        <span className="text-xs text-gray-600 font-mono">Job: {jobId.slice(0, 8)}…</span>
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
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">Analysis Running</h2>
            <span className="text-base text-indigo-300/80 font-mono font-semibold ml-1">
              {job?.progress ?? 0}%
            </span>
            {elapsed > 0 && (
              <span className="text-xs text-slate-600 font-mono ml-auto">
                {formatElapsed(elapsed)} elapsed
              </span>
            )}
          </div>

          {/* Shimmer bar + phase dots */}
          <ProgressBar progress={job?.progress ?? 0} status={job?.status} />

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
                  className={i === visibleTerminalLines.length - 1 ? 'text-slate-300' : 'text-slate-600'}
                >
                  {line}
                  {i === visibleTerminalLines.length - 1 && (
                    <span className="cursor-blink text-slate-500 ml-0.5">█</span>
                  )}
                </div>
              ))}
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
                  tab === t ? 'bg-gray-900 text-white border border-b-gray-900 border-gray-800' : 'text-slate-500 hover:text-gray-300'
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
                <p className="text-sm text-gray-400">
                  Ranked by novelty score — higher means fewer existing drugs and more dark-gene characteristics.
                </p>
                {hypotheses.length === 0
                  ? <p className="text-slate-500 text-sm text-center py-12">No hypotheses generated yet.</p>
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
                    <span className="ml-2 text-xs text-slate-500">({dgeResults.length} genes)</span>
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
                  : <p className="text-slate-500 text-sm text-center py-12">Report not yet generated.</p>
                }
              </div>
            )}

            {tab === 'Raw Data' && (
              <div className="card">
                <h3 className="text-sm font-semibold text-white mb-4">Raw Pipeline Output</h3>
                <pre className="text-xs text-gray-400 overflow-auto max-h-[600px] bg-gray-950 rounded-lg p-4">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </>
      )}

      {!isRunning && !error && hypotheses.length === 0 && dgeResults.length === 0 && (
        <div className="card text-center py-16">
          <p className="text-slate-500">Waiting for results…</p>
        </div>
      )}
    </div>
  )
}

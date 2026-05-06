import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronLeft, Download, RefreshCw } from 'lucide-react'
import { getJobStatus, streamJobProgress } from '../utils/api.js'
import ProgressBar from '../components/ProgressBar.jsx'
import HypothesisCard from '../components/HypothesisCard.jsx'
import DGETable from '../components/DGETable.jsx'
import VolcanoPlot from '../components/VolcanoPlot.jsx'

const TABS = ['Hypotheses', 'DGE Results', 'Report', 'Raw Data']

export default function ResultsPage() {
  const { jobId } = useParams()
  const [job, setJob] = useState(null)
  const [tab, setTab] = useState('Hypotheses')
  const [error, setError] = useState('')

  useEffect(() => {
    // Initial fetch
    getJobStatus(jobId).then(setJob).catch(e => setError(e.message))

    // Stream updates
    const stop = streamJobProgress(
      jobId,
      (data) => setJob(prev => ({ ...prev, ...data })),
      (data) => {
        setJob(prev => ({ ...prev, ...data }))
        // Fetch full result once done
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

      {/* Progress */}
      {isRunning && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw size={15} className="text-pharma-400 animate-spin" />
            <h2 className="text-sm font-semibold text-white">Analysis Running…</h2>
          </div>
          <ProgressBar progress={job?.progress ?? 0} status={job?.status} />
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
                  tab === t ? 'bg-gray-900 text-white border border-b-gray-900 border-gray-800' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t}
                {t === 'Hypotheses' && hypotheses.length > 0 && (
                  <span className="ml-1.5 bg-pharma-600/30 text-pharma-400 text-xs px-1.5 py-0.5 rounded-full">
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
                  ? <p className="text-gray-500 text-sm text-center py-12">No hypotheses generated yet.</p>
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
                    <span className="ml-2 text-xs text-gray-500">({dgeResults.length} genes)</span>
                  </h3>
                  <DGETable results={dgeResults} />
                </div>
              </div>
            )}

            {tab === 'Report' && (
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-white">AI-Generated Research Report</h3>
                  {report && (
                    <button onClick={downloadReport} className="btn-secondary flex items-center gap-1.5 text-xs">
                      <Download size={13} /> Download .md
                    </button>
                  )}
                </div>
                {report
                  ? <div className="prose-dark"><ReactMarkdown>{report}</ReactMarkdown></div>
                  : <p className="text-gray-500 text-sm text-center py-12">Report not yet generated.</p>
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
          <p className="text-gray-500">Waiting for results…</p>
        </div>
      )}
    </div>
  )
}

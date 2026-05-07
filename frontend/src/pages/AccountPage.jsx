import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

const BASE = import.meta.env.VITE_API_BASE || '/api/v1'

function StatusBadge({ status }) {
  const colours = {
    complete: 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50',
    running:  'text-amber-400 bg-amber-950/40 border-amber-900/50',
    failed:   'text-red-400 bg-red-950/40 border-red-900/50',
    queued:   'text-slate-400 bg-slate-800/40 border-slate-700/50',
  }
  return (
    <span className={`inline-block text-[10px] font-mono uppercase tracking-wide border rounded px-2 py-0.5 ${colours[status] ?? colours.queued}`}>
      {status}
    </span>
  )
}

export default function AccountPage() {
  const { user, logout, loading, getToken } = useAuth()
  const navigate = useNavigate()
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    if (!loading && !user) navigate('/login')
  }, [user, loading, navigate])

  useEffect(() => {
    if (!user) return
    const token = getToken()
    fetch(`${BASE}/auth/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [user, getToken])

  if (loading || !user) return null

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="max-w-2xl mx-auto py-12 space-y-12">

      {/* Profile */}
      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-2">Account</p>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-100">{user.name}</h1>
            <p className="text-slate-500 mt-1">{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-600 hover:text-slate-300 border border-slate-800 hover:border-slate-600 px-4 py-2 rounded-lg transition-colors duration-150"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/run"
          className="rounded-xl border border-amber-500/30 bg-amber-400/5 hover:bg-amber-400/10 p-6 transition-colors duration-150"
        >
          <p className="text-amber-400 font-semibold mb-1">New analysis</p>
          <p className="text-sm text-slate-500">Upload a count matrix and launch the agentic network</p>
        </Link>
        <Link
          to="/gene/EGFR"
          className="rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-900 p-6 transition-colors duration-150"
        >
          <p className="text-slate-200 font-semibold mb-1">Gene lookup</p>
          <p className="text-sm text-slate-500">Search protein, drug, and literature data by gene</p>
        </Link>
      </div>

      {/* Analysis history */}
      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-6">Analysis history</p>

        {historyLoading ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-slate-500 text-sm">No analyses yet.</p>
            <Link to="/run" className="text-amber-400/70 hover:text-amber-400 text-sm transition-colors duration-150 mt-2 inline-block">
              Run your first analysis
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {history.map(job => (
              <div key={job.job_id} className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{job.disease_term}</p>
                  <p className="text-[11px] font-mono text-slate-600 mt-0.5">
                    {job.created_at ? new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={job.status} />
                  {job.status === 'complete' && (
                    <Link
                      to={`/results/${job.job_id}`}
                      className="text-xs text-amber-400/70 hover:text-amber-400 transition-colors duration-150"
                    >
                      View →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

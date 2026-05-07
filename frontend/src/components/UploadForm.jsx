import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { FileSpreadsheet, AlertCircle, Plus, Trash2, X } from 'lucide-react'
import { startAnalysis } from '../utils/api.js'

function parsePastedConditions(text) {
  text = text.trim()
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text)
      return Object.entries(obj).map(([name, condition]) => ({ name, condition }))
    } catch {}
  }
  return text.split('\n')
    .map(l => l.trim()).filter(Boolean)
    .map(line => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',')
      return { name: (parts[0] || '').trim(), condition: (parts[1] || '').trim() }
    })
    .filter(s => s.name)
}

const LABEL = ({ children }) => (
  <p className="text-xs font-mono uppercase tracking-widest text-white/50 mb-2">{children}</p>
)

export default function UploadForm() {
  const navigate = useNavigate()
  const [file, setFile]           = useState(null)
  const [disease, setDisease]     = useState('')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples, setSamples]     = useState([{ name: '', condition: 'disease' }])
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const onDrop = useCallback((accepted) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.tsv', '.txt'], 'text/csv': ['.csv'] },
    maxFiles: 1,
  })

  const applyPaste = () => {
    const parsed = parsePastedConditions(pasteText)
    if (!parsed.length) return setPasteError('Could not parse — use "sample_name\\tcondition" per line.')
    setSamples(parsed)
    setPasteError('')
    setPasteMode(false)
  }

  const addSample    = () => setSamples([...samples, { name: '', condition: conditionA }])
  const removeSample = (i) => { if (samples.length > 2) setSamples(samples.filter((_, idx) => idx !== i)) }
  const updateSample = (i, field, value) => {
    const next = [...samples]; next[i] = { ...next[i], [field]: value }; setSamples(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('')
    if (!file) return setError('Upload a count matrix file.')
    if (!disease.trim()) return setError('Enter a disease or study term.')
    const validSamples = samples.filter(s => s.name.trim())
    if (validSamples.length < 2) return setError('Add at least 2 samples.')
    const fd = new FormData()
    fd.append('count_matrix', file)
    fd.append('disease_term', disease)
    fd.append('sample_conditions', JSON.stringify(Object.fromEntries(validSamples.map(s => [s.name, s.condition]))))
    fd.append('condition_a', conditionA)
    fd.append('condition_b', conditionB)
    setLoading(true)
    try {
      const { job_id } = await startAnalysis(fd)
      navigate(`/results/${job_id}`)
    } catch (err) {
      setError(err.message || 'Failed to start analysis.')
      setLoading(false)
    }
  }

  const chipColor = (cond) => cond === conditionA
    ? 'bg-amber-400/20 text-amber-300 border-amber-500/30'
    : 'bg-blue-500/15 text-blue-300 border-blue-500/30'

  const dotColor = (cond) => cond === conditionA ? 'bg-amber-400' : 'bg-blue-400'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Drop zone ─────────────────────────────────────────── */}
      <div>
        <LABEL>Count Matrix</LABEL>
        <div
          {...getRootProps()}
          className={`relative rounded-xl cursor-pointer transition-all duration-200 overflow-hidden
            ${isDragActive ? 'marching-ants bg-amber-400/5' : 'border border-dashed border-slate-700 hover:border-slate-500'}
          `}
          style={{ padding: isDragActive ? 0 : undefined }}
        >
          <input {...getInputProps()} />

          {file ? (
            <div className="flex items-center justify-between px-4 py-4 glass-panel rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <FileSpreadsheet size={16} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white leading-tight">{file.name}</p>
                  <p className="text-xs text-white/40 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="text-white/30 hover:text-white/80 transition-colors p-1"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className={`flex items-center gap-4 px-5 py-5 ${isDragActive ? 'p-5' : ''}`}>
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={18} className="text-white/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  {isDragActive ? 'Drop to upload' : 'Drop your file here or click to browse'}
                </p>
                <p className="text-xs text-white/40 font-mono mt-0.5">.tsv · .csv · .txt — rows = genes, cols = samples</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Disease ───────────────────────────────────────────── */}
      <div>
        <LABEL>Disease / Study Context</LABEL>
        <input
          className="glass-input w-full rounded-xl px-4 py-3 text-sm font-medium"
          placeholder="e.g. Glioblastoma, KRAS-mutant PDAC"
          value={disease}
          onChange={e => setDisease(e.target.value)}
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        />
      </div>

      {/* ── Case vs Control ───────────────────────────────────── */}
      <div>
        <LABEL>Comparison Groups</LABEL>
        <div className="grid grid-cols-[1fr_48px_1fr] gap-2 items-center">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 pointer-events-none" />
            <input
              className="glass-input w-full rounded-xl pl-7 pr-3 py-3 text-sm font-mono"
              value={conditionA}
              onChange={e => { setConditionA(e.target.value); setSamples(s => s.map(r => r.condition === conditionA ? { ...r, condition: e.target.value } : r)) }}
              placeholder="case"
            />
          </div>
          <div className="flex items-center justify-center">
            <span className="text-xs font-bold text-white/30 tracking-widest">VS</span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 pointer-events-none" />
            <input
              className="glass-input w-full rounded-xl pl-7 pr-3 py-3 text-sm font-mono"
              value={conditionB}
              onChange={e => setConditionB(e.target.value)}
              placeholder="control"
            />
          </div>
        </div>
      </div>

      {/* ── Sample conditions ─────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <LABEL>Sample Conditions</LABEL>
          <div className="flex items-center gap-3 mb-2">
            <button
              type="button"
              onClick={() => { setPasteMode(!pasteMode); setPasteError('') }}
              className="text-xs text-white/50 hover:text-white transition-colors font-mono"
            >
              {pasteMode ? '← manual' : 'paste from sheet'}
            </button>
            {!pasteMode && (
              <button type="button" onClick={addSample}
                className="flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 transition-colors font-mono">
                <Plus size={11} /> add row
              </button>
            )}
          </div>
        </div>

        {pasteMode ? (
          <div className="space-y-2">
            <textarea
              className="glass-input w-full rounded-xl px-4 py-3 text-xs font-mono h-32 resize-none"
              placeholder={"GBM_01\tdisease\nGBM_02\tdisease\nNRM_01\tcontrol\nNRM_02\tcontrol"}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            {pasteError && <p className="text-xs text-red-400 font-mono">{pasteError}</p>}
            <button type="button" onClick={applyPaste}
              className="text-xs font-mono text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 transition-colors">
              Apply
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {samples.map((s, i) => (
              <div key={i} className="flex gap-2 items-center group">
                {/* Condition chip */}
                <span className={`shrink-0 w-2 h-2 rounded-full transition-colors ${dotColor(s.condition)}`} />

                <input
                  className="glass-input flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder={`sample_${i + 1}`}
                  value={s.name}
                  onChange={e => updateSample(i, 'name', e.target.value)}
                />

                <select
                  className={`glass-input rounded-lg px-2 py-2 text-xs font-mono border ${chipColor(s.condition)}`}
                  style={{ background: 'transparent', minWidth: '90px' }}
                  value={s.condition}
                  onChange={e => updateSample(i, 'condition', e.target.value)}
                >
                  <option value={conditionA} style={{ background: '#0f172a' }}>{conditionA}</option>
                  <option value={conditionB} style={{ background: '#0f172a' }}>{conditionB}</option>
                </select>

                {samples.length > 2 && (
                  <button type="button" onClick={() => removeSample(i)}
                    className="text-slate-700 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-white/30 font-mono mt-2">Names must match column headers exactly.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 font-mono">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 rounded-xl font-bold text-base text-slate-900 bg-amber-400 hover:bg-amber-300 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed tracking-tight"
        style={{ boxShadow: loading ? 'none' : '0 0 24px rgba(251,191,36,0.25)' }}
      >
        {loading ? 'Launching agent network…' : 'Run Analysis →'}
      </button>
    </form>
  )
}

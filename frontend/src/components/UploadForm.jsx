import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Trash2, X } from 'lucide-react'
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
  <p className="bg-slate-800 px-2 py-1 text-xs font-bold text-slate-200 mb-2">{children}</p>
)

const OPTIONAL_INPUTS = [
  { key: 'sample_metadata', label: 'Sample metadata', accept: '.csv,.tsv,.txt', hint: 'sample_id, batch, tissue, sex, age, treatment' },
  { key: 'phenotype_table', label: 'Phenotype table', accept: '.csv,.tsv,.txt', hint: 'sample_id, response, survival, subtype' },
  { key: 'mutation_table', label: 'Mutation table', accept: '.csv,.tsv,.txt,.maf', hint: 'gene, variant, sample_id, effect' },
  { key: 'custom_gene_sets', label: 'Custom gene sets', accept: '.txt,.csv,.tsv,.gmt', hint: 'pathway or signature genes' },
]

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
  const [sampleLoading, setSampleLoading] = useState(false)
  const [optionalFiles, setOptionalFiles] = useState({})
  const [studyNotes, setStudyNotes] = useState('')

  const onDrop = useCallback((accepted) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.tsv'], 'text/csv': ['.csv'] },
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

  const updateOptionalFile = (key, selectedFile) => {
    setOptionalFiles(prev => ({ ...prev, [key]: selectedFile || null }))
  }

  const clearOptionalFile = (key) => {
    setOptionalFiles(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const inputSampleData = async () => {
    setError('')
    setSampleLoading(true)
    try {
      const res = await fetch('/sample_counts.tsv')
      if (!res.ok) throw new Error('Could not load sample_counts.tsv')
      const blob = await res.blob()
      const sampleFile = new File([blob], 'sample_counts.tsv', { type: 'text/tab-separated-values' })
      setFile(sampleFile)
      setDisease('Glioblastoma')
      setConditionA('disease')
      setConditionB('control')
      setSamples([
        { name: 'D1', condition: 'disease' },
        { name: 'D2', condition: 'disease' },
        { name: 'D3', condition: 'disease' },
        { name: 'D4', condition: 'disease' },
        { name: 'C1', condition: 'control' },
        { name: 'C2', condition: 'control' },
        { name: 'C3', condition: 'control' },
        { name: 'C4', condition: 'control' },
      ])
      setPasteMode(false)
      setPasteText('')
      setPasteError('')
      setOptionalFiles({})
      setStudyNotes('')
    } catch (err) {
      setError(err.message || 'Failed to load sample data.')
    } finally {
      setSampleLoading(false)
    }
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
    Object.entries(optionalFiles).forEach(([key, value]) => {
      if (value) fd.append(key, value)
    })
    if (studyNotes.trim()) fd.append('study_notes', studyNotes.trim())
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
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* ── Drop zone ─────────────────────────────────────────── */}
      <div>
        <LABEL>Count Matrix</LABEL>
        <div
          {...getRootProps()}
          className={`relative cursor-pointer transition-colors overflow-hidden
            ${isDragActive ? 'bg-slate-900 border border-slate-400' : 'border border-dashed border-slate-600 bg-slate-950 hover:border-slate-300'}
          `}
          style={{ padding: isDragActive ? 0 : undefined }}
        >
          <input {...getInputProps()} />

          {file ? (
            <div className="flex items-center justify-between border border-slate-700 bg-slate-950 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-medium text-white leading-tight">{file.name}</p>
                  <p className="text-xs text-white/40">{(file.size / 1024).toFixed(1)} KB</p>
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
            <div className={`px-3 py-3 ${isDragActive ? 'p-4' : ''}`}>
              <div>
                <p className="text-sm font-medium text-white">
                  {isDragActive ? 'Drop file' : 'Drop or browse'}
                </p>
                <p className="text-xs text-white/70 mt-0.5">.tsv · .csv</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Disease ───────────────────────────────────────────── */}
      <div>
        <LABEL>Disease / Study Context</LABEL>
        <input
          className="glass-input w-full rounded-none px-3 py-2.5 text-sm font-medium"
          placeholder="e.g. Glioblastoma, KRAS-mutant PDAC"
          value={disease}
          onChange={e => setDisease(e.target.value)}
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        />
      </div>

      {/* ── Sample conditions ─────────────────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
          <LABEL>Sample Conditions</LABEL>
          <div className="flex items-center gap-2 sm:mb-2">
            <button
              type="button"
              onClick={() => { setPasteMode(!pasteMode); setPasteError('') }}
              className="border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white/70 hover:text-white hover:border-slate-500 transition-colors"
            >
              {pasteMode ? 'Manual entry' : 'Paste from sheet'}
            </button>
          </div>
        </div>

        <div className="border border-slate-700 bg-slate-950 p-2 mb-2">
          <div className="grid grid-cols-[1fr_36px_1fr] gap-2 items-center">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 pointer-events-none" />
              <input
                className="glass-input w-full rounded-none pl-7 pr-3 py-2 text-sm"
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
                className="glass-input w-full rounded-none pl-7 pr-3 py-2 text-sm"
                value={conditionB}
                onChange={e => { setConditionB(e.target.value); setSamples(s => s.map(r => r.condition === conditionB ? { ...r, condition: e.target.value } : r)) }}
                placeholder="control"
              />
            </div>
          </div>
        </div>

        {pasteMode ? (
          <div className="space-y-2">
            <textarea
              className="glass-input w-full rounded-none px-3 py-2 text-xs h-28 resize-none"
              placeholder={"GBM_01\tdisease\nGBM_02\tdisease\nNRM_01\tcontrol\nNRM_02\tcontrol"}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            {pasteError && <p className="text-xs text-red-400">{pasteError}</p>}
            <button type="button" onClick={applyPaste}
              className="text-xs text-slate-200 border border-slate-700 px-3 py-1.5 hover:bg-slate-800 transition-colors">
              Apply
            </button>
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {samples.map((s, i) => (
              <div key={i} className="flex gap-2 items-center group">
                {/* Condition chip */}
                <span className={`shrink-0 w-2 h-2 rounded-full transition-colors ${dotColor(s.condition)}`} />

                <input
                  className="glass-input flex-1 rounded-none px-3 py-2 text-sm"
                  placeholder={`sample_${i + 1}`}
                  value={s.name}
                  onChange={e => updateSample(i, 'name', e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && i === samples.length - 1) {
                      e.preventDefault()
                      addSample()
                    }
                  }}
                />

                <div className="grid grid-cols-2 gap-1 border border-slate-700 bg-slate-950/60 p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateSample(i, 'condition', conditionA)}
                    className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      s.condition === conditionA
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-white/55 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {conditionA || 'case'}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSample(i, 'condition', conditionB)}
                    className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      s.condition === conditionB
                        ? 'bg-blue-400 text-slate-950'
                        : 'text-white/55 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {conditionB || 'control'}
                  </button>
                </div>

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
      </div>

      {/* Optional context */}
      <div className="border-t border-slate-800 pt-4">
        <div className="mb-2">
          <LABEL>Optional Context</LABEL>
        </div>

        <div className="divide-y divide-slate-800 border border-slate-800">
          {OPTIONAL_INPUTS.map(({ key, label, accept, hint }) => {
            const selected = optionalFiles[key]
            return (
              <div key={key} className="grid gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-white">{label}</p>
                  </div>
                  {selected && (
                    <button
                      type="button"
                      onClick={() => clearOptionalFile(key)}
                      className="text-white/30 hover:text-white/80 transition-colors p-1"
                      aria-label={`Remove ${label}`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {selected ? (
                  <div className="flex items-center gap-3 bg-slate-950 border border-slate-700 px-2 py-2 min-h-10">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{selected.name}</p>
                      <p className="text-[11px] text-white/40 mt-0.5">{(selected.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                ) : (
                  <label className="flex min-h-10 cursor-pointer items-center justify-center border border-dashed border-slate-600 hover:border-slate-300 bg-slate-950 px-2 py-2 transition-colors">
                    <input
                      type="file"
                      accept={accept}
                      className="sr-only"
                      onChange={e => updateOptionalFile(key, e.target.files?.[0])}
                    />
                    <span className="text-xs font-semibold text-white/70">Upload file</span>
                  </label>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3">
          <textarea
            className="glass-input w-full rounded-none px-3 py-2 text-sm min-h-24 resize-y"
            placeholder="Study notes: model system, treatment, subtype, response label, target class to prefer"
            value={studyNotes}
            onChange={e => setStudyNotes(e.target.value)}
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 font-bold text-sm text-slate-900 bg-amber-400 hover:bg-amber-300 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed tracking-tight"
      >
        {loading ? 'Launching agent network…' : 'Run Analysis →'}
      </button>

      <button
        type="button"
        onClick={inputSampleData}
        disabled={loading || sampleLoading}
        className="w-full py-2.5 font-semibold text-xs text-slate-200 border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sampleLoading ? 'Loading sample data…' : 'Input sample data'}
      </button>
    </form>
  )
}

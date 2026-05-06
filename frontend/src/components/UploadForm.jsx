import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { Upload, FileText, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { startAnalysis } from '../utils/api.js'

function parsePastedConditions(text) {
  // Accepts tab or comma separated: "sample_1\tdisease" or "sample_1,disease"
  // Also accepts JSON: {"s1": "disease"}
  text = text.trim()
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text)
      return Object.entries(obj).map(([name, condition]) => ({ name, condition }))
    } catch {}
  }
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',')
      return { name: (parts[0] || '').trim(), condition: (parts[1] || '').trim() }
    })
    .filter(s => s.name)
}

export default function UploadForm() {
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [disease, setDisease] = useState('')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples, setSamples] = useState([{ name: '', condition: 'disease' }])
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

  const addSample = () => setSamples([...samples, { name: '', condition: conditionA }])
  const removeSample = (i) => setSamples(samples.filter((_, idx) => idx !== i))
  const updateSample = (i, field, value) => {
    const next = [...samples]
    next[i] = { ...next[i], [field]: value }
    setSamples(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!file) return setError('Upload a count matrix file.')
    if (!disease.trim()) return setError('Enter a disease or study term.')
    const validSamples = samples.filter(s => s.name.trim())
    if (validSamples.length < 2) return setError('Add at least 2 samples.')

    const sampleConditions = Object.fromEntries(validSamples.map(s => [s.name, s.condition]))
    const fd = new FormData()
    fd.append('count_matrix', file)
    fd.append('disease_term', disease)
    fd.append('sample_conditions', JSON.stringify(sampleConditions))
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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* File drop */}
      <div>
        <label className="label">Count Matrix</label>
        <div
          {...getRootProps()}
          className={`border border-dashed rounded-lg px-5 py-7 text-center cursor-pointer transition-colors ${
            file ? 'border-indigo-700 bg-indigo-950/20' :
            isDragActive ? 'border-indigo-500 bg-indigo-950/30' :
            'border-slate-700 hover:border-slate-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText size={16} className="text-indigo-400 shrink-0" />
              <span className="text-sm text-slate-200">{file.name}</span>
              <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload size={18} className="text-slate-500" />
              <p className="text-sm text-slate-400">Drop file here or click to browse</p>
              <p className="text-xs text-slate-600">TSV / CSV — rows = genes, columns = samples</p>
            </div>
          )}
        </div>
      </div>

      {/* Disease */}
      <div>
        <label className="label">Disease / Study</label>
        <input
          className="input"
          placeholder="e.g. Glioblastoma, Type 2 Diabetes"
          value={disease}
          onChange={e => setDisease(e.target.value)}
        />
      </div>

      {/* Condition labels */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Case label</label>
          <input className="input" value={conditionA} onChange={e => setConditionA(e.target.value)} />
        </div>
        <div>
          <label className="label">Control label</label>
          <input className="input" value={conditionB} onChange={e => setConditionB(e.target.value)} />
        </div>
      </div>

      {/* Sample annotations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Sample Conditions</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setPasteMode(!pasteMode); setPasteError('') }}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {pasteMode ? 'Switch to manual' : 'Paste from spreadsheet'}
            </button>
            {!pasteMode && (
              <button type="button" onClick={addSample} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
                <Plus size={12} /> Add row
              </button>
            )}
          </div>
        </div>

        {pasteMode ? (
          <div className="space-y-2">
            <textarea
              className="input font-mono text-xs h-32 resize-none"
              placeholder={`Paste tab-separated or comma-separated:\nGBM_01\tdisease\nGBM_02\tdisease\nNRM_01\tcontrol\nNRM_02\tcontrol\n\nOr paste JSON: {"GBM_01":"disease"}`}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            {pasteError && <p className="text-xs text-red-400">{pasteError}</p>}
            <button type="button" onClick={applyPaste} className="btn-secondary text-xs">
              Apply
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {samples.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  className="input flex-1 text-xs font-mono"
                  placeholder={`sample_${i + 1}`}
                  value={s.name}
                  onChange={e => updateSample(i, 'name', e.target.value)}
                />
                <select
                  className="input w-32 text-xs"
                  value={s.condition}
                  onChange={e => updateSample(i, 'condition', e.target.value)}
                >
                  <option value={conditionA}>{conditionA}</option>
                  <option value={conditionB}>{conditionB}</option>
                </select>
                <button type="button" onClick={() => removeSample(i)} className="text-slate-600 hover:text-slate-400 shrink-0">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-600 mt-1.5">Names must match column headers in your file exactly.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Starting…' : 'Run Analysis'}
      </button>
    </form>
  )
}

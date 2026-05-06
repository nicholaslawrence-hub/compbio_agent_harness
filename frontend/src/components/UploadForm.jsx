import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { Upload, FileText, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { startAnalysis } from '../utils/api.js'

export default function UploadForm() {
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [disease, setDisease] = useState('')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples, setSamples] = useState([{ name: '', condition: 'disease' }])
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

  const addSample = () => setSamples([...samples, { name: '', condition: 'disease' }])
  const removeSample = (i) => setSamples(samples.filter((_, idx) => idx !== i))
  const updateSample = (i, field, value) => {
    const next = [...samples]
    next[i] = { ...next[i], [field]: value }
    setSamples(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!file) return setError('Please upload a count matrix file.')
    if (!disease.trim()) return setError('Please enter a disease term.')
    const validSamples = samples.filter(s => s.name.trim())
    if (validSamples.length < 2) return setError('Add at least 2 samples with labels.')

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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File drop zone */}
      <div>
        <label className="label">Count Matrix (TSV/CSV)</label>
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-pharma-500 bg-pharma-500/10' : 'border-gray-700 hover:border-gray-500'
          } ${file ? 'border-pharma-600 bg-pharma-600/5' : ''}`}
        >
          <input {...getInputProps()} />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileText size={32} className="text-pharma-400" />
              <p className="text-sm font-medium text-pharma-300">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={32} className="text-gray-500" />
              <p className="text-sm text-gray-400">
                {isDragActive ? 'Drop it here' : 'Drag & drop your count matrix, or click to browse'}
              </p>
              <p className="text-xs text-gray-600">Rows = genes, Columns = samples. TSV, CSV, or TXT.</p>
            </div>
          )}
        </div>
      </div>

      {/* Disease term */}
      <div>
        <label className="label">Disease / Study Context</label>
        <input
          className="input"
          placeholder="e.g. Glioblastoma, Type 2 Diabetes, Lung Adenocarcinoma"
          value={disease}
          onChange={e => setDisease(e.target.value)}
        />
      </div>

      {/* Condition labels */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Disease Condition Label</label>
          <input className="input" value={conditionA} onChange={e => setConditionA(e.target.value)} />
        </div>
        <div>
          <label className="label">Control Condition Label</label>
          <input className="input" value={conditionB} onChange={e => setConditionB(e.target.value)} />
        </div>
      </div>

      {/* Sample annotations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Sample Annotations</label>
          <button type="button" onClick={addSample} className="flex items-center gap-1 text-xs text-pharma-400 hover:text-pharma-300">
            <Plus size={13} /> Add sample
          </button>
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {samples.map((s, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="input flex-1 text-xs"
                placeholder={`Sample name (e.g. sample_${i + 1})`}
                value={s.name}
                onChange={e => updateSample(i, 'name', e.target.value)}
              />
              <select
                className="input w-36 text-xs"
                value={s.condition}
                onChange={e => updateSample(i, 'condition', e.target.value)}
              >
                <option value={conditionA}>{conditionA}</option>
                <option value={conditionB}>{conditionB}</option>
              </select>
              <button type="button" onClick={() => removeSample(i)} className="text-gray-600 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-1">Column names must exactly match your count matrix headers.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Starting Analysis…' : 'Run PharmaGPT Analysis'}
      </button>
    </form>
  )
}

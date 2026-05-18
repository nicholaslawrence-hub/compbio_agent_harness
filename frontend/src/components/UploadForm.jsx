import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Trash2, X, HelpCircle } from 'lucide-react'
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

function Tooltip({ tip, children }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-56 rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-[11px] leading-snug text-white opacity-0 group-hover:opacity-100 transition-opacity duration-100 whitespace-normal shadow-xl">
        {tip}
      </span>
    </span>
  )
}

function FieldLabel({ children, tip }) {
  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-xs font-semibold text-white uppercase tracking-wide">{children}</span>
      {tip && (
        <Tooltip tip={tip}>
          <HelpCircle size={11} className="text-white hover:text-white cursor-default transition-colors" />
        </Tooltip>
      )}
    </div>
  )
}

const OPTIONAL_INPUTS = [
  { key: 'sample_metadata',  label: 'Sample metadata',  accept: '.csv,.tsv,.txt',      hint: 'sample_id, batch, tissue, sex, age' },
  { key: 'phenotype_table',  label: 'Phenotype table',  accept: '.csv,.tsv,.txt',      hint: 'sample_id, response, survival, subtype' },
  { key: 'mutation_table',   label: 'Mutation table',   accept: '.csv,.tsv,.txt,.maf', hint: 'gene, variant, sample_id, effect' },
  { key: 'custom_gene_sets', label: 'Custom gene sets', accept: '.txt,.csv,.tsv,.gmt', hint: 'pathway or signature genes' },
]

const FIELD_TIPS = {
  matrix:   'Rows = genes, cols = samples. Raw integer counts preferred (DESeq2). TPM/FPKM falls back to Welch t-test + BH correction. First column = HGNC gene symbols.',
  disease:  'Free text, e.g. "Glioblastoma". Anchors PubMed queries, LLM prompts, and hypothesis generation to your biology.',
  condAB:   'Must exactly match condition strings in Sample Conditions. Fold-change = case ÷ control.',
  samples:  'Maps each column header from your matrix to a condition label. Case-sensitive. Use "Paste" to bulk-import from Excel/Sheets (sample_name\\tcondition per row).',
  optional: 'Supplementary data that augments agent reasoning.',
}

export default function UploadForm() {
  const navigate = useNavigate()
  const [file, setFile]             = useState(null)
  const [disease, setDisease]       = useState('')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples, setSamples]       = useState([{ name: '', condition: 'disease' }])
  const [pasteMode, setPasteMode]   = useState(false)
  const [pasteText, setPasteText]   = useState('')
  const [pasteError, setPasteError] = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [optionalFiles, setOptionalFiles] = useState({})
  const [studyNotes, setStudyNotes] = useState('')

  const onDrop = useCallback((accepted) => { if (accepted[0]) setFile(accepted[0]) }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.tsv'], 'text/csv': ['.csv'] },
    maxFiles: 1,
  })

  const applyPaste = () => {
    const parsed = parsePastedConditions(pasteText)
    if (!parsed.length) return setPasteError('Cannot parse — use "sample_name\\tcondition" per line.')
    setSamples(parsed); setPasteError(''); setPasteMode(false)
  }

  const addSample    = () => setSamples([...samples, { name: '', condition: conditionA }])
  const removeSample = (i) => { if (samples.length > 2) setSamples(samples.filter((_, idx) => idx !== i)) }
  const updateSample = (i, field, value) => {
    const next = [...samples]; next[i] = { ...next[i], [field]: value }; setSamples(next)
  }

  const updateOptionalFile = (key, f) => setOptionalFiles(prev => ({ ...prev, [key]: f || null }))
  const clearOptionalFile  = (key) => setOptionalFiles(prev => { const n = { ...prev }; delete n[key]; return n })

  const inputSampleData = async () => {
    setError(''); setSampleLoading(true)
    try {
      const res = await fetch('/sample_counts.tsv')
      if (!res.ok) throw new Error('Could not load sample_counts.tsv')
      const blob = await res.blob()
      setFile(new File([blob], 'sample_counts.tsv', { type: 'text/tab-separated-values' }))
      setDisease('Glioblastoma')
      setConditionA('disease'); setConditionB('control')
      setSamples([
        { name: 'D1', condition: 'disease' }, { name: 'D2', condition: 'disease' },
        { name: 'D3', condition: 'disease' }, { name: 'D4', condition: 'disease' },
        { name: 'C1', condition: 'control' }, { name: 'C2', condition: 'control' },
        { name: 'C3', condition: 'control' }, { name: 'C4', condition: 'control' },
      ])
      setPasteMode(false); setPasteText(''); setPasteError('')
      setOptionalFiles({}); setStudyNotes('')
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
    Object.entries(optionalFiles).forEach(([key, value]) => { if (value) fd.append(key, value) })
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

  const dotColor = (cond) => cond === conditionA ? 'bg-amber-400' : 'bg-blue-400'

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-sm">

      {/* Count Matrix */}
      <div>
        <FieldLabel tip={FIELD_TIPS.matrix}>Count Matrix</FieldLabel>
        <div
          {...getRootProps()}
          className={`cursor-pointer border transition-colors ${
            isDragActive
              ? 'border-slate-400 bg-slate-900'
              : 'border-dashed border-slate-700 bg-slate-950 hover:border-slate-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? (
            <div className="flex items-center justify-between px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-white truncate">{file.name}</span>
                <span className="text-[11px] text-white shrink-0">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="text-white hover:text-white transition-colors ml-2 shrink-0">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="px-2.5 py-2 flex items-center gap-2">
              <span className="text-xs text-white">{isDragActive ? 'Drop file' : 'Drop or browse'}</span>
              <span className="text-[11px] text-white">.tsv · .csv</span>
            </div>
          )}
        </div>
      </div>

      {/* Disease */}
      <div>
        <FieldLabel tip={FIELD_TIPS.disease}>Disease / Study</FieldLabel>
        <input
          className="glass-input w-full rounded-none px-3 py-2 text-sm"
          placeholder="e.g. Glioblastoma, KRAS-mutant PDAC"
          value={disease}
          onChange={e => setDisease(e.target.value)}
        />
      </div>

      {/* Sample Conditions */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel tip={FIELD_TIPS.samples}>Sample Conditions</FieldLabel>
          <button
            type="button"
            onClick={() => { setPasteMode(!pasteMode); setPasteError('') }}
            className="text-[11px] text-white hover:text-white transition-colors border border-slate-800 px-1.5 py-0.5 -mt-1"
          >
            {pasteMode ? 'Manual' : 'Paste'}
          </button>
        </div>

        {/* Case vs Control */}
        <div className="grid grid-cols-[1fr_28px_1fr] gap-1.5 items-center mb-1.5">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400 pointer-events-none" />
            <input
              className="glass-input w-full rounded-none pl-5 pr-2 py-1.5 text-xs"
              value={conditionA}
              onChange={e => { setConditionA(e.target.value); setSamples(s => s.map(r => r.condition === conditionA ? { ...r, condition: e.target.value } : r)) }}
              placeholder="case"
            />
          </div>
          <span className="text-[10px] font-bold text-white text-center tracking-widest">VS</span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400 pointer-events-none" />
            <input
              className="glass-input w-full rounded-none pl-5 pr-2 py-1.5 text-xs"
              value={conditionB}
              onChange={e => { setConditionB(e.target.value); setSamples(s => s.map(r => r.condition === conditionB ? { ...r, condition: e.target.value } : r)) }}
              placeholder="control"
            />
          </div>
        </div>

        {pasteMode ? (
          <div className="space-y-1.5">
            <textarea
              className="glass-input w-full rounded-none px-3 py-2 text-sm h-20 resize-none"
              placeholder={"GBM_01\tdisease\nGBM_02\tdisease\nNRM_01\tcontrol"}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            {pasteError && <p className="text-[11px] text-red-400">{pasteError}</p>}
            <button type="button" onClick={applyPaste}
              className="text-[11px] text-white border border-slate-700 px-2.5 py-1 hover:bg-slate-800 transition-colors">
              Apply
            </button>
          </div>
        ) : (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {samples.map((s, i) => (
              <div key={i} className="flex gap-1.5 items-center group">
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dotColor(s.condition)}`} />
                <input
                  className="glass-input flex-1 rounded-none px-2 py-1 text-xs"
                  placeholder={`sample_${i + 1}`}
                  value={s.name}
                  onChange={e => updateSample(i, 'name', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && i === samples.length - 1) { e.preventDefault(); addSample() } }}
                />
                <div className="flex border border-slate-800 shrink-0">
                  <button type="button"
                    onClick={() => updateSample(i, 'condition', conditionA)}
                    className={`px-2 py-1 text-[11px] font-semibold transition-colors ${
                      s.condition === conditionA ? 'bg-amber-400 text-slate-950' : 'text-white hover:text-white hover:bg-slate-800'
                    }`}>
                    {conditionA || 'case'}
                  </button>
                  <button type="button"
                    onClick={() => updateSample(i, 'condition', conditionB)}
                    className={`px-2 py-1 text-[11px] font-semibold transition-colors border-l border-slate-800 ${
                      s.condition === conditionB ? 'bg-blue-400 text-slate-950' : 'text-white hover:text-white hover:bg-slate-800'
                    }`}>
                    {conditionB || 'control'}
                  </button>
                </div>
                {samples.length > 2 && (
                  <button type="button" onClick={() => removeSample(i)}
                    className="text-slate-800 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Optional Context */}
      <div className="border-t border-slate-800 pt-2">
        <FieldLabel tip={FIELD_TIPS.optional}>Optional Context</FieldLabel>

        <table className="w-full text-[11px] border border-slate-800">
          <tbody className="divide-y divide-slate-800">
            {OPTIONAL_INPUTS.map(({ key, label, accept, hint }) => {
              const selected = optionalFiles[key]
              return (
                <tr key={key} className="group">
                  <td className="w-32 px-2 py-1 font-semibold text-white whitespace-nowrap">{label}</td>
                  <td className="px-2 py-1 text-white hidden sm:table-cell">{hint}</td>
                  <td className="px-2 py-1 text-white min-w-0 max-w-[8rem]">
                    {selected
                      ? <span className="truncate block text-white">{selected.name}</span>
                      : <span className="text-white/50">—</span>
                    }
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {selected ? (
                      <button type="button" onClick={() => clearOptionalFile(key)}
                        className="text-white hover:text-red-400 transition-colors">
                        <X size={12} />
                      </button>
                    ) : (
                      <label className="cursor-pointer text-white hover:text-white transition-colors">
                        <input type="file" accept={accept} className="sr-only"
                          onChange={e => updateOptionalFile(key, e.target.files?.[0])} />
                        Browse
                      </label>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <textarea
          className="glass-input w-full rounded-none px-3 py-2 text-sm min-h-14 resize-y mt-1.5"
          placeholder="Study notes: model system, treatment, subtype, response label, target class"
          value={studyNotes}
          onChange={e => setStudyNotes(e.target.value)}
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} className="shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={inputSampleData}
          disabled={loading || sampleLoading}
          className="text-sm font-semibold text-white border border-slate-600 px-5 py-2.5 hover:bg-slate-800 transition-colors disabled:opacity-40"
        >
          {sampleLoading ? 'Loading…' : 'Load sample data'}
        </button>

        <button
          type="submit"
          disabled={loading}
          className="px-8 py-3 text-sm font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Launching…' : 'Run Analysis →'}
        </button>
      </div>

    </form>
  )
}

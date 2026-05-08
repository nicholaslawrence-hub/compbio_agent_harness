import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  BrainCircuit,
  FileSpreadsheet,
  FlaskConical,
  Network,
  Pill,
  Play,
  Target,
} from 'lucide-react'
import { startSandboxAnalysis } from '../utils/api'

const AGENTS = [
  {
    id: 'enrich_ppi',
    name: 'PPI Network',
    role: 'Maps interaction partners around top genes.',
    icon: Network,
    tone: 'border-sky-400/45 bg-sky-400/10 text-sky-100',
  },
  {
    id: 'depmap_query',
    name: 'DepMap Essentiality',
    role: 'Checks dependency evidence in cancer cell lines.',
    icon: Activity,
    tone: 'border-violet-300/45 bg-violet-300/10 text-violet-100',
  },
  {
    id: 'opentargets_query',
    name: 'Open Targets',
    role: 'Adds disease, tractability, and genetic association support.',
    icon: Target,
    tone: 'border-fuchsia-300/45 bg-fuchsia-300/10 text-fuchsia-100',
  },
  {
    id: 'literature_rag',
    name: 'Literature RAG',
    role: 'Searches PubMed evidence and sparse-gene context.',
    icon: BookOpen,
    tone: 'border-emerald-300/45 bg-emerald-300/10 text-emerald-100',
  },
  {
    id: 'drug_annotation',
    name: 'Drug Annotation',
    role: 'Finds known drug and binding evidence.',
    icon: Pill,
    tone: 'border-amber-300/45 bg-amber-300/10 text-amber-100',
  },
]

const SAMPLE_ROWS = [
  ['D1', 'disease'],
  ['D2', 'disease'],
  ['D3', 'disease'],
  ['D4', 'disease'],
  ['C1', 'control'],
  ['C2', 'control'],
  ['C3', 'control'],
  ['C4', 'control'],
]

function fileFromText(text, filename) {
  return new File([text], filename, { type: 'text/tab-separated-values' })
}

export default function SandboxPage() {
  const navigate = useNavigate()
  const [countFile, setCountFile] = useState(null)
  const [diseaseTerm, setDiseaseTerm] = useState('')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples, setSamples] = useState(SAMPLE_ROWS.map(([name, condition]) => ({ name, condition })))
  const [enabledAgents, setEnabledAgents] = useState(() => new Set(AGENTS.map(agent => agent.id)))
  const [directive, setDirective] = useState('Prioritize novel, druggable disease targets with interpretable supporting evidence.')
  const [maxIterations, setMaxIterations] = useState(5)
  const [loading, setLoading] = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedAgents = useMemo(
    () => AGENTS.filter(agent => enabledAgents.has(agent.id)),
    [enabledAgents],
  )

  const toggleAgent = (id) => {
    setEnabledAgents(prev => {
      const next = new Set(prev)
      if (next.has(id) && next.size > 1) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateSample = (index, patch) => {
    setSamples(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const updateConditionA = (value) => {
    const previous = conditionA
    setConditionA(value)
    setSamples(prev => prev.map(row => (
      row.condition === previous ? { ...row, condition: value } : row
    )))
  }

  const updateConditionB = (value) => {
    const previous = conditionB
    setConditionB(value)
    setSamples(prev => prev.map(row => (
      row.condition === previous ? { ...row, condition: value } : row
    )))
  }

  const addSampleRow = () => {
    setSamples(prev => [...prev, { name: '', condition: conditionA }])
  }

  const removeSampleRow = (index) => {
    setSamples(prev => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)))
  }

  const useSampleData = async () => {
    setSampleLoading(true)
    setError('')
    try {
      const response = await fetch('/sample_counts.tsv')
      if (!response.ok) throw new Error('Sample count matrix is unavailable.')
      const text = await response.text()
      setCountFile(fileFromText(text, 'sample_counts.tsv'))
      setDiseaseTerm('Glioblastoma')
      setConditionA('disease')
      setConditionB('control')
      setSamples(SAMPLE_ROWS.map(([name, condition]) => ({ name, condition })))
      setDirective('Let the supervisor search for novel glioblastoma targets, then prioritize druggable or dependency-supported genes.')
    } catch (err) {
      setError(err.message || 'Could not load sample data.')
    } finally {
      setSampleLoading(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    const cleanSamples = samples.filter(row => row.name.trim() && row.condition.trim())
    const sampleConditions = Object.fromEntries(cleanSamples.map(row => [row.name.trim(), row.condition.trim()]))

    if (!countFile) {
      setError('Add a count matrix before starting the supervisor.')
      return
    }
    if (!diseaseTerm.trim()) {
      setError('Add a disease context before starting the supervisor.')
      return
    }
    if (!Object.values(sampleConditions).includes(conditionA) || !Object.values(sampleConditions).includes(conditionB)) {
      setError('Case and control labels must both appear in the sample table.')
      return
    }

    const formData = new FormData()
    formData.append('count_matrix', countFile)
    formData.append('disease_term', diseaseTerm.trim())
    formData.append('condition_a', conditionA.trim())
    formData.append('condition_b', conditionB.trim())
    formData.append('sample_conditions', JSON.stringify(sampleConditions))
    formData.append('sandbox_config', JSON.stringify({
      allowed_agents: Array.from(enabledAgents),
      directive: directive.trim(),
      max_iterations: Number(maxIterations),
    }))

    setLoading(true)
    try {
      const result = await startSandboxAnalysis(formData)
      navigate(`/results/${result.job_id}`)
    } catch (err) {
      setError(err.message || 'Sandbox run failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr] items-end">
        <div>
          <p className="text-sm uppercase tracking-wide text-amber-400 mb-3">Agent Sandbox</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
            Build a supervisor run
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl leading-relaxed">
            Keep RNAgent agentic: choose the specialists the supervisor can call, then let it decide the order, subqueries, repeats, and stopping point.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <Link
            to="/run"
            className="inline-flex items-center justify-center rounded-lg border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-100 hover:border-amber-300 hover:text-amber-200 transition-colors"
          >
            Guided run
          </Link>
          <button
            type="button"
            onClick={useSampleData}
            disabled={sampleLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 transition-colors"
          >
            <FileSpreadsheet size={16} />
            {sampleLoading ? 'Loading sample' : 'Input sample data'}
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-950/40 px-4 py-3 text-sm font-medium text-red-100">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5 space-y-5">
          <div className="flex items-center gap-3">
            <BrainCircuit className="text-amber-300" size={22} />
            <div>
              <h2 className="text-xl font-bold text-white">Supervisor behavior</h2>
              <p className="text-sm text-slate-300">This sets boundaries. The supervisor still chooses what to call.</p>
            </div>
          </div>

          <label className="block">
            <span className="block text-sm font-semibold text-slate-100 mb-2">Research directive</span>
            <textarea
              value={directive}
              onChange={event => setDirective(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-300 focus:outline-none"
              placeholder="Tell the supervisor what kind of evidence or targets to favor."
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-sm font-semibold text-slate-100 mb-2">
              Max supervisor decisions
              <span className="text-amber-300">{maxIterations}</span>
            </span>
            <input
              type="range"
              min="1"
              max="8"
              value={maxIterations}
              onChange={event => setMaxIterations(event.target.value)}
              className="w-full accent-amber-400"
            />
          </label>

          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">Available specialists</h3>
              <span className="text-xs font-semibold text-slate-300">{selectedAgents.length} active</span>
            </div>
            <div className="grid gap-3">
              {AGENTS.map(agent => {
                const Icon = agent.icon
                const active = enabledAgents.has(agent.id)
                return (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={`text-left rounded-lg border p-4 transition-colors ${
                      active
                        ? agent.tone
                        : 'border-slate-700 bg-slate-950/70 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <span className="flex items-start gap-3">
                      <Icon size={19} className={active ? 'text-current' : 'text-slate-500'} />
                      <span>
                        <span className="block text-base font-bold">{agent.name}</span>
                        <span className="block text-sm opacity-85 leading-snug mt-1">{agent.role}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5 space-y-5">
          <div className="flex items-center gap-3">
            <FlaskConical className="text-amber-300" size={22} />
            <div>
              <h2 className="text-xl font-bold text-white">Run data</h2>
              <p className="text-sm text-slate-300">Counts still anchor DGE; optional agents add biological evidence.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="block text-sm font-semibold text-slate-100 mb-2">Count matrix</span>
              <span className="flex min-h-24 items-center justify-between gap-4 rounded-lg border border-slate-600 bg-slate-950 px-4 py-4">
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-white">
                    {countFile?.name || 'No file selected'}
                  </span>
                  <span className="block text-sm text-slate-300 mt-1">TSV or CSV raw counts</span>
                </span>
                <span className="relative inline-flex shrink-0 rounded-lg border border-amber-300/70 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-300/10">
                  Choose file
                  <input
                    type="file"
                    accept=".tsv,.csv,.txt"
                    onChange={event => setCountFile(event.target.files?.[0] || null)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </span>
              </span>
            </label>

            <label className="block sm:col-span-2">
              <span className="block text-sm font-semibold text-slate-100 mb-2">Disease context</span>
              <input
                value={diseaseTerm}
                onChange={event => setDiseaseTerm(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-300 focus:outline-none"
                placeholder="Glioblastoma, NSCLC, hepatocellular carcinoma"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-slate-100 mb-2">Case label</span>
              <input
                value={conditionA}
                onChange={event => updateConditionA(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 focus:border-amber-300 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold text-slate-100 mb-2">Control label</span>
              <input
                value={conditionB}
                onChange={event => updateConditionB(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 focus:border-amber-300 focus:outline-none"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">Sample conditions</h3>
              <button
                type="button"
                onClick={addSampleRow}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-amber-300 hover:text-amber-200 transition-colors"
              >
                Add row
              </button>
            </div>
            <div className="grid gap-2">
              {samples.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    value={row.name}
                    onChange={event => updateSample(index, { name: event.target.value })}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && index === samples.length - 1) {
                        event.preventDefault()
                        addSampleRow()
                      }
                    }}
                    className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-300 focus:outline-none"
                    placeholder="Sample"
                  />
                  <select
                    value={row.condition}
                    onChange={event => updateSample(index, { condition: event.target.value })}
                    className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 focus:border-amber-300 focus:outline-none"
                  >
                    <option className="bg-slate-950 text-slate-100" value={conditionA}>{conditionA || 'case'}</option>
                    <option className="bg-slate-950 text-slate-100" value={conditionB}>{conditionB || 'control'}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSampleRow(index)}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-red-300 hover:text-red-100 transition-colors"
                    aria-label="Remove sample row"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-4">
            <p className="text-sm font-semibold text-slate-100 mb-2">Current build</p>
            <div className="flex flex-wrap gap-2">
              {selectedAgents.map(agent => (
                <span key={agent.id} className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100">
                  {agent.name}
                </span>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-4 text-base font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 transition-colors"
          >
            <Play size={18} fill="currentColor" />
            {loading ? 'Starting supervisor' : 'Run sandbox supervisor'}
          </button>
        </section>
      </form>
    </div>
  )
}

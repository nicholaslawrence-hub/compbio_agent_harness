const STAGES = [
  { at: 0,  label: 'Queued' },
  { at: 20, label: 'DGE Analysis' },
  { at: 40, label: 'PPI Enrichment' },
  { at: 60, label: 'PubMed RAG' },
  { at: 75, label: 'Drug Annotation' },
  { at: 90, label: 'LLM Synthesis' },
  { at: 100, label: 'Complete' },
]

export default function ProgressBar({ progress = 0, status = '' }) {
  const currentStage = STAGES.filter(s => progress >= s.at).pop()

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{currentStage?.label ?? 'Initializing'}</span>
        <span>{progress}%</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between">
        {STAGES.map(s => (
          <div key={s.at} className="flex flex-col items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-colors ${progress >= s.at ? 'bg-indigo-500' : 'bg-slate-700'}`} />
            <span className={`text-xs hidden sm:block ${progress >= s.at ? 'text-gray-400' : 'text-slate-700'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

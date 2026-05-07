import { CheckCircle } from 'lucide-react'

const STAGES = [
  { at: 0,   label: 'Queued' },
  { at: 20,  label: 'DGE Analysis' },
  { at: 40,  label: 'PPI Enrichment' },
  { at: 60,  label: 'PubMed RAG' },
  { at: 75,  label: 'Drug Annotation' },
  { at: 90,  label: 'LLM Synthesis' },
  { at: 100, label: 'Complete' },
]

const GREEN = '#22c55e'

function ActiveIcon() {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 animate-pulse"
      style={{ border: '2px solid rgba(255,255,255,0.6)' }}
    >
      <div className="w-3 h-3 rounded-full bg-white" />
    </div>
  )
}

function QueuedIcon() {
  return (
    <div
      className="w-9 h-9 rounded-full shrink-0"
      style={{ border: '2px solid rgba(100,116,139,0.2)' }}
    />
  )
}

export default function ProgressBar({ progress = 0 }) {
  const currentIdx = STAGES.reduce((acc, s, i) => (progress >= s.at ? i : acc), 0)
  const isComplete = progress >= 100

  return (
    <div className="space-y-7">

      {/* Segmented bar — solid green, fades in per segment */}
      <div className="flex gap-1.5">
        {STAGES.map((stage, i) => {
          const done   = i < currentIdx || isComplete
          const active = i === currentIdx && !isComplete
          return (
            <div
              key={stage.at}
              className="flex-1 h-3 rounded-sm transition-all duration-700"
              style={{
                background: done
                  ? GREEN
                  : active
                    ? 'rgba(34,197,94,0.25)'
                    : 'rgba(30,41,59,0.8)',
              }}
            />
          )
        })}
      </div>

      {/* Step list */}
      <div className="space-y-5">
        {STAGES.map((stage, i) => {
          const done   = i < currentIdx || isComplete
          const active = i === currentIdx && !isComplete

          return (
            <div key={stage.at} className="flex items-center gap-5">
              {done && (
                <CheckCircle
                  size={36}
                  strokeWidth={1.5}
                  className="shrink-0"
                  style={{ color: GREEN }}
                />
              )}
              {active  && <ActiveIcon />}
              {!done && !active && <QueuedIcon />}

              <span
                className="text-3xl font-semibold leading-none"
                style={{
                  color: done
                    ? 'rgba(255,255,255,0.3)'
                    : active
                      ? '#fff'
                      : 'rgba(100,116,139,0.22)',
                }}
              >
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

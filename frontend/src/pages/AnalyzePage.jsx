import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const TYPED_TEXT = 'drug hypothesis.'

const STEPS = [
  {
    n: 1,
    label: 'Differential Expression',
    detail:
      'Your count matrix is tested gene-by-gene for statistically significant expression changes between case and control. PyDESeq2 applies a negative binomial model with Benjamini–Hochberg correction. Only genes clearing padj < 0.05 and |log₂FC| > 1 feed into downstream steps — everything else is filtered out.',
  },
  {
    n: 2,
    label: 'Protein Interaction Network',
    detail:
      'Top upregulated genes are queried against the STRING database to map protein–protein interaction networks. High-confidence partners are scored and cross-referenced against a curated oncogene list — surfacing which of your hits are wired into known disease driver networks and which connections are therapeutically exploitable.',
  },
  {
    n: 3,
    label: 'Literature RAG',
    detail:
      'Abstracts are fetched live from PubMed and Semantic Scholar, then upserted into a Pinecone vector index. The index is semantically searched to pull the most relevant passages per gene. Genes returning fewer than three meaningful hits are flagged as dark genes — under-studied targets with a less competitive drug discovery landscape.',
  },
  {
    n: 4,
    label: 'Drug & Protein Annotation',
    detail:
      'Each gene is looked up in UniProt for functional description and known 3D structures. ChEMBL is then searched for approved and investigational drugs against the same target. Existing drug coverage directly shapes the novelty score in the next step — a well-drugged target scores lower, a dark gene with no compounds scores higher.',
  },
  {
    n: 5,
    label: 'Hypothesis Synthesis',
    detail:
      'GPT-4o receives the combined DGE statistics, PPI context, literature passages, and drug landscape for each prioritized gene. Chain-of-thought reasoning produces a structured hypothesis: proposed mechanism of action, supporting evidence, and a novelty score 0–1. Dark genes connected to oncogene networks with no existing drugs surface at the top.',
  },
  {
    n: 6,
    label: 'Report Generation',
    detail:
      'A publication-style report covers all findings: executive summary, targets ranked by novelty score, proposed mechanisms, and recommended follow-up experiments including suggested assays and validation approaches. Displayed inline and fully copyable for grant writing or lab notebooks.',
  },
]


const EXAMPLE_GENES = [
  { symbol: 'TGFBI', lfc: '+4.2', padj: '0.0003', novelty: 0.91 },
  { symbol: 'MMP9',  lfc: '+3.8', padj: '0.0011', novelty: 0.74 },
  { symbol: 'VEGFA', lfc: '+3.1', padj: '0.0024', novelty: 0.48 },
]

const HYPOTHESIS_TEXT =
  'TGFBI (transforming growth factor β-induced) is markedly upregulated in KRAS-mutant PDAC ' +
  'and physically interacts with integrin αvβ3 to activate downstream FAK/PI3K signaling. No ' +
  'approved small-molecule inhibitors target TGFBI directly, making it a high-novelty candidate. ' +
  'Cross-referencing 31 PubMed abstracts reveals consistent association with stromal remodeling ' +
  'and chemotherapy resistance. Recommended follow-up: siRNA knockdown in PANC-1 cells, co-IP ' +
  'to confirm integrin binding, and patient stratification by TGFBI expression quartile.'


function AnimatedBar({ score, visible }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-px bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-1000 ease-out"
          style={{
            width: visible ? `${score * 100}%` : '0%',
            opacity: visible ? (0.5 + score * 0.5) : 0,
          }}
        />
      </div>
      <span className="font-mono text-xs text-slate-500 w-8 text-right">{score.toFixed(2)}</span>
    </div>
  )
}

function WhisperText({ text, visible }) {
  const words = text.split(' ')
  return (
    <p className="text-sm text-slate-400 leading-relaxed">
      {words.map((word, i) => (
        <span
          key={i}
          className="transition-opacity duration-500"
          style={{
            opacity: visible ? 1 : 0,
            transitionDelay: visible ? `${i * 55}ms` : '0ms',
          }}
        >
          {word}{' '}
        </span>
      ))}
    </p>
  )
}

export default function AnalyzePage() {
  const navigate = useNavigate()
  const [activeStep, setActiveStep] = useState(null)
  const containerRef = useRef(null)
  const labelRefs    = useRef([])
  const bubbleRef    = useRef(null)
  const [line, setLine] = useState(null)

  useLayoutEffect(() => {
    if (!activeStep) { setLine(null); return }
    const raf = requestAnimationFrame(() => {
      const cRect = containerRef.current?.getBoundingClientRect()
      const lbl   = labelRefs.current[activeStep - 1]?.getBoundingClientRect()
      const bub   = bubbleRef.current?.getBoundingClientRect()
      if (!cRect || !lbl || !bub) return
      setLine({
        x1: lbl.right - cRect.left,
        y1: lbl.top   + lbl.height / 2 - cRect.top,
        x2: bub.left  - cRect.left,
        y2: bub.top   + bub.height / 2 - cRect.top,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [activeStep])

  const toggle = (n) => setActiveStep(prev => (prev === n ? null : n))

  // Typing animation
  const [typedCount, setTypedCount] = useState(0)
  const typingDone = typedCount >= TYPED_TEXT.length
  useEffect(() => {
    if (typingDone) return
    const delay = typedCount === 0 ? 700 : 68
    const id = setTimeout(() => setTypedCount(c => c + 1), delay)
    return () => clearTimeout(id)
  }, [typedCount, typingDone])

  // Scroll-driven example animation
  const exampleRef = useRef(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const exampleVisible = scrollProgress > 0.55

  useEffect(() => {
    let raf
    const update = () => {
      if (!exampleRef.current) return
      const rect = exampleRef.current.getBoundingClientRect()
      const wh   = window.innerHeight
      const progress = Math.max(0, Math.min(1, (wh - rect.top) / (wh * 0.65)))
      setScrollProgress(progress)
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [])

  return (
    <div className="space-y-24">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="pt-16 pb-4">
        <h1 className="text-8xl font-bold text-slate-100 leading-[1.06] mb-8 tracking-tight">
          From count matrix<br />
          <span className="text-amber-400">
            to{' '}
            {TYPED_TEXT.slice(0, typedCount)}
            <span className={`inline-block w-[3px] transition-opacity duration-500 ${typingDone ? 'opacity-0' : 'cursor-blink'}`}>_</span>
          </span>
        </h1>
        <p className="text-lg text-slate-400 max-w-xl leading-relaxed">
          Upload an RNA-seq count matrix and a disease context. The pipeline runs
          differential expression, maps protein interaction networks, mines the
          literature, annotates known drugs, and synthesizes ranked hypotheses
          end to end, without leaving the browser.
        </p>
        <div className="flex justify-center mt-20">
          <button
            onClick={() => navigate('/run')}
            className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-2xl px-24 py-6 rounded-2xl transition-colors duration-150 tracking-tight"
          >
            Start Analysis
          </button>
        </div>
      </div>

      {/* ── Example use-case ─────────────────────────────────── */}
      <div ref={exampleRef}>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-2"
          style={{ opacity: scrollProgress, transform: `translateY(${(1 - scrollProgress) * 80}px)` }}>
          KRAS-mutant Pancreatic Cancer · GEO GSE71729
        </p>

        <div className="grid grid-cols-2 gap-6">

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6"
            style={{
              opacity: scrollProgress,
              transform: `translateY(${(1 - scrollProgress) * 80}px)`,
            }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-6">
              Top prioritized targets
            </p>
            <div className="space-y-6">
              {EXAMPLE_GENES.map(g => (
                <div key={g.symbol}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-200">{g.symbol}</span>
                    <div className="flex items-center gap-4 text-xs font-mono text-slate-600">
                      <span>log₂FC {g.lfc}</span>
                      <span>padj {g.padj}</span>
                    </div>
                  </div>
                  <AnimatedBar score={g.novelty} visible={exampleVisible} />
                  <p className="text-[10px] text-slate-700 mt-1.5">novelty score</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 flex flex-col"
            style={{
              opacity: scrollProgress,
              transform: `translateY(${(1 - scrollProgress) * 80}px)`,
            }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-5">
              Generated hypothesis · TGFBI
            </p>
            <div className="flex-1">
              <WhisperText text={HYPOTHESIS_TEXT} visible={exampleVisible} />
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-700">Novelty score</span>
              <span
                className="font-mono text-sm text-amber-400 transition-opacity duration-700"
                style={{
                  opacity: exampleVisible ? 1 : 0,
                  transitionDelay: `${HYPOTHESIS_TEXT.split(' ').length * 55 + 200}ms`,
                }}
              >
                0.91
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Data Pipeline ────────────────────────────────────── */}
      <div className="border-t border-slate-800 pt-14">
        <p className="text-2xl font-semibold text-slate-400 mb-10">Data Pipeline</p>

        <div ref={containerRef} className="relative flex gap-40 items-stretch">

          {line && (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: '100%', height: '100%', overflow: 'visible' }}
            >
              <path
                d={`M ${line.x1} ${line.y1} C ${line.x1 + 48} ${line.y1}, ${line.x2 - 48} ${line.y2}, ${line.x2} ${line.y2}`}
                stroke="rgba(251,191,36,0.20)"
                strokeWidth="1"
                fill="none"
              />
              <circle cx={line.x2} cy={line.y2} r="2.5" fill="rgba(251,191,36,0.40)" />
            </svg>
          )}

          <div className="shrink-0 w-80 flex flex-col z-10">
            {STEPS.map((step, i) => {
              const isActive = activeStep === step.n
              const isLast   = i === STEPS.length - 1
              return (
                <div key={step.n} className="flex gap-4 items-start">
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => toggle(step.n)}
                      style={isActive ? {
                        boxShadow: '0 0 0 4px rgba(251,191,36,0.15), 0 0 22px rgba(251,191,36,0.28)',
                      } : {}}
                      className={`rounded-full font-mono font-bold flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isActive
                          ? 'w-12 h-12 text-xl bg-amber-400 text-slate-900'
                          : 'w-10 h-10 text-base border border-amber-500/30 text-amber-400/55 hover:text-amber-400 hover:border-amber-400/60'
                      }`}
                    >
                      {step.n}
                    </button>
                    {!isLast && (
                      <div className="w-px flex-1 min-h-[1.25rem] border-l border-dashed border-slate-800 my-1.5" />
                    )}
                  </div>

                  <button
                    ref={el => { labelRefs.current[i] = el }}
                    type="button"
                    onClick={() => toggle(step.n)}
                    className={`inline-block text-left leading-snug whitespace-nowrap transition-all duration-300 ${
                      isActive
                        ? 'text-2xl font-semibold text-slate-100 pt-2'
                        : 'text-lg font-medium text-slate-500 hover:text-slate-300 pt-2'
                    }`}
                  >
                    {step.label}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex-1 flex items-center z-10">
            <div
              ref={bubbleRef}
              className={`w-full rounded-xl p-8 transition-all duration-300 ${
                activeStep ? 'border border-slate-800 bg-slate-900' : 'border border-transparent bg-transparent'
              }`}
              style={{ minHeight: '260px' }}
            >
              {activeStep && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/50 mb-4">
                    Step {activeStep}
                  </p>
                  <p className="text-base text-slate-300 leading-loose">
                    {STEPS[activeStep - 1].detail}
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── CTA footer ───────────────────────────────────────── */}
      <div className="border-t border-slate-800 pt-14 pb-16 flex items-center justify-center">
        <button
          onClick={() => navigate('/run')}
          className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-xl px-20 py-5 rounded-2xl transition-colors duration-150 tracking-tight"
        >
          Start Analysis
        </button>
      </div>

    </div>
  )
}

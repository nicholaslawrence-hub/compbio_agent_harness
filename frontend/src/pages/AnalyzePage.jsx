import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import UploadForm from '../components/UploadForm.jsx'

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

const FIELD_DOCS = [
  {
    field: 'Count Matrix',
    doc: 'TSV or CSV — rows are genes, columns are samples. Raw integer counts give the best results with DESeq2. TPM or FPKM falls back to a Welch t-test with BH correction automatically.',
  },
  {
    field: 'Disease / Study',
    doc: 'Free-text context, e.g. "Glioblastoma" or "KRAS-mutant PDAC". Injected into PubMed queries and the LLM prompt to anchor literature retrieval and hypothesis generation to your biology.',
  },
  {
    field: 'Case / Control labels',
    doc: 'Must exactly match the condition strings assigned to samples. Fold-change is always computed as case ÷ control.',
  },
  {
    field: 'Sample Conditions',
    doc: 'Maps each column header from your matrix to a condition label. Names are case-sensitive. Use "Paste from spreadsheet" to import a two-column list from Excel or Google Sheets.',
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

// Fires callback once when the element enters the viewport
function useInView(ref, options = {}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold: 0.15, ...options })
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [ref])
  return visible
}

function AnimatedBar({ score, visible }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-px bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-700 ease-out"
          style={{
            width: visible ? `${score * 100}%` : '0%',
            opacity: visible ? (0.55 + score * 0.45) : 0,
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
          className="transition-opacity duration-300"
          style={{
            opacity: visible ? 1 : 0,
            transitionDelay: visible ? `${i * 22}ms` : '0ms',
          }}
        >
          {word}{' '}
        </span>
      ))}
    </p>
  )
}

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)
  const containerRef = useRef(null)
  const labelRefs    = useRef([])
  const bubbleRef    = useRef(null)
  const [line, setLine] = useState(null)

  // Instant measurement via RAF — one frame after DOM mutation, no perceptible delay
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

  // Scroll-triggered visibility for the example section
  const exampleRef = useRef(null)
  const exampleVisible = useInView(exampleRef)

  return (
    <div className="space-y-20">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="pt-12 pb-4">
        <h1 className="text-5xl font-bold text-slate-100 leading-tight mb-6">
          From count matrix<br />
          <span className="text-amber-400">to drug hypothesis.</span>
        </h1>
        <p className="text-base text-slate-400 max-w-lg leading-relaxed">
          Upload an RNA-seq count matrix and a disease context. The pipeline runs
          differential expression, maps protein interaction networks, mines the
          literature, annotates known drugs, and synthesizes ranked hypotheses —
          end to end, without leaving the browser.
        </p>
      </div>

      {/* ── How it works ─────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-8">
          How it works
        </p>

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

          {/* Fixed-width column prevents the right panel from shifting */}
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
                        ? 'text-xl font-semibold text-slate-100 pt-2.5'
                        : 'text-base font-medium text-slate-500 hover:text-slate-300 pt-2.5'
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
              className="w-full rounded-xl border border-slate-800 bg-slate-900 p-8"
              style={{ minHeight: '260px' }}
            >
              {activeStep ? (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/50 mb-4">
                    Step {activeStep}
                  </p>
                  <p className="text-base text-slate-300 leading-loose">
                    {STEPS[activeStep - 1].detail}
                  </p>
                </div>
              ) : (
                <p className="text-base text-slate-700 text-center" style={{ paddingTop: '80px' }}>
                  Select a step to see what happens inside the pipeline.
                </p>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Example use-case ─────────────────────────────────── */}
      <div
        ref={exampleRef}
        className="border-t border-slate-800 pt-14 transition-all duration-700 ease-out"
        style={{
          opacity:   exampleVisible ? 1 : 0,
          transform: exampleVisible ? 'translateY(0)' : 'translateY(20px)',
        }}
      >
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-2">Example</p>
        <h2 className="text-2xl font-semibold text-slate-100 mb-1">
          KRAS-mutant Pancreatic Cancer
        </h2>
        <p className="text-sm text-slate-500 mb-10">
          18 tumor vs 18 adjacent-normal samples · GEO accession GSE71729
        </p>

        <div className="grid grid-cols-2 gap-6">

          {/* Top hits */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
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

          {/* Sample hypothesis */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 flex flex-col">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-5">
              Generated hypothesis · TGFBI
            </p>
            <div className="flex-1">
              <WhisperText text={HYPOTHESIS_TEXT} visible={exampleVisible} />
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-700">Novelty score</span>
              <span
                className="font-mono text-sm text-amber-400 transition-opacity duration-500"
                style={{ opacity: exampleVisible ? 1 : 0, transitionDelay: '1400ms' }}
              >
                0.91
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── New Analysis form ────────────────────────────────── */}
      <div className="max-w-2xl">
        <div className="border-t border-slate-800 pt-10 mb-7">
          <h2 className="text-2xl font-semibold text-slate-100 mb-2">New Analysis</h2>
          <p className="text-base text-slate-500">
            Upload a count matrix and configure your experiment below.
          </p>
        </div>
        <UploadForm />
      </div>

      {/* ── Input reference ──────────────────────────────────── */}
      <div className="max-w-2xl border-t border-slate-800 pt-10">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-8">Input reference</p>
        <div className="space-y-8">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex items-start gap-6">
              <div className="flex items-center gap-3 shrink-0 pt-[0.45rem]">
                <span className="font-mono text-sm text-amber-400/50 whitespace-nowrap">{field}</span>
                <div className="w-8 h-px bg-slate-800" />
              </div>
              <span className="text-sm text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

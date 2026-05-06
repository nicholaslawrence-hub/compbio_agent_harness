import { useState, useRef, useLayoutEffect } from 'react'
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
      'GPT-4o receives the combined DGE statistics, PPI context, literature passages, and drug landscape for each prioritised gene. Chain-of-thought reasoning produces a structured hypothesis: proposed mechanism of action, supporting evidence, and a novelty score 0–1. Dark genes connected to oncogene networks with no existing drugs surface at the top.',
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

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)
  const containerRef  = useRef(null)
  const circleRefs    = useRef([])
  const bubbleRef     = useRef(null)
  const [line, setLine] = useState(null)

  useLayoutEffect(() => {
    if (!activeStep || !containerRef.current || !bubbleRef.current) {
      setLine(null)
      return
    }
    const cRect = containerRef.current.getBoundingClientRect()
    const circ  = circleRefs.current[activeStep - 1]?.getBoundingClientRect()
    const bub   = bubbleRef.current.getBoundingClientRect()
    if (!circ) return

    setLine({
      x1: circ.right  - cRect.left,
      y1: circ.top    + circ.height / 2 - cRect.top,
      x2: bub.left    - cRect.left,
      y2: bub.top     + bub.height / 2  - cRect.top,
    })
  }, [activeStep])

  const toggle = (n) => setActiveStep(prev => (prev === n ? null : n))

  return (
    <div className="space-y-16">

      {/* ── Pipeline ─────────────────────────────────────────── */}
      <div ref={containerRef} className="relative flex gap-14 items-stretch">

        {/* SVG connector */}
        {line && (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            {/* bezier from circle to bubble */}
            <path
              d={`M ${line.x1} ${line.y1} C ${line.x1 + 70} ${line.y1}, ${line.x2 - 70} ${line.y2}, ${line.x2} ${line.y2}`}
              stroke="rgba(251,191,36,0.3)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
              fill="none"
            />
            {/* dot at circle */}
            <circle cx={line.x1} cy={line.y1} r="3.5" fill="rgba(251,191,36,0.55)" />
            {/* dot at bubble */}
            <circle cx={line.x2} cy={line.y2} r="3.5" fill="rgba(251,191,36,0.55)" />
          </svg>
        )}

        {/* Left: vertical step list */}
        <div className="shrink-0 w-64 flex flex-col z-10">
          {STEPS.map((step, i) => {
            const isActive = activeStep === step.n
            const isLast   = i === STEPS.length - 1
            return (
              <div key={step.n} className="flex gap-4 items-start">
                <div className="flex flex-col items-center">
                  <button
                    ref={el => { circleRefs.current[i] = el }}
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
                  type="button"
                  onClick={() => toggle(step.n)}
                  className={`text-left transition-all duration-300 leading-snug ${
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

        {/* Right: fixed-position speech bubble */}
        <div className="flex-1 flex items-center z-10">
          <div
            ref={bubbleRef}
            className="w-full rounded-xl border border-slate-800 bg-slate-900 p-8 flex flex-col justify-center"
            style={{ minHeight: '260px' }}
          >
            {activeStep ? (
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-amber-400/50 mb-4">
                  Step {activeStep}
                </p>
                <p className="text-base text-slate-300 leading-loose">
                  {STEPS[activeStep - 1].detail}
                </p>
              </div>
            ) : (
              <p className="text-base text-slate-700 text-center">
                Select a step to see what happens inside the pipeline.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── New Analysis form ────────────────────────────────── */}
      <div className="max-w-2xl">
        <div className="border-t border-slate-800 pt-10 mb-7">
          <h1 className="text-2xl font-semibold text-slate-100 mb-2">New Analysis</h1>
          <p className="text-base text-slate-500">
            Upload a count matrix and configure your experiment below.
          </p>
        </div>
        <UploadForm />
      </div>

      {/* ── Input reference ──────────────────────────────────── */}
      <div className="max-w-2xl border-t border-slate-800 pt-10">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-6">Input reference</p>
        <div className="space-y-6">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex gap-8">
              <span className="font-mono text-sm text-amber-400/50 w-36 shrink-0 pt-0.5">{field}</span>
              <span className="text-base text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

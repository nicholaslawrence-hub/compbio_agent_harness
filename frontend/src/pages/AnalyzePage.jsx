import { useState } from 'react'
import UploadForm from '../components/UploadForm.jsx'

const STEPS = [
  {
    n: 1,
    label: 'Differential Expression',
    detail:
      'Your count matrix is tested gene-by-gene for statistically significant expression changes between case and control. PyDESeq2 applies a negative binomial model and Benjamini–Hochberg correction. Only genes clearing padj < 0.05 and |log₂FC| > 1 feed into downstream steps — everything else is filtered out.',
  },
  {
    n: 2,
    label: 'Protein Interaction Network',
    detail:
      'Top upregulated genes are queried against the STRING database to map protein–protein interaction networks. High-confidence partners are scored and cross-referenced against a curated oncogene list — surfacing which of your hits are wired into known disease driver networks and which connections might be therapeutically exploitable.',
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
      'A publication-style report covers all findings: executive summary, targets ranked by novelty score, proposed mechanisms, and recommended follow-up experiments including suggested assays and validation approaches. Displayed inline and fully copyable — designed to slot into grant writing or lab notebooks.',
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
    doc: 'Maps each column header from your matrix to a condition label. Names are case-sensitive. Use "Paste from spreadsheet" to import a two-column list directly from Excel or Google Sheets.',
  },
]

// rough per-step row height so the bubble arrow tracks the circle vertically
const ROW_HEIGHT_INACTIVE = 44   // px — circle(32) + gap
const ROW_HEIGHT_ACTIVE   = 44

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)

  const toggle = (n) => setActiveStep(prev => (prev === n ? null : n))

  // calculate top offset of the bubble arrow = sum of rows above active
  const arrowTop = activeStep
    ? STEPS.slice(0, activeStep - 1).reduce((acc) => acc + ROW_HEIGHT_INACTIVE, 0) + 14
    : 0

  return (
    <div className="space-y-16">

      {/* ── Pipeline walkthrough ─────────────────────────────── */}
      <div className="relative flex gap-12">

        {/* Left: step list */}
        <div className="shrink-0 w-60 flex flex-col">
          {STEPS.map((step, i) => {
            const isActive = activeStep === step.n
            const isLast   = i === STEPS.length - 1
            return (
              <div key={step.n}>
                <div className="flex items-start gap-3">
                  {/* circle + line */}
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => toggle(step.n)}
                      style={isActive ? {
                        boxShadow: '0 0 0 4px rgba(251,191,36,0.12), 0 0 18px rgba(251,191,36,0.22)',
                      } : {}}
                      className={`rounded-full font-mono font-bold flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isActive
                          ? 'w-11 h-11 text-lg bg-amber-400 text-slate-900'
                          : 'w-8 h-8 text-sm border border-amber-500/25 text-amber-400/50 hover:text-amber-400 hover:border-amber-400/50'
                      }`}
                    >
                      {step.n}
                    </button>
                    {!isLast && (
                      <div className="flex-1 w-px my-1.5 border-l border-dashed border-slate-800 min-h-[1.25rem]" />
                    )}
                  </div>

                  {/* label */}
                  <button
                    type="button"
                    onClick={() => toggle(step.n)}
                    className={`text-left leading-snug transition-all duration-300 ${
                      isActive
                        ? 'text-lg font-semibold text-slate-100 pt-1.5'
                        : 'text-sm font-medium text-slate-500 hover:text-slate-300 pt-1.5'
                    }`}
                  >
                    {step.label}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right: speech bubble panel */}
        <div className="flex-1 relative">
          {activeStep && (() => {
            const step = STEPS[activeStep - 1]
            return (
              <div
                className="transition-all duration-300"
                style={{ paddingTop: `${arrowTop}px` }}
              >
                {/* arrow pointing left */}
                <div
                  className="w-0 h-0 ml-0 mb-0"
                  style={{
                    borderTop: '8px solid transparent',
                    borderBottom: '8px solid transparent',
                    borderRight: '10px solid rgb(30 41 59)', // slate-800
                    marginBottom: '-1px',
                    marginLeft: '0px',
                  }}
                />
                {/* bubble */}
                <div className="relative overflow-hidden rounded-xl rounded-tl-none border border-slate-800 bg-slate-900/50 p-6">
                  {/* large ghost number */}
                  <span className="absolute right-5 bottom-2 font-mono font-bold text-[7rem] leading-none text-slate-800/25 select-none pointer-events-none">
                    {step.n}
                  </span>
                  {/* step label inside bubble */}
                  <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400/50 mb-3">
                    Step {step.n}
                  </p>
                  <p className="relative text-sm text-slate-300 leading-loose max-w-prose">
                    {step.detail}
                  </p>
                </div>
              </div>
            )
          })()}

          {!activeStep && (
            <div className="h-full flex items-start pt-1.5">
              <p className="text-sm text-slate-700 italic">Select a step ↑</p>
            </div>
          )}
        </div>
      </div>

      {/* ── New Analysis form ────────────────────────────────── */}
      <div className="max-w-2xl space-y-6">
        <div className="border-t border-slate-800 pt-10">
          <h1 className="text-xl font-semibold text-slate-100 mb-1">New Analysis</h1>
          <p className="text-sm text-slate-500">
            Upload a count matrix and configure your experiment below.
          </p>
        </div>
        <UploadForm />
      </div>

      {/* ── Input reference ──────────────────────────────────── */}
      <div className="max-w-2xl border-t border-slate-800 pt-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-5">Input reference</p>
        <div className="space-y-5">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex gap-8">
              <span className="font-mono text-xs text-amber-400/50 w-36 shrink-0 pt-0.5">{field}</span>
              <span className="text-sm text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

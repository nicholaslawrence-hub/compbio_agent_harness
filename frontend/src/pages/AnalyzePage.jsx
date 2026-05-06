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
      'Top upregulated genes are queried against the STRING database to map protein–protein interaction networks. High-confidence partners are scored and cross-referenced against a curated oncogene list — surfacing whether your hits are embedded in known disease driver networks, and which connections might be therapeutically exploitable.',
  },
  {
    n: 3,
    label: 'Literature RAG',
    detail:
      'Abstracts are fetched live from PubMed and Semantic Scholar for each gene, then upserted into a Pinecone vector index. The index is semantically searched to pull the most relevant passages per gene. Genes returning fewer than three meaningful hits are flagged as dark genes — under-studied targets with higher novelty potential and less competitive drug discovery landscape.',
  },
  {
    n: 4,
    label: 'Drug & Protein Annotation',
    detail:
      'Each gene is looked up in UniProt for functional description and known 3D structures. ChEMBL is then queried for approved and investigational drugs that already target the same protein. The resulting drug coverage map directly shapes the novelty scoring in the hypothesis step — a well-drugged target scores lower, a dark gene with no compounds scores higher.',
  },
  {
    n: 5,
    label: 'Hypothesis Synthesis',
    detail:
      'GPT-4o receives the combined DGE statistics, PPI context, literature passages, and drug landscape for each prioritised gene. Using chain-of-thought reasoning it produces a structured therapeutic hypothesis: proposed mechanism of action, supporting evidence items, and a novelty score from 0 to 1. Dark genes wired into oncogene networks with no existing drugs consistently surface at the top.',
  },
  {
    n: 6,
    label: 'Report Generation',
    detail:
      'A publication-style markdown report is generated covering all findings: executive summary, targets ranked by novelty score, proposed mechanisms, and recommended follow-up experiments including suggested assays and validation approaches. Displayed inline and fully copyable — designed to slot directly into grant writing, lab notebooks, or internal research briefs.',
  },
]

const FIELD_DOCS = [
  {
    field: 'Count Matrix',
    doc: 'TSV or CSV — rows are genes, columns are samples. Raw integer counts give the best results with DESeq2. If you only have TPM or FPKM the pipeline falls back to a Welch t-test with BH correction automatically.',
  },
  {
    field: 'Disease / Study',
    doc: 'Free-text context, e.g. "Glioblastoma" or "KRAS-mutant PDAC". Injected into PubMed queries, Semantic Scholar searches, and the LLM prompt to anchor literature retrieval and hypothesis generation to your biology.',
  },
  {
    field: 'Case / Control labels',
    doc: 'Must exactly match the condition strings you assign to samples below. Fold-change is always computed as case ÷ control, so make sure the labels align with the biology you intend to contrast.',
  },
  {
    field: 'Sample Conditions',
    doc: 'Maps each column header from your matrix to a condition label. Names are case-sensitive and must match exactly. Use "Paste from spreadsheet" to import a two-column list directly from Excel or Google Sheets.',
  },
]

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)

  const toggle = (n) => setActiveStep(prev => prev === n ? null : n)

  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-100 mb-1">New Analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a gene expression count matrix to identify therapeutic targets.
        </p>
      </div>

      {/* Pipeline */}
      <div className="flex gap-10">
        {/* Left: vertical steps */}
        <div className="shrink-0 w-64 flex flex-col">
          {STEPS.map((step, i) => {
            const isActive = activeStep === step.n
            const isLast = i === STEPS.length - 1
            return (
              <div key={step.n} className="flex gap-3.5">
                {/* circle + line */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => toggle(step.n)}
                    style={isActive ? {
                      boxShadow: '0 0 0 4px rgba(251,191,36,0.15), 0 0 20px rgba(251,191,36,0.25)',
                    } : {}}
                    className={`rounded-full font-mono font-bold flex items-center justify-center shrink-0 transition-all duration-300 ${
                      isActive
                        ? 'w-12 h-12 text-xl bg-amber-400 text-slate-900'
                        : 'w-8 h-8 text-sm border border-amber-500/25 text-amber-400/50 hover:text-amber-400 hover:border-amber-500/50 bg-transparent'
                    }`}
                  >
                    {step.n}
                  </button>
                  {!isLast && (
                    <div className="flex-1 w-px my-1.5 border-l border-dashed border-slate-800 min-h-[1.5rem]" />
                  )}
                </div>

                {/* label */}
                <div className={`flex-1 transition-all duration-300 ${isLast ? '' : 'pb-1'}`}>
                  <button
                    type="button"
                    onClick={() => toggle(step.n)}
                    className={`text-left transition-all duration-300 w-full ${
                      isActive
                        ? 'text-xl font-semibold text-slate-100 pt-1.5'
                        : 'text-sm font-medium text-slate-500 pt-1.5 hover:text-slate-300'
                    }`}
                  >
                    {step.label}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right: explanation */}
        <div className="flex-1 pt-1">
          {activeStep ? (
            <div className="border-l border-slate-800 pl-10">
              <p className="text-xs font-mono uppercase tracking-widest text-slate-600 mb-4">
                Step {activeStep}
              </p>
              <p className="text-slate-300 text-base leading-loose">
                {STEPS[activeStep - 1].detail}
              </p>
            </div>
          ) : (
            <div className="border-l border-slate-800 pl-10 pt-1.5">
              <p className="text-sm text-slate-700">
                Select a step to learn what happens inside the pipeline.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl">
        <UploadForm />
      </div>

      {/* Input reference */}
      <div className="max-w-2xl border-t border-slate-800 pt-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-5">Input reference</p>
        <div className="space-y-5">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex gap-8">
              <span className="font-mono text-xs text-amber-400/50 w-36 shrink-0 pt-0.5 leading-relaxed">{field}</span>
              <span className="text-sm text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

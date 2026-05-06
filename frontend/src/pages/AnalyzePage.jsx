import { useState } from 'react'
import UploadForm from '../components/UploadForm.jsx'

const STEPS = [
  {
    n: 1,
    label: 'Differential Expression',
    tag: 'DESeq2',
    detail:
      'Your count matrix is tested gene-by-gene for statistically significant expression changes between case and control. PyDESeq2 applies a negative binomial model and Benjamini–Hochberg correction. Only genes clearing padj < 0.05 and |log₂FC| > 1 feed into downstream steps.',
  },
  {
    n: 2,
    label: 'Protein Interaction Network',
    tag: 'STRING',
    detail:
      'Top upregulated genes are queried against the STRING database. High-confidence interaction partners are scored and cross-referenced against a curated oncogene list — surfacing which of your hits are wired into known disease driver networks.',
  },
  {
    n: 3,
    label: 'Literature RAG',
    tag: 'Pinecone',
    detail:
      'Abstracts are auto-fetched live from PubMed and Semantic Scholar, then upserted into a Pinecone vector index. The index is semantically queried to retrieve the most relevant passages per gene. Fewer than 3 hits → classified as a dark gene: under-studied, higher novelty potential.',
  },
  {
    n: 4,
    label: 'Drug & Protein Annotation',
    tag: 'ChEMBL',
    detail:
      'UniProt is queried for protein function and known 3D structures. ChEMBL is then searched for approved and investigational drugs against the same target. Existing drug coverage directly shapes the novelty score computed in the next step.',
  },
  {
    n: 5,
    label: 'Hypothesis Synthesis',
    tag: 'GPT-4o',
    detail:
      'GPT-4o receives the combined DGE statistics, PPI context, literature summary, and drug landscape for each top gene. Chain-of-thought reasoning produces a structured hypothesis: mechanism of action, supporting evidence, and a novelty score 0–1. Dark genes connected to oncogene networks score highest.',
  },
  {
    n: 6,
    label: 'Report Generation',
    tag: 'Markdown',
    detail:
      'A publication-style report is generated covering all findings: executive summary, ranked targets, proposed mechanisms, and recommended follow-up experiments. Displayed inline and copyable — useful for grant writing or lab notebooks.',
  },
]

const FIELD_DOCS = [
  {
    field: 'Count Matrix',
    doc: 'TSV or CSV — rows are genes, columns are samples. Raw integer counts give the best results with DESeq2. If you only have TPM or FPKM, a Welch t-test with BH correction is used instead.',
  },
  {
    field: 'Disease / Study',
    doc: 'Free-text context e.g. "Glioblastoma" or "KRAS-mutant PDAC". Injected into PubMed queries and the LLM prompt to anchor literature retrieval and hypothesis generation.',
  },
  {
    field: 'Case / Control labels',
    doc: 'Must exactly match the condition strings assigned to samples. Fold-change is always computed as case ÷ control.',
  },
  {
    field: 'Sample Conditions',
    doc: 'Maps each column header in your matrix to a condition label. Names are case-sensitive. Use "Paste from spreadsheet" to import a two-column list directly from Excel or Google Sheets.',
  },
]

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 mb-1">New Analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a gene expression count matrix to identify therapeutic targets.
        </p>
      </div>

      {/* Pipeline */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="px-5 pt-5 pb-1 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-600">Pipeline — 6 steps</span>
        </div>

        <div className="px-5 pb-5 pt-3">
          {STEPS.map((step, i) => {
            const isActive = activeStep === step.n
            const isLast = i === STEPS.length - 1
            return (
              <div key={step.n} className="flex gap-4">
                {/* Node + line */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => setActiveStep(isActive ? null : step.n)}
                    style={isActive ? {
                      boxShadow: '0 0 0 3px rgba(251,191,36,0.15), 0 0 14px rgba(251,191,36,0.25)'
                    } : {}}
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-sm shrink-0 transition-all duration-200 ${
                      isActive
                        ? 'bg-amber-400 text-slate-900'
                        : 'bg-amber-400/10 border border-amber-500/30 text-amber-400/70 hover:bg-amber-400/20 hover:text-amber-400'
                    }`}
                  >
                    {step.n}
                  </button>
                  {!isLast && (
                    <div className="flex-1 w-px my-1 border-l border-dashed border-slate-800 min-h-[1.5rem]" />
                  )}
                </div>

                {/* Content */}
                <div className={`flex-1 ${!isLast ? 'pb-1' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setActiveStep(isActive ? null : step.n)}
                    className="w-full text-left flex items-center gap-2.5 h-8 group"
                  >
                    <span className={`text-sm font-medium transition-colors duration-150 ${isActive ? 'text-slate-100' : 'text-slate-400 group-hover:text-slate-200'}`}>
                      {step.label}
                    </span>
                    <span className={`font-mono text-[10px] tracking-wide border rounded px-1.5 py-0.5 transition-colors duration-150 ${
                      isActive
                        ? 'text-amber-400 border-amber-500/40 bg-amber-400/5'
                        : 'text-slate-600 border-slate-800 group-hover:text-slate-500'
                    }`}>
                      {step.tag}
                    </span>
                  </button>

                  {isActive && (
                    <div className="mt-1 mb-3 pl-3 border-l-2 border-amber-500/30">
                      <p className="text-xs text-slate-400 leading-relaxed">{step.detail}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Form */}
      <UploadForm />

      {/* Input reference */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="px-5 pt-5 pb-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-600">Input reference</span>
        </div>
        <div className="px-5 pb-5 pt-3 space-y-4">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex gap-4">
              <span className="font-mono text-xs text-amber-400/60 w-36 shrink-0 pt-0.5 leading-relaxed">{field}</span>
              <span className="text-xs text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

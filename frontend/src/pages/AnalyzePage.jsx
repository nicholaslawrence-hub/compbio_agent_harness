import { useState } from 'react'
import UploadForm from '../components/UploadForm.jsx'

const STEPS = [
  {
    n: 1,
    label: 'Differential Expression',
    short: 'DGE',
    detail:
      'Your count matrix is analyzed using PyDESeq2 (or a t-test fallback). Each gene is tested for statistically significant expression differences between case and control. Genes are ranked by adjusted p-value and log₂ fold-change — only those passing padj < 0.05 and |log₂FC| > 1 continue.',
  },
  {
    n: 2,
    label: 'PPI Network',
    short: 'STRING',
    detail:
      'Top upregulated genes are queried against the STRING database to map protein–protein interactions. High-confidence partners are scored and cross-referenced against a curated oncogene list, surfacing whether your hits are connected to known disease drivers.',
  },
  {
    n: 3,
    label: 'Literature RAG',
    short: 'Pinecone',
    detail:
      'Abstracts are auto-fetched from PubMed and Semantic Scholar for each gene, then upserted into a Pinecone vector index. The index is semantically searched to retrieve the most relevant passages. Genes with fewer than 3 matching publications are flagged as "dark genes" — under-studied targets with higher novelty potential.',
  },
  {
    n: 4,
    label: 'Drug Annotation',
    short: 'ChEMBL + UniProt',
    detail:
      'Each gene is looked up in UniProt for functional annotations and known 3D structures (PDB IDs). ChEMBL is then queried for approved and investigational drugs targeting the same protein. Existing drug coverage directly informs the novelty score in the next step.',
  },
  {
    n: 5,
    label: 'Hypothesis Synthesis',
    short: 'GPT-4o',
    detail:
      'GPT-4o receives the combined DGE stats, PPI context, literature summary, and drug landscape for each top gene. Using chain-of-thought reasoning it produces a structured hypothesis: mechanism of action, supporting evidence, and a novelty score 0–1. Dark genes with oncogene interactions and no existing drugs score highest.',
  },
  {
    n: 6,
    label: 'Report',
    short: 'Markdown',
    detail:
      'A publication-style markdown report is generated summarising all findings: executive summary, ranked targets, proposed mechanisms, and recommended follow-up experiments. Displayed in the results view and copyable for use in grant applications or lab notes.',
  },
]

const FIELD_DOCS = [
  {
    field: 'Count Matrix',
    doc: 'TSV or CSV — rows are genes, columns are samples. Raw integer counts work best with DESeq2. TPM/FPKM will fall back to a t-test.',
  },
  {
    field: 'Disease / Study',
    doc: 'Used to focus PubMed and Semantic Scholar queries and to guide the LLM. E.g. "Glioblastoma" or "KRAS-mutant PDAC".',
  },
  {
    field: 'Case / Control labels',
    doc: 'Must exactly match the condition strings assigned to samples. Fold-change is always computed as case ÷ control.',
  },
  {
    field: 'Sample Conditions',
    doc: 'Maps each column header from your matrix to a condition. Names are case-sensitive. Use "Paste from spreadsheet" for bulk import.',
  },
]

export default function AnalyzePage() {
  const [activeStep, setActiveStep] = useState(null)

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 mb-1">New Analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a gene expression count matrix to identify therapeutic targets.
        </p>
      </div>

      {/* Pipeline roadmap */}
      <div className="border border-slate-800 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-slate-600 mb-4">How it works</p>

        {/* Step nodes */}
        <div className="flex items-start gap-0">
          {STEPS.map((step, i) => (
            <div key={step.n} className="flex items-start flex-1">
              <div className="flex flex-col items-center flex-1">
                <button
                  type="button"
                  onClick={() => setActiveStep(activeStep === step.n ? null : step.n)}
                  className={`flex flex-col items-center gap-1.5 group w-full pb-2 ${activeStep === step.n ? '' : ''}`}
                >
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border transition-all ${
                      activeStep === step.n
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-500 group-hover:border-slate-500 group-hover:text-slate-300'
                    }`}
                  >
                    {step.n}
                  </span>
                  <span className={`text-[10px] text-center leading-tight px-1 transition-colors ${activeStep === step.n ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-400'}`}>
                    {step.label}
                  </span>
                </button>
              </div>

              {/* connector */}
              {i < STEPS.length - 1 && (
                <div className="w-4 shrink-0 mt-4 h-px bg-slate-800" />
              )}
            </div>
          ))}
        </div>

        {/* Expanded detail */}
        {activeStep && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <p className="text-xs font-medium text-indigo-400 mb-1">
              Step {activeStep} — {STEPS[activeStep - 1].label}
              <span className="ml-2 text-slate-600 font-normal">{STEPS[activeStep - 1].short}</span>
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {STEPS[activeStep - 1].detail}
            </p>
          </div>
        )}
      </div>

      {/* Form */}
      <UploadForm />

      {/* Field reference */}
      <div className="border border-slate-800 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-slate-600 mb-4">Input reference</p>
        <div className="space-y-3">
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="flex gap-3">
              <span className="text-xs font-medium text-slate-400 w-32 shrink-0 pt-0.5">{field}</span>
              <span className="text-xs text-slate-600 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

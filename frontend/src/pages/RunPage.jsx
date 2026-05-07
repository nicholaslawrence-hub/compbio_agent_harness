import UploadForm from '../components/UploadForm.jsx'

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

export default function RunPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-16 py-12">

      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-2">New Analysis</p>
        <h1 className="text-3xl font-bold text-slate-100 mb-3">Run the pipeline</h1>
        <p className="text-base text-slate-500">
          Upload a count matrix and configure your experiment. Results are ready in minutes.
        </p>
      </div>

      <UploadForm />

      <div className="border-t border-slate-800 pt-10">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-6">Input reference</p>
        <div>
          {FIELD_DOCS.map(({ field, doc }) => (
            <div key={field} className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-12 gap-y-1 py-5 border-b border-slate-800/50 last:border-0">
              <span className="text-sm font-medium text-slate-300 pt-0.5">{field}</span>
              <span className="text-sm text-slate-500 leading-relaxed">{doc}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

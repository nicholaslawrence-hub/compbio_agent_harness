import UploadForm from '../components/UploadForm.jsx'

const FIELD_DOCS = [
  {
    field: 'Count Matrix',
    doc: 'TSV or CSV — rows are genes, columns are samples. Raw integer counts work best with DESeq2. TPM or FPKM automatically falls back to a Welch t-test with BH correction.',
  },
  {
    field: 'Disease / Study',
    doc: 'Free-text context, e.g. "Glioblastoma". Injected into PubMed queries and the LLM prompt to anchor literature retrieval and hypothesis generation to your biology.',
  },
  {
    field: 'Case / Control',
    doc: 'Must exactly match the condition strings assigned to samples. Fold-change is always computed as case ÷ control.',
  },
  {
    field: 'Sample Conditions',
    doc: 'Maps each column header from your matrix to a condition. Names are case-sensitive. Use "paste from sheet" to bulk-import from Excel or Google Sheets.',
  },
  {
    field: 'File format',
    doc: 'First column = gene symbols. Remaining columns = sample names. No header for gene column required — it\'s inferred from position.',
  },
]

const TIPS = [
  'Use raw counts, not normalised values, for best DESeq2 results.',
  'At least 3 replicates per condition gives statistical power.',
  'Gene symbols must be HGNC — e.g. EGFR, TP53, not Ensembl IDs.',
  'Disease context improves PubMed relevance and hypothesis quality.',
]

export default function RunPage() {
  return (
    <div className="py-10 sm:py-16">
      <div className="mb-10">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-amber-400/60 mb-2">New Analysis</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">Launch the agent network</h1>
        <p className="text-base text-white/80 max-w-lg">
          Upload a count matrix and configure your experiment. Results are ready in minutes.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-10 lg:gap-14 items-start">

        {/* ── Left: form ──────────────────────────────────────── */}
        <div className="w-full lg:w-[58%] glass-panel rounded-2xl p-6 sm:p-8">
          <UploadForm />
        </div>

        {/* ── Right: sticky reference panel ───────────────────── */}
        <div className="w-full lg:w-[42%] lg:sticky lg:top-28 space-y-6">

          {/* Input reference */}
          <div className="glass-panel rounded-2xl p-6">
            <p className="text-xs font-mono uppercase tracking-widest text-amber-400/60 mb-5">Input reference</p>
            <div className="space-y-5">
              {FIELD_DOCS.map(({ field, doc }) => (
                <div key={field} className="border-b border-slate-800/60 pb-4 last:border-0 last:pb-0">
                  <p className="text-sm font-semibold text-white mb-1">{field}</p>
                  <p className="text-sm text-white/50 leading-relaxed">{doc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="glass-panel rounded-2xl p-6">
            <p className="text-xs font-mono uppercase tracking-widest text-amber-400/60 mb-4">Tips</p>
            <ul className="space-y-3">
              {TIPS.map((tip, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-mono text-xs text-amber-400/40 pt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm text-white/50 leading-relaxed">{tip}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </div>
  )
}

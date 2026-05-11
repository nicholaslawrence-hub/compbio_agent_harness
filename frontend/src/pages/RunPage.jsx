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
    <div className="py-5">
      <div className="mb-4 border-b border-slate-700 pb-3">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Run Analysis</h1>
      </div>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] items-start">
        <div className="min-w-0">
          <UploadForm />
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24">
          <section>
            <p className="bg-slate-800 px-2 py-1 text-xs font-bold text-white">Input reference</p>
            <table className="mt-3 w-full border-collapse text-left text-xs">
              <tbody>
                {FIELD_DOCS.map(({ field, doc }) => (
                  <tr key={field} className="border-b border-slate-800 align-top">
                    <th className="w-32 py-2 pr-4 font-semibold text-white">{field}</th>
                    <td className="py-2 leading-relaxed text-slate-300">{doc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-5">
            <p className="bg-slate-800 px-2 py-1 text-xs font-bold text-white">Tips</p>
            <ol className="mt-3 space-y-2 text-xs">
              {TIPS.map((tip, i) => (
                <li key={i} className="grid grid-cols-[2rem_1fr] gap-2">
                  <span className="text-slate-500">{String(i + 1).padStart(2, '0')}</span>
                  <span className="leading-relaxed text-slate-300">{tip}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

import { Dna, BookOpen, Cpu, Database } from 'lucide-react'
import UploadForm from '../components/UploadForm.jsx'

const FEATURES = [
  { icon: Database, title: 'Multi-Omics Data', desc: 'Integrates NCBI SRA, UniProt, ChEMBL, and STRING DB' },
  { icon: Cpu, title: 'Bioinformatics Toolbox', desc: 'Kallisto/Salmon quantification and DGE analysis' },
  { icon: BookOpen, title: 'Self-RAG Literature', desc: 'PubMed search to identify dark genes under-studied for drugs' },
  { icon: Dna, title: 'LLM Hypothesis Engine', desc: 'LangGraph + GPT-4o chain-of-thought therapeutic reasoning' },
]

export default function AnalyzePage() {
  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-pharma-600/10 border border-pharma-600/20 rounded-full px-4 py-1 text-xs text-pharma-400 mb-4">
          <Dna size={13} /> Agentic Multi-Omics Drug Discovery
        </div>
        <h1 className="text-4xl font-bold text-white mb-3">
          PharmaGPT<span className="text-pharma-400">-Agent</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Upload a gene expression count matrix and let the AI pipeline autonomously discover
          novel therapeutic targets through multi-omics agentic reasoning.
        </p>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="card text-center hover:border-gray-700 transition-colors">
            <Icon size={22} className="text-pharma-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-1">{title}</p>
            <p className="text-xs text-gray-500">{desc}</p>
          </div>
        ))}
      </div>

      {/* Upload card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-5 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-pharma-600/20 text-pharma-400 text-xs flex items-center justify-center font-bold">1</span>
          Upload & Configure Analysis
        </h2>
        <UploadForm />
      </div>

      {/* File format hint */}
      <div className="mt-4 card bg-gray-900/40">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Expected File Format</p>
        <pre className="text-xs text-gray-400 overflow-x-auto">
{`gene\t sample_T1\tsample_T2\tsample_N1\tsample_N2
TP53\t 120\t\t 95\t\t  450\t\t 420
EGFR\t 890\t\t 930\t\t  210\t\t 190
MYC\t 1200\t\t 1100\t\t  300\t\t 280
...`}
        </pre>
        <p className="text-xs text-gray-600 mt-2">Rows = genes, Columns = samples. First column = gene symbols. Raw counts or TPM accepted.</p>
      </div>
    </div>
  )
}

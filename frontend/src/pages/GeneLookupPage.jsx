import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, ExternalLink, Loader2 } from 'lucide-react'
import { getGenePPI, getGeneUniprot, getGeneDrugs, getGenePubmed } from '../utils/api.js'

function Section({ title, children }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-xs text-white/40">{title}</h3>
      {children}
    </div>
  )
}

export default function GeneLookupPage() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(symbol || '')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const lookup = async (sym) => {
    const s = sym.trim().toUpperCase()
    if (!s) return
    setLoading(true)
    setError('')
    setData(null)
    try {
      const [ppi, uniprot, drugs, pubmed] = await Promise.allSettled([
        getGenePPI(s), getGeneUniprot(s), getGeneDrugs(s), getGenePubmed(s),
      ])
      setData({
        ppi: ppi.status === 'fulfilled' ? ppi.value : null,
        uniprot: uniprot.status === 'fulfilled' ? uniprot.value : null,
        drugs: drugs.status === 'fulfilled' ? drugs.value : [],
        pubmed: pubmed.status === 'fulfilled' ? pubmed.value : [],
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (symbol) lookup(symbol) }, [symbol])

  const handleSearch = (e) => {
    e.preventDefault()
    navigate(`/gene/${input.trim().toUpperCase()}`)
    lookup(input)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Gene Lookup</h1>
        <p className="text-sm text-white/70">Explore PPI networks, drug interactions, and literature for any gene.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Gene symbol (e.g. EGFR, TP53, MYC)"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Lookup
        </button>
      </form>

      {error && <div className="card border-red-700/40 text-red-300 text-sm">{error}</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* UniProt */}
          <Section title="UniProt Annotation">
            {data.uniprot ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/40">Accession</span>
                  <a
                    href={`https://www.uniprot.org/uniprotkb/${data.uniprot.accession}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    {data.uniprot.accession} <ExternalLink size={11} />
                  </a>
                </div>
                <div>
                  <span className="text-white/40">Protein</span>
                  <p className="text-white text-xs mt-1">{data.uniprot.protein_name}</p>
                </div>
                {data.uniprot.function && (
                  <div>
                    <span className="text-white/40">Function</span>
                    <p className="text-white/80 text-xs mt-1 leading-relaxed line-clamp-4">{data.uniprot.function}</p>
                  </div>
                )}
                {data.uniprot.pdb_ids?.length > 0 && (
                  <div>
                    <span className="text-white/40">PDB Structures</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {data.uniprot.pdb_ids.map(id => (
                        <a
                          key={id}
                          href={`https://www.rcsb.org/structure/${id}`}
                          target="_blank" rel="noopener noreferrer"
                          className="badge-known"
                        >
                          {id}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <p className="text-white/40 text-sm">Not found in UniProt.</p>}
          </Section>

          {/* Drugs */}
          <Section title="ChEMBL Drug Interactions">
            {data.drugs?.length > 0 ? (
              <div className="space-y-2">
                {data.drugs.slice(0, 8).map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <a
                      href={`https://www.ebi.ac.uk/chembl/compound_report_card/${d.molecule_id}/`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:underline font-medium"
                    >
                      {d.molecule_name || d.molecule_id}
                    </a>
                    <span className="text-white/40">
                      {d.standard_type} {d.standard_value} {d.standard_units}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-white/40 text-sm">No drug interactions found in ChEMBL.</p>}
          </Section>

          {/* PPI */}
          <Section title="STRING DB Interactions">
            {data.ppi?.partners?.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.ppi.partners.map((p, i) => (
                  <span
                    key={i}
                    className={p.is_oncogene ? 'badge-oncogene' : 'badge-known'}
                    title={`Score: ${p.score}`}
                  >
                    {p.partner}
                    {p.is_oncogene && ' ⚠'}
                  </span>
                ))}
              </div>
            ) : <p className="text-white/40 text-sm">No interactions found.</p>}
            {data.ppi?.error && <p className="text-xs text-red-400 mt-1">{data.ppi.error}</p>}
          </Section>

          {/* PubMed */}
          <Section title="PubMed Drug Literature">
            {data.pubmed?.length > 0 ? (
              <div className="space-y-3">
                {data.pubmed.map((a, i) => (
                  <div key={i} className="text-xs border-l-2 border-gray-700 pl-2">
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline"
                    >
                      PMID: {a.pmid}
                    </a>
                    <p className="text-white/50 mt-0.5 line-clamp-3">{a.abstract}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <p className="text-white/40 text-sm">No drug-gene literature found.</p>
                <span className="badge-dark mt-2">Potential unstudied gene.</span>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

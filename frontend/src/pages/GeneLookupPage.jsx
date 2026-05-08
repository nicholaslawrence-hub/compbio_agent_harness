import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, ExternalLink, Loader2 } from 'lucide-react'
import { getGenePPI, getGeneUniprot, getGeneDrugs, getGenePubmed } from '../utils/api.js'

function Section({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-600/70 bg-slate-800/90 p-4 min-w-0 overflow-hidden shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
      <h3 className="font-semibold text-white/80 mb-4 uppercase tracking-wider text-xs">{title}</h3>
      {children}
    </div>
  )
}

function phaseLabel(phase) {
  if (Number(phase) === 4) return 'Approved'
  if (Number(phase) > 0) return `Phase ${phase}`
  return 'Preclinical'
}

function ActivityRow({ drug, muted = false }) {
  const displayName = drug.molecule_name || drug.molecule_id
  const showId = drug.molecule_id && displayName !== drug.molecule_id
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <div className="min-w-0">
        <a
          href={`https://www.ebi.ac.uk/chembl/compound_report_card/${drug.molecule_id}/`}
          target="_blank" rel="noopener noreferrer"
          className={`${muted ? 'text-white/85' : 'text-cyan-300'} hover:text-white hover:underline font-semibold truncate block`}
        >
          {displayName}
        </a>
        {showId && <p className="text-slate-400 mt-0.5">{drug.molecule_id}</p>}
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <p className={Number(drug.max_phase) === 4 ? 'text-emerald-300 font-semibold' : 'text-white/75 font-medium'}>
          {phaseLabel(drug.max_phase)}
        </p>
        <p className="text-slate-300">
          {drug.pchembl_value ? `pChEMBL ${drug.pchembl_value}` : `${drug.standard_type || drug.assay_type || ''}`}
        </p>
        {drug.standard_value && (
          <p className="text-slate-400">
            {drug.standard_type} {drug.standard_value} {drug.standard_units}
          </p>
        )}
      </div>
    </div>
  )
}

function stringDbUrl(symbol) {
  return `https://string-db.org/network/9606.${encodeURIComponent(symbol)}`
}

export default function GeneLookupPage() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
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
      const drugPayload = drugs.status === 'fulfilled' ? drugs.value : null
      setData({
        ppi: ppi.status === 'fulfilled' ? ppi.value : null,
        uniprot: uniprot.status === 'fulfilled' ? uniprot.value : null,
        drugs: Array.isArray(drugPayload) ? drugPayload : (drugPayload?.drugs ?? []),
        exploratoryDrugs: Array.isArray(drugPayload) ? [] : (drugPayload?.exploratory_drugs ?? []),
        targetActivityCount: Array.isArray(drugPayload) ? null : drugPayload?.target_activity_count,
        drugNote: Array.isArray(drugPayload) ? '' : (drugPayload?.query_note ?? ''),
        drugTargetFound: Array.isArray(drugPayload) ? null : drugPayload?.query_found_target,
        pubmed: pubmed.status === 'fulfilled' ? pubmed.value : [],
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setData(null)
    setError('')
  }, [symbol])

  const handleSearch = (e) => {
    e.preventDefault()
    const s = input.trim().toUpperCase()
    if (!s) return
    navigate(`/gene/${s}`)
    lookup(s)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-6 items-end">
        <div>
          <p className="text-sm uppercase tracking-wide text-amber-400/80 mb-2">Gene Lookup</p>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Inspect a target</h1>
          <p className="text-sm text-white/70 max-w-xl leading-relaxed">
            Query protein annotation, interaction partners, drug records, and PubMed abstracts for a single gene.
          </p>
        </div>

        <form onSubmit={handleSearch} className="glass-panel rounded-xl p-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="glass-input flex-1 rounded-lg px-4 py-3 text-sm font-medium"
              placeholder="Gene symbol, e.g. EGFR"
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold px-6 py-3 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
              Lookup
            </button>
          </div>
        </form>
      </div>

      {error && <div className="card border-red-700/40 text-red-300 text-sm">{error}</div>}

      {data && (
        <div className="rounded-2xl border border-slate-600/70 bg-slate-950/90 p-4 sm:p-5 space-y-4 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.025)_inset]">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-600/70 bg-slate-800/80 px-4 py-3">
              <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">Protein</p>
              <p className="text-sm font-semibold text-white mt-1">
                {data.uniprot?.protein_name || 'Not resolved'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-600/70 bg-slate-800/80 px-4 py-3">
              <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">ChEMBL</p>
              <p className="text-sm font-semibold text-white mt-1">
                {data.drugs.length} strong, {data.exploratoryDrugs.length} exploratory
              </p>
            </div>
            <div className="rounded-lg border border-slate-600/70 bg-slate-800/80 px-4 py-3">
              <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">PPI Partners</p>
              <p className="text-sm font-semibold text-white mt-1">{data.ppi?.partners?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-600/70 bg-slate-800/80 px-4 py-3">
              <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">PubMed Hits</p>
              <p className="text-sm font-semibold text-white mt-1">{data.pubmed?.length ?? 0}</p>
            </div>
          </div>

          <div className="columns-1 lg:columns-2 gap-4">
            {/* UniProt */}
            <div className="break-inside-avoid mb-4">
              <Section title="UniProt Annotation">
                {data.uniprot ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-300">Accession</span>
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${data.uniprot.accession}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-cyan-300 hover:text-white hover:underline flex items-center gap-1 font-semibold"
                      >
                        {data.uniprot.accession} <ExternalLink size={11} />
                      </a>
                    </div>
                    <div>
                      <span className="text-slate-300">Protein</span>
                      <p className="text-white text-sm mt-1">{data.uniprot.protein_name}</p>
                    </div>
                    {data.uniprot.function && (
                      <div>
                        <span className="text-slate-300">Function</span>
                      <p className="text-slate-200 text-xs mt-1 leading-relaxed line-clamp-5">{data.uniprot.function}</p>
                      </div>
                    )}
                    {data.uniprot.pdb_ids?.length > 0 && (
                      <div>
                        <span className="text-slate-300">PDB Structures</span>
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
                ) : <p className="text-slate-300 text-sm">Not found in UniProt.</p>}
              </Section>
            </div>

            {/* Drugs */}
            <div className="break-inside-avoid mb-4">
              <Section title="ChEMBL Drug Interactions">
                {data.drugs?.length > 0 ? (
                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-300 font-semibold mb-2">Strong binding hits</p>
                      <div className="space-y-3">
                        {data.drugs.slice(0, 8).map((d, i) => <ActivityRow key={i} drug={d} />)}
                      </div>
                    </div>
                    {data.exploratoryDrugs?.length > 0 && (
                      <div className="border-t border-slate-600/70 pt-3">
                        <p className="text-xs uppercase tracking-wide text-slate-300 font-semibold mb-2">
                          Exploratory records
                          {data.targetActivityCount ? ` (${data.targetActivityCount} target activities)` : ''}
                        </p>
                        <div className="space-y-3">
                          {data.exploratoryDrugs.slice(0, 5).map((d, i) => (
                            <ActivityRow key={i} drug={d} muted />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : data.exploratoryDrugs?.length > 0 ? (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                    <p className="text-slate-300 text-sm">No strong binding hits passed the strict filter.</p>
                    <div className="space-y-3">
                      {data.exploratoryDrugs.slice(0, 8).map((d, i) => (
                        <ActivityRow key={i} drug={d} />
                      ))}
                    </div>
                    {data.drugNote && <p className="text-xs text-slate-300 leading-relaxed">{data.drugNote}</p>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-slate-300 text-sm">No drug interactions found in ChEMBL.</p>
                    {data.drugNote && (
                      <p className="text-xs text-slate-300 leading-relaxed">{data.drugNote}</p>
                    )}
                  </div>
                )}
              </Section>
            </div>

            {/* PPI */}
            <div className="break-inside-avoid mb-4">
              <Section title="STRING DB Interactions">
                {data.ppi?.partners?.length > 0 ? (
                  <div className="space-y-3">
                    <a
                      href={stringDbUrl(data.ppi.gene)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-white hover:underline"
                    >
                      Open {data.ppi.gene} in STRING DB <ExternalLink size={11} />
                    </a>
                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {data.ppi.partners.map((p, i) => (
                        <a
                          key={i}
                          href={stringDbUrl(p.partner)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={p.is_oncogene
                          ? 'inline-flex items-center gap-1 rounded border border-red-500/60 bg-red-950/70 px-2.5 py-1 text-xs font-semibold text-red-200 hover:border-red-300 hover:text-white'
                          : 'inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-700/80 px-2.5 py-1 text-xs font-semibold text-white/85 hover:border-cyan-400/70 hover:text-white'}
                          title={`STRING DB score: ${p.score}`}
                        >
                          {p.partner}
                          {p.is_oncogene && ' ⚠'}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : <p className="text-slate-300 text-sm">No interactions found.</p>}
                {data.ppi?.error && <p className="text-xs text-red-300 mt-1">{data.ppi.error}</p>}
              </Section>
            </div>

            {/* PubMed */}
            <div className="break-inside-avoid mb-4">
              <Section title="PubMed Drug Literature">
                {data.pubmed?.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-1">
                    {data.pubmed.map((a, i) => (
                      <div key={i} className="text-xs border-l-2 border-gray-700 pl-3">
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-white hover:underline font-semibold"
                        >
                          PMID: {a.pmid}
                        </a>
                        <p className="text-slate-200 mt-1 line-clamp-3">{a.abstract}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="text-slate-300 text-sm">No drug-gene literature found.</p>
                    <span className="badge-dark mt-2">Potential unstudied gene.</span>
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, ExternalLink, Loader2 } from 'lucide-react'
import { getGenePPI, getGeneUniprot, getGeneDrugs, getGenePubmed } from '../utils/api.js'

function Section({ title, children }) {
  return (
    <div className="border border-slate-700 bg-[#0f1217] p-3 min-w-0 overflow-hidden">
      <h3 className="font-semibold text-slate-100 mb-2.5 uppercase tracking-wider text-[11px]">{title}</h3>
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
    <div className="flex items-start justify-between gap-3 text-xs">
      <div className="min-w-0">
        <a
          href={`https://www.ebi.ac.uk/chembl/compound_report_card/${drug.molecule_id}/`}
          target="_blank" rel="noopener noreferrer"
          className={`${muted ? 'text-white/85' : 'text-cyan-300'} hover:text-white hover:underline font-semibold truncate block`}
        >
          {displayName}
        </a>
        {showId && <p className="text-slate-100 mt-0.5">{drug.molecule_id}</p>}
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <p className={Number(drug.max_phase) === 4 ? 'text-emerald-300 font-semibold' : 'text-white/75 font-medium'}>
          {phaseLabel(drug.max_phase)}
        </p>
        <p className="text-slate-200">
          {drug.pchembl_value ? `pChEMBL ${drug.pchembl_value}` : `${drug.standard_type || drug.assay_type || ''}`}
        </p>
        {drug.standard_value && (
          <p className="text-slate-200">
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
    setLoading(true); setError(''); setData(null)
    try {
      const [ppi, uniprot, drugs, pubmed] = await Promise.allSettled([
        getGenePPI(s), getGeneUniprot(s), getGeneDrugs(s), getGenePubmed(s),
      ])
      const drugPayload = drugs.status === 'fulfilled' ? drugs.value : null
      setData({
        ppi:                ppi.status === 'fulfilled' ? ppi.value : null,
        uniprot:            uniprot.status === 'fulfilled' ? uniprot.value : null,
        drugs:              Array.isArray(drugPayload) ? drugPayload : (drugPayload?.drugs ?? []),
        exploratoryDrugs:   Array.isArray(drugPayload) ? [] : (drugPayload?.exploratory_drugs ?? []),
        targetActivityCount: Array.isArray(drugPayload) ? null : drugPayload?.target_activity_count,
        drugNote:           Array.isArray(drugPayload) ? '' : (drugPayload?.query_note ?? ''),
        drugTargetFound:    Array.isArray(drugPayload) ? null : drugPayload?.query_found_target,
        pubmed:             pubmed.status === 'fulfilled' ? pubmed.value : [],
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setData(null); setError('') }, [symbol])

  const handleSearch = (e) => {
    e.preventDefault()
    const s = input.trim().toUpperCase()
    if (!s) return
    navigate(`/gene/${s}`)
    lookup(s)
  }

  return (
    <div className="w-[90%] max-w-5xl mx-auto py-3 space-y-4">

      {/* Header + Search */}
      <div className="pb-2 border-b border-slate-800">
        <h1 className="text-base font-semibold text-white tracking-tight">Gene Lookup</h1>
        <p className="text-xs text-slate-100 mt-0.5">Protein annotation, PPI partners, drug records, and PubMed abstracts.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          className="glass-input flex-1 rounded-none px-3 py-2 text-sm"
          placeholder="Gene symbol — e.g. EGFR, TP53, KRAS"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold px-4 py-2 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Lookup
        </button>
      </form>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {data && (
        <div className="space-y-3">

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Protein',      value: data.uniprot?.protein_name || '—' },
              { label: 'ChEMBL',       value: `${data.drugs.length} strong, ${data.exploratoryDrugs.length} exp.` },
              { label: 'PPI Partners', value: data.ppi?.partners?.length ?? 0 },
              { label: 'PubMed Hits',  value: data.pubmed?.length ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="border border-slate-700 bg-[#0f1217] px-3 py-2">
                <p className="text-[11px] text-slate-200 uppercase tracking-wide font-semibold">{label}</p>
                <p className="text-xs font-semibold text-white mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Detail panels */}
          <div className="columns-1 lg:columns-2 gap-3">

            {/* UniProt */}
            <div className="break-inside-avoid mb-3">
              <Section title="UniProt Annotation">
                {data.uniprot ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-200">Accession</span>
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${data.uniprot.accession}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-cyan-300 hover:text-white hover:underline flex items-center gap-1 font-semibold"
                      >
                        {data.uniprot.accession} <ExternalLink size={10} />
                      </a>
                    </div>
                    <div>
                      <span className="text-slate-200">Protein</span>
                      <p className="text-white mt-0.5">{data.uniprot.protein_name}</p>
                    </div>
                    {data.uniprot.function && (
                      <div>
                        <span className="text-slate-200">Function</span>
                        <p className="text-slate-100 mt-0.5 leading-snug line-clamp-5">{data.uniprot.function}</p>
                      </div>
                    )}
                    {data.uniprot.pdb_ids?.length > 0 && (
                      <div>
                        <span className="text-slate-200">PDB Structures</span>
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
                ) : <p className="text-slate-200 text-xs">Not found in UniProt.</p>}
              </Section>
            </div>

            {/* Drugs */}
            <div className="break-inside-avoid mb-3">
              <Section title="ChEMBL Drug Interactions">
                {data.drugs?.length > 0 ? (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-200 font-semibold mb-1.5">Strong binding hits</p>
                      <div className="space-y-2">
                        {data.drugs.slice(0, 8).map((d, i) => <ActivityRow key={i} drug={d} />)}
                      </div>
                    </div>
                    {data.exploratoryDrugs?.length > 0 && (
                      <div className="border-t border-slate-700/60 pt-2.5">
                        <p className="text-[11px] uppercase tracking-wide text-slate-200 font-semibold mb-1.5">
                          Exploratory records{data.targetActivityCount ? ` (${data.targetActivityCount} target activities)` : ''}
                        </p>
                        <div className="space-y-2">
                          {data.exploratoryDrugs.slice(0, 5).map((d, i) => <ActivityRow key={i} drug={d} muted />)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : data.exploratoryDrugs?.length > 0 ? (
                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    <p className="text-slate-200 text-xs">No strong binding hits passed the strict filter.</p>
                    <div className="space-y-2">
                      {data.exploratoryDrugs.slice(0, 8).map((d, i) => <ActivityRow key={i} drug={d} />)}
                    </div>
                    {data.drugNote && <p className="text-[11px] text-slate-200 leading-snug">{data.drugNote}</p>}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-slate-200 text-xs">No drug interactions found in ChEMBL.</p>
                    {data.drugNote && <p className="text-[11px] text-slate-200 leading-snug">{data.drugNote}</p>}
                  </div>
                )}
              </Section>
            </div>

            {/* PPI */}
            <div className="break-inside-avoid mb-3">
              <Section title="STRING DB Interactions">
                {data.ppi?.partners?.length > 0 ? (
                  <div className="space-y-2">
                    <a
                      href={stringDbUrl(data.ppi.gene)}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-white hover:underline"
                    >
                      Open {data.ppi.gene} in STRING DB <ExternalLink size={10} />
                    </a>
                    <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-1">
                      {data.ppi.partners.map((p, i) => (
                        <a
                          key={i}
                          href={stringDbUrl(p.partner)}
                          target="_blank" rel="noopener noreferrer"
                          className={p.is_oncogene
                            ? 'inline-flex items-center gap-1 border border-red-500/60 bg-red-950/70 px-2 py-0.5 text-[11px] font-semibold text-red-200 hover:border-red-300 hover:text-white'
                            : 'inline-flex items-center gap-1 border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] font-semibold text-white/85 hover:border-cyan-400/70 hover:text-white'}
                          title={`STRING DB score: ${p.score}`}
                        >
                          {p.partner}{p.is_oncogene && ' ⚠'}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : <p className="text-slate-200 text-xs">No interactions found.</p>}
                {data.ppi?.error && <p className="text-[11px] text-red-300 mt-1">{data.ppi.error}</p>}
              </Section>
            </div>

            {/* PubMed */}
            <div className="break-inside-avoid mb-3">
              <Section title="PubMed Drug Literature">
                {data.pubmed?.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
                    {data.pubmed.map((a, i) => (
                      <div key={i} className="text-xs border-l-2 border-slate-700 pl-2.5">
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-white hover:underline font-semibold"
                        >
                          PMID: {a.pmid}
                        </a>
                        <p className="text-slate-100 mt-0.5 line-clamp-3 leading-snug">{a.abstract}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="text-slate-200 text-xs">No drug-gene literature found.</p>
                    <span className="badge-dark mt-1.5 inline-block">Potential unstudied gene.</span>
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

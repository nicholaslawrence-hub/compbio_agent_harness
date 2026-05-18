import { useState } from 'react'
import { Star, ExternalLink, Copy, Check, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

function NoveltyBar({ score }) {
  const pct = Math.round((score ?? 0) * 100)
  const color = score > 0.7 ? 'bg-amber-500' : score > 0.4 ? 'bg-indigo-500' : 'bg-slate-600'
  const label = score > 0.7 ? 'High' : score > 0.4 ? 'Moderate' : 'Low'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white/80 w-20 text-right tabular-nums">{label} ({pct}%)</span>
    </div>
  )
}

function InlineMarkdown({ text }) {
  if (!text) return null
  return (
    <span className="[&_strong]:text-white [&_strong]:font-semibold">
      <ReactMarkdown
        components={{
          p: ({ children }) => <span>{children}</span>,
          strong: ({ children }) => <strong>{children}</strong>,
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="flex items-center gap-1 text-xs text-white/40 hover:text-white border border-slate-800 hover:border-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function PubMedBadge({ pmid }) {
  return (
    <a
      href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 hover:bg-indigo-900/40 border border-indigo-900/50 px-2 py-0.5 rounded transition-colors"
    >
      PMID {pmid}
      <ExternalLink size={9} />
    </a>
  )
}

const MONO = 'JetBrains Mono, ui-monospace, monospace'

export default function HypothesisCard({ hypothesis, rank }) {
  const {
    gene,
    hypothesis: text,
    mechanism,
    novelty_score,
    pub_count,
    supporting_evidence,
    key_pmids = [],
    dge_results,
  } = hypothesis


  const cardText = [
    `Gene: ${gene}`,
    `Hypothesis: ${text}`,
    mechanism ? `Mechanism: ${mechanism}` : '',
    supporting_evidence?.length ? `Evidence:\n${supporting_evidence.map(e => `• ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const lfc = hypothesis.log2FoldChange != null ? Number(hypothesis.log2FoldChange).toFixed(2) : null
  const padj = hypothesis.padj != null ? Number(hypothesis.padj).toExponential(1) : null

  return (
    <div style={{ border: '1px solid #21262d', background: '#010409', marginBottom: 8, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid #21262d', background: '#0d1117' }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: '#484f58' }}>#{rank}</span>
        <a href={`/gene/${gene}`} style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: '#ffffff', textDecoration: 'none', letterSpacing: '0.03em' }}>
          {gene}
        </a>
        {/* Compact inline metrics */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontFamily: MONO, fontSize: 11 }}>
          {lfc && <span style={{ color: '#ffffff' }}>log2FC: <span style={{ color: '#e6edf3' }}>{lfc}</span></span>}
          {padj && <span style={{ color: '#ffffff' }}>padj: <span style={{ color: '#e6edf3' }}>{padj}</span></span>}
          {pub_count != null && pub_count >= 0 && (
            <span style={{ color: '#4d7ec5' }}>pubs: <span style={{ color: '#6b9fd4' }}>{pub_count.toLocaleString()}</span></span>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ marginBottom: 14, borderLeft: '2px solid #30363d', paddingLeft: 12 }}>
          <p style={{ fontFamily: MONO, fontSize: 10, color: '#7d8590', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Hypothesis</p>
          <p style={{ fontSize: 14, color: '#ffffff', lineHeight: 1.65, margin: 0 }}>
            <InlineMarkdown text={text} />
          </p>
        </div>

        {mechanism && (
          <div style={{ marginBottom: 14, borderLeft: '2px solid #30363d', paddingLeft: 12 }}>
            <p style={{ fontFamily: MONO, fontSize: 10, color: '#7d8590', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Proposed Mechanism</p>
            <p style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.65, margin: 0 }}>
              <InlineMarkdown text={mechanism} />
            </p>
          </div>
        )}

        {(() => {
          const cleanedEvidence = (supporting_evidence ?? []).filter(
            ev => !ev.toLowerCase().includes('database query returned no results')
          )
          return cleanedEvidence.length > 0 ? (
            <div style={{ marginBottom: 14, borderLeft: '2px solid #30363d', paddingLeft: 12 }}>
              <p style={{ fontFamily: MONO, fontSize: 10, color: '#7d8590', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Supporting Evidence</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cleanedEvidence.map((ev, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#cdd9e5', lineHeight: 1.55 }}>
                    <span style={{ color: '#57606a', flexShrink: 0 }}>–</span>
                    <InlineMarkdown text={ev} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        })()}

        {key_pmids?.length > 0 && (
          <div style={{ marginBottom: 4, borderLeft: '2px solid #30363d', paddingLeft: 12 }}>
            <p style={{ fontFamily: MONO, fontSize: 10, color: '#7d8590', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>References</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {key_pmids.map((pmid) => <PubMedBadge key={pmid} pmid={pmid} />)}
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: '1px solid #21262d', background: '#0d1117' }}>
        <CopyButton text={cardText} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <a href={`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: MONO, fontSize: 10, color: '#ffffff', border: '1px solid #30363d', background: '#0d1117', padding: '2px 8px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
            GeneCards <ExternalLink size={9} />
          </a>
          <a href={`https://www.uniprot.org/uniprot/?query=${gene}+AND+organism_id:9606`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: MONO, fontSize: 10, color: '#ffffff', border: '1px solid #30363d', background: '#0d1117', padding: '2px 8px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
            UniProt <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  )
}

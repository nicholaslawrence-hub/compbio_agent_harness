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
      <span className="text-xs text-gray-300 w-20 text-right tabular-nums">{label} ({pct}%)</span>
    </div>
  )
}

// Render text with **bold** markdown inline — lets the LLM highlight key values
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

export default function HypothesisCard({ hypothesis, rank }) {
  const {
    gene,
    hypothesis: text,
    mechanism,
    novelty_score,
    pub_count,
    supporting_evidence,
    key_pmids = [],
  } = hypothesis

  const isNovel = (novelty_score ?? 0) > 0.6

  const cardText = [
    `Gene: ${gene}`,
    `Hypothesis: ${text}`,
    mechanism ? `Mechanism: ${mechanism}` : '',
    supporting_evidence?.length ? `Evidence:\n${supporting_evidence.map(e => `• ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  return (
    <div className={`card relative overflow-hidden transition-all hover:border-gray-700 ${isNovel ? 'border-amber-700/40' : ''}`}>
      {isNovel && (
        <div className="absolute top-0 right-0 bg-amber-600/20 text-amber-400 text-xs px-2 py-0.5 rounded-bl-lg flex items-center gap-1">
          <Star size={11} /> High Novelty
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-slate-700">#{rank}</span>
          <div>
            <h3 className="text-lg font-bold text-white">
              <a href={`/gene/${gene}`} className="hover:text-indigo-400 transition-colors">
                {gene}
              </a>
            </h3>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-white/50">Novelty</span>
              <div className="w-40">
                <NoveltyBar score={novelty_score ?? 0} />
              </div>
              {pub_count != null && pub_count >= 0 && (
                <span className="text-xs text-white/80 font-semibold tabular-nums whitespace-nowrap">
                  {pub_count.toLocaleString()} pub{pub_count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1.5">Hypothesis</p>
          <p className="text-sm text-gray-200 leading-relaxed">
            <InlineMarkdown text={text} />
          </p>
        </div>

        {mechanism && (
          <div>
            <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1.5">Proposed Mechanism</p>
            <p className="text-sm text-gray-300 leading-relaxed">
              <InlineMarkdown text={mechanism} />
            </p>
          </div>
        )}

        {(() => {
          const cleanedEvidence = (supporting_evidence ?? []).filter(
            ev => !ev.toLowerCase().includes('database query returned no results')
          )
          return cleanedEvidence.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1.5">Supporting Evidence</p>
              <ul className="space-y-1.5">
                {cleanedEvidence.map((ev, i) => (
                  <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                    <span className="text-indigo-500 mt-0.5 shrink-0">•</span>
                    <InlineMarkdown text={ev} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        })()}

        {key_pmids?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <BookOpen size={11} /> References
            </p>
            <div className="flex flex-wrap gap-1.5">
              {key_pmids.map((pmid) => (
                <PubMedBadge key={pmid} pmid={pmid} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="mt-4 pt-3 border-t border-gray-800 flex items-center gap-2">
        <CopyButton text={cardText} />
        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900/60 hover:border-indigo-700 bg-indigo-950/30 hover:bg-indigo-950/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            GeneCards <ExternalLink size={10} />
          </a>
          <a
            href={`https://www.uniprot.org/uniprot/?query=${gene}+AND+organism_id:9606`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900/60 hover:border-indigo-700 bg-indigo-950/30 hover:bg-indigo-950/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            UniProt <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  )
}

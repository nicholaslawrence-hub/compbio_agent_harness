import { Star, AlertTriangle, ExternalLink } from 'lucide-react'

function NoveltyBar({ score }) {
  const pct = Math.round(score * 100)
  const color = score > 0.7 ? 'bg-amber-500' : score > 0.4 ? 'bg-bio-500' : 'bg-gray-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

export default function HypothesisCard({ hypothesis, rank }) {
  const { gene, hypothesis: text, mechanism, novelty_score, supporting_evidence } = hypothesis
  const isNovel = novelty_score > 0.6

  return (
    <div className={`card relative overflow-hidden transition-all hover:border-gray-700 ${isNovel ? 'border-amber-700/40' : ''}`}>
      {isNovel && (
        <div className="absolute top-0 right-0 bg-amber-600/20 text-amber-400 text-xs px-2 py-0.5 rounded-bl-lg flex items-center gap-1">
          <Star size={11} /> High Novelty
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-gray-700">#{rank}</span>
          <div>
            <h3 className="text-lg font-bold text-white">
              <a
                href={`/gene/${gene}`}
                className="hover:text-pharma-400 transition-colors"
              >
                {gene}
              </a>
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-gray-500">Novelty Score</span>
              <div className="w-32">
                <NoveltyBar score={novelty_score ?? 0} />
              </div>
            </div>
          </div>
        </div>
        <a
          href={`https://www.ncbi.nlm.nih.gov/gene/?term=${gene}+homo+sapiens`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-600 hover:text-gray-400"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hypothesis</p>
          <p className="text-sm text-gray-200 leading-relaxed">{text}</p>
        </div>

        {mechanism && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Proposed Mechanism</p>
            <p className="text-sm text-gray-300 leading-relaxed">{mechanism}</p>
          </div>
        )}

        {supporting_evidence?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Supporting Evidence</p>
            <ul className="space-y-1">
              {supporting_evidence.map((ev, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                  <span className="text-pharma-600 mt-0.5">•</span>
                  {ev}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

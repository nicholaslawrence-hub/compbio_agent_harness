import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Github, Linkedin, Code2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import AgentWeb from '../components/AgentWeb.jsx'

const PHRASES = [
  'drug hypothesis.',
  'novel targets.',
  'clinical insights.',
  'therapeutic leads.',
  'mechanistic evidence.',
  'ranked gene candidates.',
  'a publishable report.',
  'dark gene discoveries.',
  'PPI network analysis.',
  'ChEMBL drug matches.',
  'pathway enrichment.',
  'novelty scores.',
  'literature synthesis.',
  'research directions.',
  'a drug target.',
  'actionable biology.',
  'biomarker candidates.',
  'oncogene networks.',
  'a scientific narrative.',
  'the next experiment.',
]


const EXAMPLE_GENES = [
  { symbol: 'TGFBI', lfc: '+4.2', padj: '0.0003', novelty: 0.91 },
  { symbol: 'MMP9',  lfc: '+3.8', padj: '0.0011', novelty: 0.74 },
  { symbol: 'VEGFA', lfc: '+3.1', padj: '0.0024', novelty: 0.48 },
]

const HYPOTHESIS_TEXTS = {
  TGFBI:
    'TGFBI (transforming growth factor β-induced) is markedly upregulated in KRAS-mutant PDAC ' +
    'and physically interacts with integrin αvβ3 to activate downstream FAK/PI3K signaling. No ' +
    'approved small-molecule inhibitors target TGFBI directly, making it a high-novelty candidate. ' +
    'Cross-referencing 31 PubMed abstracts reveals consistent association with stromal remodeling ' +
    'and chemotherapy resistance. Recommended follow-up: siRNA knockdown in PANC-1 cells, co-IP ' +
    'to confirm integrin binding, and patient stratification by TGFBI expression quartile.',
  MMP9:
    'MMP9 (matrix metallopeptidase 9) drives ECM degradation and is co-expressed with TIMP1, ' +
    'CD44, and VEGFA in the STRING PPI network. Phase III trials of the anti-MMP9 antibody ' +
    'andecaliximab failed, suggesting the catalytic domain alone is insufficient. The ITGB1 ' +
    'interaction node — flagged as high-confidence — offers a co-target opportunity. Proposed ' +
    'mechanism: dual blockade of MMP9/ITGB1 to simultaneously impair matrix remodeling and ' +
    'anoikis resistance. Novelty score reflects moderate literature saturation.',
  VEGFA:
    'VEGFA is upregulated 3.1-fold and occupies the center of a dense angiogenesis network. ' +
    'Bevacizumab, ramucirumab, and multiple VEGFR TKIs are already approved, placing this gene ' +
    'firmly in the low-novelty tier. Included as an agent network calibration control: the scoring ' +
    'correctly deprioritizes well-drugged targets regardless of fold-change magnitude. ' +
    'If your analysis surfaces VEGFA at the top, check whether the disease context is ' +
    'angiogenesis-specific or if background gene counts are too small.',
}


function AnimatedBar({ score, visible }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-px bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-1000 ease-out"
          style={{
            width: visible ? `${score * 100}%` : '0%',
            opacity: visible ? (0.5 + score * 0.5) : 0,
          }}
        />
      </div>
      <span className="text-sm text-white/70 w-10 text-right tabular-nums">{score.toFixed(2)}</span>
    </div>
  )
}


export default function AnalyzePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [selectedGene, setSelectedGene] = useState(null)

  // Typing animation — cycles through PHRASES
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [typingPhase, setTypingPhase] = useState('typing') // 'typing' | 'holding' | 'deleting'
  const currentPhrase = PHRASES[phraseIndex]

  useEffect(() => {
    let id
    if (typingPhase === 'typing') {
      if (charCount < currentPhrase.length) {
        id = setTimeout(() => setCharCount(c => c + 1), charCount === 0 ? 700 : 68)
      } else {
        id = setTimeout(() => setTypingPhase('holding'), 1800)
      }
    } else if (typingPhase === 'holding') {
      id = setTimeout(() => setTypingPhase('deleting'), 300)
    } else if (typingPhase === 'deleting') {
      if (charCount > 0) {
        id = setTimeout(() => setCharCount(c => c - 1), 38)
      } else {
        setPhraseIndex(i => (i + 1) % PHRASES.length)
        setTypingPhase('typing')
      }
    }
    return () => clearTimeout(id)
  }, [typingPhase, charCount, currentPhrase])

  // Intersection-Observer-driven card entrance
  const leftCardRef  = useRef(null)
  const rightCardRef = useRef(null)
  const [leftIn,  setLeftIn]  = useState(false)
  const [rightIn, setRightIn] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          if (entry.target === leftCardRef.current)  { setLeftIn(true) }
          if (entry.target === rightCardRef.current) { setTimeout(() => setRightIn(true), 160) }
          observer.unobserve(entry.target)  // fire once
        })
      },
      { threshold: 0.12 }
    )
    if (leftCardRef.current)  observer.observe(leftCardRef.current)
    if (rightCardRef.current) observer.observe(rightCardRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="space-y-14 sm:space-y-24">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="pt-8 sm:pt-16 pb-4">
        <h1 className="text-[2.6rem] leading-tight sm:text-6xl lg:text-8xl sm:leading-[1.06] font-bold text-white mb-5 sm:mb-8 tracking-tight">
          From count matrix<br />
          <span className="text-amber-400">
            to{' '}
            {currentPhrase.slice(0, charCount)}
            <span className="inline-block w-[3px] cursor-blink">_</span>
          </span>
        </h1>
        <p className="text-base sm:text-lg text-white max-w-xl leading-relaxed">
          Upload an RNA-seq count matrix and a disease context. A coordinated
          network of specialist agents runs differential expression, maps protein
          interaction networks, mines the literature, annotates known drugs, and
          synthesizes ranked hypotheses — end to end, without leaving the browser.
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-10 sm:mt-20">
          {user ? (
            <button
              onClick={() => navigate('/run')}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-xl sm:text-2xl px-10 sm:px-24 py-5 sm:py-6 rounded-2xl transition-colors duration-150 tracking-tight text-center"
            >
              Start Analysis
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/run')}
                className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-lg sm:text-xl px-10 sm:px-14 py-5 sm:py-6 rounded-2xl transition-colors duration-150 tracking-tight shadow-[0_0_28px_rgba(251,191,36,0.30)] text-center"
              >
                Try the Agent Network
              </button>
              <Link
                to="/login"
                className="border border-slate-600 hover:border-slate-400 text-white/80 hover:text-white font-semibold text-lg sm:text-xl px-10 sm:px-14 py-5 sm:py-6 rounded-2xl transition-colors duration-150 tracking-tight text-center"
              >
                Log in / Sign up
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Agent Network ────────────────────────────────────── */}
      <div className="border-t border-slate-800 pt-14">
        <p className="text-2xl font-semibold text-white mb-2">Agent Network</p>
        <p className="text-sm text-white/80 mb-8">
          A supervisor orchestrates seven specialist agents in parallel. Click any node to inspect its role.
        </p>
        <AgentWeb />
      </div>

      {/* ── Example use-case ─────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

          {/* ── Left: gene list ── */}
          <div
            ref={leftCardRef}
            className={`rounded-xl border border-slate-700 bg-slate-800/70 p-8 border-t-[1.5px] border-t-amber-400/30 transition-all duration-700 ease-out ${
              leftIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-16'
            }`}
          >
            <div className="space-y-2">
              {EXAMPLE_GENES.map(g => {
                const isActive = selectedGene === g.symbol
                const hasSelection = selectedGene !== null
                return (
                  <div
                    key={g.symbol}
                    onClick={() => setSelectedGene(g.symbol)}
                    className={`relative cursor-pointer rounded-xl pl-5 pr-4 py-5 -mx-2 transition-all duration-200 ${
                      isActive
                        ? 'bg-amber-400/10'
                        : hasSelection
                          ? 'opacity-40 hover:opacity-70 hover:bg-slate-700/30'
                          : 'hover:bg-slate-700/30 hover:opacity-90'
                    }`}
                  >
                    <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-all duration-200 ${
                      isActive ? 'bg-amber-400' : 'bg-transparent'
                    }`} />

                    <div className="flex items-baseline justify-between mb-3">
                      <span className={`text-2xl font-bold tracking-tight transition-colors duration-200 ${
                        isActive ? 'text-white' : 'text-white'
                      }`}>
                        {g.symbol}
                      </span>
                      <div className="flex flex-wrap tabular-nums text-sm sm:text-base text-white gap-x-3">
                        <span>log₂FC {g.lfc}</span>
                        <span>padj {g.padj}</span>
                      </div>
                    </div>

                    <AnimatedBar score={g.novelty} visible={leftIn} />
                    <p className="text-sm text-white mt-2">novelty score</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right: hypothesis detail ── */}
          <div
            ref={rightCardRef}
            className={`rounded-xl border border-slate-700 bg-slate-800/70 p-8 flex flex-col border-t-[1.5px] border-t-amber-400/30 transition-all duration-700 ease-out ${
              rightIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-16'
            }`}
          >
            {selectedGene === null ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="text-3xl">←</div>
                <p className="text-base font-semibold text-white">Click a gene</p>
                <p className="text-sm text-white/80 max-w-[200px] leading-relaxed">
                  Select any target on the left to see the generated mechanism and evidence.
                </p>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-white mb-1">{selectedGene}</p>
                <p className="text-sm text-white/60 mb-5">Generated hypothesis</p>

                <div className="flex-1 overflow-y-auto pr-1" style={{ maxHeight: '220px' }}>
                  <p key={selectedGene} className="text-lg text-white leading-relaxed animate-fade-in">
                    {HYPOTHESIS_TEXTS[selectedGene]}
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between">
                  <span className="text-base font-semibold text-white">Novelty score</span>
                  <span className="text-2xl font-bold text-amber-400">
                    {EXAMPLE_GENES.find(g => g.symbol === selectedGene)?.novelty.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* ── Developer Banner ─────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 p-3 bg-slate-800 rounded-xl border border-slate-600">
            <Code2 size={22} className="text-amber-400" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-lg font-semibold text-white mb-1.5">Source Code</p>
            <p className="text-sm text-white max-w-lg leading-relaxed">
              The entire codebase is open source on GitHub. Check out the repo for implementation details, or to contribute your own features and improvements.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://github.com/nicholaslawrence-hub/compbio_agent_harness"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm px-6 py-3 rounded-xl transition-colors duration-150"
          >
            <Github size={15} strokeWidth={2} />
            View Source
          </a>
          <a
            href="https://www.linkedin.com/in/nicholas-lawrence-a16122296/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border border-slate-500 hover:border-slate-300 text-white hover:text-white text-sm px-6 py-3 rounded-xl transition-colors duration-150"
          >
            <Linkedin size={14} strokeWidth={1.5} />
            Nicholas Lawrence
          </a>
        </div>
      </div>
    </div>
  )
}

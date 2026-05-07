import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Github, Linkedin, Code2, ExternalLink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'

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

const STEPS = [
  {
    n: 1,
    label: 'Differential Expression',
    detail:
      'Your count matrix is tested gene-by-gene for statistically significant expression changes between case and control. PyDESeq2 applies a negative binomial model with Benjamini–Hochberg correction. Only genes clearing padj < 0.05 and |log₂FC| > 1 feed into downstream steps, everything else is filtered out.',
  },
  {
    n: 2,
    label: 'Pathway Enrichment',
    detail:
      'The DEG list is tested against GO Biological Process and KEGG gene sets using a Fisher\'s exact over-representation test — statistically valid on small N where correlation-based methods like WGCNA break down. Significant pathways (padj < 0.05) are ranked and deduplicated by Jaccard overlap. The top 5 — for example "MAPK signaling", "PI3K-AKT pathway", or "cell cycle regulation", are passed directly into the LLM prompt alongside each gene, providing structured biological context before any hypothesis is written.',
  },
  {
    n: 3,
    label: 'Protein Interaction Network',
    detail:
      'Top upregulated genes are queried against the STRING database (confidence ≥ 700) to map interaction networks. A single batch call to MyGene.info then annotates every focal gene and its top partners with GO Molecular Function terms — so the LLM sees "KRAS (GTPase activity)" rather than just a symbol. Partners are cross-referenced against a curated oncogene list to identify which connections are therapeutically exploitable.',
  },
  {
    n: 4,
    label: 'Literature RAG',
    detail:
      'Abstracts are fetched live from PubMed and Semantic Scholar, then upserted into a Pinecone vector index. The index is semantically searched to pull the most relevant passages per gene. When a gene returns fewer than three direct hits, the agent automatically retries with a "{gene} AND {top interactor}" query — allowing it to surface indirect evidence through network neighbours. Genes still returning sparse results are flagged as dark genes.',
  },
  {
    n: 5,
    label: 'Drug & Protein Annotation',
    detail:
      'Each gene is looked up in UniProt for functional description and known 3D structures. ChEMBL is then searched for approved and investigational drugs against the same target. Existing drug coverage directly shapes the novelty score in the next step, a well-drugged target scores lower, a dark gene with no compounds scores higher.',
  },
  {
    n: 6,
    label: 'Hypothesis Synthesis',
    detail:
      'GPT-5.4-mini receives the combined DGE statistics, GO Molecular Function terms, confirmed Reactome pathway memberships, annotated PPI network, literature passages, and drug landscape for each gene. Chain-of-thought reasoning produces a structured hypothesis naming at least two specific interaction partners and a concrete molecular event — phosphorylation site, complex dissociation, or transcriptional target. Dark genes with no existing drugs surface at the top.',
  },
  {
    n: 7,
    label: 'Report Generation',
    detail:
      'A publication-style report covers all findings: executive summary, targets ranked by novelty score, proposed mechanisms, and recommended follow-up experiments including suggested assays and validation approaches. Displayed inline and fully copyable for grant writing or lab notebooks.',
  },
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
    'firmly in the low-novelty tier. Included as a pipeline calibration control — the scoring ' +
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
      <span className="font-mono text-xs text-slate-500 w-8 text-right">{score.toFixed(2)}</span>
    </div>
  )
}


export default function AnalyzePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeStep, setActiveStep] = useState(null)
  const [selectedGene, setSelectedGene] = useState(null)
  const containerRef = useRef(null)
  const labelRefs    = useRef([])
  const bubbleRef    = useRef(null)
  const [line, setLine] = useState(null)

  useLayoutEffect(() => {
    if (!activeStep) { setLine(null); return }
    const raf = requestAnimationFrame(() => {
      const cRect = containerRef.current?.getBoundingClientRect()
      const lbl   = labelRefs.current[activeStep - 1]?.getBoundingClientRect()
      const bub   = bubbleRef.current?.getBoundingClientRect()
      if (!cRect || !lbl || !bub) return
      setLine({
        x1: lbl.right - cRect.left,
        y1: lbl.top   + lbl.height / 2 - cRect.top,
        x2: bub.left  - cRect.left,
        y2: bub.top   + bub.height / 2 - cRect.top,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [activeStep])

  const toggle = (n) => setActiveStep(prev => (prev === n ? null : n))

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
  const exampleVisible = leftIn   // drives AnimatedBar

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
    <div className="space-y-24">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="pt-16 pb-4">
        <h1 className="text-8xl font-bold text-slate-100 leading-[1.06] mb-8 tracking-tight">
          From count matrix<br />
          <span className="text-amber-400">
            to{' '}
            {currentPhrase.slice(0, charCount)}
            <span className="inline-block w-[3px] cursor-blink">_</span>
          </span>
        </h1>
        <p className="text-lg text-slate-200 max-w-xl leading-relaxed">
          Upload an RNA-seq count matrix and a disease context. The pipeline runs
          differential expression, maps protein interaction networks, mines the
          literature, annotates known drugs, and synthesizes ranked hypotheses
          end to end, without leaving the browser.
        </p>
        <div className="flex items-center justify-center gap-4 mt-20">
          {user ? (
            <button
              onClick={() => navigate('/run')}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-2xl px-24 py-6 rounded-2xl transition-colors duration-150 tracking-tight"
            >
              Start Analysis
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/run')}
                className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-xl px-14 py-6 rounded-2xl transition-colors duration-150 tracking-tight shadow-[0_0_28px_rgba(251,191,36,0.30)]"
              >
                Try the Pipeline
              </button>
              <Link
                to="/login"
                className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-slate-100 font-semibold text-xl px-14 py-6 rounded-2xl transition-colors duration-150 tracking-tight"
              >
                Log in / Sign up
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Example use-case ─────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-2 gap-6">

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
                    {/* 3px active left bar */}
                    <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-all duration-200 ${
                      isActive ? 'bg-amber-400' : 'bg-transparent'
                    }`} />

                    {/* Gene name + tabular stats */}
                    <div className="flex items-baseline justify-between mb-3">
                      <span className={`text-xl font-bold tracking-tight transition-colors duration-200 ${
                        isActive ? 'text-white' : 'text-slate-300'
                      }`}>
                        {g.symbol}
                      </span>
                      <div className="flex font-mono tabular-nums text-sm text-slate-400">
                        <span className="w-24 text-right">log₂FC {g.lfc}</span>
                        <span className="w-28 text-right">padj {g.padj}</span>
                      </div>
                    </div>

                    <AnimatedBar score={g.novelty} visible={exampleVisible} />
                    <p className="text-xs text-slate-400 mt-2">novelty score</p>
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
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="text-3xl">←</div>
                <p className="text-base font-semibold text-slate-300">Click left on a gene</p>
                <p className="text-sm text-slate-500 max-w-[200px] leading-relaxed">
                  Select any target on the left to see the generated mechanism and evidence.
                </p>
              </div>
            ) : (
              <>
                {/* Gene name header in detail panel */}
                <p className="text-xl font-bold text-white mb-1">{selectedGene}</p>
                <p className="text-xs text-slate-500 mb-5 font-mono">Generated hypothesis</p>

                {/* Scrollable hypothesis text */}
                <div className="flex-1 overflow-y-auto pr-1" style={{ maxHeight: '200px' }}>
                  <p
                    key={selectedGene}
                    className="text-base text-slate-200 leading-relaxed animate-fade-in"
                  >
                    {HYPOTHESIS_TEXTS[selectedGene]}
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-sm text-slate-400 font-mono">Novelty score</span>
                  <span className="font-mono text-lg font-bold text-amber-400">
                    {EXAMPLE_GENES.find(g => g.symbol === selectedGene)?.novelty.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* ── Data Pipeline ────────────────────────────────────── */}
      <div className="border-t border-slate-800 pt-14">
        <p className="text-2xl font-semibold text-slate-400 mb-10">Data Pipeline</p>

        <div ref={containerRef} className="relative flex gap-40 items-stretch">

          {line && (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: '100%', height: '100%', overflow: 'visible' }}
            >
              <path
                d={`M ${line.x1} ${line.y1} C ${line.x1 + 48} ${line.y1}, ${line.x2 - 48} ${line.y2}, ${line.x2} ${line.y2}`}
                stroke="rgba(251,191,36,0.20)"
                strokeWidth="1"
                fill="none"
              />
              <circle cx={line.x2} cy={line.y2} r="2.5" fill="rgba(251,191,36,0.40)" />
            </svg>
          )}

          <div className="shrink-0 w-80 flex flex-col z-10">
            {STEPS.map((step, i) => {
              const isActive = activeStep === step.n
              const isLast   = i === STEPS.length - 1
              return (
                <div key={step.n} className="flex gap-4 items-start">
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => toggle(step.n)}
                      style={isActive ? {
                        boxShadow: '0 0 0 4px rgba(251,191,36,0.15), 0 0 22px rgba(251,191,36,0.28)',
                      } : {}}
                      className={`rounded-full font-mono font-bold flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isActive
                          ? 'w-12 h-12 text-xl bg-amber-400 text-slate-900'
                          : 'w-10 h-10 text-base border border-amber-500/30 text-amber-400/55 hover:text-amber-400 hover:border-amber-400/60'
                      }`}
                    >
                      {step.n}
                    </button>
                    {!isLast && (
                      <div className="w-px flex-1 min-h-[1.25rem] border-l border-dashed border-slate-800 my-1.5" />
                    )}
                  </div>

                  <button
                    ref={el => { labelRefs.current[i] = el }}
                    type="button"
                    onClick={() => toggle(step.n)}
                    className={`inline-block text-left leading-snug whitespace-nowrap transition-all duration-300 ${
                      isActive
                        ? 'text-2xl font-semibold text-slate-100 pt-2'
                        : 'text-lg font-medium text-slate-500 hover:text-slate-300 pt-2'
                    }`}
                  >
                    {step.label}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex-1 flex items-center z-10">
            <div
              ref={bubbleRef}
              className={`w-full rounded-xl p-8 transition-all duration-300 ${
                activeStep ? 'border border-slate-800 bg-slate-900' : 'border border-transparent bg-transparent'
              }`}
              style={{ minHeight: '260px' }}
            >
              {activeStep && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/50 mb-4">
                    Step {activeStep}
                  </p>
                  <p className="text-base text-slate-300 leading-loose">
                    {STEPS[activeStep - 1].detail}
                  </p>
                </div>
              )}
            </div>
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
            <p className="text-sm text-slate-300 max-w-lg leading-relaxed">
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
            className="flex items-center gap-2 border border-slate-500 hover:border-slate-300 text-slate-200 hover:text-white text-sm px-6 py-3 rounded-xl transition-colors duration-150"
          >
            <Linkedin size={14} strokeWidth={1.5} />
            Nicholas Lawrence
          </a>
        </div>
      </div>
    </div>
  )
}

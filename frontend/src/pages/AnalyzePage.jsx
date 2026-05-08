import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Github, Linkedin, Code2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import AgentWeb from '../components/AgentWeb.jsx'

const CLUSTERS = [
  {
    label: 'Expression Analysis',
    color: 'text-sky-400',
    divider: 'bg-sky-500/40',
    description: 'Exploratory data analysis cluster, turning your raw RNA-sequence data into a candidate pool.',
    agents: [
      {
        id: 'dge',
        label: 'Differential Expression',
        color: 'text-sky-300',
        dot: 'bg-sky-400',
        activeBg: 'bg-sky-950/40',
        activeBorder: 'border-sky-500/70',
        source: 'PyDESeq2',
        tagline: 'Conducts RNA-seq differential expression analysis with PyDESeq2.',
        description:
          'PyDESeq2 fits a negative binomial GLM to your count matrix, using empirical Bayes dispersion shrinkage to stabilise estimates across genes with low counts. The output is a ranked list of upregulated genes, corrected for multiple testing with Benjamini-Hochberg. A plain t-test on normalised counts gets this wrong at small sample sizes. The GLM gets it right by modelling the variance structure RNA-seq data actually has.',
      },
      {
        id: 'pathway',
        label: 'Pathway Enrichment',
        color: 'text-orange-300',
        dot: 'bg-orange-400',
        activeBg: 'bg-orange-950/40',
        activeBorder: 'border-orange-500/70',
        source: 'GSEApy / KEGG / GO',
        tagline: 'Scrapes through different pathway databases for your gene.',
        description:
          'Over-representation analysis runs against KEGG, GO Biological Process, and Reactome gene sets, using only genes detected in your matrix as the background universe. Benchmarking against the whole genome inflates significance for any study with a narrow detection range, so this matters. When the DEG count falls outside the ORA confidence range, the analysis switches automatically to GSEA preranking on the full differential expression scores. Redundant GO terms are collapsed by Jaccard similarity before anything reaches the report.',
      },
      {
        id: 'ppi',
        label: 'PPI Network',
        color: 'text-indigo-300',
        dot: 'bg-indigo-400',
        activeBg: 'bg-indigo-950/40',
        activeBorder: 'border-indigo-500/70',
        source: 'STRING DB',
        tagline: 'Finds target gene-protein interactions.',
        description:
          'Protein interactions are pulled from STRING at a combined confidence score of 700 or above, which keeps out low-quality co-expression inferences. Each partner gets cross-referenced against a curated oncogene set, so the supervisor can see immediately whether a dark gene sits next to well-known cancer drivers. GO molecular function terms add mechanistic context. A gene with no known function but three high-confidence oncogene neighbours is worth a harder look.',
      },
    ],
  },
  {
    label: 'Target Validation',
    color: 'text-rose-400',
    divider: 'bg-rose-500/40',
    description: 'The supervisor pulls from these tools in whatever order the evidence demands.',
    agents: [
      {
        id: 'depmap',
        label: 'DepMap CRISPR',
        color: 'text-rose-300',
        dot: 'bg-rose-400',
        activeBg: 'bg-rose-950/40',
        activeBorder: 'border-rose-500/70',
        source: 'DepMap Portal',
        tagline: 'Identifies target gene from the DepMap database.',
        description:
          'The DepMap Chronos scores tell you what happens when you knock a gene out across hundreds of cancer cell lines. Strongly selective essentiality means the gene is lethal in a cancer-type-specific way while normal tissue is spared. That is the target profile you want for a therapeutic. Broadly essential genes are flagged separately as on-target toxicity concerns. Low essentiality is not a dead end, but the supervisor weighs it when deciding how much further to investigate.',
      },
      {
        id: 'opentargets',
        label: 'OpenTargets',
        color: 'text-violet-300',
        dot: 'bg-violet-400',
        activeBg: 'bg-violet-950/40',
        activeBorder: 'border-violet-500/70',
        source: 'OT Platform v4',
        tagline: 'Compares to a generic disease association profile from OpenTargets.',
        description:
          'The OpenTargets overall score aggregates genetic association, somatic mutation, clinical drug evidence, pathway membership, literature co-mention, RNA expression, and animal model data for every gene-disease pair. Decomposing the score matters: a gene that scores on somatic mutation and approved drugs is in a very different position from one whose score comes entirely from literature co-mention. The supervisor uses the breakdown to decide which agents to pull next.',
      },
      {
        id: 'literature',
        label: 'Literature RAG',
        color: 'text-cyan-300',
        dot: 'bg-cyan-400',
        activeBg: 'bg-cyan-950/40',
        activeBorder: 'border-cyan-500/70',
        source: 'Pinecone / PubMed',
        tagline: 'Uses Pinecone RAG to find semantically similar clusters.',
        description:
          'Abstracts are fetched from PubMed and Semantic Scholar, then embedded server-side by Pinecone using llama-text-embed-v2 and stored in a dense vector index. At query time the system retrieves the top hits by cosine similarity, not keyword overlap, so it surfaces papers about a gene\'s mechanism even when the gene symbol does not appear in the title.',
      },
    ],
  },
  {
    label: 'Discovery',
    color: 'text-amber-400',
    divider: 'bg-amber-500/40',
    description: 'Report writing and hypothesis generation.',
    agents: [
      {
        id: 'drugs',
        label: 'Drug Annotation',
        color: 'text-emerald-300',
        dot: 'bg-emerald-400',
        activeBg: 'bg-emerald-950/40',
        activeBorder: 'border-emerald-500/70',
        source: 'ChEMBL / UniProt',
        tagline: 'Scrapes for drugs targeting your gene already in the market.',
        description:
          'ChEMBL is queried for binding assay compounds with pChEMBL at or above 5, corresponding to a rough potency ceiling of 10 micromolar. Results are sorted by clinical phase first, then by potency. No hits is itself a finding: high essentiality with a completely empty ChEMBL record is the white-space signature this tool is built to detect. UniProt fills in structural and functional annotation to add further context to the hypothesis.',
      },
      {
        id: 'synthesis',
        label: 'Hypothesis Synthesis',
        color: 'text-pink-300',
        dot: 'bg-pink-400',
        activeBg: 'bg-pink-950/40',
        activeBorder: 'border-pink-500/70',
        source: 'GPT-4o / PubMed',
        tagline: 'Generates a mechanistic hypothesis for each gene.',
        description:
          'One hypothesis is generated per gene that survived supervisor pruning. The model reads the full accumulated investigation log rather than raw data structures, so the reasoning reflects everything the network discovered: PPI context, essentiality profile, OpenTargets scores, literature hits, drug landscape. Publication count is fetched fresh from PubMed at synthesis time and converted to a novelty score on a log scale, so a gene with 12 papers scores near 0.7 and one with 10,000 scores near zero. The output is a mechanistic narrative with proposed follow-up experiments, not a summary.',
      },
      {
        id: 'report',
        label: 'Hypothesis Report',
        color: 'text-amber-300',
        dot: 'bg-amber-400',
        activeBg: 'bg-amber-950/40',
        activeBorder: 'border-amber-500/70',
        source: 'GPT-4o',
        tagline: 'Compiles a structured report on the entire process.',
        description:
          'After all targets are scored and ranked, GPT-4o reads the complete investigation log and assembles a structured report: executive summary, per-gene mechanism paragraphs, supporting evidence citations, novelty scores, and concrete next-step assays. The format mirrors a preclinical target identification report. If your top hit has 11 papers and no approved inhibitors, that shows up clearly alongside the ChEMBL gap and the DepMap essentiality score, so the case for pursuing it is already in writing.',
      },
    ],
  },
]

const PHRASES = [
  'new drugs.',
  'novel targets.',
  'clinical insights.',
  'new discoveries.',
  'gene candidates.',
  'a publication.',
  'new discoveries.',
  'PPI analysis.',
  'drug matches.',
  'path enrichment.',
  'novelty scores.',
  'ideas.',
  'research direction.',
  'intron sequencing.',
  'biomarker studies.',
  'vital oncogenes.',
  'new experiments.',
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
  const [activeAgent, setActiveAgent] = useState(null)

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
        <h1 className="text-[3rem] leading-tight sm:text-7xl lg:text-[8.5rem] sm:leading-[1.06] font-bold text-white mb-5 sm:mb-8 tracking-tight">
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
        <p className="text-4xl sm:text-5xl font-bold text-white mb-3 tracking-wide">Agent Network</p>
        <p className="text-base sm:text-lg text-white/70 mb-10 max-w-2xl leading-relaxed">
          RNAgent features a single supervisor node, with 9 specialist agents, each computing a different biological task.
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
                          ? 'opacity-45 hover:opacity-65 hover:bg-slate-700/30'
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
                        <span>log₂FC Score: {g.lfc}</span>
                      </div>
                    </div>

                    <AnimatedBar score={g.novelty} visible={leftIn} />
                    <p className="text-sm text-white sm:text-base">Novelty Score</p>
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
                <p className="text-sm text-white/80 max-w-[350px] leading-relaxed">
                  The supervisor agent reads all the specialist outputs and synthesizes a mechanistic hypothesis for each gene, along with a novelty score.
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
                  <span className="text-xl font-semibold text-white">Novelty score</span>
                  <span className="text-2xl font-bold text-amber-400">
                    {EXAMPLE_GENES.find(g => g.symbol === selectedGene)?.novelty.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* ── About / Agent Guide ──────────────────────────────── */}
      <div className="border-t border-slate-800 pt-14 space-y-14">
        <div>
          <p className="text-4xl sm:text-5xl font-bold text-white mb-3 tracking-tight">Agent Breakdown</p>
          <p className="text-base sm:text-lg text-white/70 max-w-2xl leading-relaxed">
            Click on an agent card to see its function, purpose, and the context it feeds forward through the network.
          </p>
        </div>

        {CLUSTERS.map(cluster => (
          <div key={cluster.label}>
            {/* Cluster header */}
            <div className="flex items-center gap-3 mb-2">
              <span className={`w-1 h-6 rounded-full shrink-0 ${cluster.divider}`} />
              <p className={`text-xl font-bold ${cluster.color}`}>{cluster.label}</p>
            </div>
            <p className="text-base text-white/60 mb-6 pl-4">{cluster.description}</p>

            {/* Card row with flex-grow physics */}
            <div className="flex gap-5 items-stretch">
              {cluster.agents.map(agent => {
                const isActive = activeAgent === agent.id
                return (
                  <div
                    key={agent.id}
                    onClick={() => setActiveAgent(isActive ? null : agent.id)}
                    style={{
                      flex: isActive ? 2 : 1,
                      transition: 'flex 0.38s cubic-bezier(0.34,1.56,0.64,1), transform 0.25s ease, box-shadow 0.25s ease',
                    }}
                    className={`cursor-pointer rounded-2xl border p-8 overflow-hidden min-w-0 min-h-[220px] flex flex-col
                      ${isActive
                        ? `${agent.activeBg} ${agent.activeBorder} -translate-y-1.5 shadow-2xl`
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                      }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-3 mb-5">
                      <span className={`w-3 h-3 rounded-full shrink-0 ${agent.dot} ${isActive ? 'animate-pulse' : ''}`} />
                      <span className={`text-lg font-semibold leading-tight ${isActive ? agent.color : 'text-white'}`}>
                        {agent.label}
                      </span>
                      <span className="ml-auto text-sm text-white/30 shrink-0 pl-2">{agent.source}</span>
                    </div>

                    {/* Tagline */}
                    <p className={`text-lg font-medium leading-snug transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/65'}`}>
                      {agent.tagline}
                    </p>

                    {/* Expanded description — always mounted; fades in after flex expansion finishes */}
                    <div
                      style={{
                        overflow: 'hidden',
                        maxHeight: isActive ? '600px' : '0px',
                        opacity: isActive ? 1 : 0,
                        transitionProperty: 'max-height, opacity',
                        transitionDuration: isActive ? '0.4s, 0.25s' : '0.2s, 0.1s',
                        transitionDelay: isActive ? '0.34s, 0.52s' : '0s, 0s',
                        transitionTimingFunction: 'ease',
                      }}
                    >
                      <p className="text-base text-white/80 leading-relaxed mt-5 pt-5 border-t border-white/10">
                        {agent.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
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

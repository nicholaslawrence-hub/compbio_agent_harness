import { useRef, useEffect, useState, useCallback } from 'react'

const VW = 720, VH = 490
const CX = VW / 2, CY = VH / 2
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace"

// ── Agents ────────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 'supervisor',   label: ['Supervisor'],               isCenter: true, r: 54 },
  { id: 'dge',          label: ['DGE', 'Analysis'],          r: 44 },
  { id: 'pathway',      label: ['Pathway', 'Enrichment'],    r: 44 },
  { id: 'ppi',          label: ['PPI', 'Network'],           r: 44 },
  { id: 'depmap',       label: ['DepMap', 'Essentiality'],   r: 44 },
  { id: 'opentargets',  label: ['Open', 'Targets'],          r: 44 },
  { id: 'rag',          label: ['Literature', 'RAG'],        r: 44 },
  { id: 'drug',         label: ['Drug', 'Annotation'],       r: 44 },
  { id: 'synthesis',    label: ['Hypothesis', 'Synthesis'],  r: 44 },
  { id: 'report',       label: ['Report', 'Generation'],     r: 44 },
]

const EDGES = [
  // supervisor spokes
  ['supervisor','dge'], ['supervisor','pathway'], ['supervisor','ppi'],
  ['supervisor','depmap'], ['supervisor','opentargets'],
  ['supervisor','rag'], ['supervisor','drug'],
  ['supervisor','synthesis'], ['supervisor','report'],
  // cross-cluster semantic
  ['ppi','depmap'],
  ['opentargets','synthesis'],
  ['rag','synthesis'],
  ['drug','report'],
  // intra-cluster triangles
  ['pathway','ppi'], ['dge','ppi'],
  ['depmap','opentargets'], ['opentargets','rag'], ['depmap','rag'],
  ['drug','synthesis'], ['synthesis','report'],
]

// ── Functional Clusters ───────────────────────────────────────────────────────

const CLUSTERS = {
  data:      { label: 'DATA',      color: '#38bdf8', ids: ['dge','ppi','pathway'],         cx: 540, cy: 168 },
  knowledge: { label: 'KNOWLEDGE', color: '#a78bfa', ids: ['depmap','opentargets','rag'],  cx: 360, cy: 405 },
  synthesis: { label: 'SYNTHESIS', color: '#34d399', ids: ['drug','synthesis','report'],   cx: 182, cy: 168 },
}

const NODE_CLUSTER = {}
Object.entries(CLUSTERS).forEach(([k, c]) => c.ids.forEach(id => { NODE_CLUSTER[id] = k }))

function nodeColor(id) {
  if (id === 'supervisor') return '#f59e0b'
  return CLUSTERS[NODE_CLUSTER[id]]?.color ?? '#22c55e'
}

// Cluster-aware initial positions — avoids cold-start chaos
const INIT_POS = {
  supervisor:  { x: CX,  y: CY  },
  dge:         { x: 518, y: 112 },
  ppi:         { x: 592, y: 205 },
  pathway:     { x: 516, y: 292 },
  depmap:      { x: 245, y: 386 },
  opentargets: { x: 360, y: 448 },
  rag:         { x: 475, y: 386 },
  drug:        { x: 162, y: 288 },
  synthesis:   { x: 115, y: 202 },
  report:      { x: 180, y: 105 },
}

const SPOKE_SET = new Set([
  'supervisor,dge','supervisor,pathway','supervisor,ppi',
  'supervisor,depmap','supervisor,opentargets',
  'supervisor,rag','supervisor,drug','supervisor,synthesis','supervisor,report',
])

const INTRA_SET = new Set([
  'dge,pathway','pathway,ppi','dge,ppi',
  'depmap,opentargets','opentargets,rag','depmap,rag',
  'drug,synthesis','synthesis,report','drug,report',
])


function restLen(a, b) {
  const k = `${a},${b}`, kr = `${b},${a}`
  if (SPOKE_SET.has(k) || SPOKE_SET.has(kr)) return 210
  if (INTRA_SET.has(k) || INTRA_SET.has(kr)) return 95
  return 168
}

// ── Chat content ──────────────────────────────────────────────────────────────

const CHAT_INFO = {
  supervisor: {
    color: '#f59e0b', header: 'Supervisor Agent',
    desc: 'Central orchestrator. Routes tasks to specialist workers, aggregates results, and coordinates synthesis.',
    msgs: [
      { from: 'SUP', text: 'Agent network initialized. Dispatching DGE agent with count matrix and disease context.' },
      { from: 'SUP', text: 'DGE complete — routing to Pathway Enrichment and PPI Network.' },
      { from: 'SUP', text: 'Enrichment done. Dispatching Literature RAG with top genes and PPI partners.' },
      { from: 'SUP', text: 'All agents complete. Requesting Hypothesis Synthesis then Report Generation.' },
    ],
  },
  dge: {
    color: '#38bdf8', header: 'DGE Analysis Agent',
    desc: 'PyDESeq2 negative binomial model with BH correction. Falls back to Welch t-test for small N.',
    msgs: [
      { from: 'SUP', text: 'Run differential expression on count matrix. Filter padj < 0.05, |log₂FC| > 1.' },
      { from: 'DGE', text: 'Running PyDESeq2 — median-of-ratios normalization, negative binomial model.' },
      { from: 'DGE', text: 'Done. 847 DEGs pass filter. Top: EGFR (log₂FC = 3.2, padj = 1.4e-12). Returning list.' },
    ],
  },
  pathway: {
    color: '#38bdf8', header: 'Pathway Enrichment Agent',
    desc: "GO Biological Process and KEGG ORA via Fisher's exact test. Deduplicates by Jaccard overlap.",
    msgs: [
      { from: 'SUP', text: 'Run pathway ORA on DEG list. Return top 5 pathways for LLM prompt context.' },
      { from: 'PWY', text: "Testing against GO BP and KEGG gene sets with Fisher's exact test (BH)..." },
      { from: 'PWY', text: 'Top hits: MAPK signaling, PI3K-AKT, cell cycle regulation, ECM remodeling, apoptosis. Deduplicated.' },
    ],
  },
  ppi: {
    color: '#38bdf8', header: 'PPI Network Agent',
    desc: 'STRING DB at confidence ≥ 700. Annotates all genes and partners with GO MF terms via MyGene.info.',
    msgs: [
      { from: 'SUP', text: 'Build PPI network for top 50 DEGs. Annotate with GO Molecular Function terms.' },
      { from: 'PPI', text: 'Querying STRING DB (confidence ≥ 700). Collecting interaction partners...' },
      { from: 'PPI', text: 'Network: 50 nodes, 312 edges. Batching to MyGene.info for GO MF. Hub: TP53 (degree 89).' },
    ],
  },
  depmap: {
    color: '#a78bfa', header: 'DepMap Essentiality Agent',
    desc: 'Queries DepMap CRISPR screen API for gene effect scores across 1,000+ cancer cell lines. Elevates dark genes with high essentiality.',
    msgs: [
      { from: 'SUP', text: 'Fetch CRISPR essentiality scores for top candidate genes. Flag cancer-line dependence.' },
      { from: 'DEP', text: 'Querying DepMap API for gene effect scores across 1,054 cancer cell lines...' },
      { from: 'DEP', text: 'EGFR: essential in 234 lines (mean −0.85). SBSPON: essential in PDAC lines (−1.2) — dark gene elevated to priority.' },
    ],
  },
  opentargets: {
    color: '#a78bfa', header: 'Open Targets Agent',
    desc: 'Single API call returns a gene-disease association score aggregating genetics, somatic mutations, expression, and literature.',
    msgs: [
      { from: 'SUP', text: 'Score top candidates against disease context using Open Targets. Return association scores.' },
      { from: 'OT',  text: 'Querying Open Targets platform API for gene-disease association scores...' },
      { from: 'OT',  text: 'EGFR × lung adenocarcinoma: 0.91. TGFBI × PDAC: 0.34 (high novelty potential). Scores ready for synthesis.' },
    ],
  },
  rag: {
    color: '#a78bfa', header: 'Literature RAG Agent',
    desc: 'PubMed + Semantic Scholar retrieval, Pinecone vector upsert, semantic search with interactor fallback for dark genes.',
    msgs: [
      { from: 'SUP', text: 'Retrieve literature for top targets. Use PPI partners for dark-gene fallback.' },
      { from: 'RAG', text: 'Fetching from PubMed and Semantic Scholar. Upserting 42 records into Pinecone...' },
      { from: 'RAG', text: '4 high-relevance hits (score > 0.45). Interactor fallback for 2 dark genes — retried with gene+partner query.' },
    ],
  },
  drug: {
    color: '#34d399', header: 'Drug Annotation Agent',
    desc: 'ChEMBL and UniProt cross-reference for approved drugs, clinical candidates, binding constants, and druggability scores.',
    msgs: [
      { from: 'SUP', text: 'Annotate top targets with ChEMBL and UniProt data. Flag well-drugged vs dark targets.' },
      { from: 'DRG', text: 'Querying ChEMBL for approved compounds and Phase I–III candidates...' },
      { from: 'DRG', text: 'EGFR: 3 approved (erlotinib Ki = 0.3 nM), 7 Phase II. TGFBI: 0 approved — elevated novelty score.' },
    ],
  },
  synthesis: {
    color: '#34d399', header: 'Hypothesis Synthesis Agent',
    desc: 'GPT-5.4-mini receives all agent outputs and generates ranked hypotheses with mechanism and novelty scores.',
    msgs: [
      { from: 'SUP', text: 'Synthesize all agent outputs into ranked drug target hypotheses.' },
      { from: 'SYN', text: 'Aggregating DGE stats, GO MF, PPI network, RAG passages, OT scores, and ChEMBL data...' },
      { from: 'SYN', text: '5 ranked hypotheses. #1: EGFR synthetic lethal in KRAS-mutant context (novelty 0.87). #2: TGFBI dark gene.' },
    ],
  },
  report: {
    color: '#34d399', header: 'Report Generation Agent',
    desc: 'Compiles a publication-style report with ranked targets, mechanisms, novelty scores, and suggested assays.',
    msgs: [
      { from: 'SUP', text: 'Compile final report. Include exec summary and validation recommendations.' },
      { from: 'RPT', text: 'Formatting ranked targets, mechanism summaries, novelty scores, evidence citations...' },
      { from: 'RPT', text: 'Report ready. 5 targets, 12 citations. Suggested: siRNA knockdown for TGFBI, co-IP validation.' },
    ],
  },
}

// ── Physics ───────────────────────────────────────────────────────────────────

const SPRING_K     = 0.040
const REPULSION    = 11000
const DAMPING      = 0.62
const GRAVITY      = 0.005   // global — keeps supervisor anchored
const CLUSTER_GRAV = 0.012   // per-cluster pull

function getSVGPoint(svg, clientX, clientY) {
  const r = svg.getBoundingClientRect()
  return { x: ((clientX - r.left) / r.width) * VW, y: ((clientY - r.top) / r.height) * VH }
}

function initPhysics() {
  return AGENTS.map(a => ({
    id: a.id,
    x: INIT_POS[a.id]?.x ?? CX,
    y: INIT_POS[a.id]?.y ?? CY,
    vx: (Math.random() - 0.5) * 1.5,
    vy: (Math.random() - 0.5) * 1.5,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentWeb() {
  const wrapRef     = useRef(null)
  const svgRef      = useRef(null)
  const physRef     = useRef(initPhysics())
  const groupRefs   = useRef({})
  const lineRefs    = useRef({})
  const gradRefs    = useRef({})
  const rafRef      = useRef(null)
  const dragRef     = useRef(null)
  const selectedRef = useRef(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => { selectedRef.current = selected }, [selected])

  const updateDOM = useCallback(() => {
    const nodes = physRef.current
    const map   = Object.fromEntries(nodes.map(n => [n.id, n]))
    nodes.forEach(n => {
      groupRefs.current[n.id]?.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`)
    })

    const sel = selectedRef.current

    EDGES.forEach(([a, b]) => {
      const el = lineRefs.current[`${a}-${b}`]
      const na = map[a], nb = map[b]
      if (!el || !na || !nb) return
      el.setAttribute('x1', na.x.toFixed(1)); el.setAttribute('y1', na.y.toFixed(1))
      el.setAttribute('x2', nb.x.toFixed(1)); el.setAttribute('y2', nb.y.toFixed(1))

      if (sel && (a === sel || b === sel)) {
        const grad = gradRefs.current[`${a}-${b}`]
        if (grad) {
          grad.setAttribute('x1', na.x.toFixed(1)); grad.setAttribute('y1', na.y.toFixed(1))
          grad.setAttribute('x2', nb.x.toFixed(1)); grad.setAttribute('y2', nb.y.toFixed(1))
        }
        el.setAttribute('stroke', `url(#aw-grad-${a}-${b})`)
        el.setAttribute('stroke-width', '2')
        el.setAttribute('stroke-opacity', '0.85')
      } else if (sel) {
        el.setAttribute('stroke', 'rgba(100,116,139,0.08)')
        el.setAttribute('stroke-width', '0.7')
        el.setAttribute('stroke-opacity', '1')
      } else {
        el.setAttribute('stroke', 'rgba(148,163,184,0.45)')
        el.setAttribute('stroke-width', '1.4')
        el.setAttribute('stroke-opacity', '1')
      }
    })
  }, [])

  const tick = useCallback(() => {
    const nodes = physRef.current
    const pinId = dragRef.current?.nodeId

    nodes.forEach(n => { n.fx = 0; n.fy = 0 })

    EDGES.forEach(([a, b]) => {
      const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b)
      if (!na || !nb) return
      const dx = nb.x - na.x, dy = nb.y - na.y
      const dist = Math.hypot(dx, dy) || 0.001
      const f = SPRING_K * (dist - restLen(a, b))
      na.fx += f * dx / dist; na.fy += f * dy / dist
      nb.fx -= f * dx / dist; nb.fy -= f * dy / dist
    })

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const na = nodes[i], nb = nodes[j]
        const dx = nb.x - na.x, dy = nb.y - na.y
        const d2 = dx * dx + dy * dy || 0.001
        const d  = Math.sqrt(d2)
        const f  = REPULSION / d2
        na.fx -= f * dx / d; na.fy -= f * dy / d
        nb.fx += f * dx / d; nb.fy += f * dy / d
      }
    }

    nodes.forEach(n => {
      n.fx += (CX - n.x) * GRAVITY
      n.fy += (CY - n.y) * GRAVITY
      const cc = CLUSTERS[NODE_CLUSTER[n.id]]
      if (cc) { n.fx += (cc.cx - n.x) * CLUSTER_GRAV; n.fy += (cc.cy - n.y) * CLUSTER_GRAV }
    })

    nodes.forEach(n => {
      if (n.id === pinId) return
      n.vx = (n.vx + n.fx) * DAMPING
      n.vy = (n.vy + n.fy) * DAMPING
      n.x  = Math.max(46, Math.min(VW - 46, n.x + n.vx))
      n.y  = Math.max(46, Math.min(VH - 46, n.y + n.vy))
    })

    updateDOM()
    rafRef.current = requestAnimationFrame(tick)
  }, [updateDOM])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [tick])

  // Drag
  const onPointerDown = useCallback((e, id) => {
    e.preventDefault()
    const pt = getSVGPoint(svgRef.current, e.clientX, e.clientY)
    dragRef.current = { nodeId: id, startX: pt.x, startY: pt.y, moved: false }
    svgRef.current?.setPointerCapture(e.pointerId)
  }, [])

  const onSVGPointerMove = useCallback((e) => {
    if (!dragRef.current) return
    const pt = getSVGPoint(svgRef.current, e.clientX, e.clientY)
    const node = physRef.current.find(n => n.id === dragRef.current.nodeId)
    if (!node) return
    const dx = pt.x - dragRef.current.startX, dy = pt.y - dragRef.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true
    node.x = Math.max(46, Math.min(VW - 46, pt.x))
    node.y = Math.max(46, Math.min(VH - 46, pt.y))
    node.vx = 0; node.vy = 0
  }, [])

  const onPointerUp = useCallback((e, id) => {
    if (dragRef.current && !dragRef.current.moved)
      setSelected(prev => prev === id ? null : id)
    dragRef.current = null
  }, [])

  // Parallax
  const onMouseMove = useCallback((e) => {
    if (dragRef.current || !wrapRef.current) return
    const r  = wrapRef.current.getBoundingClientRect()
    const mx = (e.clientX - r.left) / r.width  - 0.5
    const my = (e.clientY - r.top)  / r.height - 0.5
    wrapRef.current.style.transform = `perspective(900px) rotateX(${(my * -5).toFixed(2)}deg) rotateY(${(mx * 6).toFixed(2)}deg)`
  }, [])

  const onMouseLeave = useCallback(() => {
    if (!wrapRef.current) return
    wrapRef.current.style.transition = 'transform 0.5s ease-out'
    wrapRef.current.style.transform  = 'perspective(900px) rotateX(0deg) rotateY(0deg)'
    setTimeout(() => { if (wrapRef.current) wrapRef.current.style.transition = '' }, 500)
  }, [])

  const chat = selected ? CHAT_INFO[selected] : null

  return (
    <div className="space-y-3 max-w-5xl mx-auto" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>

      {/* Parallax wrapper */}
      <div ref={wrapRef} style={{ willChange: 'transform' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VW} ${VH}`}
          className="w-full max-h-[460px] select-none"
          style={{ touchAction: 'none' }}
          onPointerMove={onSVGPointerMove}
          onPointerUp={e => { if (dragRef.current) onPointerUp(e, dragRef.current.nodeId) }}
          onPointerLeave={() => { if (dragRef.current) dragRef.current = null }}
        >
          <defs>
            <filter id="aw-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="7" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {EDGES.map(([a, b]) => (
              <linearGradient
                key={`aw-grad-${a}-${b}`}
                id={`aw-grad-${a}-${b}`}
                gradientUnits="userSpaceOnUse"
                ref={el => { if (el) gradRefs.current[`${a}-${b}`] = el }}
              >
                <stop offset="0%"   stopColor={nodeColor(a)} />
                <stop offset="42%"  stopColor={nodeColor(a)} />
                <stop offset="58%"  stopColor={nodeColor(b)} />
                <stop offset="100%" stopColor={nodeColor(b)} />
              </linearGradient>
            ))}
          </defs>

          {/* Edges */}
          {EDGES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              ref={el => { if (el) lineRefs.current[`${a}-${b}`] = el }}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth="1.4"
            />
          ))}

          {/* Nodes */}
          {AGENTS.map(({ id, label, isCenter, r }) => {
            const isSel = selected === id
            const color = nodeColor(id)
            return (
              <g
                key={id}
                ref={el => { if (el) groupRefs.current[id] = el }}
                style={{ cursor: 'pointer' }}
                onPointerDown={e => onPointerDown(e, id)}
                onPointerUp={e => onPointerUp(e, id)}
              >
                {/* Node body */}
                <circle r={r}
                  fill="rgba(5,10,28,0.92)"
                  stroke={color}
                  strokeWidth={isSel ? 2.5 : 1.5}
                  strokeOpacity={isSel ? 1 : 0.72}
                  filter={isSel ? 'url(#aw-glow)' : undefined}
                />

                {/* Label */}
                {label.length === 1 ? (
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize={isCenter ? '12' : '10.5'} fontWeight="700"
                    fontFamily={MONO}
                    fill={isSel ? color : '#ffffff'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >{label[0]}</text>
                ) : (
                  <text textAnchor="middle" fontSize="9" fontWeight="700"
                    fontFamily={MONO}
                    fill={isSel ? color : '#ffffff'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    <tspan x="0" dy="-5.5">{label[0]}</tspan>
                    <tspan x="0" dy="13">{label[1]}</tspan>
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {!selected && (
        <p className="text-center text-sm font-medium text-white">
          Click Any Node
        </p>
      )}

      {/* Chat panel */}
      {chat && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
            <span className="text-base font-semibold text-white">{chat.header}</span>
            <span className="hidden sm:block text-sm text-white/60 flex-1 leading-snug">{chat.desc}</span>
            <button onClick={() => setSelected(null)}
              className="text-white/50 hover:text-white transition-colors text-2xl leading-none ml-auto shrink-0 pl-4"
            >×</button>
          </div>

          <p className="sm:hidden text-sm text-white/60 px-6 pt-4 leading-snug">{chat.desc}</p>

          <div className="px-6 py-5 space-y-4 max-h-72 overflow-y-auto">
            {chat.msgs.map((msg, i) => {
              const isOut = msg.from === 'SUP'
              return (
                <div key={i} className={`flex items-end ${isOut ? '' : 'justify-end'}`}>
                  <div className="max-w-[82%] px-4 py-3 text-sm leading-relaxed text-white"
                    style={{
                      background: isOut ? 'rgba(245,158,11,0.18)' : chat.color + '24',
                      border: `1px solid ${isOut ? 'rgba(245,158,11,0.40)' : chat.color + '55'}`,
                      borderRadius: isOut ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                    }}
                  >{msg.text}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

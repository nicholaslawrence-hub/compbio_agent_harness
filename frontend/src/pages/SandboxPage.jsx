import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Background,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Play, Save, X } from 'lucide-react'
import { loadSandboxDesign, saveSandboxDesign, startSandboxAnalysis } from '../utils/api'
import { AGENT_CARDS, PORT_LABELS, cardFor } from '../data/agentCatalog'
import BioToolNode from '../components/sandbox/BioToolNode'
import EdgeChatInspector from '../components/sandbox/EdgeChatInspector'
import OpticTetherEdge from '../components/sandbox/OpticTetherEdge'
import SupervisorNode from '../components/sandbox/SupervisorNode'
import TranslatorNode from '../components/sandbox/TranslatorNode'

const NODE_W = 220
const NODE_H = 96
const SUPERVISOR_MIN_W = 360
const SUPERVISOR_MIN_H = 220
const SNAP = 24
const SAMPLE_ROWS = [['D1', 'disease'], ['D2', 'disease'], ['D3', 'disease'], ['D4', 'disease'], ['C1', 'control'], ['C2', 'control'], ['C3', 'control'], ['C4', 'control']]
const RUNNABLE_NODE_TYPES = new Set([
  'count_matrix_input',
  'run_dge',
  'pathway_enrichment',
  'enrich_ppi',
  'literature_rag',
  'drug_annotation',
  'depmap_query',
  'opentargets_query',
  'clinical_trials',
  'pathway_crosstalk',
  'tcga_survival',
  'crispr_designer',
  'report',
])
const BANK_GROUPS = [
  { title: 'Entry', types: ['count_matrix_input', 'clinical_metadata', 'study_context'] },
  { title: 'RNA and Systems Biology', types: ['run_dge', 'scenic_regulon', 'spatial_tme', 'lincs_reversion', 'literature_rag'] },
  { title: 'Target Validation', types: ['viper_protein_activity', 'mageck_crispr', 'tcga_survival', 'enrich_ppi', 'alphafold_complex', 'crispr_designer'] },
  { title: 'Chemistry', types: ['reinvent_generative', 'rdkit_features', 'gnina_docking', 'drug_annotation', 'pharmacogenomics_pgx'] },
  { title: 'Controls', types: ['sync_gateway', 'approval_gate', 'translator', 'critic_structural_tractability', 'critic_microenvironment_validity'] },
  { title: 'Output', types: ['report'] },
]

export const INITIAL_SANDBOX = {
  nodes: [
    { id: 'count-input', type: 'bioNode', position: { x: 120, y: 180 }, data: { type: 'count_matrix_input', label: 'Count Matrix' } },
    { id: 'report', type: 'bioNode', position: { x: 520, y: 180 }, data: { type: 'report', label: 'Report' } },
  ],
  edges: [],
}

function snap(value) {
  return Math.round(value / SNAP) * SNAP
}

const nodeTypes = { bioNode: BioToolNode, supervisorGroup: SupervisorNode, translator: TranslatorNode }

function biologicalDescriptor(card) {
  const byType = {
    count_matrix_input: 'RNA count matrix',
    clinical_metadata: 'sample phenotype table',
    study_context: 'study objective',
    run_dge: 'RNA differential expression',
    viper_protein_activity: 'TF activity profile',
    mageck_crispr: 'CRISPR dependency profile',
    scenic_regulon: 'regulon activity',
    spatial_tme: 'spatial TME profile',
    tcga_survival: 'clinical survival signal',
    enrich_ppi: 'protein interaction context',
    alphafold_complex: 'structure pointer',
    reinvent_generative: 'de novo SMILES',
    rdkit_features: 'ADMET profile',
    gnina_docking: 'docking pose scores',
    approval_gate: 'human decision gate',
    crispr_designer: 'wet-lab guide design',
    report: 'final synthesis',
  }
  return byType[card.type] || card.category
}

function absolutePosition(node, allNodes = []) {
  const own = node.internals?.positionAbsolute || node.positionAbsolute
  if (own) return own
  if (!node.parentId) return node.position
  const parent = allNodes.find(item => item.id === node.parentId)
  const parentPosition = parent ? absolutePosition(parent, allNodes) : { x: 0, y: 0 }
  return { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y }
}

function nodeRect(node, allNodes = []) {
  const width = node.measured?.width || node.width || (node.type === 'supervisorGroup' ? node.data?.width || SUPERVISOR_MIN_W : NODE_W)
  const height = node.measured?.height || node.height || (node.type === 'supervisorGroup' ? node.data?.height || SUPERVISOR_MIN_H : NODE_H)
  const abs = absolutePosition(node, allNodes)
  return { x: abs.x, y: abs.y, width, height, cx: abs.x + width / 2, cy: abs.y + height / 2 }
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

const edgeTypes = { translator: OpticTetherEdge }

function canConnectPorts(sourceType, sourcePort, targetType, targetPort) {
  if (!sourceType || !targetType || sourceType === targetType) return false
  const sourceCard = cardFor(sourceType)
  const targetCard = cardFor(targetType)
  if (!(sourceCard.outputs || []).includes(sourcePort)) return false
  if (!(targetCard.inputs || []).includes(targetPort)) return false
  if (sourcePort === targetPort) return true
  const semanticPairs = new Set([
    'degs:genes',
    'regulator_activity:genes',
    'regulator_activity:regulator_activity',
    'clinical_signal:genes',
    'clinical_signal:clinical_signal',
    'network_context:genes',
    'network_context:translation_brief',
    'genes:protein',
    'protein:genes',
    'structure:pocket',
    'structure_signal:translation_brief',
    'chemistry_profile:translation_brief',
    'smiles:ligand',
    'docking:structure_signal',
    'docking:translation_brief',
    'wetlab_design:translation_brief',
    'literature_support:translation_brief',
    'decision:translation_brief',
    'translation_brief:decision',
  ])
  return semanticPairs.has(`${sourcePort}:${targetPort}`)
}

function needsTranslator(sourcePort, targetPort) {
  return sourcePort && targetPort && sourcePort !== targetPort
}

function translationPlan(sourcePort, targetPort) {
  if (!needsTranslator(sourcePort, targetPort)) {
    return { model: 'no translation', why: 'The upstream and downstream payload modality already match.' }
  }
  const deterministic = new Set([
    'degs:genes',
    'genes:protein',
    'protein:genes',
    'structure:pocket',
    'smiles:ligand',
    'regulator_activity:genes',
    'clinical_signal:genes',
  ])
  if (deterministic.has(`${sourcePort}:${targetPort}`)) {
    return {
      model: 'deterministic parser',
      why: 'This should not use an LLM. The adapter extracts IDs, ranks, symbols, or pointers from structured node output.',
    }
  }
  return {
    model: 'small summarizer LLM, temperature 0',
    why: 'Use an LLM only to compress heterogeneous biological text into a typed translation brief. Raw matrices, structures, and tables remain pointers.',
  }
}

function edgeVisual(sourceHandle, targetHandle, data = {}, selected = false) {
  const translator = needsTranslator(sourceHandle, targetHandle)
  const critic = data.reverse || data.criticLoop || data.edgeType === 'conditional'
  const [, semanticColor] = portSemanticType(sourceHandle || targetHandle)
  return {
    data: {
      ...data,
      edgeType: translator ? 'agentic' : data.edgeType || 'deterministic',
      translator,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
      translatorPlan: translationPlan(sourceHandle, targetHandle),
      selected,
      status: data.status || (selected ? 'running' : 'idle'),
      flowDirection: data.flowDirection || (data.reverse ? 'tool-to-agent' : 'agent-to-tool'),
      color: semanticColor,
    },
    style: {
      stroke: selected ? '#3B82F6' : semanticColor,
      opacity: selected ? 1 : 0.72,
      strokeWidth: 2,
      strokeDasharray: selected || critic || translator ? '4 4' : undefined,
    },
  }
}

function portSemanticType(port) {
  const byPort = {
    counts: ['matrix', '#3B82F6'],
    metadata: ['context', '#9CA3AF'],
    directive: ['context', '#9CA3AF'],
    degs: ['gene_set', '#10B981'],
    genes: ['gene_set', '#10B981'],
    signature: ['gene_set', '#10B981'],
    regulator_activity: ['gene_set', '#10B981'],
    essentiality_score: ['gene_set', '#10B981'],
    regulon_program: ['gene_set', '#10B981'],
    network_context: ['gene_set', '#10B981'],
    protein: ['structure', '#8B5CF6'],
    structure: ['structure', '#8B5CF6'],
    structure_signal: ['structure', '#8B5CF6'],
    pocket: ['structure', '#8B5CF6'],
    smiles: ['molecule', '#F97316'],
    ligand: ['molecule', '#F97316'],
    chemistry_profile: ['molecule', '#F97316'],
    docking: ['molecule', '#F97316'],
    perturbation_match: ['molecule', '#F97316'],
    decision: ['control', '#FBBF24'],
    wetlab_design: ['control', '#FBBF24'],
    report: ['control', '#FBBF24'],
    clinical_signal: ['context', '#9CA3AF'],
    spatial_context: ['context', '#9CA3AF'],
    literature_support: ['context', '#9CA3AF'],
    translation_brief: ['context', '#9CA3AF'],
  }
  return byPort[port] || ['context', '#9CA3AF']
}

function semanticType(port) {
  return portSemanticType(port)[0]
}

function midpointBetween(sourceNode, targetNode, allNodes) {
  const source = nodeRect(sourceNode, allNodes)
  const target = nodeRect(targetNode, allNodes)
  return {
    x: snap((source.cx + target.cx) / 2 - 90),
    y: snap((source.cy + target.cy) / 2 - 28),
  }
}

function buildConnectionPatch(connection, currentNodes) {
  const source = currentNodes.find(node => node.id === connection.source)
  const target = currentNodes.find(node => node.id === connection.target)
  const sourceType = semanticType(connection.sourceHandle)
  const targetType = semanticType(connection.targetHandle)
  const directEdge = {
    ...connection,
    id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${Date.now()}`,
    type: 'translator',
    animated: false,
    ...edgeVisual(connection.sourceHandle, connection.targetHandle),
  }

  if (!source || !target || sourceType === targetType) {
    return { nodes: [], edges: [directEdge] }
  }

  const translatorId = `translator-${sourceType}-to-${targetType}-${Date.now()}`
  const translatorNode = {
    id: translatorId,
    type: 'translator',
    position: midpointBetween(source, target, currentNodes),
    data: {
      sourceType,
      targetType,
      promptPreview: `${sourceType} -> ${targetType}`,
    },
  }
  const firstEdge = {
    id: `e-${connection.source}-${translatorId}`,
    source: connection.source,
    target: translatorId,
    sourceHandle: connection.sourceHandle,
    targetHandle: 'translator-in',
    type: 'translator',
    data: { translatorEdge: true, sourcePort: connection.sourceHandle, targetPort: 'translator-in', color: portSemanticType(connection.sourceHandle)[1], status: 'idle' },
    style: { stroke: portSemanticType(connection.sourceHandle)[1], strokeWidth: 2, strokeDasharray: '4 4', opacity: 0.6 },
  }
  const secondEdge = {
    id: `e-${translatorId}-${connection.target}`,
    source: translatorId,
    target: connection.target,
    sourceHandle: 'translator-out',
    targetHandle: connection.targetHandle,
    type: 'translator',
    data: { translatorEdge: true, sourcePort: 'translator-out', targetPort: connection.targetHandle, color: portSemanticType(connection.targetHandle)[1], status: 'idle' },
    style: { stroke: portSemanticType(connection.targetHandle)[1], strokeWidth: 2, strokeDasharray: '4 4', opacity: 0.6 },
  }
  return { nodes: [translatorNode], edges: [firstEdge, secondEdge] }
}

function categoryColor(category = '') {
  if (/rna|systems/i.test(category)) return '#10B981'
  if (/target|network|structure/i.test(category)) return '#8B5CF6'
  if (/chem/i.test(category)) return '#F97316'
  if (/control|critic|output/i.test(category)) return '#FBBF24'
  return '#3B82F6'
}

function fileFromText(text, filename) {
  return new File([text], filename, { type: 'text/tab-separated-values' })
}

function toBackendTopology(nodes, edges, directive) {
  const runnableNodes = nodes.filter(node => node.type === 'bioNode' && RUNNABLE_NODE_TYPES.has(node.data.type))
  const runnableIds = new Set(runnableNodes.map(node => node.id))
  const runnableEdges = edges.filter(edge => runnableIds.has(edge.source) && runnableIds.has(edge.target))
  return {
    version: 3,
    name: 'RNAgent visual network',
    directive,
    nodes: runnableNodes.map(node => ({ id: node.id, type: node.data.type, label: node.data.label, position: node.position, parentId: node.parentId || null, config: node.data.config || {} })),
    edges: runnableEdges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: edge.data || { edgeType: 'deterministic' },
    })),
  }
}

function minimalRunnableTopology(directive) {
  return {
    version: 3,
    name: 'RNAgent minimal run',
    directive,
    nodes: [
      { id: 'dge', type: 'run_dge', label: 'DGE', position: { x: 360, y: 210 }, config: {} },
      { id: 'report', type: 'report', label: 'Report', position: { x: 648, y: 210 }, config: {} },
    ],
    edges: [
      { id: 'r-dge-report', source: 'dge', target: 'report', sourceHandle: 'genes', targetHandle: 'translation_brief', data: { edgeType: 'deterministic' } },
    ],
  }
}

function reachesReport(topology) {
  const nodes = topology.nodes || []
  const edges = topology.edges || []
  const nodeIds = new Set(nodes.map(node => node.id))
  const incoming = new Map(nodes.map(node => [node.id, 0]))
  edges.forEach(edge => incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1))
  const start = nodes.find(node => node.type === 'run_dge') || nodes.find(node => (incoming.get(node.id) || 0) === 0)
  if (!start) return false
  const targets = edges.reduce((acc, edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      acc[edge.source] = acc[edge.source] || []
      acc[edge.source].push(edge.target)
    }
    return acc
  }, {})
  const queue = [start.id]
  const seen = new Set()
  while (queue.length) {
    const current = queue.shift()
    if (seen.has(current)) continue
    seen.add(current)
    const node = nodes.find(item => item.id === current)
    if (node?.type === 'report') return true
    queue.push(...(targets[current] || []))
  }
  return false
}

export default function SandboxPage() {
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_SANDBOX.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_SANDBOX.edges)
  const [selectedNode, setSelectedNode] = useState(null)
  const [countFile, setCountFile] = useState(null)
  const [diseaseTerm, setDiseaseTerm] = useState('Glioblastoma')
  const [conditionA, setConditionA] = useState('disease')
  const [conditionB, setConditionB] = useState('control')
  const [samples] = useState(SAMPLE_ROWS.map(([name, condition]) => ({ name, condition })))
  const [directive, setDirective] = useState('Prioritize clinically translatable targets that survive RNA, protein activity, essentiality, docking, ADMET, and FDA-style review.')
  const [maxIterations, setMaxIterations] = useState(8)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [connectingPort, setConnectingPort] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [flowInstance, setFlowInstance] = useState(null)
  const [designId, setDesignId] = useState('default')

  const selectedCard = selectedNode
    ? selectedNode.type === 'supervisorGroup'
      ? { category: 'Control', label: selectedNode.data.label || 'Supervisor Environment', doc: 'A movable, editable workspace boundary. Tools inside this window are available to the supervisor as callable specialists.', requires: [], returns: [] }
      : cardFor(selectedNode.data.type)
    : null
  const selectedEdgeObject = selectedEdge ? edges.find(edge => edge.id === selectedEdge.id) : null
  const edgeInspector = useMemo(() => {
    if (!selectedEdgeObject) return null
    const source = nodes.find(node => node.id === selectedEdgeObject.source)
    const target = nodes.find(node => node.id === selectedEdgeObject.target)
    if (!source || !target) return null
    const a = nodeRect(source, nodes)
    const b = nodeRect(target, nodes)
    const plan = selectedEdgeObject.data?.translatorPlan
    const mid = { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 }
    const screen = flowInstance?.flowToScreenPosition ? flowInstance.flowToScreenPosition(mid) : mid
    return {
      x: screen.x,
      y: screen.y,
      messages: [
        { role: 'agent', text: `route ${selectedEdgeObject.sourceHandle || 'output'} -> ${selectedEdgeObject.targetHandle || 'input'}` },
        { role: 'tool', text: plan?.why || 'typed payload accepted without translation' },
      ],
    }
  }, [flowInstance, nodes, selectedEdgeObject])

  const deleteNode = useCallback((nodeId) => {
    setNodes(current => current.filter(node => node.id !== nodeId))
    setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNode(current => current?.id === nodeId ? null : current)
    setSelectedEdge(null)
  }, [setEdges, setNodes])

  const setCountMatrixFile = useCallback((file) => {
    setCountFile(file)
    setNodes(current => current.map(node => node.data.type === 'count_matrix_input'
      ? { ...node, data: { ...node.data, fileName: file?.name || '' } }
      : node))
  }, [setNodes])

  const useSampleData = useCallback(async () => {
    const response = await fetch('/sample_counts.tsv')
    const text = await response.text()
    const file = fileFromText(text, 'sample_counts.tsv')
    setCountMatrixFile(file)
    setDiseaseTerm('Glioblastoma')
    return file
  }, [setCountMatrixFile])

  const resizeSupervisor = useCallback((nodeId, width, height) => {
    setNodes(current => current.map(node => node.id === nodeId
      ? {
          ...node,
          style: { ...(node.style || {}), width, height },
          data: { ...node.data, width, height },
        }
      : node))
    setSelectedNode(current => current?.id === nodeId
      ? {
          ...current,
          style: { ...(current.style || {}), width, height },
          data: { ...current.data, width, height },
        }
      : current)
  }, [setNodes])

  const displayNodes = useMemo(() => nodes.map(node => {
    const selectedCardForPorts = selectedNode && selectedNode.type === 'bioNode' ? cardFor(selectedNode.data.type) : null
    const nodeCard = node.type === 'bioNode' ? cardFor(node.data.type) : null
    const selectedOutputs = selectedCardForPorts?.outputs || []
    const selectedInputs = selectedCardForPorts?.inputs || []
    const downstreamMatch = selectedOutputs.some(sourcePort => (nodeCard?.inputs || []).some(targetPort => canConnectPorts(selectedCardForPorts.type, sourcePort, node.data.type, targetPort)))
    const upstreamMatch = !selectedOutputs.length && selectedInputs.some(targetPort => (nodeCard?.outputs || []).some(sourcePort => canConnectPorts(node.data.type, sourcePort, selectedCardForPorts.type, targetPort)))
    const edgeEndpoint = selectedEdgeObject && (node.id === selectedEdgeObject.source || node.id === selectedEdgeObject.target)
    const matchesSelected = Boolean(edgeEndpoint || (selectedCardForPorts && nodeCard && node.id !== selectedNode?.id && (downstreamMatch || upstreamMatch)))
    const dataWithActions = {
      ...node.data,
      category: nodeCard?.category,
      wip: Boolean(nodeCard?.wip),
      descriptor: nodeCard ? biologicalDescriptor(nodeCard) : 'supervisor hub',
      inputs: nodeCard?.inputs || [],
      outputs: nodeCard?.outputs || [],
      iterations: node.data.iterations || (node.data.type?.includes('critic') ? 2 : 1),
      onDelete: node.type === 'supervisorGroup' ? null : () => deleteNode(node.id),
      onResize: node.type === 'supervisorGroup' ? (width, height) => resizeSupervisor(node.id, width, height) : null,
      onCountFile: node.data.type === 'count_matrix_input' ? setCountMatrixFile : null,
      onSampleData: node.data.type === 'count_matrix_input' ? useSampleData : null,
      onDirective: node.data.type === 'study_context' ? setDirective : null,
      directive: node.data.type === 'study_context' ? directive : node.data.directive,
      onDiseaseTerm: node.data.type === 'clinical_metadata' ? setDiseaseTerm : null,
      onConditionA: node.data.type === 'clinical_metadata' ? setConditionA : null,
      onConditionB: node.data.type === 'clinical_metadata' ? setConditionB : null,
      diseaseTerm: node.data.type === 'clinical_metadata' ? diseaseTerm : node.data.diseaseTerm,
      conditionA: node.data.type === 'clinical_metadata' ? conditionA : node.data.conditionA,
      conditionB: node.data.type === 'clinical_metadata' ? conditionB : node.data.conditionB,
      portExpanded: node.id === selectedNode?.id || matchesSelected,
    }
    if (node.type === 'translator') return { ...node, zIndex: 30 }
    const zIndex = node.type === 'supervisorGroup' ? 0 : 20
    if (!connectingPort) return { ...node, zIndex, data: { ...dataWithActions, connectionMode: '' } }
    const card = node.type === 'bioNode' ? cardFor(node.data.type) : null
    const activeInputPorts = node.id === connectingPort.nodeId ? [] : (card?.inputs || [])
    const mode = activeInputPorts.length ? 'target' : 'dim'
    return {
      ...node,
      zIndex,
      data: {
        ...dataWithActions,
        activeInputPorts,
        activeOutputPorts: [],
        connectionMode: node.id === connectingPort.nodeId ? '' : mode,
      },
    }
  }), [nodes, connectingPort, conditionA, conditionB, deleteNode, directive, diseaseTerm, resizeSupervisor, selectedEdgeObject, selectedNode, setCountMatrixFile, useSampleData])
  const displayEdges = useMemo(() => edges.map(edge => ({
    ...edge,
    ...edgeVisual(edge.sourceHandle, edge.targetHandle, edge.data || {}, edge.id === selectedEdgeObject?.id),
  })), [edges, selectedEdgeObject])
  const topology = useMemo(() => toBackendTopology(nodes, edges, directive), [nodes, edges, directive])
  const runnableTopology = topology

  const isValidConnection = useCallback((connection) => {
    const source = nodes.find(node => node.id === connection.source)
    const target = nodes.find(node => node.id === connection.target)
    if (!source || !target || source.id === target.id) return false
    if (!connection.sourceHandle || !connection.targetHandle) return false
    if (source.type === 'translator' || target.type === 'translator') return true
    const sourceCard = cardFor(source.data.type)
    const targetCard = cardFor(target.data.type)
    return (sourceCard.outputs || []).includes(connection.sourceHandle) && (targetCard.inputs || []).includes(connection.targetHandle)
  }, [nodes])

  const onConnect = useCallback(params => {
    const patch = buildConnectionPatch(params, nodes)
    if (patch.nodes.length) setNodes(current => current.concat(patch.nodes))
    setEdges(eds => patch.edges.reduce((acc, edge) => addEdge(edge, acc), eds))
  }, [nodes, setEdges, setNodes])

  const clearAll = useCallback(() => {
    setNodes(INITIAL_SANDBOX.nodes)
    setEdges([])
    setSelectedNode(null)
    setSelectedEdge(null)
  }, [setEdges, setNodes])

  const saveDesign = useCallback(async () => {
    setError('')
    try {
      await saveSandboxDesign(designId, {
        name: designId,
        nodes,
        edges,
        viewport: flowInstance?.getViewport?.() || null,
        directive,
        disease_term: diseaseTerm,
        condition_a: conditionA,
        condition_b: conditionB,
      })
    } catch (err) {
      setError(err.message || 'Save failed.')
    }
  }, [conditionA, conditionB, designId, directive, diseaseTerm, edges, flowInstance, nodes])

  const loadDesign = useCallback(async () => {
    setError('')
    try {
      const design = await loadSandboxDesign(designId)
      setNodes(design.nodes || [])
      setEdges(design.edges || [])
      setDirective(design.directive || '')
      setDiseaseTerm(design.disease_term || 'Glioblastoma')
      setConditionA(design.condition_a || 'disease')
      setConditionB(design.condition_b || 'control')
      if (design.viewport && flowInstance?.setViewport) flowInstance.setViewport(design.viewport)
    } catch (err) {
      setError(err.message || 'Load failed.')
    }
  }, [designId, flowInstance, setEdges, setNodes])

  const updateSelectedNodeData = useCallback((patch) => {
    if (!selectedNode) return
    const stylePatch = selectedNode.type === 'supervisorGroup' && (patch.width || patch.height)
      ? { width: patch.width ?? selectedNode.data.width, height: patch.height ?? selectedNode.data.height }
      : {}
    setNodes(current => current.map(node => node.id === selectedNode.id ? { ...node, style: { ...(node.style || {}), ...stylePatch }, data: { ...node.data, ...patch } } : node))
    setSelectedNode(node => node ? { ...node, style: { ...(node.style || {}), ...stylePatch }, data: { ...node.data, ...patch } } : node)
  }, [selectedNode, setNodes])

  const updateSelectedEdge = useCallback((patch) => {
    if (!selectedEdgeObject) return
    setEdges(current => current.map(edge => {
      if (edge.id !== selectedEdgeObject.id) return edge
      const next = { ...edge, ...patch, data: { ...(edge.data || {}), ...(patch.data || {}) } }
      return { ...next, ...edgeVisual(next.sourceHandle, next.targetHandle, next.data || {}) }
    }))
    setSelectedEdge(edge => edge ? { ...edge, ...patch, data: { ...(edge.data || {}), ...(patch.data || {}) } } : edge)
  }, [selectedEdgeObject, setEdges])

  const onDrop = useCallback((event) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/rnagent-agent')
    if (!type) return
    const flowPoint = flowInstance?.screenToFlowPosition
      ? flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: event.clientX, y: event.clientY }
    const card = cardFor(type)
    const supervisor = nodes.find(node => node.id === 'supervisor-env')
    const supervisorRect = supervisor ? nodeRect(supervisor, nodes) : null
    const insideSupervisor = supervisorRect && pointInRect(flowPoint, supervisorRect)
    const position = { x: snap(flowPoint.x - NODE_W / 2), y: snap(flowPoint.y - NODE_H / 2) }
    setNodes(nds => nds.concat({
      id: `${type}-${Date.now()}`,
      type: 'bioNode',
      position,
      data: { type, label: card.label, config: {}, supervised: Boolean(insideSupervisor) },
    }))
  }, [flowInstance, nodes, setNodes])

  const onNodeDragStop = useCallback((_, node) => {
    const snappedNode = { ...node, position: { x: snap(node.position.x), y: snap(node.position.y) } }
    setNodes(nds => nds.map(n => n.id === node.id ? snappedNode : n))
  }, [setNodes])

  const run = async () => {
    setError('')
    if (!countFile) {
      setError('Select a count matrix node and attach a .tsv or .csv file before running.')
      return
    }
    const hasDge = runnableTopology.nodes.some(node => node.type === 'run_dge')
    const executableTopology = hasDge && reachesReport(runnableTopology) ? runnableTopology : minimalRunnableTopology(directive)
    const sampleConditions = Object.fromEntries(samples.map(r => [r.name, r.condition]))
    const formData = new FormData()
    formData.append('count_matrix', countFile)
    formData.append('disease_term', diseaseTerm)
    formData.append('condition_a', conditionA)
    formData.append('condition_b', conditionB)
    formData.append('sample_conditions', JSON.stringify(sampleConditions))
    formData.append('network_topology', JSON.stringify(executableTopology))
    formData.append('sandbox_config', JSON.stringify({ directive, max_iterations: Number(maxIterations), allowed_agents: [...new Set(executableTopology.nodes.map(n => n.type))], network_topology: executableTopology }))
    setLoading(true)
    try {
      const result = await startSandboxAnalysis(formData)
      navigate(`/results/${result.job_id}`)
    } catch (err) {
      setError(err.message || 'Run failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#0D1117]">
      <aside className="h-screen w-[16%] min-w-[180px] max-w-[220px] shrink-0 border-r border-[#30363D] bg-[#010409]">
        <div className="flex h-[36px] items-center border-b border-[#30363D] px-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-[#E6EDF3]">Node Palette</span>
        </div>
        <div className="h-[calc(100vh-36px)] overflow-y-auto">
          {BANK_GROUPS.map(group => {
            const cards = group.types
              .map(type => AGENT_CARDS.find(card => card.type === type))
              .filter(card => card && card.type !== 'supervisor')
            if (!cards.length) return null
            return (
              <section key={group.title}>
                <div className="flex h-6 items-center px-2 font-sans text-[10px] font-bold uppercase tracking-wider text-[#8B949E]">
                  {group.title}
                </div>
                {cards.map(card => (
                  <div
                    key={card.type}
                    draggable
                    onDragStart={event => event.dataTransfer.setData('application/rnagent-agent', card.type)}
                    className="flex h-6 cursor-grab items-center gap-2 px-3 font-sans text-[11px] text-[#E6EDF3] hover:bg-[#1C2128] active:cursor-grabbing"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: categoryColor(card.category) }} />
                    <span className="truncate">{card.label}</span>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      </aside>

      <main className="flex-1 relative">
        <header className="absolute left-0 right-0 top-0 z-30 flex h-[36px] items-center justify-between border-b border-[#30363D] bg-[#0D1117] px-2">
          <div className="flex items-center gap-1">
            <input value={designId} onChange={event => setDesignId(event.target.value)} className="h-6 w-28 rounded-sm border border-[#30363D] bg-[#0D1117] px-2 font-mono text-[10px] text-[#8B949E] outline-none focus:text-[#E6EDF3]" />
            <button type="button" onClick={saveDesign} className="inline-flex h-6 items-center gap-1 rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]"><Save size={12} /> Save</button>
            <button type="button" onClick={loadDesign} className="h-6 rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]">Load</button>
            <Link to="/tools" className="h-6 rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]">Docs</Link>
          </div>
          <div className="flex items-center gap-1">
            {error ? <span className="max-w-[360px] truncate font-mono text-[10px] text-red-300">{error}</span> : null}
            <button type="button" onClick={run} disabled={loading} className="inline-flex h-6 items-center gap-1 rounded-sm border border-[#30363D] bg-[#1C2128] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6] disabled:opacity-60"><Play size={12} fill="currentColor" /> {loading ? 'Starting' : 'Run'}</button>
            <button type="button" onClick={clearAll} className="h-6 rounded-sm border border-[#30363D] bg-[#1C2128] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]">Clear</button>
            <button type="button" onClick={() => navigate('/')} className="inline-flex h-6 items-center gap-1 rounded-sm border border-[#30363D] bg-[#1C2128] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]"><ArrowLeft size={12} /> Exit</button>
          </div>
        </header>

        <div className="absolute bottom-0 left-0 right-0 top-[36px]">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'smoothstep', style: { strokeWidth: 1.5 } }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={(instance) => {
              setFlowInstance(instance)
              requestAnimationFrame(() => instance.fitView({ padding: 0.18, duration: 0 }))
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onConnectStart={(_, params) => {
              const source = nodes.find(node => node.id === params.nodeId)
              setConnectingPort({ nodeId: params.nodeId, nodeType: source?.data.type, port: params.handleId })
            }}
            onConnectEnd={() => setConnectingPort(null)}
            onDrop={onDrop}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
            onNodeClick={(_, node) => { setSelectedNode(node); setSelectedEdge(null) }}
            onEdgeClick={(_, edge) => { setSelectedEdge(edge); setSelectedNode(null) }}
            onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null) }}
            onNodeDragStop={onNodeDragStop}
            minZoom={0.25}
            maxZoom={1.2}
            defaultViewport={{ x: -80, y: 112, zoom: 0.78 }}
            snapToGrid
            snapGrid={[SNAP, SNAP]}
            deleteKeyCode={['Backspace', 'Delete']}
            className="rnagent-flow"
          >
            <Background color="rgba(100,116,139,0.35)" gap={24} size={1} />
          </ReactFlow>
          {edgeInspector ? <EdgeChatInspector x={edgeInspector.x} y={edgeInspector.y} messages={edgeInspector.messages} /> : null}
        </div>
      </main>

      <aside className="h-screen w-[20%] min-w-[220px] max-w-[280px] shrink-0 border-l border-[#30363D] bg-[#010409]">
        <div className="flex h-[36px] items-center justify-between border-b border-[#30363D] px-3">
          <span className="truncate font-sans text-[12px] font-semibold text-[#E6EDF3]">
            {selectedEdgeObject ? 'Connection' : selectedCard?.label || 'Inspector'}
          </span>
          {(selectedNode || selectedEdgeObject) ? (
            <button type="button" onClick={() => { setSelectedNode(null); setSelectedEdge(null) }} className="grid h-6 w-6 place-items-center rounded-sm border border-[#30363D] text-[#8B949E] hover:text-[#3B82F6]">
              <X size={12} />
            </button>
          ) : null}
        </div>

        <div className="h-[calc(100vh-36px)] overflow-y-auto px-2 py-1">
          {selectedEdgeObject ? (
            <div>
              <p className="mt-2 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Route</p>
              <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                <span className="font-sans text-[11px] text-[#E6EDF3]">Source</span>
                <span className="font-mono text-[10px] text-[#3B82F6]">{selectedEdgeObject.source}</span>
              </div>
              <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                <span className="font-sans text-[11px] text-[#E6EDF3]">Target</span>
                <span className="font-mono text-[10px] text-[#3B82F6]">{selectedEdgeObject.target}</span>
              </div>

              <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Ports</p>
              <label className="block border-b border-[#30363D]/50 py-1">
                <span className="block font-sans text-[11px] text-[#E6EDF3]">Source output</span>
                <select
                  value={selectedEdgeObject.sourceHandle || ''}
                  onChange={event => {
                    const value = event.target.value
                    const visual = edgeVisual(value, selectedEdgeObject.targetHandle, selectedEdgeObject.data || {}, true)
                    updateSelectedEdge({ sourceHandle: value, data: visual.data, style: visual.style })
                  }}
                  className="mt-1 h-6 w-full rounded-sm border border-[#30363D] bg-[#0D1117] px-2 font-mono text-[10px] text-[#8B949E]"
                >
                  {(cardFor(nodes.find(node => node.id === selectedEdgeObject.source)?.data.type).outputs || []).map(port => (
                    <option key={port} value={port}>{PORT_LABELS[port] || port}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b border-[#30363D]/50 py-1">
                <span className="block font-sans text-[11px] text-[#E6EDF3]">Target input</span>
                <select
                  value={selectedEdgeObject.targetHandle || ''}
                  onChange={event => {
                    const value = event.target.value
                    const visual = edgeVisual(selectedEdgeObject.sourceHandle, value, selectedEdgeObject.data || {}, true)
                    updateSelectedEdge({ targetHandle: value, data: visual.data, style: visual.style })
                  }}
                  className="mt-1 h-6 w-full rounded-sm border border-[#30363D] bg-[#0D1117] px-2 font-mono text-[10px] text-[#8B949E]"
                >
                  {(cardFor(nodes.find(node => node.id === selectedEdgeObject.target)?.data.type).inputs || []).map(port => (
                    <option key={port} value={port}>{PORT_LABELS[port] || port}</option>
                  ))}
                </select>
              </label>

              <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Translator</p>
              <div className="border-b border-[#30363D]/50 py-1">
                <p className="font-mono text-[10px] text-[#3B82F6]">{selectedEdgeObject.data?.translatorPlan?.model || 'no translation'}</p>
                <p className="mt-1 line-clamp-3 font-sans text-[11px] leading-snug text-[#8B949E]">{selectedEdgeObject.data?.translatorPlan?.why || 'Matching payload types do not need translation.'}</p>
              </div>
              <button type="button" onClick={() => { setEdges(current => current.filter(edge => edge.id !== selectedEdgeObject.id)); setSelectedEdge(null) }} className="mt-2 h-6 w-full rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] uppercase tracking-wide text-red-300 hover:bg-[#1C2128]">
                Delete connection
              </button>
            </div>
          ) : selectedNode && selectedCard ? (
            <div>
              <details className="border-b border-[#30363D]/50 py-1">
                <summary className="cursor-pointer font-sans text-[10px] uppercase text-[#7D8590]">Documentation</summary>
                <p className="mt-1 line-clamp-3 font-sans text-[11px] leading-snug text-[#8B949E]">{selectedCard.doc || biologicalDescriptor(selectedCard)}</p>
              </details>

              {selectedNode.type === 'supervisorGroup' ? (
                <>
                  <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Supervisor</p>
                  <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                    <span className="font-sans text-[11px] text-[#E6EDF3]">Width</span>
                    <input type="number" min={SUPERVISOR_MIN_W} value={selectedNode.data.width || SUPERVISOR_MIN_W} onChange={event => updateSelectedNodeData({ width: Number(event.target.value) })} className="h-5 w-16 rounded-sm border border-[#30363D] bg-[#0D1117] px-1 font-mono text-[10px] text-[#3B82F6]" />
                  </div>
                  <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                    <span className="font-sans text-[11px] text-[#E6EDF3]">Height</span>
                    <input type="number" min={SUPERVISOR_MIN_H} value={selectedNode.data.height || SUPERVISOR_MIN_H} onChange={event => updateSelectedNodeData({ height: Number(event.target.value) })} className="h-5 w-16 rounded-sm border border-[#30363D] bg-[#0D1117] px-1 font-mono text-[10px] text-[#3B82F6]" />
                  </div>
                </>
              ) : null}

              <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Inputs</p>
              {(selectedCard.inputs || []).length ? selectedCard.inputs.map(port => {
                const [kind, color] = portSemanticType(port)
                return (
                  <div key={port} className="flex justify-between border-b border-[#30363D]/50 py-1">
                    <span className="font-sans text-[11px] text-[#E6EDF3]">{PORT_LABELS[port] || port}</span>
                    <span className="font-mono text-[10px]" style={{ color }}>{kind}</span>
                  </div>
                )
              }) : (
                <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                  <span className="font-sans text-[11px] text-[#E6EDF3]">Entry</span>
                  <span className="font-mono text-[10px] text-[#3B82F6]">source</span>
                </div>
              )}

              <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">Outputs</p>
              {(selectedCard.outputs || []).length ? selectedCard.outputs.map(port => {
                const [kind, color] = portSemanticType(port)
                return (
                  <div key={port} className="flex justify-between border-b border-[#30363D]/50 py-1">
                    <span className="font-sans text-[11px] text-[#E6EDF3]">{PORT_LABELS[port] || port}</span>
                    <span className="font-mono text-[10px]" style={{ color }}>{kind}</span>
                  </div>
                )
              }) : (
                <div className="flex justify-between border-b border-[#30363D]/50 py-1">
                  <span className="font-sans text-[11px] text-[#E6EDF3]">Terminal</span>
                  <span className="font-mono text-[10px] text-[#FBBF24]">sink</span>
                </div>
              )}

              <p className="mt-4 mb-1 font-sans text-[10px] uppercase text-[#7D8590]">AgentState</p>
              <pre className="overflow-auto border-b border-[#30363D]/50 py-1 font-mono text-[10px] leading-tight text-[#8B949E]">{`node_outputs["${selectedNode.id}"] = {
  "type": "${selectedCard.type}",
  "artifact_id": "...",
  "ports": ${JSON.stringify(selectedCard.outputs || [])}
}`}</pre>
            </div>
          ) : (
            <p className="px-1 py-2 font-sans text-[11px] leading-snug text-[#8B949E]">Select a node or tether to inspect schema, routing, and payload translation.</p>
          )}
        </div>
      </aside>
    </div>
  )
}

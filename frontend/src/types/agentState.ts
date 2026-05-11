export type NodeStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'complete'
  | 'context_loaded'
  | 'dge_complete'
  | 'pathway_complete'
  | 'ppi_complete'
  | 'rag_complete'
  | 'annotation_complete'
  | 'depmap_complete'
  | 'ot_complete'
  | 'clinical_trials_complete'
  | 'pathway_crosstalk_complete'
  | 'alphafold_lookup_complete'
  | 'awaiting_approval'
  | 'approval_resolved'
  | 'failed'
  | string

export type AgentPort =
  | 'counts'
  | 'metadata'
  | 'directive'
  | 'degs'
  | 'genes'
  | 'signature'
  | 'regulator_activity'
  | 'essentiality_score'
  | 'regulon_program'
  | 'spatial_context'
  | 'perturbation_match'
  | 'clinical_signal'
  | 'network_context'
  | 'protein'
  | 'structure'
  | 'structure_signal'
  | 'pocket'
  | 'smiles'
  | 'ligand'
  | 'chemistry_profile'
  | 'docking'
  | 'literature_support'
  | 'wetlab_design'
  | 'translation_brief'
  | 'decision'
  | 'report'

export interface ArtifactPointer {
  artifact_id: string
  uri: string
  kind: string
  summary: string
  bytes?: number | null
  metadata: Record<string, unknown>
}

export interface NetworkNode {
  id: string
  type: string
  label?: string
  position?: { x: number; y: number }
  config?: Record<string, unknown>
}

export interface NetworkEdge {
  id: string
  source: string
  target: string
  sourceHandle?: AgentPort | string
  targetHandle?: AgentPort | string
  data?: {
    edgeType?: 'deterministic' | 'agentic' | 'conditional' | 'join' | 'approval' | 'reject'
    translator?: boolean
    sourcePort?: AgentPort | string
    targetPort?: AgentPort | string
    translatorPlan?: {
      model: string
      why: string
    }
    reverse?: boolean
    criticLoop?: boolean
  }
}

export interface NetworkTopology {
  version: number
  name: string
  directive?: string
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}

export interface NodeOutput {
  node_type?: string
  summary?: string
  keys?: string[]
  data?: Record<string, unknown>
  artifact_refs?: string[]
}

export interface ApprovalRequest {
  node_id: string
  status: 'awaiting_user_approval' | 'resolved' | string
  summary?: string
  decision?: 'approved' | 'rejected'
  options?: string[]
}

export interface PendingTask {
  task_id: string
  node_id: string
  node_type: string
  status: string
  queue?: string
  summary?: string
  created_at?: number
  completed_at?: number
}

export interface ProvenanceEvent {
  node_id: string
  node_type: string
  input_summary: Record<string, unknown>
  output_summary: string
  temperature?: number | null
  prompt: string
  raw_output: string
  timestamp: number
  hash: string
}

export interface NetworkCheckpoint {
  status?: string
  progress: number
  network_topology: NetworkTopology
  node_outputs: Record<string, NodeOutput>
  node_status: Record<string, NodeStatus>
  artifact_registry: Record<string, ArtifactPointer>
  pending_tasks: Record<string, PendingTask>
  approval_requests: Record<string, ApprovalRequest>
  provenance_ledger: ProvenanceEvent[]
  routing_history: Array<Record<string, unknown>>
  execution_events: Array<Record<string, unknown>>
  prompt_payloads: Array<Record<string, unknown>>
  errors: string[]
}

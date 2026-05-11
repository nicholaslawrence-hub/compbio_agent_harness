const STATUS_COLOR = {
  queued: '#8B949E',
  running: '#3B82F6',
  complete: '#10B981',
  completed: '#10B981',
  failed: '#F97316',
}

function flattenNodes(topology) {
  const nodes = topology?.nodes?.length ? topology.nodes : [
    { id: 'run_dge', type: 'run_dge', label: 'DGE' },
    { id: 'supervisor', type: 'supervisor', label: 'Supervisor' },
    { id: 'enrich_ppi', type: 'enrich_ppi', label: 'PPI' },
    { id: 'literature_rag', type: 'literature_rag', label: 'Literature' },
    { id: 'drug_annotation', type: 'drug_annotation', label: 'Drug' },
    { id: 'report', type: 'report', label: 'Report' },
  ]
  return nodes
    .filter(node => node.type !== 'supervisorGroup')
    .slice(0, 12)
    .map(node => ({
      id: node.id,
      type: node.data?.type || node.type,
      label: node.data?.label || node.label || node.id,
    }))
}

function eventKey(event) {
  return event?.node_id || event?.node_type || event?.step || ''
}

export default function NetworkExecutionVisualizer({
  progress = 0,
  status = '',
  topology,
  executionEvents = [],
  promptPayloads = [],
}) {
  const nodes = flattenNodes(topology)
  const activeEvent = executionEvents?.[executionEvents.length - 1]
  const active = eventKey(activeEvent) || status
  const seen = new Set((executionEvents || []).map(eventKey))
  const latestPayload = promptPayloads?.[promptPayloads.length - 1]
  const clamped = Math.min(100, Math.max(0, Number(progress) || 0))

  return (
    <section className="border border-[#30363D] bg-[#0D1117]">
      <div className="flex h-[36px] items-center justify-between border-b border-[#30363D] px-2">
        <span className="font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3]">Execution Trace</span>
        <span className="font-mono text-[10px] text-[#8B949E]">{clamped}%</span>
      </div>

      <div className="px-2 py-1">
        <div className="h-1 border border-[#30363D] bg-[#010409]">
          <div className="h-full bg-[#3B82F6] transition-[width] duration-500" style={{ width: `${clamped}%` }} />
        </div>
      </div>

      <div className="relative overflow-hidden border-y border-[#30363D] bg-[#010409] px-2 py-2">
        <div className="absolute left-0 top-1/2 h-px w-full bg-[#30363D]" />
        <div className="rnagent-trace-packet absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#10B981]" />
        <div className="relative grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, nodes.length)}, minmax(0, 1fr))` }}>
          {nodes.map(node => {
            const nodeActive = active === node.id || active === node.type
            const nodeSeen = seen.has(node.id) || seen.has(node.type)
            const color = nodeActive ? STATUS_COLOR.running : nodeSeen ? STATUS_COLOR.complete : STATUS_COLOR.queued
            return (
              <div key={node.id} className="min-w-0 bg-[#010409] px-1">
                <div className="mx-auto h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <p className="mt-1 truncate text-center font-mono text-[10px] text-[#8B949E]">{node.label}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-[70px_minmax(0,1fr)] border-b border-[#30363D] px-2 py-1">
        <span className="font-sans text-[10px] uppercase text-[#7D8590]">status</span>
        <span className="truncate font-mono text-[10px] text-[#E6EDF3]">{status || 'queued'}</span>
      </div>
      <div className="grid grid-cols-[70px_minmax(0,1fr)] px-2 py-1">
        <span className="font-sans text-[10px] uppercase text-[#7D8590]">payload</span>
        <span className="truncate font-mono text-[10px] text-[#8B949E]">
          {latestPayload?.summary || latestPayload?.node_type || latestPayload?.node_id || 'waiting for node output'}
        </span>
      </div>
    </section>
  )
}

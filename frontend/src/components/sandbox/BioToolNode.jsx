import { memo } from 'react'
import { Trash2 } from 'lucide-react'
import NodeSocket from './NodeSocket'

const PORT_TYPE_BY_ID = {
  counts: 'matrix',
  metadata: 'context',
  directive: 'context',
  degs: 'gene_set',
  genes: 'gene_set',
  signature: 'gene_set',
  regulator_activity: 'gene_set',
  essentiality_score: 'gene_set',
  regulon_program: 'gene_set',
  spatial_context: 'context',
  perturbation_match: 'molecule',
  clinical_signal: 'context',
  network_context: 'gene_set',
  protein: 'structure',
  structure: 'structure',
  structure_signal: 'structure',
  pocket: 'structure',
  smiles: 'molecule',
  ligand: 'molecule',
  chemistry_profile: 'molecule',
  docking: 'molecule',
  literature_support: 'context',
  wetlab_design: 'control',
  translation_brief: 'context',
  decision: 'control',
  report: 'control',
}

function normalizeSocket(port) {
  if (typeof port !== 'string') return port
  return {
    id: port,
    label: port,
    dataType: PORT_TYPE_BY_ID[port] || 'context',
  }
}

function BioToolNode({ data, selected }) {
  const iterations = Math.max(1, Number(data.iterations || 1))
  const state = data.execState || 'queued'
  const stacked = iterations > 1
  const stateColor = state === 'running' ? 'text-[#3B82F6]' : state === 'completed' ? 'text-[#E6EDF3]' : 'text-[#8B949E]'
  const inputs = (data.inputs || []).map(normalizeSocket)
  const outputs = (data.outputs || []).map(normalizeSocket)
  const activeInputs = new Set(data.activeInputPorts || [])
  const activeOutputs = new Set(data.activeOutputPorts || [])

  return (
    <div
      className={[
        'relative min-w-[220px] rounded-sm border bg-[#1C2128]',
        data.connectionMode === 'dim' ? 'opacity-25' : '',
        data.connectionMode === 'target' ? 'border-[#10B981]' : selected ? 'border-[#64748B]' : 'border-[#30363D]',
        stacked ? 'before:absolute before:-top-1 before:-left-1 before:-z-10 before:h-full before:w-full before:rounded-sm before:border before:border-[#30363D] before:bg-[#1C2128] after:absolute after:-top-2 after:-left-2 after:-z-20 after:h-full after:w-full after:rounded-sm after:border after:border-[#30363D] after:bg-[#1C2128]' : '',
      ].join(' ')}
    >
      {selected && data.onDelete ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            data.onDelete?.()
          }}
          className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-sm border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] hover:text-[#3B82F6]"
          aria-label="Delete node"
        >
          <Trash2 size={12} />
        </button>
      ) : null}
      <div className="flex items-center justify-between gap-2 rounded-t-sm border-b border-[#30363D] bg-[#161B22] px-2 py-1 pr-7">
        <div className="flex min-w-0 items-center gap-1">
          <p className="truncate font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3]">{data.label}</p>
          {data.wip ? (
            <span className="rounded-sm border border-[#F59E0B] px-1 font-mono text-[9px] uppercase tracking-wide text-[#F59E0B]" title="Work in progress — adapter or stub, may not be fully functional">
              WIP
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {stacked ? <span className="font-mono text-[10px] text-[#8B949E]">[ ITER: {iterations} ]</span> : null}
          <span className={`font-mono text-[10px] ${stateColor}`}>{state}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 px-2 py-1">
        <div className="min-w-0">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-tight text-[#8B949E]">inputs</p>
          <div className="space-y-1">
            {inputs.length ? inputs.map(socket => <NodeSocket key={`in-${socket.id}`} socket={socket} direction="input" active={activeInputs.has(socket.id)} />) : <span className="font-mono text-[10px] text-[#8B949E]">entry</span>}
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-right font-mono text-[10px] uppercase tracking-tight text-[#8B949E]">outputs</p>
          <div className="space-y-1">
            {outputs.length ? outputs.map(socket => <NodeSocket key={`out-${socket.id}`} socket={socket} direction="output" active={activeOutputs.has(socket.id)} />) : <span className="block text-right font-mono text-[10px] text-[#8B949E]">terminal</span>}
          </div>
        </div>
      </div>
      <div className="border-t border-[#30363D] px-2 py-1">
        <span className="block truncate font-mono text-[10px] text-[#8B949E]">{data.fileName || data.descriptor || data.category || 'tool'}</span>
      </div>
      {selected && data.type === 'count_matrix_input' ? (
        <div className="flex gap-1 border-t border-[#30363D] px-2 py-1">
          <label className="rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]">
            TSV
            <input type="file" accept=".tsv,.csv" onChange={(event) => data.onCountFile?.(event.target.files?.[0] || null)} className="hidden" />
          </label>
          <button type="button" onClick={() => data.onSampleData?.()} className="rounded-sm border border-[#30363D] px-2 py-1 font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3] hover:text-[#3B82F6]">
            Sample
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default memo(BioToolNode)

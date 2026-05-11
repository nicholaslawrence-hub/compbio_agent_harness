import { Handle, Position } from '@xyflow/react'

export type NodeSocketType =
  | 'matrix'
  | 'gene_set'
  | 'structure'
  | 'molecule'
  | 'context'
  | 'control'

export interface NodeSocketData {
  id: string
  label: string
  dataType: NodeSocketType
}

export const SOCKET_COLORS: Record<NodeSocketType, string> = {
  matrix: '#3B82F6',
  gene_set: '#10B981',
  structure: '#8B5CF6',
  molecule: '#F97316',
  context: '#9CA3AF',
  control: '#FBBF24',
}

export type NodeSocketProps = {
  socket: NodeSocketData
  direction: 'input' | 'output'
  active?: boolean
}

export default function NodeSocket({ socket, direction, active = false }: NodeSocketProps) {
  const isInput = direction === 'input'
  const color = active ? '#10B981' : SOCKET_COLORS[socket.dataType]

  return (
    <div className={`relative flex h-4 items-center gap-1 ${active ? 'bg-[#0f1f19]' : ''} ${isInput ? 'justify-start pl-2' : 'justify-end pr-2'}`}>
      {isInput ? (
        <Handle
          id={socket.id}
          type="target"
          position={Position.Left}
          title={`${socket.label}: ${socket.dataType}`}
          className="!h-2 !w-2 !rounded-full !border-0"
          style={{ left: 0, top: '50%', backgroundColor: color, transform: 'translate(-50%, -50%)' }}
        />
      ) : null}
      <span className={`truncate font-mono text-[10px] tracking-tight ${active ? 'text-[#10B981]' : 'text-[#8B949E]'}`}>{socket.label}</span>
      {!isInput ? (
        <Handle
          id={socket.id}
          type="source"
          position={Position.Right}
          title={`${socket.label}: ${socket.dataType}`}
          className="!h-2 !w-2 !rounded-full !border-0"
          style={{ right: 0, top: '50%', backgroundColor: color, transform: 'translate(50%, -50%)' }}
        />
      ) : null}
    </div>
  )
}

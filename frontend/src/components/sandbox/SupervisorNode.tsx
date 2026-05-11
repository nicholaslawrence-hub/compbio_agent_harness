import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

export type SupervisorNodeData = {
  label?: string
  status?: 'idle' | 'running'
}

function SupervisorNode({ data, selected }: NodeProps<SupervisorNodeData>) {
  return (
    <div className={`grid h-[132px] w-[132px] place-items-center border-2 bg-[#1C2128] [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] ${selected ? 'border-[#64748B]' : 'border-[#30363D]'}`}>
      <Handle id="hub-in" type="target" position={Position.Left} className="!h-2 !w-2 !rounded-sm !border !border-[#30363D] !bg-[#0D1117]" />
      <Handle id="hub-out" type="source" position={Position.Right} className="!h-2 !w-2 !rounded-sm !border !border-[#30363D] !bg-[#0D1117]" />
      <div className="px-2 text-center">
        <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-[#E6EDF3]">{data.label || 'Supervisor'}</p>
        <p className="mt-1 font-mono text-[10px] text-[#8B949E]">{data.status || 'router'}</p>
      </div>
    </div>
  )
}

export default memo(SupervisorNode)

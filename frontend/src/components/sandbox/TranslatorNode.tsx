import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles } from 'lucide-react'
import { SOCKET_COLORS, type NodeSocketType } from './NodeSocket'

export type TranslatorNodeData = {
  sourceType: NodeSocketType
  targetType: NodeSocketType
  promptPreview?: string
}

function TranslatorNode({ data }: NodeProps<TranslatorNodeData>) {
  const sourceColor = SOCKET_COLORS[data.sourceType] || SOCKET_COLORS.context
  const targetColor = SOCKET_COLORS[data.targetType] || SOCKET_COLORS.context

  return (
    <div className="w-[180px] rounded-md bg-gradient-to-r from-[var(--source-color)] to-[var(--target-color)] p-[1px]" style={{ '--source-color': sourceColor, '--target-color': targetColor }}>
      <div className="relative rounded-md bg-[#1C2128] px-2 py-1">
        <Handle
          id="translator-in"
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !rounded-full !border-0"
          style={{ left: 0, top: '50%', backgroundColor: sourceColor, transform: 'translate(-50%, -50%)' }}
        />
        <Handle
          id="translator-out"
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !rounded-full !border-0"
          style={{ right: 0, top: '50%', backgroundColor: targetColor, transform: 'translate(50%, -50%)' }}
        />
        <div className="flex items-center gap-1">
          <Sparkles size={10} className="text-[#8B949E]" />
          <span className="font-sans text-[9px] font-bold uppercase tracking-widest text-[#8B949E]">LLM Translator</span>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] italic text-[#E6EDF3]">
          {data.promptPreview || `${data.sourceType} -> ${data.targetType}`}
        </p>
      </div>
    </div>
  )
}

export default memo(TranslatorNode)

import { BaseEdge } from '@xyflow/react'

export default function OpticTetherEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, data, selected } = props
  const edgePath = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
  const running = data?.status === 'running'
  const reverse = data?.flowDirection === 'tool-to-agent'
  const translatorEdge = Boolean(data?.translatorEdge)

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#3B82F6' : data?.color || '#30363D',
          strokeWidth: 2,
          strokeOpacity: translatorEdge ? 0.6 : 1,
          strokeDasharray: running || translatorEdge ? '4 4' : undefined,
          animation: running ? `${reverse ? 'dashdraw-reverse' : 'dashdraw'} 0.55s linear infinite` : undefined,
        }}
      />
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
    </>
  )
}

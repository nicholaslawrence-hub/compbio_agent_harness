export type EdgeChatMessage = {
  role: 'agent' | 'tool'
  text: string
}

export type EdgeChatInspectorProps = {
  x: number
  y: number
  messages: EdgeChatMessage[]
}

export default function EdgeChatInspector({ x, y, messages }: EdgeChatInspectorProps) {
  return (
    <div
      className="pointer-events-auto absolute z-50 max-h-[250px] w-[300px] overflow-y-auto rounded-sm border border-[#30363D] bg-[#161B22] px-2 py-1"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
    >
      {messages.map((message, index) => (
        <div key={`${message.role}-${index}`} className={`mb-1 flex ${message.role === 'agent' ? 'justify-end' : 'justify-start'}`}>
          <div className={`${message.role === 'agent' ? 'bg-[#1F2937]' : 'border border-[#30363D] bg-transparent'} max-w-[260px] rounded-sm p-2 text-left font-mono text-[10px] leading-4 text-[#E6EDF3]`}>
            {message.text}
          </div>
        </div>
      ))}
    </div>
  )
}

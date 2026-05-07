import { useRef } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { Download } from 'lucide-react'

function getColor(lfc, padj) {
  if (padj < 0.05 && lfc > 1) return '#22c55e'
  if (padj < 0.05 && lfc < -1) return '#ef4444'
  return '#374151'
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="font-bold text-white">{d.gene}</p>
      <p className="text-gray-400">log2FC: <span className="text-white">{d.x?.toFixed(3)}</span></p>
      <p className="text-gray-400">-log10(padj): <span className="text-white">{d.y?.toFixed(3)}</span></p>
    </div>
  )
}

function getSVGString(containerEl) {
  const svg = containerEl?.querySelector('svg')
  if (!svg) return null
  // Inline a dark background so the export looks right outside the app
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.insertAdjacentHTML('afterbegin', '<rect width="100%" height="100%" fill="#030712"/>')
  return new XMLSerializer().serializeToString(clone)
}

function downloadSVG(containerEl) {
  const str = getSVGString(containerEl)
  if (!str) return
  const blob = new Blob([str], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'volcano_plot.svg'
  a.click()
  URL.revokeObjectURL(url)
}

function downloadPNG(containerEl) {
  const str = getSVGString(containerEl)
  if (!str) return
  const svg = containerEl.querySelector('svg')
  const scale = 2  // 2× for high-res
  const w = svg.clientWidth  || 800
  const h = svg.clientHeight || 300
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width  = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'volcano_plot.png'
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(str)))
}

export default function VolcanoPlot({ results = [] }) {
  const containerRef = useRef(null)

  if (!results.length) return null

  const data = results.map(r => ({
    x: Number(r.log2FoldChange ?? 0),
    y: -Math.log10(Math.max(Number(r.padj ?? 1), 1e-300)),
    gene: r.gene,
    padj: Number(r.padj ?? 1),
    fill: getColor(Number(r.log2FoldChange ?? 0), Number(r.padj ?? 1)),
  }))

  return (
    <div>
      <div className="flex justify-end gap-2 mb-2">
        <button
          onClick={() => downloadSVG(containerRef.current)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg transition-colors duration-150"
        >
          <Download size={12} /> SVG
        </button>
        <button
          onClick={() => downloadPNG(containerRef.current)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg transition-colors duration-150"
        >
          <Download size={12} /> PNG (2×)
        </button>
      </div>
      <div ref={containerRef} className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              name="log2FC"
              label={{ value: 'log2 Fold Change', position: 'insideBottom', offset: -10, fill: '#6b7280', fontSize: 11 }}
              tick={{ fill: '#6b7280', fontSize: 10 }}
            />
            <YAxis
              dataKey="y"
              name="-log10(padj)"
              label={{ value: '-log10(padj)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
              tick={{ fill: '#6b7280', fontSize: 10 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine x={1}  stroke="#374151" strokeDasharray="4 2" />
            <ReferenceLine x={-1} stroke="#374151" strokeDasharray="4 2" />
            <ReferenceLine y={-Math.log10(0.05)} stroke="#374151" strokeDasharray="4 2" />
            <Scatter data={data} fill="#374151">
              {data.map((d, i) => (
                <circle key={i} cx={0} cy={0} r={4} fill={d.fill} fillOpacity={0.8} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

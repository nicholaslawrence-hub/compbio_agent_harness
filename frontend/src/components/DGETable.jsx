import { useState } from 'react'
import { ArrowUpDown, Download } from 'lucide-react'

function exportCSV(rows) {
  const header = 'gene,log2FoldChange,pvalue,padj'
  const lines = rows.map(r =>
    [r.gene, r.log2FoldChange, r.pvalue ?? '', r.padj].join(',')
  )
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'dge_results.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function DGETable({ results = [] }) {
  const [sortField, setSortField] = useState('log2FoldChange')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = [...results].sort((a, b) => {
    const va = a[sortField] ?? 0
    const vb = b[sortField] ?? 0
    return sortDir === 'asc' ? va - vb : vb - va
  })

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const Th = ({ field, children }) => (
    <th
      onClick={() => handleSort(field)}
      className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-200 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {children}
        <ArrowUpDown size={11} className={sortField === field ? 'text-indigo-400' : 'text-slate-700'} />
      </span>
    </th>
  )

  if (!results.length) return <p className="text-sm text-slate-500 text-center py-8">No DGE results yet.</p>

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => exportCSV(sorted)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg transition-colors duration-150"
        >
          <Download size={12} /> Export CSV
        </button>
      </div>
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/80">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Gene</th>
            <Th field="log2FoldChange">log2FC</Th>
            <Th field="pvalue">p-value</Th>
            <Th field="padj">adj. p-value</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {sorted.map((row, i) => {
            const lfc = Number(row.log2FoldChange ?? 0)
            const padj = Number(row.padj ?? 1)
            const isSignificant = padj < 0.05 && Math.abs(lfc) > 1
            return (
              <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                <td className="px-4 py-2.5 font-mono font-semibold">
                  <a
                    href={`/gene/${row.gene}`}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    {row.gene}
                  </a>
                </td>
                <td className="px-4 py-2.5">
                  <span className={lfc > 0 ? 'text-green-400' : 'text-red-400'}>
                    {lfc > 0 ? '+' : ''}{lfc.toFixed(3)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                  {Number(row.pvalue ?? 1).toExponential(2)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`font-mono text-xs ${isSignificant ? 'text-indigo-400' : 'text-slate-500'}`}>
                    {padj.toExponential(2)}
                  </span>
                  {isSignificant && <span className="ml-2 text-xs text-indigo-600">*</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </div>
  )
}

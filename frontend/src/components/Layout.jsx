import { Outlet, NavLink } from 'react-router-dom'
import { Dna, Search, FlaskConical } from 'lucide-react'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pharma-600/20 border border-pharma-600/30 flex items-center justify-center">
              <Dna size={20} className="text-pharma-400" />
            </div>
            <div>
              <span className="font-bold text-white text-lg tracking-tight">PharmaGPT</span>
              <span className="text-pharma-500 font-bold text-lg">-Agent</span>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-pharma-600/20 text-pharma-400' : 'text-gray-400 hover:text-gray-200'}`
              }
            >
              <FlaskConical size={15} /> Analyze
            </NavLink>
            <NavLink
              to="/gene/EGFR"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-pharma-600/20 text-pharma-400' : 'text-gray-400 hover:text-gray-200'}`
              }
            >
              <Search size={15} /> Gene Lookup
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-gray-800 py-4 text-center text-xs text-gray-600">
        PharmaGPT-Agent — Multi-Omics Drug Target Discovery
      </footer>
    </div>
  )
}

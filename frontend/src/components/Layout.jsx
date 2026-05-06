import { Outlet, NavLink } from 'react-router-dom'
import { Search, FlaskConical } from 'lucide-react'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-slate-100 tracking-tight">
            PharmaGPT <span className="text-indigo-400 font-normal">/ Agent</span>
          </span>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${isActive ? 'text-slate-100 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`
              }
            >
              <FlaskConical size={13} /> Analyze
            </NavLink>
            <NavLink
              to="/gene/EGFR"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${isActive ? 'text-slate-100 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`
              }
            >
              <Search size={13} /> Gene Lookup
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}

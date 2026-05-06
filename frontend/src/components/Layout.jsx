import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Search, FlaskConical, Dna } from 'lucide-react'

export default function Layout() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-slate-950">
        {/* amber hairline accent */}
        <div className="h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <Dna size={18} className="text-amber-400" strokeWidth={1.5} />
            <span className="font-semibold text-slate-100 tracking-tight">
              Pharma<span className="text-amber-400">GPT</span>
              <span className="text-slate-600 font-light ml-1 text-sm">/agent</span>
            </span>
          </div>

          {/* Nav */}
          <nav className="flex items-center">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `relative flex items-center gap-2 px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <FlaskConical size={13} strokeWidth={isActive ? 2 : 1.5} />
                  Analyze
                  {isActive && (
                    <span className="absolute bottom-0 left-4 right-4 h-px bg-amber-400/70 rounded-full" />
                  )}
                </>
              )}
            </NavLink>
            <NavLink
              to="/gene/EGFR"
              className={({ isActive }) =>
                `relative flex items-center gap-2 px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Search size={13} strokeWidth={isActive ? 2 : 1.5} />
                  Gene Lookup
                  {isActive && (
                    <span className="absolute bottom-0 left-4 right-4 h-px bg-amber-400/70 rounded-full" />
                  )}
                </>
              )}
            </NavLink>
          </nav>
        </div>
        {/* bottom separator */}
        <div className="h-px bg-slate-800/80" />
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}

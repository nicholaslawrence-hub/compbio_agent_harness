import { Outlet, NavLink, Link } from 'react-router-dom'
import { Search, Dna, Github, UserCircle2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function Layout() {
  const { user, loading } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-slate-950">
        <div className="h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
        <div className="max-w-7xl mx-auto px-10 h-20 flex items-center justify-between">

          <Link to="/" className="flex items-center gap-3 group">
            <Dna size={22} className="text-amber-400" strokeWidth={1.5} />
            <span className="font-semibold text-lg text-slate-100 tracking-tight group-hover:text-white transition-colors duration-150">
              Pharma<span className="text-amber-400">GPT</span>
              <span className="text-slate-600 font-light ml-1.5 text-base">/agent</span>
            </span>
          </Link>

          <nav className="flex items-center gap-2">
            <NavLink
              to="/gene/EGFR"
              className={({ isActive }) =>
                `relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${
                  isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Search size={14} strokeWidth={isActive ? 2 : 1.5} />
                  Gene Lookup
                  {isActive && (
                    <span className="absolute bottom-0 left-4 right-4 h-px bg-amber-400/70 rounded-full" />
                  )}
                </>
              )}
            </NavLink>

            <NavLink
              to="/run"
              className={({ isActive }) =>
                `flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-150 ${
                  isActive
                    ? 'bg-amber-400 text-slate-900'
                    : 'bg-amber-400/10 text-amber-400 hover:bg-amber-400/20'
                }`
              }
            >
              Run Analysis
            </NavLink>

            {!loading && (
              user ? (
                <Link
                  to="/account"
                  className="flex items-center gap-2 pl-3 ml-1 border-l border-slate-800 text-sm text-slate-400 hover:text-slate-200 transition-colors duration-150"
                >
                  <UserCircle2 size={18} strokeWidth={1.5} />
                  <span className="font-medium">{user.name.split(' ')[0]}</span>
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="ml-1 pl-3 border-l border-slate-800 text-sm font-medium text-slate-500 hover:text-slate-300 transition-colors duration-150"
                >
                  Log in
                </Link>
              )
            )}
          </nav>
        </div>
        <div className="h-px bg-slate-800/80" />
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-10">
        <Outlet />
      </main>

      <footer className="max-w-7xl mx-auto w-full px-10 py-6 flex items-center justify-between border-t border-slate-800/60">
        <span className="text-xs text-slate-700">PharmaGPT /agent</span>
        <a
          href="https://github.com/nicholaslawrence-hub/compbio_agent_harness"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-300 transition-colors duration-150"
        >
          <Github size={13} strokeWidth={1.5} />
          nicholaslawrence-hub
        </a>
      </footer>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

const BASE = import.meta.env.VITE_API_BASE || '/api/v1'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, register } = useAuth()
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({ email: '', name: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const oauthError = searchParams.get('oauthError')
    if (oauthError) setError(oauthError)
  }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'login') {
        await login(form.email, form.password)
      } else {
        if (!form.name.trim()) { setError('Name is required'); setLoading(false); return }
        await register(form.email, form.name, form.password)
      }
      navigate('/account')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const oauthVerb = tab === 'login' ? 'Sign In' : 'Sign Up'

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md">

        <div className="mb-5 text-center">
          <h1 className="text-3xl font-bold text-white">
            {tab === 'login' ? 'Sign In' : 'Create Account'}
          </h1>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-xl border border-slate-800 p-1 mb-4 bg-slate-900">
          {['login', 'register'].map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2.5 text-base font-medium rounded-lg transition-colors duration-150 ${
                tab === t
                  ? 'bg-amber-400 text-slate-900'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {t === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* OAuth buttons */}
        <div className="space-y-2.5 mb-4">
          <a
            href={`${BASE}/auth/google/login`}
            className="flex items-center justify-center gap-3 w-full bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm py-3 rounded-xl transition-colors duration-150"
          >
            <GoogleIcon />
            {oauthVerb} with Google
          </a>
          <a
            href={`${BASE}/auth/github/login`}
            className="flex items-center justify-center gap-3 w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm py-3 rounded-xl transition-colors duration-150"
          >
            <GitHubIcon />
            {oauthVerb} with GitHub
          </a>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-xs text-white/40 font-medium">or</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {tab === 'register' && (
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                className="input"
                placeholder="Your name"
                value={form.name}
                onChange={set('name')}
                required
              />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@example.com"
              value={form.email}
              onChange={set('email')}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              placeholder={tab === 'register' ? 'Choose a password (8+ chars)' : 'Your password'}
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-900 font-bold py-3 rounded-xl transition-colors duration-150 text-base mt-1"
          >
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

const BASE = import.meta.env.VITE_API_BASE || '/api/v1'

const ERROR_MESSAGES = {
  oauth_cancelled:          'Sign-in was cancelled.',
  oauth_failed:             'Sign-in failed. Please try again.',
  google_not_configured:    'Google sign-in is not available yet.',
  github_not_configured:    'GitHub sign-in is not available yet.',
}

export default function OAuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithToken } = useAuth()

  useEffect(() => {
    const error = params.get('error')
    if (error) {
      const msg = ERROR_MESSAGES[error] || ERROR_MESSAGES.oauth_failed
      navigate(`/login?oauthError=${encodeURIComponent(msg)}`, { replace: true })
      return
    }

    const legacyToken = params.get('token')
    if (legacyToken) {
      loginWithToken(legacyToken).then(() => navigate('/account', { replace: true }))
      return
    }

    const code = params.get('code')
    if (!code) {
      navigate(`/login?oauthError=${encodeURIComponent(ERROR_MESSAGES.oauth_failed)}`, { replace: true })
      return
    }

    fetch(`${BASE}/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('exchange_failed')
        const body = await res.json()
        return loginWithToken(body.token)
      })
      .then(() => navigate('/account', { replace: true }))
      .catch(() => {
        navigate(`/login?oauthError=${encodeURIComponent(ERROR_MESSAGES.oauth_failed)}`, { replace: true })
      })
  }, [])

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <p className="text-white text-base font-medium">Signing you in…</p>
    </div>
  )
}

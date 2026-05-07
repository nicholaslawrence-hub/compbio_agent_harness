import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

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
    const token = params.get('token')
    const error = params.get('error')

    if (error || !token) {
      const msg = ERROR_MESSAGES[error] || ERROR_MESSAGES.oauth_failed
      navigate(`/login?oauthError=${encodeURIComponent(msg)}`, { replace: true })
      return
    }

    loginWithToken(token).then(() => navigate('/account', { replace: true }))
  }, [])

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <p className="text-white text-base font-medium">Signing you in…</p>
    </div>
  )
}

import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import AnalyzePage from './pages/AnalyzePage.jsx'
import RunPage from './pages/RunPage.jsx'
import ResultsPage from './pages/ResultsPage.jsx'
import GeneLookupPage from './pages/GeneLookupPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AccountPage from './pages/AccountPage.jsx'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<AnalyzePage />} />
          <Route path="run" element={<RunPage />} />
          <Route path="results/:jobId" element={<ResultsPage />} />
          <Route path="gene/:symbol" element={<GeneLookupPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

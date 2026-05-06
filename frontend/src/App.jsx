import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import AnalyzePage from './pages/AnalyzePage.jsx'
import ResultsPage from './pages/ResultsPage.jsx'
import GeneLookupPage from './pages/GeneLookupPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<AnalyzePage />} />
        <Route path="results/:jobId" element={<ResultsPage />} />
        <Route path="gene/:symbol" element={<GeneLookupPage />} />
      </Route>
    </Routes>
  )
}

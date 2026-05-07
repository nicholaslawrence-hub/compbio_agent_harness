const BASE = import.meta.env.VITE_API_BASE || '/api/v1'

function authHeader() {
  const token = localStorage.getItem('rnagent_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function startAnalysis(formData) {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: authHeader(),
    body: formData,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getJobStatus(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function streamJobProgress(jobId, onMessage, onDone) {
  const es = new EventSource(`${BASE}/jobs/${jobId}/stream`)
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    onMessage(data)
    if (['complete', 'failed', 'dge_failed'].includes(data.status)) {
      es.close()
      onDone(data)
    }
  }
  es.onerror = () => { es.close(); onDone({ status: 'failed' }) }
  return () => es.close()
}

export async function getGenePPI(symbol) {
  const res = await fetch(`${BASE}/gene/${symbol}/ppi`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getGeneUniprot(symbol) {
  const res = await fetch(`${BASE}/gene/${symbol}/uniprot`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getGeneDrugs(symbol) {
  const res = await fetch(`${BASE}/gene/${symbol}/drugs`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getGenePubmed(symbol) {
  const res = await fetch(`${BASE}/gene/${symbol}/pubmed`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

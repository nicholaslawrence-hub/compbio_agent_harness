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

export async function getSandboxTemplates() {
  const res = await fetch(`${BASE}/sandbox/templates`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function startSandboxAnalysis(formData) {
  const res = await fetch(`${BASE}/sandbox/run`, {
    method: 'POST',
    headers: authHeader(),
    body: formData,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listSandboxDesigns() {
  const res = await fetch(`${BASE}/sandbox/designs`, { headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function loadSandboxDesign(designId) {
  const res = await fetch(`${BASE}/sandbox/designs/${encodeURIComponent(designId)}`, { headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function saveSandboxDesign(designId, payload) {
  const res = await fetch(`${BASE}/sandbox/designs/${encodeURIComponent(designId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getJobStatus(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getNetworkState(jobId) {
  const res = await fetch(`${BASE}/network/${jobId}/state`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function resolveApproval(jobId, nodeId, decision) {
  const body = new FormData()
  body.append('decision', decision)
  const res = await fetch(`${BASE}/network/${jobId}/approval/${nodeId}`, {
    method: 'POST',
    body,
  })
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

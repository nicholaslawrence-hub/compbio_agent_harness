import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const chromePath = process.env.QA_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const url = process.env.QA_URL || 'http://127.0.0.1:5179/'
const outDir = path.resolve('artifacts', 'landing-qa')
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function requestJson(endpoint) {
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${endpoint}`)
  return response.json()
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()

  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data)
    if (!data.id) return
    const callbacks = pending.get(data.id)
    if (!callbacks) return
    pending.delete(data.id)
    if (data.error) callbacks.reject(new Error(JSON.stringify(data.error)))
    else callbacks.resolve(data.result)
  })

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const messageId = ++id
          ws.send(JSON.stringify({ id: messageId, method, params }))
          return new Promise((resolveSend, rejectSend) => {
            pending.set(messageId, { resolve: resolveSend, reject: rejectSend })
          })
        },
        close() {
          ws.close()
        },
      })
    })
    ws.addEventListener('error', reject)
  })
}

async function connect(port) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const tabs = await requestJson(`http://127.0.0.1:${port}/json`)
      const page = tabs.find(tab => tab.type === 'page') || tabs[0]
      if (page?.webSocketDebuggerUrl) return createCdpClient(page.webSocketDebuggerUrl)
    } catch {}
    await wait(250)
  }
  throw new Error('Chrome DevTools endpoint did not become ready')
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 2))
  return result.result.value
}

async function screenshot(client, filePath) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  })
  await fs.writeFile(filePath, Buffer.from(shot.data, 'base64'))
}

const measurementScript = String.raw`
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const screening = document.querySelector('#screening-run');
  if (screening) screening.scrollIntoView({ block: 'start' });
  await sleep(850);
  const webSection = document.querySelector('.screen-agentweb-embedded');
  if (webSection) webSection.scrollIntoView({ block: 'center' });
  await sleep(850);
  const reportSection = document.querySelector('.screen-report-window');
  if (reportSection) reportSection.scrollIntoView({ block: 'center' });
  await sleep(900);
  if (screening) screening.scrollIntoView({ block: 'start' });
  await sleep(120);

  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 };
  };
  const anchor = (r, side) => ({
    left: { x: r.left, y: r.centerY },
    right: { x: r.right, y: r.centerY },
    top: { x: r.centerX, y: r.top },
    bottom: { x: r.centerX, y: r.bottom },
    center: { x: r.centerX, y: r.centerY },
  }[side]);
  const parsePath = d => {
    const numbers = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    return {
      start: { x: numbers[0], y: numbers[1] },
      end: { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] },
    };
  };
  const viewport = { width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  const overflowX = viewport.scrollWidth - viewport.clientWidth;
  const issues = [];
  const measurements = { viewport, overflowX, connectors: [], boxes: {} };

  const registerBox = (name, selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = rect(el);
    measurements.boxes[name] = r;
    return { el, r };
  };

  const agent = registerBox('agentBubble', '.screen-bubble-agent');
  const diff = registerBox('diffEq', '.screen-diffeq-card');
  const webBox = registerBox('agentWeb', '.screen-agentweb-embedded');
  const reportBox = registerBox('reportWindow', '.screen-report-window');
  const reportCopy = registerBox('reportCopy', '.screen-report-copy');

  document.querySelectorAll('.screen-connector-svg').forEach((svg, index) => {
    const path = svg.querySelector('path');
    if (!path) return;
    const svgRect = rect(svg);
    const parsed = parsePath(path.getAttribute('d') || '');
    const pageStart = { x: svgRect.left + parsed.start.x, y: svgRect.top + parsed.start.y };
    const pageEnd = { x: svgRect.left + parsed.end.x, y: svgRect.top + parsed.end.y };
    let expectedStart = null;
    let expectedEnd = null;
    const label = svg.dataset.connector || (index === 0 ? 'diffEqToAgentWeb' : index === 1 ? 'agentWebToReport' : index === 2 ? 'reportToCopy' : 'chatToDiffEq');
    if (label === 'diffEqToAgentWeb' && diff && webBox) { expectedStart = anchor(diff.r, 'bottom'); expectedEnd = anchor(webBox.r, 'top'); }
    if (label === 'agentWebToReport' && webBox && reportBox) { expectedStart = anchor(webBox.r, 'bottom'); expectedEnd = anchor(reportBox.r, 'top'); }
    if (label === 'reportToCopy' && reportBox && reportCopy) { expectedStart = anchor(reportBox.r, 'right'); expectedEnd = anchor(reportCopy.r, 'left'); }
    if (label === 'chatToDiffEq' && agent && diff) { expectedStart = anchor(agent.r, 'right'); expectedEnd = anchor(diff.r, 'left'); }
    const startDelta = expectedStart ? Math.hypot(pageStart.x - expectedStart.x, pageStart.y - expectedStart.y) : null;
    const endDelta = expectedEnd ? Math.hypot(pageEnd.x - expectedEnd.x, pageEnd.y - expectedEnd.y) : null;
    measurements.connectors.push({ label, pageStart, pageEnd, expectedStart, expectedEnd, startDelta, endDelta, svgRect });
    if (startDelta !== null && startDelta > 5) issues.push({ type: 'connector-start', label, delta: startDelta });
    if (endDelta !== null && endDelta > 5) issues.push({ type: 'connector-end', label, delta: endDelta });
  });

  const allBoxes = Object.entries(measurements.boxes);
  for (const [name, r] of allBoxes) {
    if (r.left < -2 || r.right > window.innerWidth + 2) issues.push({ type: 'viewport-overflow', label: name, left: r.left, right: r.right, viewportWidth: window.innerWidth });
  }
  if (overflowX > 2) issues.push({ type: 'document-overflow-x', delta: overflowX });

  return { measurements, issues };
})()
`

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  const port = 9333 + Math.floor(Math.random() * 200)
  const profile = path.resolve('artifacts', `chrome-qa-${port}`)
  await fs.mkdir(profile, { recursive: true })
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=old',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--disable-features=VizDisplayCompositor,CalculateNativeWinOcclusion',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  chrome.stderr.on('data', data => {
    const text = String(data)
    if (!text.includes('DevTools listening')) process.stderr.write(text)
  })

  const client = await connect(port)
  const report = []
  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    for (const vp of viewports) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 600,
      })
      await client.send('Page.navigate', { url })
      await wait(1200)
      await evaluate(client, measurementScript)
      await screenshot(client, path.join(outDir, `${vp.name}-${vp.width}x${vp.height}.png`))
      const result = await evaluate(client, measurementScript)
      report.push({ viewport: vp, ...result })
    }
    await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ outDir, report }, null, 2))
  } finally {
    client.close()
    chrome.kill()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

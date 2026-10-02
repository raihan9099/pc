/**
 * ============================================================
 *  All-in-One Remote PowerShell Server
 *  ----------------------------------------------------------
 *  - Browser UI served from the same process
 *  - WebSocket hub for both agent (PC) and browser clients
 *  - Password auth via AUTH_TOKEN env variable
 *  - Reverse connection: your PC dials OUT to this server
 * ============================================================
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

// ─────────────────────────────────────────────
// CONFIG (from env vars or defaults)
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ⚠️ MUST set these in Render Environment Variables
const AUTH_TOKEN =
  process.env.AUTH_TOKEN ||
  crypto.randomBytes(16).toString('hex'); // fallback random (changes each restart)

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB per command
const HEARTBEAT_INTERVAL = 30 * 1000; // 30s
const COMMAND_TIMEOUT = 60 * 1000;    // 60s

console.log('==============================================');
console.log(' Remote PowerShell Server starting...');
console.log('==============================================');
if (!process.env.AUTH_TOKEN) {
  console.log('⚠️  AUTH_TOKEN not set — using random:');
  console.log(`    ${AUTH_TOKEN}`);
  console.log('    Set AUTH_TOKEN in Render env vars for production.');
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let agentSocket = null;               // the single PC agent
const browsers = new Set();           // active browser clients
const pendingCommands = new Map();    // id -> { resolve, timer }

// ─────────────────────────────────────────────
// HTML UI (inlined, no external files)
// ─────────────────────────────────────────────
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Remote PowerShell</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#c9d1d9;--accent:#58a6ff;--err:#f85149;--ok:#3fb950}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
  #wrap{display:flex;flex-direction:column;height:100vh;padding:12px;gap:8px}
  header{display:flex;align-items:center;gap:12px;padding:6px 0}
  header h1{font-size:15px;margin:0;font-weight:600}
  #status{margin-left:auto;font-size:12px;padding:3px 10px;border-radius:20px;background:#21262d;border:1px solid var(--border)}
  #status.on{color:var(--ok);border-color:var(--ok)}
  #status.off{color:var(--err);border-color:var(--err)}
  #output{flex:1;overflow:auto;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word}
  #input-row{display:flex;gap:8px}
  #cmd{flex:1;padding:12px;background:#21262d;color:#fff;border:1px solid var(--border);border-radius:8px;font:inherit;outline:none}
  #cmd:focus{border-color:var(--accent)}
  button{padding:12px 20px;background:var(--accent);color:#000;border:0;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}
  button:disabled{opacity:.5;cursor:not-allowed}
  .in{color:var(--accent)}
  .err{color:var(--err)}
  .sys{color:#8b949e;font-style:italic}
  #login{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:10}
  #login .box{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:28px;width:340px}
  #login h2{margin:0 0 16px;font-size:16px}
  #login input{width:100%;padding:12px;margin-bottom:12px;background:#0d1117;color:#fff;border:1px solid var(--border);border-radius:8px;font:inherit;outline:none}
  #login button{width:100%}
  #login .err{color:var(--err);font-size:12px;height:16px;margin-bottom:8px}
</style>
</head>
<body>

<div id="login">
  <div class="box">
    <h2>🔐 Remote PowerShell</h2>
    <div class="err" id="loginErr"></div>
    <input id="token" type="password" placeholder="Access token" autofocus>
    <button id="loginBtn">Connect</button>
  </div>
</div>

<div id="wrap">
  <header>
    <h1>🖥️ Remote PowerShell</h1>
    <span id="status" class="off">connecting…</span>
  </header>
  <div id="output"><span class="sys">Waiting for connection…\n</span></div>
  <div id="input-row">
    <input id="cmd" placeholder="Type a PowerShell command and press Enter…" autocomplete="off" spellcheck="false" disabled>
    <button id="send" disabled>Send</button>
  </div>
</div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const out = $('output');
  const cmd = $('cmd');
  const send = $('send');
  const status = $('status');
  const login = $('login');

  let ws = null;
  let token = sessionStorage.getItem('token') || '';

  function setStatus(txt, cls) {
    status.textContent = txt;
    status.className = cls;
  }
  function write(html, cls) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = html;
    out.appendChild(span);
    out.scrollTop = out.scrollHeight;
  }
  function writeHTML(html) {
    out.insertAdjacentHTML('beforeend', html);
    out.scrollTop = out.scrollHeight;
  }

  async function tryLogin(inputToken) {
    // verify by hitting /auth
    const r = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inputToken })
    });
    if (!r.ok) return false;
    token = inputToken;
    sessionStorage.setItem('token', token);
    return true;
  }

  function connect() {
    if (ws) try { ws.close(); } catch {}
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '/ws?role=browser&token=' + encodeURIComponent(token));

    ws.onopen = () => {
      setStatus('connected', 'on');
      write('Connected to server.\\n', 'sys');
      cmd.disabled = false; send.disabled = false; cmd.focus();
    };
    ws.onclose = () => {
      setStatus('disconnected', 'off');
      write('\\n[disconnected]\\n', 'err');
      cmd.disabled = true; send.disabled = true;
      setTimeout(connect, 3000);
    };
    ws.onerror = () => setStatus('error', 'off');
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return write(e.data); }
      if (msg.type === 'output') write(msg.data);
      else if (msg.type === 'error') write(msg.msg + '\\n', 'err');
      else if (msg.type === 'agent-status')
        writeHTML('<span class="sys">[PC agent ' + msg.status + ']</span>\\n');
    };
  }

  function submit() {
    const v = cmd.value.trim();
    if (!v || !ws || ws.readyState !== 1) return;
    writeHTML('<span class="in">PS&gt; ' + escapeHtml(v) + '</span>\\n');
    ws.send(JSON.stringify({ type: 'command', cmd: v }));
    cmd.value = '';
  }
  function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  send.addEventListener('click', submit);

  // Login flow
  $('loginBtn').addEventListener('click', async () => {
    const t = $('token').value.trim();
    if (!t) return;
    const ok = await tryLogin(t);
    if (!ok) { $('loginErr').textContent = 'Invalid token'; return; }
    login.style.display = 'none';
    connect();
  });
  $('token').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('loginBtn').click();
  });

  // Auto-login if token cached
  if (token) {
    tryLogin(token).then(ok => {
      if (ok) { login.style.display = 'none'; connect(); }
      else sessionStorage.removeItem('token');
    });
  }
})();
</script>
</body>
</html>`;

// ─────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check (for Render)
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // Auth endpoint (POST /auth  {token})
  if (url.pathname === '/auth' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body || '{}');
        if (token && timingSafeEqual(token, AUTH_TOKEN)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // Root → serve UI
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_PAGE);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ─────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token');

  // Auth check
  if (!token || !timingSafeEqual(token, AUTH_TOKEN)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (role === 'agent') handleAgent(ws);
  else handleBrowser(ws);
});

// ─────────────────────────────────────────────
// AGENT HANDLER (your PC)
// ─────────────────────────────────────────────
function handleAgent(ws) {
  if (agentSocket && agentSocket.readyState === 1) {
    console.log('⚠️  Replacing existing agent connection');
    try { agentSocket.close(); } catch {}
  }
  agentSocket = ws;
  console.log('✅ Agent connected');

  broadcastToBrowsers({ type: 'agent-status', status: 'online' });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'output' || msg.type === 'error') {
      // Route output back to the browser that requested it
      const pending = pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.id);
      }
      // Also broadcast to all browsers if no specific id
      if (msg.id && ws._lastBrowserId) {
        const b = findBrowserById(ws._lastBrowserId);
        if (b) b.send(JSON.stringify(msg));
      } else {
        broadcastToBrowsers(msg);
      }
    }
  });

  ws.on('close', () => {
    if (agentSocket === ws) {
      agentSocket = null;
      console.log('❌ Agent disconnected');
      broadcastToBrowsers({ type: 'agent-status', status: 'offline' });
    }
  });

  ws.on('error', (e) => console.error('Agent WS error:', e.message));
}

// ─────────────────────────────────────────────
// BROWSER HANDLER
// ─────────────────────────────────────────────
function handleBrowser(ws) {
  browsers.add(ws);
  ws._id = crypto.randomBytes(8).toString('hex');
  console.log(`🌐 Browser connected (${browsers.size} total)`);

  // Send current agent status
  ws.send(JSON.stringify({
    type: 'agent-status',
    status: agentSocket && agentSocket.readyState === 1 ? 'online' : 'offline'
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'command') {
      if (!agentSocket || agentSocket.readyState !== 1) {
        return ws.send(JSON.stringify({ type: 'error', msg: 'PC agent is offline' }));
      }

      const id = crypto.randomBytes(8).toString('hex');
      agentSocket._lastBrowserId = ws._id;

      // Timeout guard
      const timer = setTimeout(() => {
        if (pendingCommands.has(id)) {
          pendingCommands.delete(id);
          ws.send(JSON.stringify({ type: 'error', msg: 'Command timeout' }));
        }
      }, COMMAND_TIMEOUT);

      pendingCommands.set(id, { resolve: ws, timer });

      agentSocket.send(JSON.stringify({ type: 'command', id, cmd: msg.cmd }));
    }
  });

  ws.on('close', () => {
    browsers.delete(ws);
    console.log(`🌐 Browser disconnected (${browsers.size} left)`);
  });

  ws.on('error', (e) => console.error('Browser WS error:', e.message));
}

function findBrowserById(id) {
  for (const b of browsers) if (b._id === id) return b;
  return null;
}

function broadcastToBrowsers(obj) {
  const data = JSON.stringify(obj);
  for (const b of browsers) if (b.readyState === 1) b.send(data);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─────────────────────────────────────────────
// HEARTBEAT (keep connections alive)
// ─────────────────────────────────────────────
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL);

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down…');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   UI:     http://localhost:${PORT}/`);
});

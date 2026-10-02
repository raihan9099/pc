'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'change-me';
const HEARTBEAT_INTERVAL = 30 * 1000;
const COMMAND_TIMEOUT = 5 * 60 * 1000; // 5 min

console.log('==============================================');
console.log(' Remote PowerShell Server starting...');
console.log('==============================================');

// ─────────────────────────────────────────────
// HTML UI
// ─────────────────────────────────────────────
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PowerShell Remote</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --fg: #c9d1d9;
    --fg-dim: #8b949e;
    --accent: #58a6ff;
    --accent-hover: #79c0ff;
    --err: #f85149;
    --ok: #3fb950;
    --warn: #d29922;
    --tab-bg: #21262d;
    --tab-active: #0d1117;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; overflow: hidden; }
  
  /* Login Screen */
  #login {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
    z-index: 100;
  }
  #login .box {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    width: 380px;
    max-width: 90vw;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  #login h1 { font-size: 20px; margin-bottom: 6px; color: #fff; }
  #login p { font-size: 13px; color: var(--fg-dim); margin-bottom: 20px; }
  #login input {
    width: 100%; padding: 12px 14px; margin-bottom: 12px;
    background: var(--bg); color: #fff; border: 1px solid var(--border);
    border-radius: 8px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px;
    outline: none; transition: border-color .15s;
  }
  #login input:focus { border-color: var(--accent); }
  #login button {
    width: 100%; padding: 12px; background: var(--accent); color: #000;
    border: 0; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer;
    transition: background .15s;
  }
  #login button:hover { background: var(--accent-hover); }
  #login .err { color: var(--err); font-size: 12px; min-height: 18px; margin-bottom: 8px; text-align: center; }

  /* Main App */
  #app { display: none; flex-direction: column; height: 100vh; }
  #app.active { display: flex; }

  /* Header */
  header {
    display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    background: var(--panel); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  header .logo { font-weight: 600; font-size: 14px; color: #fff; }
  header .status { margin-left: auto; font-size: 11px; padding: 4px 10px; border-radius: 20px;
    background: var(--bg); border: 1px solid var(--border); font-family: ui-monospace, monospace;
  }
  header .status.on { color: var(--ok); border-color: var(--ok); }
  header .status.off { color: var(--err); border-color: var(--err); }
  header button {
    padding: 6px 12px; background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit;
    transition: background .15s;
  }
  header button:hover { background: var(--tab-bg); }

  /* Tab Bar */
  #tabBar {
    display: flex; align-items: center; gap: 2px; padding: 4px 8px 0 8px;
    background: var(--bg); border-bottom: 1px solid var(--border);
    overflow-x: auto; flex-shrink: 0;
  }
  #tabBar::-webkit-scrollbar { height: 4px; }
  #tabBar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .tab {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: var(--tab-bg); color: var(--fg-dim);
    border: 1px solid var(--border); border-bottom: 0;
    border-radius: 8px 8px 0 0; font-size: 12px; cursor: pointer;
    font-family: ui-monospace, monospace; white-space: nowrap;
    max-width: 200px; transition: all .15s;
  }
  .tab.active { background: var(--tab-active); color: var(--fg); border-bottom: 1px solid var(--tab-active); margin-bottom: -1px; }
  .tab .close { opacity: 0.5; font-size: 14px; }
  .tab .close:hover { opacity: 1; color: var(--err); }
  .tab .tab-name { overflow: hidden; text-overflow: ellipsis; }
  #newTabBtn {
    padding: 6px 12px; background: transparent; color: var(--fg-dim);
    border: 1px dashed var(--border); border-radius: 6px;
    font-size: 14px; cursor: pointer; margin-bottom: 2px;
  }
  #newTabBtn:hover { color: var(--fg); border-color: var(--accent); }

  /* Terminal Area */
  #terminalArea { flex: 1; position: relative; overflow: hidden; }
  .terminal {
    position: absolute; inset: 0; display: none; flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.5;
  }
  .terminal.active { display: flex; }
  .term-output {
    flex: 1; overflow-y: auto; padding: 12px 16px;
    background: var(--bg); white-space: pre-wrap; word-break: break-word;
  }
  .term-output::-webkit-scrollbar { width: 10px; }
  .term-output::-webkit-scrollbar-track { background: var(--bg); }
  .term-output::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
  .term-output::-webkit-scrollbar-thumb:hover { background: #484f58; }
  .term-input-row {
    display: flex; align-items: center; gap: 0;
    padding: 8px 16px; background: var(--panel); border-top: 1px solid var(--border);
  }
  .term-prompt {
    color: var(--ok); font-family: ui-monospace, monospace; font-size: 13px;
    white-space: nowrap; margin-right: 6px; flex-shrink: 0;
  }
  .term-input {
    flex: 1; background: transparent; color: #fff; border: 0; outline: none;
    font-family: ui-monospace, monospace; font-size: 13px; caret-color: var(--accent);
  }

  /* Output coloring */
  .in { color: var(--accent); }
  .err { color: var(--err); }
  .sys { color: var(--fg-dim); font-style: italic; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }

  /* Empty state */
  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; color: var(--fg-dim); gap: 12px;
  }
  .empty svg { width: 60px; height: 60px; opacity: 0.3; }
</style>
</head>
<body>

<!-- Login Screen -->
<div id="login">
  <div class="box">
    <h1>🖥️ PowerShell Remote</h1>
    <p>Enter your access token to connect</p>
    <div class="err" id="loginErr"></div>
    <input id="tokenInput" type="password" placeholder="Access token" autofocus>
    <button id="loginBtn">Connect</button>
  </div>
</div>

<!-- Main App -->
<div id="app">
  <header>
    <span class="logo">🖥️ PowerShell Remote</span>
    <button id="clearBtn" title="Clear current tab">Clear</button>
    <button id="logoutBtn" title="Logout">Logout</button>
    <span id="status" class="status off">connecting…</span>
  </header>

  <div id="tabBar">
    <button id="newTabBtn" title="New tab">+</button>
  </div>

  <div id="terminalArea"></div>
</div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login');
  const app = $('app');
  const statusEl = $('status');
  const tabBar = $('tabBar');
  const terminalArea = $('terminalArea');
  const newTabBtn = $('newTabBtn');

  let token = sessionStorage.getItem('auth_token') || '';
  let ws = null;
  const tabs = new Map(); // id -> { name, ws, output, input, history, historyIdx, buffer }
  let activeTabId = null;
  let tabCounter = 0;

  // ──────────────────────────────────────
  // Login
  // ──────────────────────────────────────
  async function tryLogin(t) {
    const r = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t })
    });
    return r.ok;
  }

  $('loginBtn').onclick = async () => {
    const t = $('tokenInput').value.trim();
    if (!t) return;
    $('loginErr').textContent = '';
    const ok = await tryLogin(t);
    if (!ok) { $('loginErr').textContent = 'Invalid token'; return; }
    token = t;
    sessionStorage.setItem('auth_token', t);
    login.style.display = 'none';
    app.classList.add('active');
    initApp();
  };
  $('tokenInput').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };

  // ──────────────────────────────────────
  // App Init
  // ──────────────────────────────────────
  function initApp() {
    // Restore tabs from storage
    const savedTabs = JSON.parse(localStorage.getItem('tabs') || '[]');
    if (savedTabs.length > 0) {
      savedTabs.forEach(t => createTab(t.name, t.id));
      setActiveTab(savedTabs[savedTabs.length - 1].id);
    } else {
      createTab('Shell 1');
    }
  }

  // ──────────────────────────────────────
  // Create Tab
  // ──────────────────────────────────────
  function createTab(name, existingId) {
    const id = existingId || ('tab-' + (++tabCounter) + '-' + Date.now());
    const tabName = name || 'Shell ' + (tabCounter + 1);

    // Tab button
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.id = id;
    tabEl.innerHTML = '<span class="tab-name">' + tabName + '</span><span class="close" title="Close">×</span>';
    tabBar.insertBefore(tabEl, newTabBtn);

    // Terminal panel
    const termEl = document.createElement('div');
    termEl.className = 'terminal';
    termEl.dataset.id = id;
    termEl.innerHTML =
      '<div class="term-output"></div>' +
      '<div class="term-input-row">' +
        '<span class="term-prompt">PS&gt;</span>' +
        '<input class="term-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type a command...">' +
      '</div>';
    terminalArea.appendChild(termEl);

    const outputEl = termEl.querySelector('.term-output');
    const inputEl = termEl.querySelector('.term-input');

    // Tab state
    const state = {
      id, name: tabName,
      el: tabEl, termEl, output: outputEl, input: inputEl,
      history: [], historyIdx: -1, ws: null, buffer: ''
    };
    tabs.set(id, state);

    // ── Events
    tabEl.onclick = (e) => {
      if (e.target.classList.contains('close')) {
        closeTab(id);
      } else {
        setActiveTab(id);
      }
    };

    inputEl.onkeydown = (e) => handleInputKey(e, state);
    termEl.onclick = () => inputEl.focus();

    // ── Connect WS for this tab
    connectTab(state);

    // ── Welcome message
    writeSys(state, 'Connecting to server...\\n');

    return state;
  }

  // ──────────────────────────────────────
  // Connect tab via WebSocket
  // ──────────────────────────────────────
  function connectTab(state) {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/ws?role=browser&token=' + encodeURIComponent(token));
    state.ws = ws;

    ws.onopen = () => {
      writeSys(state, '✓ Connected\\n');
    };
    ws.onclose = () => {
      writeSys(state, '\\n[disconnected]\\n', 'err');
    };
    ws.onerror = () => writeSys(state, '[connection error]\\n', 'err');
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { write(state, e.data); return; }
      if (msg.type === 'output') {
        write(state, msg.data);
      } else if (msg.type === 'error') {
        write(state, msg.msg + '\\n', 'err');
      } else if (msg.type === 'agent-status') {
        updateGlobalStatus(msg.status);
        writeSys(state, '[PC agent ' + msg.status + ']\\n');
      }
    };
  }

  // ──────────────────────────────────────
  // Input handler
  // ──────────────────────────────────────
  function handleInputKey(e, state) {
    if (e.key === 'Enter') {
      const cmd = state.input.value;
      if (!cmd.trim()) return;
      // Echo
      writeIn(state, 'PS> ' + cmd + '\\n');
      // Save history
      state.history.push(cmd);
      state.historyIdx = state.history.length;
      // Send
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({ type: 'command', cmd }));
      } else {
        writeSys(state, '[not connected]\\n', 'err');
      }
      state.input.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.historyIdx > 0) {
        state.historyIdx--;
        state.input.value = state.history[state.historyIdx] || '';
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.historyIdx < state.history.length - 1) {
        state.historyIdx++;
        state.input.value = state.history[state.historyIdx] || '';
      } else {
        state.historyIdx = state.history.length;
        state.input.value = '';
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      state.output.innerHTML = '';
    }
  }

  // ──────────────────────────────────────
  // Output helpers
  // ──────────────────────────────────────
  function write(state, text, cls) {
    if (cls) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      state.output.appendChild(span);
    } else {
      state.output.appendChild(document.createTextNode(text));
    }
    state.output.scrollTop = state.output.scrollHeight;
  }
  function writeSys(state, text, cls) { write(state, text, cls || 'sys'); }
  function writeIn(state, text) { write(state, text, 'in'); }

  // ──────────────────────────────────────
  // Tab management
  // ──────────────────────────────────────
  function setActiveTab(id) {
    activeTabId = id;
    tabs.forEach((t, tid) => {
      t.el.classList.toggle('active', tid === id);
      t.termEl.classList.toggle('active', tid === id);
    });
    const t = tabs.get(id);
    if (t) setTimeout(() => t.input.focus(), 50);
    saveTabs();
  }

  function closeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    if (t.ws) try { t.ws.close(); } catch {}
    t.el.remove();
    t.termEl.remove();
    tabs.delete(id);
    if (activeTabId === id) {
      const next = tabs.keys().next().value;
      if (next) setActiveTab(next);
    }
    saveTabs();
  }

  function saveTabs() {
    const data = Array.from(tabs.values()).map(t => ({ id: t.id, name: t.name }));
    localStorage.setItem('tabs', JSON.stringify(data));
  }

  // ──────────────────────────────────────
  // Global status
  // ──────────────────────────────────────
  function updateGlobalStatus(s) {
    if (s === 'online') {
      statusEl.textContent = 'PC Online';
      statusEl.className = 'status on';
    } else {
      statusEl.textContent = 'PC Offline';
      statusEl.className = 'status off';
    }
  }

  // ──────────────────────────────────────
  // Header buttons
  // ──────────────────────────────────────
  newTabBtn.onclick = () => {
    const state = createTab('Shell ' + (tabCounter + 1));
    setActiveTab(state.id);
  };

  $('clearBtn').onclick = () => {
    const t = tabs.get(activeTabId);
    if (t) t.output.innerHTML = '';
  };

  $('logoutBtn').onclick = () => {
    if (!confirm('Logout and clear session?')) return;
    sessionStorage.removeItem('auth_token');
    location.reload();
  };

  // ──────────────────────────────────────
  // Auto-login if token stored
  // ──────────────────────────────────────
  if (token) {
    tryLogin(token).then(ok => {
      if (ok) {
        login.style.display = 'none';
        app.classList.add('active');
        initApp();
      } else {
        sessionStorage.removeItem('auth_token');
        token = '';
      }
    }).catch(() => {});
  }
})();
</script>
</body>
</html>`;

// ─────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

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

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_PAGE);
  }

  res.writeHead(404);
  res.end('Not found');
});

// ─────────────────────────────────────────────
// WebSocket Server
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
let agentSocket = null;
const browsers = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token');

  if (!token || !timingSafeEqual(token, AUTH_TOKEN)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (role === 'agent') {
    agentSocket = ws;
    console.log('✅ Agent connected');
    broadcastToBrowsers({ type: 'agent-status', status: 'online' });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      // Output goes back to the specific browser
      if (ws._browser && ws._browser.readyState === 1) {
        ws._browser.send(raw.toString());
      } else {
        broadcastToBrowsers(msg);
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
  } else {
    // Browser
    browsers.add(ws);
    console.log('🌐 Browser connected (' + browsers.size + ')');

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
        agentSocket._browser = ws;
        agentSocket.send(raw.toString());
      }
    });

    ws.on('close', () => {
      browsers.delete(ws);
      console.log('🌐 Browser disconnected (' + browsers.size + ')');
    });

    ws.on('error', (e) => console.error('Browser WS error:', e.message));
  }
});

function broadcastToBrowsers(obj) {
  const data = JSON.stringify(obj);
  for (const b of browsers) if (b.readyState === 1) b.send(data);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL);

server.listen(PORT, () => {
  console.log('🚀 Server on port ' + PORT);
});

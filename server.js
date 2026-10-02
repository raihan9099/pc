'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'change-me';
const HEARTBEAT_INTERVAL = 30 * 1000;

console.log('==============================================');
console.log(' Remote PowerShell Server — Mobile UI');
console.log('==============================================');

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#ffffff">
<title>PowerShell</title>
<style>
  :root {
    --bg: #ffffff;
    --bg-secondary: #f2f2f7;
    --bg-tertiary: #e5e5ea;
    --fg: #1c1c1e;
    --fg-secondary: #8e8e93;
    --border: #d1d1d6;
    --border-light: #e5e5ea;
    --accent: #007aff;
    --accent-hover: #0051d5;
    --err: #ff3b30;
    --ok: #34c759;
    --warn: #ff9500;
    --terminal-bg: #1c1c1e;
    --terminal-fg: #ffffff;
    --terminal-green: #30d158;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    font-size: 15px;
    overflow: hidden;
    overscroll-behavior: none;
    -webkit-font-smoothing: antialiased;
  }

  /* ───── Login Screen ───── */
  #login {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    background: var(--bg);
    z-index: 100;
  }
  #login .card {
    width: 100%;
    max-width: 360px;
    background: var(--bg-secondary);
    border-radius: 20px;
    padding: 32px 24px;
    text-align: center;
  }
  #login .icon {
    width: 68px; height: 68px;
    background: var(--accent);
    border-radius: 17px;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px;
    font-size: 36px;
  }
  #login h1 {
    font-size: 26px; font-weight: 700;
    margin-bottom: 6px; letter-spacing: -0.4px;
  }
  #login p {
    font-size: 15px; color: var(--fg-secondary);
    margin-bottom: 24px;
  }
  #login .field {
    background: var(--bg);
    border-radius: 12px;
    margin-bottom: 12px;
    overflow: hidden;
    display: flex; align-items: center;
    padding: 0 14px;
  }
  #login input {
    flex: 1;
    padding: 15px 0;
    background: transparent;
    border: 0;
    font-size: 16px;
    font-family: inherit;
    color: var(--fg);
    outline: none;
    -webkit-appearance: none;
  }
  #login input::placeholder { color: var(--fg-secondary); }
  #login .btn {
    width: 100%;
    padding: 15px;
    background: var(--accent);
    color: #fff;
    border: 0;
    border-radius: 12px;
    font-size: 17px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity .15s;
    -webkit-appearance: none;
  }
  #login .btn:active { opacity: 0.7; }
  #login .btn:disabled { opacity: 0.4; }
  #login .err {
    color: var(--err);
    font-size: 13px;
    min-height: 18px;
    margin-bottom: 8px;
  }

  /* ───── Main App ───── */
  #app {
    display: none;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }
  #app.active { display: flex; }

  /* iOS Status Bar look */
  .status-bar {
    padding: 10px 20px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
    background: var(--bg);
    flex-shrink: 0;
    padding-top: max(10px, env(safe-area-inset-top));
  }
  .status-bar .left { display: flex; align-items: center; gap: 4px; }
  .status-bar .right { display: flex; align-items: center; gap: 4px; }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--err);
    display: inline-block;
  }
  .status-dot.on { background: var(--ok); }

  /* Header */
  header {
    display: flex;
    align-items: center;
    padding: 8px 16px 12px;
    background: var(--bg);
    flex-shrink: 0;
  }
  header .title {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }
  header .actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
  header button {
    width: 32px; height: 32px;
    background: var(--bg-secondary);
    color: var(--accent);
    border: 0;
    border-radius: 50%;
    font-size: 16px;
    font-family: inherit;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
    -webkit-appearance: none;
  }
  header button:active { background: var(--bg-tertiary); }

  /* Tab Bar */
  #tabBar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 10px;
    background: var(--bg);
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
  }
  #tabBar::-webkit-scrollbar { display: none; }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-secondary);
    color: var(--fg);
    border: 0;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: all .15s;
    flex-shrink: 0;
    -webkit-appearance: none;
    min-height: 34px;
  }
  .tab.active {
    background: var(--accent);
    color: #fff;
  }
  .tab:active { transform: scale(0.96); }
  .tab .close {
    font-size: 16px;
    line-height: 1;
    opacity: 0.6;
    padding-left: 2px;
  }
  .tab .close:hover { opacity: 1; }
  #newTabBtn {
    width: 34px; height: 34px;
    background: var(--bg-secondary);
    color: var(--accent);
    border: 0;
    border-radius: 50%;
    font-size: 20px;
    font-weight: 300;
    cursor: pointer;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    -webkit-appearance: none;
    line-height: 1;
  }
  #newTabBtn:active { background: var(--bg-tertiary); transform: scale(0.96); }

  /* Terminal */
  #terminalArea {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--terminal-bg);
    margin: 0 8px;
    border-radius: 16px 16px 0 0;
    min-height: 0;
  }
  .terminal {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
  }
  .terminal.active { display: flex; }
  .term-output {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: var(--terminal-bg);
    color: var(--terminal-fg);
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    -webkit-overflow-scrolling: touch;
  }
  .term-output::-webkit-scrollbar { width: 4px; }
  .term-output::-webkit-scrollbar-thumb { background: #3a3a3c; border-radius: 2px; }
  .term-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    background: #2c2c2e;
    border-top: 1px solid #3a3a3c;
  }
  .term-prompt {
    color: var(--terminal-green);
    font-family: ui-monospace, monospace;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .term-input {
    flex: 1;
    background: transparent;
    color: #fff;
    border: 0;
    outline: none;
    font-family: ui-monospace, monospace;
    font-size: 16px;
    padding: 0;
    caret-color: var(--terminal-green);
    -webkit-appearance: none;
  }

  /* Output colors */
  .in { color: #64d2ff; }
  .err { color: #ff453a; }
  .sys { color: #8e8e93; font-style: italic; }
  .ok { color: #30d158; }
  .warn { color: #ffd60a; }

  /* Home Indicator */
  .home-indicator {
    height: 34px;
    background: var(--terminal-bg);
    margin: 0 8px;
    border-radius: 0 0 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
  .home-indicator::after {
    content: '';
    width: 134px;
    height: 5px;
    background: rgba(255,255,255,0.5);
    border-radius: 3px;
    margin-top: auto;
  }
</style>
</head>
<body>

<!-- Login -->
<div id="login">
  <div class="card">
    <div class="icon">🖥️</div>
    <h1>PowerShell</h1>
    <p>Enter access token</p>
    <div class="err" id="loginErr"></div>
    <div class="field">
      <input id="tokenInput" type="password" placeholder="Access token" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </div>
    <button class="btn" id="loginBtn">Connect</button>
  </div>
</div>

<!-- App -->
<div id="app">
  <div class="status-bar">
    <div class="left">
      <span id="clock">--:--</span>
    </div>
    <div class="right">
      <span class="status-dot" id="statusDot"></span>
      <span id="statusText">…</span>
    </div>
  </div>

  <header>
    <span class="title">Terminal</span>
    <div class="actions">
      <button id="clearBtn" title="Clear">🗑</button>
      <button id="logoutBtn" title="Logout">⏻</button>
    </div>
  </header>

  <div id="tabBar">
    <button id="newTabBtn" title="New">+</button>
  </div>

  <div id="terminalArea"></div>

  <div class="home-indicator"></div>
</div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login');
  const app = $('app');
  const statusDot = $('statusDot');
  const statusText = $('statusText');
  const clock = $('clock');
  const tabBar = $('tabBar');
  const terminalArea = $('terminalArea');
  const newTabBtn = $('newTabBtn');

  let token = localStorage.getItem('auth_token') || '';
  const tabs = new Map();
  let activeTabId = null;
  let tabCounter = 0;

  // Clock
  function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
  }
  setInterval(updateClock, 30000);
  updateClock();

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
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Connecting…';
    try {
      const ok = await tryLogin(t);
      if (!ok) {
        $('loginErr').textContent = 'Invalid token';
        $('loginBtn').disabled = false;
        $('loginBtn').textContent = 'Connect';
        return;
      }
      token = t;
      localStorage.setItem('auth_token', t);
      login.style.display = 'none';
      app.classList.add('active');
      initApp();
    } catch (e) {
      $('loginErr').textContent = 'Network error';
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Connect';
    }
  };
  $('tokenInput').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };

  // ──────────────────────────────────────
  // App Init
  // ──────────────────────────────────────
  function initApp() {
    const saved = JSON.parse(localStorage.getItem('tabs') || '[]');
    if (saved.length > 0) {
      saved.forEach(t => createTab(t.name, t.id));
      setActiveTab(saved[saved.length - 1].id);
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
    const tabEl = document.createElement('button');
    tabEl.className = 'tab';
    tabEl.dataset.id = id;
    tabEl.innerHTML = '<span class="tab-name">' + tabName + '</span><span class="close" title="Close">×</span>';
    tabBar.insertBefore(tabEl, newTabBtn);

    // Terminal
    const termEl = document.createElement('div');
    termEl.className = 'terminal';
    termEl.dataset.id = id;
    termEl.innerHTML =
      '<div class="term-output"></div>' +
      '<div class="term-input-row">' +
        '<span class="term-prompt">PS&gt;</span>' +
        '<input class="term-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type command...">' +
      '</div>';
    terminalArea.appendChild(termEl);

    const outputEl = termEl.querySelector('.term-output');
    const inputEl = termEl.querySelector('.term-input');

    const state = {
      id, name: tabName,
      el: tabEl, termEl, output: outputEl, input: inputEl,
      history: [], historyIdx: -1, ws: null
    };
    tabs.set(id, state);

    tabEl.onclick = (e) => {
      if (e.target.classList.contains('close')) closeTab(id);
      else setActiveTab(id);
    };
    inputEl.onkeydown = (e) => handleInputKey(e, state);
    termEl.onclick = () => inputEl.focus();

    connectTab(state);
    writeSys(state, 'Connecting…\\n');

    return state;
  }

  // ──────────────────────────────────────
  // WebSocket
  // ──────────────────────────────────────
  function connectTab(state) {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/ws?role=browser&token=' + encodeURIComponent(token));
    state.ws = ws;

    ws.onopen = () => writeSys(state, '✓ Connected\\n');
    ws.onclose = () => writeSys(state, '\\n[disconnected]\\n', 'err');
    ws.onerror = () => writeSys(state, '[connection error]\\n', 'err');
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { write(state, e.data); return; }
      if (msg.type === 'output') write(state, msg.data);
      else if (msg.type === 'error') write(state, msg.msg + '\\n', 'err');
      else if (msg.type === 'agent-status') {
        updateGlobalStatus(msg.status);
        writeSys(state, '[PC agent ' + msg.status + ']\\n');
      }
    };
  }

  // ──────────────────────────────────────
  // Input
  // ──────────────────────────────────────
  function handleInputKey(e, state) {
    if (e.key === 'Enter') {
      const cmd = state.input.value;
      if (!cmd.trim()) return;
      writeIn(state, 'PS> ' + cmd + '\\n');
      state.history.push(cmd);
      state.historyIdx = state.history.length;
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
    }
  }

  // ──────────────────────────────────────
  // Output
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
  // Tabs
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
  // Status
  // ──────────────────────────────────────
  function updateGlobalStatus(s) {
    if (s === 'online') {
      statusDot.classList.add('on');
      statusText.textContent = 'Online';
    } else {
      statusDot.classList.remove('on');
      statusText.textContent = 'Offline';
    }
  }

  newTabBtn.onclick = () => {
    const s = createTab('Shell ' + (tabCounter + 1));
    setActiveTab(s.id);
  };

  $('clearBtn').onclick = () => {
    const t = tabs.get(activeTabId);
    if (t) t.output.innerHTML = '';
  };

  $('logoutBtn').onclick = () => {
    if (!confirm('Logout?')) return;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('tabs');
    location.reload();
  };

  // Auto-login
  if (token) {
    tryLogin(token).then(ok => {
      if (ok) {
        login.style.display = 'none';
        app.classList.add('active');
        initApp();
      } else {
        localStorage.removeItem('auth_token');
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
// WebSocket
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
      if (ws._browser && ws._browser.readyState === 1) {
        ws._browser.send(raw.toString());
      } else {
        broadcastToBrowsers(JSON.parse(raw.toString()));
      }
    });
    ws.on('close', () => {
      if (agentSocket === ws) {
        agentSocket = null;
        console.log('❌ Agent disconnected');
        broadcastToBrowsers({ type: 'agent-status', status: 'offline' });
      }
    });
    ws.on('error', (e) => console.error('Agent error:', e.message));
  } else {
    browsers.add(ws);
    console.log('🌐 Browser (' + browsers.size + ')');
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
      console.log('🌐 Browser closed (' + browsers.size + ')');
    });
    ws.on('error', (e) => console.error('Browser error:', e.message));
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

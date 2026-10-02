
---

## 5️⃣ Agent Script (আপনার PC-তে চালাবেন) — `agent.js`

> এটা **server.js এর বাইরে**, কারণ এটা আপনার PC-তে চলবে, Render-এ না।

```javascript
'use strict';
const WebSocket = require('ws');
const { spawn } = require('child_process');

const SERVER_URL = process.env.SERVER_URL; // e.g. wss://your-app.onrender.com
const AUTH_TOKEN = process.env.AUTH_TOKEN;

if (!SERVER_URL || !AUTH_TOKEN) {
  console.error('❌ Set SERVER_URL and AUTH_TOKEN env vars');
  process.exit(1);
}

const RECONNECT_MS = 5000;

function connect() {
  const url = `${SERVER_URL}/ws?role=agent&token=${encodeURIComponent(AUTH_TOKEN)}`;
  const ws = new WebSocket(url);

  ws.on('open', () => console.log('✅ Connected to server'));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'command') return;

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const args = isWin ? ['-NoProfile', '-Command', msg.cmd] : ['-c', msg.cmd];

    const child = spawn(shell, args, { windowsHide: true });

    let out = '';
    const push = (d) => { if (out.length < 512 * 1024) out += d.toString(); };
    child.stdout.on('data', push);
    child.stderr.on('data', push);

    child.on('close', (code) => {
      ws.send(JSON.stringify({ type: 'output', id: msg.id, data: out + '\n' }));
    });

    child.on('error', (err) => {
      ws.send(JSON.stringify({ type: 'error', id: msg.id, msg: err.message }));
    });
  });

  ws.on('close', () => {
    console.log('❌ Disconnected, reconnecting in 5s…');
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (e) => console.error('WS error:', e.message));
}

connect();

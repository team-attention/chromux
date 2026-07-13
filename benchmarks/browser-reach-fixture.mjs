#!/usr/bin/env node

import http from 'node:http';

function html(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

let frameValue = '';
let canvasEvents = [];

function canvasPage() {
  return `<!doctype html>
<meta charset="utf-8">
<title>Canvas Reach Fixture</title>
<style>body{margin:0;padding:16px;font-family:sans-serif}h1,p{margin:0 0 8px}canvas{display:block;width:600px;height:360px;border:2px solid #222;touch-action:none}</style>
<h1>Canvas reach fixture</h1>
<p id="status">waiting</p>
<canvas id="reach-canvas" width="600" height="360" aria-label="Canvas interaction surface"></canvas>
<script>
const canvas = document.getElementById('reach-canvas');
const context = canvas.getContext('2d');
const status = document.getElementById('status');
const sent = new Set();
let dragging = false;
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}
function near(value, target, radius) { return Math.abs(value.x-target.x) <= radius && Math.abs(value.y-target.y) <= radius; }
function record(event) {
  if (sent.has(event)) return;
  sent.add(event);
  status.textContent = [...sent].sort().join(', ');
  fetch('/canvas-grade', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event}) }).catch(() => {});
}
function draw() {
  context.clearRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#f6f7f9'; context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#eab308'; context.beginPath(); context.arc(480,70,30,0,Math.PI*2); context.fill();
  context.fillStyle='#2563eb'; context.fillRect(270,150,60,60);
  context.strokeStyle='#16a34a'; context.lineWidth=6; context.beginPath(); context.moveTo(100,280); context.lineTo(500,280); context.stroke();
  context.fillStyle='#111827'; context.font='18px sans-serif';
  context.fillText('hover',452,76); context.fillText('click',280,185); context.fillText('drag',278,270);
}
canvas.addEventListener('pointermove', event => {
  const p=point(event);
  if (near(p,{x:480,y:70},32)) record('hover');
});
canvas.addEventListener('click', event => {
  if (near(point(event),{x:300,y:180},32)) record('click');
});
canvas.addEventListener('pointerdown', event => {
  if (near(point(event),{x:100,y:280},24)) { dragging=true; canvas.setPointerCapture(event.pointerId); }
});
canvas.addEventListener('pointerup', event => {
  if (dragging && near(point(event),{x:500,y:280},30)) record('drag');
  dragging=false;
});
draw();
</script>`;
}

function childPage({ navigated = false } = {}) {
  const label = navigated ? 'Navigated frame field' : 'Private frame field';
  const navigation = navigated
    ? '<p id="ready">Navigated child ready</p>'
    : '<button id="navigate" type="button" onclick="location.href=\'/frame-child-next?token=navigation-secret\'">Navigate child</button><p id="ready">Opaque child ready</p>';
  return `<!doctype html>
<meta charset="utf-8">
<title>${navigated ? 'Navigated Child' : 'Opaque Child'}</title>
<style>html,body{position:relative;margin:0;width:100%;height:100%;overflow:hidden;font-family:sans-serif}#frame-input{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;font:24px sans-serif;padding:20px}#shadow-host{position:absolute;left:8px;top:8px;z-index:2;width:150px;height:62px;background:#fff}#frame-select{position:absolute;right:8px;top:8px;z-index:2}#nested-frame{position:absolute;right:8px;top:42px;z-index:2;width:145px;height:50px;border:1px solid #555}a{position:absolute;left:8px;top:78px;z-index:2;background:#fff}button{position:absolute;right:8px;bottom:8px;z-index:1}p{position:absolute;left:8px;bottom:8px;z-index:1;margin:0;pointer-events:none}</style>
<input id="frame-input" aria-label="${label}" autocomplete="off">
<div id="shadow-host"></div>
<select id="frame-select" aria-label="Frame mode"><option value="a">Alpha</option><option value="b">Beta</option></select>
<iframe id="nested-frame" title="Nested child" src="/frame-nested"></iframe>
<a href="/account/private?token=link-secret">Private child link</a>
${navigation}
<script>
const grade = value => fetch('/grade', { method: 'POST', body: value }).catch(() => {});
const input = document.getElementById('frame-input');
input.addEventListener('input', () => grade(input.value));
const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
shadow.innerHTML = '<button id="shadow-button" type="button">Shadow child button</button><input id="shadow-input" aria-label="Shadow child field">';
shadow.getElementById('shadow-button').addEventListener('click', () => grade('shadow-clicked'));
shadow.getElementById('shadow-input').addEventListener('input', event => grade('shadow:' + event.target.value));
document.getElementById('frame-select').addEventListener('change', event => grade('select:' + event.target.value));
</script>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.local');
  if (url.pathname === '/parent') {
    const address = server.address();
    const child = `http://127.0.0.1:${address.port}/frame-child?token=fixture-secret&step=1`;
    return html(res, `<!doctype html>
<meta charset="utf-8">
<title>Browser Reach Parent</title>
<style>body{margin:0;padding:20px;font-family:sans-serif}iframe{display:block;width:320px;height:180px;border:2px solid #333}</style>
<h1>Parent fixture</h1>
<iframe id="opaque-frame" title="Opaque editor" src="${child}" onload="this.dataset.loaded='true'"></iframe>`);
  }
  if (url.pathname === '/frame-child') {
    return html(res, childPage());
  }
  if (url.pathname === '/frame-child-next') {
    return html(res, childPage({ navigated: true }));
  }
  if (url.pathname === '/frame-nested') {
    return html(res, `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0}button,input{box-sizing:border-box;width:100%;height:23px}</style>
<button id="nested-button" type="button">Nested frame button</button>
<input id="nested-input" aria-label="Nested frame field">
<script>
document.getElementById('nested-button').addEventListener('click', () => fetch('/grade', { method:'POST', body:'nested-clicked' }).catch(() => {}));
document.getElementById('nested-input').addEventListener('input', event => fetch('/grade', { method:'POST', body:'nested:' + event.target.value }).catch(() => {}));
</script>`);
  }
  if (url.pathname === '/grade' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      frameValue = body.slice(0, 1000);
      res.writeHead(204);
      res.end();
    });
    return;
  }
  if (url.pathname === '/grade') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ frameValue }));
  }
  if (url.pathname === '/canvas') {
    return html(res, canvasPage());
  }
  if (url.pathname === '/canvas-reset' && req.method === 'POST') {
    canvasEvents = [];
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === '/canvas-grade' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const event = String(JSON.parse(body).event || '');
        if (event && !canvasEvents.includes(event)) canvasEvents.push(event);
      } catch {}
      res.writeHead(204);
      res.end();
    });
    return;
  }
  if (url.pathname === '/canvas-grade') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ events: canvasEvents }));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(JSON.stringify({
    port: address.port,
    parentUrl: `http://localhost:${address.port}/parent`,
    gradeUrl: `http://127.0.0.1:${address.port}/grade`,
    canvasUrl: `http://127.0.0.1:${address.port}/canvas`,
    canvasGradeUrl: `http://127.0.0.1:${address.port}/canvas-grade`,
  }));
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

#!/usr/bin/env node

const port = Number(process.argv[2]);
const urlNeedle = process.argv[3] || '/frame-child';
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: node benchmarks/oopif-crash-probe.mjs <cdp-port> [url-needle]');
  process.exit(1);
}

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});

function send(method, params = {}, sessionId = null) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const { targetInfos } = await send('Target.getTargets');
const target = targetInfos.find(item => item.type === 'iframe' && item.url.includes(urlNeedle));
if (!target) {
  socket.close();
  throw new Error(`No OOPIF target URL contained ${JSON.stringify(urlNeedle)}`);
}

const { sessionId } = await send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});
const response = await Promise.race([
  send('Page.crash', {}, sessionId)
    .then(() => ({ replied: true }))
    .catch(error => ({ replied: true, error: error.message })),
  new Promise(resolve => setTimeout(() => resolve({ replied: false }), 1500)),
]);

console.log(JSON.stringify({
  dispatched: true,
  targetId: target.targetId,
  response,
}));
socket.close();

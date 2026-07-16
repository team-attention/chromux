#!/usr/bin/env node
// Standalone HTTP fixture for the live harness. Runs in its own process so the
// harness's synchronous CLI calls (spawnSync) never block it — a download
// triggered during a blocking CLI call still gets served.
import http from 'node:http';

const server = http.createServer((req, res) => {
  if (req.url === '/download.txt') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="hello.txt"',
    });
    res.end('chromux-live-download');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>Live Fixture</title><h1 id="hdr">live ok</h1><button id="btn" onclick="document.getElementById(\'hdr\').textContent=\'clicked\'">go</button>');
});

server.listen(0, '127.0.0.1', () => {
  // Emit the chosen port so the parent can read it from stdout.
  process.stdout.write('PORT=' + server.address().port + '\n');
});

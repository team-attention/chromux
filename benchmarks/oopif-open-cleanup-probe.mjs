#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'chromux.mjs'), 'utf8');
const start = source.indexOf('async function cleanupFailedOpenSession(');
const end = source.indexOf('\nasync function readPageInfo(', start);
assert.ok(start >= 0 && end > start, 'open-session cleanup source block not found');

const events = [];
let navigateCalled = false;
const helpers = vm.runInNewContext(
  `(function () {
    ${source.slice(start, end)}
    return { cleanupFailedOpenSession, prepareOpenSessionNavigation };
  })()`,
  {
    closeTab: async (port, targetId) => { events.push(`tab:${port}:${targetId}`); },
    disposeOopifRouting: () => { events.push('oopif-disposed'); },
    enableOopifRouting: async () => { throw new Error('injected Target.setAutoAttach failure'); },
    navigateSession: async () => { navigateCalled = true; },
    touchSession: () => { events.push('touched'); },
  },
);

const sessions = new Map();
const cdp = {
  async closeAndWait() { events.push('transport-closed'); },
  close() { events.push('transport-close-fallback'); },
};
const sessionState = { cdp };
sessions.set('new-oopif', sessionState);

await assert.rejects(
  helpers.prepareOpenSessionNavigation({
    sessions,
    session: 'new-oopif',
    s: sessionState,
    body: { oopif: true },
    url: 'https://example.com',
    settings: {},
    port: 9222,
    isNewSession: true,
    newTab: { id: 'target-1' },
  }),
  /injected Target\.setAutoAttach failure/,
);
assert.equal(sessions.has('new-oopif'), false);
assert.equal(navigateCalled, false);
assert.deepEqual(events, [
  'oopif-disposed',
  'transport-closed',
  'tab:9222:target-1',
]);

events.length = 0;
sessions.set('early-failure', {});
await helpers.cleanupFailedOpenSession(
  sessions,
  'early-failure',
  null,
  cdp,
  9333,
  'target-2',
);
assert.equal(sessions.has('early-failure'), false);
assert.deepEqual(events, [
  'transport-closed',
  'tab:9333:target-2',
]);

console.log('OOPIF open cleanup probe passed');

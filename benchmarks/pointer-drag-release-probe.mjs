#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'chromux.mjs'), 'utf8');
const start = source.indexOf('async function dispatchPointerDrag(');
const end = source.indexOf('\nasync function dispatchHtml5Drag(', start);
assert.ok(start >= 0 && end > start, 'dispatchPointerDrag source block not found');

const functionSource = source.slice(start, end);
const dispatchPointerDrag = vm.runInNewContext(
  `(function () { ${functionSource}; return dispatchPointerDrag; })()`,
  { sleep: async () => {} },
);

const events = [];
let pressedMovementCount = 0;
const cdp = {
  async send(method, payload) {
    assert.equal(method, 'Input.dispatchMouseEvent');
    events.push(payload);
    if (payload.type === 'mouseMoved' && payload.buttons === 1) {
      pressedMovementCount += 1;
      if (pressedMovementCount === 2) throw new Error('injected movement failure');
    }
  },
};

await assert.rejects(
  dispatchPointerDrag(cdp, { x: 10, y: 20 }, { x: 110, y: 120 }, 4, 0),
  /injected movement failure/,
);
assert.equal(events.at(-1).type, 'mouseReleased');
assert.equal(events.at(-1).buttons, 0);
assert.equal(events.filter(event => event.type === 'mouseReleased').length, 1);
console.log('pointer drag cleanup probe passed');

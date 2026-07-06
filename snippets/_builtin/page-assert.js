// Builtin helper for `chromux run`.
// Usage:
//   Edit the assertions below or copy this file to a local variant.
const selector = globalThis.selector || 'body';
const text = globalThis.text || '';
const expression = globalThis.expression || 'document.readyState === "complete" || document.readyState === "interactive"';

const checks = [];
checks.push(await waitFor(selector, { kind: 'selector', timeoutMs: 5000 }));
if (text) checks.push(await waitFor(text, { kind: 'text', timeoutMs: 5000 }));
checks.push(await assertPage(expression, { timeoutMs: 1000 }));

return {
  ok: true,
  checks,
  page: await page('({url:location.href,title:document.title})'),
};

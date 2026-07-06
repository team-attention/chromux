// Builtin helper for `chromux run`.
// Usage:
//   Edit selector/value/submitSelector below or copy this file to a local variant.
//
// The value is summarized in the returned receipt shape and should not be logged raw.
const selector = globalThis.selector || 'input, textarea';
const value = String(globalThis.value || 'chromux test value');
const submitSelector = globalThis.submitSelector || 'button[type="submit"], input[type="submit"], button';
const readyText = globalThis.readyText || '';

await waitFor(selector, { kind: 'selector', timeoutMs: 5000 });
await js(`((sel, txt) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('Missing form field: ' + sel);
  el.focus();
  if ('value' in el) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, txt);
    else el.value = txt;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '' };
})(${JSON.stringify(selector)}, ${JSON.stringify(value)})`);

const submit = await js(`((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  return { tag: el.tagName.toLowerCase(), text: el.innerText || el.value || '' };
})(${JSON.stringify(submitSelector)})`);

let readiness = null;
if (readyText) readiness = await waitFor(readyText, { kind: 'text', timeoutMs: 5000 });
const state = await page('({url:location.href,title:document.title})');
return {
  submitted: Boolean(submit),
  field: selector,
  valueSummary: { length: value.length },
  submit,
  readiness,
  page: state,
};

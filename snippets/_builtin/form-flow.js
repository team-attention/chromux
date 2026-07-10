// Builtin helper for `chromux run`: fill a whole form, submit, and prove
// readiness in one call.
// Usage:
//   chromux run <s> --file snippets/_builtin/form-flow.js \
//     --arg fields='{"#email":"a@b.c","#country":"US"}' \
//     --arg submit='#submit' --arg readyText='Order confirmed' --arg report='#status'
// `fields` maps CSS selectors or snapshot @refs to values; <select> values
// match by option value or label. `report` returns that element's final text;
// without `report`, the element containing `readyText` is reported instead.
// Single-field form: --arg selector=... --arg value=...
// Values are summarized in the returned receipt shape, not logged raw.
const cssOf = (sel) => /^@\d+$/.test(sel) ? `[data-ct-ref="${sel.slice(1)}"]` : sel;
const fields = (args.fields && typeof args.fields === 'object') ? args.fields : null;
const selector = args.selector || globalThis.selector || 'input, textarea';
const value = String(args.value ?? globalThis.value ?? 'chromux test value');
const submitSelector = args.submit || args.submitSelector || globalThis.submitSelector
  || 'button[type="submit"], input[type="submit"], button';
const readyText = args.readyText || globalThis.readyText || '';
const readySelector = args.readySelector || '';
const reportSelector = args.report || '';

const entries = (fields ? Object.entries(fields) : [[selector, value]])
  .map(([sel, val]) => [cssOf(sel), val]);
const filled = [];
for (const [sel, val] of entries) {
  await waitFor(sel, { kind: 'selector', timeoutMs: 5000 });
  const r = await js(`((sel, txt) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Missing form field: ' + sel);
    el.focus();
    if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options);
      const match = opts.find(o => o.value === txt)
        || opts.find(o => o.textContent.trim() === txt)
        || opts.find(o => o.textContent.trim().toLowerCase() === txt.toLowerCase());
      if (!match) throw new Error('No option matching "' + txt + '" in ' + sel);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(el, match.value);
      else el.value = match.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { tag: 'select', id: el.id || '', value: el.value };
    }
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, txt);
      else el.value = txt;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '' };
  })(${JSON.stringify(sel)}, ${JSON.stringify(String(val))})`);
  filled.push({ selector: sel, ...r, valueLength: String(val).length });
}

const submit = await js(`((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  return { tag: el.tagName.toLowerCase(), text: el.innerText || el.value || '' };
})(${JSON.stringify(cssOf(submitSelector))})`);

let readiness = null;
if (readyText) readiness = await waitFor(readyText, { kind: 'text', timeoutMs: 5000 });
else if (readySelector) readiness = await waitFor(readySelector, { kind: 'selector', timeoutMs: 5000 });
// --arg report='#status' returns that element's final text, so callers get
// the outcome (confirmation code, error message) without another read. When
// no report selector is given, the element containing readyText is used.
let report = null;
if (reportSelector) {
  report = await js(`((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || el.textContent || '').trim().slice(0, 500) : null;
  })(${JSON.stringify(cssOf(reportSelector))})`);
} else if (readyText && readiness) {
  report = await js(`((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(needle)) {
        const el = node.parentElement;
        return (el ? (el.innerText || el.textContent) : node.textContent).trim().slice(0, 500);
      }
    }
    return null;
  })(${JSON.stringify(readyText)})`);
}
const state = await page('({url:location.href,title:document.title})');
return {
  submitted: Boolean(submit),
  filled,
  submit,
  readiness,
  report,
  page: state,
};

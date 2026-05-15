// Builtin helper example for `chromux run`.
// Usage:
//   chromux run <session> --file snippets/_builtin/scroll-until.js
//
// Override these before running by copying this file or editing a local variant.
const selector = globalThis.selector || 'li';
const targetCount = Number(globalThis.count || 10);
const maxScrolls = Number(globalThis.maxScrolls || 30);
const delayMs = Number(globalThis.delayMs || 800);

for (let i = 0; i < maxScrolls; i++) {
  const info = await js(`(() => {
    const matches = document.querySelectorAll(${JSON.stringify(selector)});
    const scroller = document.scrollingElement || document.documentElement;
    const before = matches.length;
    try {
      const last = matches[matches.length - 1];
      if (last?.scrollIntoView) last.scrollIntoView({ block: 'end', behavior: 'instant' });
    } catch {}
    try { scroller.scrollTo(0, scroller.scrollHeight); } catch {}
    return { count: before, top: scroller.scrollTop, height: scroller.scrollHeight };
  })()`);

  if (info.count >= targetCount) {
    return { reached: true, count: info.count, scrolls: i };
  }

  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 300,
    y: 300,
    deltaX: 0,
    deltaY: 1500,
  });
  await sleep(delayMs);
}

const finalCount = await js(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
return { reached: finalCount >= targetCount, count: finalCount, scrolls: maxScrolls };

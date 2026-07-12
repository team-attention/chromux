// Shared deterministic fixture server for the chromux benchmark suite.
//
// Every page is generated from pure functions of the route (no randomness),
// so payload sizes, expected answers, and task outcomes are reproducible
// across runs and machines. The server also records form submissions and
// per-request user agents so harnesses can machine-grade task success and
// flag non-browser access (e.g. an agent curling the page instead of using
// the browser CLI under test).

import http from 'node:http';

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function orderCode(email, coupon, country) {
  return `ORD-${fnv1a(`${email}|${coupon}|${country}`).toUpperCase()}`;
}

export function navCode() {
  return `NAV-${fnv1a('start>hop1>hop2>finish').toUpperCase()}`;
}

export function stepValue(step) {
  return `V${step}-${fnv1a(`step-${step}`).toUpperCase().slice(0, 6)}`;
}

export function feedStory(i) {
  const points = ((i * 137) + 29) % 1000;
  return {
    index: i,
    title: `Story headline number ${i} with some descriptive words`,
    points,
  };
}

export function feedStats(count = 200, threshold = 700) {
  const stories = Array.from({ length: count }, (_, i) => feedStory(i));
  const above = stories.filter(s => s.points > threshold);
  const top = stories.reduce((a, b) => (b.points > a.points ? b : a));
  return { countAboveThreshold: above.length, threshold, topTitle: top.title, topPoints: top.points };
}

export function inventoryItem(i) {
  const price = ((((i * 271) + 83) % 9000) + 1000) / 100;
  return { index: i, sku: `SKU-${String(i).padStart(3, '0')}`, price };
}

export function inventoryStats(pages = 5, perPage = 8) {
  const items = Array.from({ length: pages * perPage }, (_, i) => inventoryItem(i));
  const top = items.reduce((a, b) => (b.price > a.price ? b : a));
  const above50 = items.filter(item => item.price > 50).length;
  return { topSku: top.sku, topPrice: top.price, above50, pages, perPage };
}

// --- Real-sized page fixtures ---
// Coverage invariant: the suite must always include a page with a sticky
// header + dense nav + consent overlay, a silent slow server round-trip, and
// a same-origin iframe form. Perception gates/probes tuned only on the small
// synthetic pages overfit to them — these pages keep that bias measurable.

const SHOP_PRODUCT_NAMES = [
  'Aurora Desk Lamp', 'Granite Mug', 'Cedar Bookend', 'Brass Compass',
  'Linen Notebook', 'Copper Kettle', 'Walnut Tray', 'Slate Coaster',
  'Ivory Candle', 'Maple Stand', 'Cobalt Vase', 'Amber Clock',
];

export function shopProduct(i) {
  const price = ((((i * 313) + 57) % 12000) + 500) / 100;
  return {
    index: i,
    sku: `SHP-${String(i).padStart(2, '0')}`,
    name: SHOP_PRODUCT_NAMES[i % SHOP_PRODUCT_NAMES.length],
    price,
  };
}

export function shopCode(sku) {
  return `SHOP-${fnv1a(`shop|${sku}`).toUpperCase()}`;
}

export function slowOrderCode(email) {
  return `SLOW-${fnv1a(`slow|${email}`).toUpperCase()}`;
}

export function embedCode(name) {
  return `EMB-${fnv1a(`embed|${name}`).toUpperCase()}`;
}

export function signupChallenge() {
  return { a: 47, b: 269 };
}

export function signupCode(email) {
  return `ACT-${fnv1a(`signup|${email}`).toUpperCase()}`;
}

function articleHtml() {
  return `<!doctype html><title>Fixture Article</title>
    <main>
      <h1>Article</h1>
      <nav><a href="/">Home</a> <a href="/feed">Feed</a> <a href="/form">Form</a> <a href="/start">Tour</a></nav>
      ${'<p>Body paragraph with enough words to resemble a real article page.</p>'.repeat(40)}
      <button id="more">Read more</button>
    </main>`;
}

function formHtml() {
  return `<!doctype html><title>Fixture Checkout</title>
    <main>
      <h1>Checkout</h1>
      <form id="checkout">
        <input id="email" aria-label="Email" placeholder="you@example.com">
        <input id="coupon" aria-label="Coupon">
        <select id="country" aria-label="Country"><option>KR</option><option>US</option><option>JP</option></select>
        <button id="submit" type="submit">Place order</button>
      </form>
      <p id="status">Waiting</p>
    </main>
    <script>
      document.getElementById('checkout').addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
          email: document.getElementById('email').value,
          coupon: document.getElementById('coupon').value,
          country: document.getElementById('country').value,
        };
        document.getElementById('status').textContent = 'Placing order...';
        const res = await fetch('/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        setTimeout(() => {
          document.getElementById('status').textContent = 'Order confirmed: ' + body.code;
        }, 150);
      });
    </script>`;
}

function feedHtml(count = 200) {
  const items = Array.from({ length: count }, (_, i) => {
    const story = feedStory(i);
    return `
      <article>
        <h2><a href="/story/${i}">${story.title}</a></h2>
        <p class="points">${story.points} points</p>
        <p>Teaser paragraph for story ${i}. ${'Filler sentence for realistic text density. '.repeat(3)}</p>
        <div><button data-id="${i}">Upvote</button> <a href="/story/${i}#comments">comments</a></div>
      </article>`;
  }).join('\n');
  return `<!doctype html><title>Fixture Feed</title><main><h1>Feed</h1>${items}</main>`;
}

function hopHtml(route) {
  if (route === '/start') {
    return `<!doctype html><title>Tour Start</title>
      <main><h1>Tour: step 1 of 4</h1><p>Follow the Continue links to the end.</p>
      <a id="continue" href="/hop/1">Continue</a></main>`;
  }
  if (route === '/hop/1') {
    return `<!doctype html><title>Tour Hop 1</title>
      <main><h1>Tour: step 2 of 4</h1><a href="/start">Back</a> <a id="continue" href="/hop/2">Continue</a></main>`;
  }
  if (route === '/hop/2') {
    return `<!doctype html><title>Tour Hop 2</title>
      <main><h1>Tour: step 3 of 4</h1><a href="/hop/1">Back</a> <a id="continue" href="/finish">Continue</a></main>`;
  }
  return `<!doctype html><title>Tour Finish</title>
    <main><h1>Tour complete</h1><p>Your completion code is <strong id="code">${navCode()}</strong>.</p></main>`;
}

function stepsHtml() {
  const values = JSON.stringify({ 1: stepValue(1), 2: stepValue(2), 3: stepValue(3) });
  return `<!doctype html><title>Fixture Steps</title>
    <main>
      <h1>Sequential steps</h1>
      <p>Click each step button in order. Each reveals its value shortly after the click,
      and the next button is enabled only after the previous value appears.</p>
      <button id="step1">Step 1</button> <span id="result1"></span><br>
      <button id="step2" disabled>Step 2</button> <span id="result2"></span><br>
      <button id="step3" disabled>Step 3</button> <span id="result3"></span>
    </main>
    <script>
      const values = ${values};
      for (const step of [1, 2, 3]) {
        document.getElementById('step' + step).addEventListener('click', () => {
          setTimeout(() => {
            document.getElementById('result' + step).textContent = values[step];
            if (step < 3) document.getElementById('step' + (step + 1)).disabled = false;
          }, 120);
        });
      }
    </script>`;
}

function storyHtml(route) {
  const index = Number(route.split('/').pop()) || 0;
  const story = feedStory(index);
  return `<!doctype html><title>${story.title}</title>
    <main><h1>${story.title}</h1><p class="points">${story.points} points</p>
    <p>${'Story body sentence. '.repeat(20)}</p></main>`;
}

function inventoryHtml(route) {
  const { pages, perPage } = inventoryStats();
  const query = route.includes('?') ? route.split('?')[1] : '';
  const page = Math.min(Math.max(Number(new URLSearchParams(query).get('page')) || 1, 1), pages);
  const items = Array.from({ length: perPage }, (_, k) => inventoryItem((page - 1) * perPage + k));
  const pageMax = items.reduce((a, b) => (b.price > a.price ? b : a));
  const rows = items.map(item => `
      <tr><td>${item.sku}</td><td>Warehouse part ${item.index} with a descriptive catalog name</td>
      <td class="price">$${item.price.toFixed(2)}</td></tr>`).join('\n');
  const links = Array.from({ length: pages }, (_, p) =>
    `<a href="/inventory?page=${p + 1}"${p + 1 === page ? ' aria-current="page"' : ''}>Page ${p + 1}</a>`).join(' ');
  return `<!doctype html><title>Inventory page ${page} of ${pages}</title>
    <main>
      <h1>Inventory — page ${page} of ${pages}</h1>
      <nav>${links}</nav>
      <table><thead><tr><th>SKU</th><th>Name</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table>
      <p>Highest price on this page: ${pageMax.sku} at $${pageMax.price.toFixed(2)}.</p>
    </main>`;
}

function signupHtml() {
  return `<!doctype html><title>Fixture Signup</title>
    <main>
      <h1>Create account</h1>
      <form id="signup">
        <input id="name" aria-label="Full name">
        <input id="email" aria-label="Email" placeholder="you@example.com">
        <button id="submit" type="submit">Sign up</button>
      </form>
      <div id="challenge" hidden>
        <p id="challenge-text"></p>
        <input id="challenge-answer" aria-label="Verification answer">
        <button id="verify" type="button">Verify</button>
      </div>
      <p id="status">Waiting</p>
    </main>
    <script>
      document.getElementById('signup').addEventListener('submit', async (event) => {
        event.preventDefault();
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
          }),
        });
        const body = await res.json();
        setTimeout(() => {
          if (!body.ok) { document.getElementById('status').textContent = 'Error: ' + body.error; return; }
          document.getElementById('challenge-text').textContent = body.challenge;
          document.getElementById('challenge').hidden = false;
          document.getElementById('status').textContent = 'Answer the verification question to finish.';
        }, 150);
      });
      document.getElementById('verify').addEventListener('click', async () => {
        const res = await fetch('/api/signup/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value,
            answer: document.getElementById('challenge-answer').value,
          }),
        });
        const body = await res.json();
        setTimeout(() => {
          document.getElementById('status').textContent = body.ok
            ? 'Account created: ' + body.code
            : 'Error: ' + body.error;
        }, 150);
      });
    </script>`;
}

// Real-sized shop page: sticky header, dozens of standard nav links, a
// sidebar of filters, a grid of div-based (cursor:pointer + listener)
// product cards, and a cookie consent dialog that covers the content but
// spares the header. `?consent=bar` swaps the dialog for a bottom-fixed
// consent bar that must NOT be treated as a page-wide overlay.
function shopHtml(route) {
  const query = route.includes('?') ? route.split('?')[1] : '';
  const consent = new URLSearchParams(query).get('consent') || 'modal';
  const cards = Array.from({ length: 12 }, (_, i) => {
    const p = shopProduct(i);
    return `<div class="card" data-sku="${p.sku}"><h3>${p.name}</h3><p>$${p.price.toFixed(2)}</p></div>`;
  }).join('\n');
  const navLinks = Array.from({ length: 24 }, (_, i) => `<a href="/shop?cat=${i}">Category ${i}</a>`).join(' ');
  const filters = ['Under $20', '$20 to $50', 'Over $50', 'In stock', 'On sale', 'New arrivals']
    .map((label, i) => `<label><input type="checkbox" id="f${i}" aria-label="Filter: ${label}"> ${label}</label>`)
    .join('<br>');
  const consentHtml = consent === 'bar'
    ? `<div id="consent" class="consent-bar"><span>We use cookies to improve your experience.</span> <button id="accept">Accept cookies</button></div>`
    : `<div id="consent" class="consent-dialog" role="dialog"><h2>Cookies</h2>
        <p>We use cookies to improve your experience. Accept to continue browsing the catalog.</p>
        <button id="accept">Accept cookies</button> <button id="reject">Reject non-essential</button></div>`;
  return `<!doctype html><title>Fixture Shop</title>
    <style>
      body { margin: 0; font-family: sans-serif; }
      header.top { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 12px; z-index: 10; }
      nav.cats { padding: 8px 12px; border-bottom: 1px solid #eee; line-height: 1.8; }
      .layout { display: flex; gap: 16px; padding: 16px; }
      aside.filters { width: 180px; }
      #grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .card { border: 1px solid #ccc; padding: 12px; cursor: pointer; }
      footer { padding: 24px 12px; border-top: 1px solid #ddd; margin-top: 400px; }
      .consent-dialog { position: fixed; top: 10%; left: 0; right: 0; height: 82%;
        background: #fff; border: 1px solid #333; padding: 24px; z-index: 100; box-shadow: 0 4px 24px rgba(0,0,0,.3); box-sizing: border-box; }
      .consent-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #222; color: #fff; padding: 14px; z-index: 100; }
    </style>
    <header class="top">
      <a href="/shop">Fixture Shop</a>
      <input id="q" aria-label="Search products" placeholder="Search">
      <button id="search">Search</button>
      <a href="/shop?page=account">Account</a> <a href="/shop?page=cart">Cart</a> <a href="/shop?page=help">Help</a>
    </header>
    <nav class="cats">${navLinks}</nav>
    <div class="layout">
      <aside class="filters"><h2>Filters</h2>${filters}</aside>
      <section>
        <div id="grid">${cards}</div>
        <button id="more">Load more products</button>
        <p id="status">No product selected.</p>
      </section>
    </div>
    <footer>
      <a href="/shop?page=about">About</a> <a href="/shop?page=terms">Terms</a> <a href="/shop?page=privacy">Privacy</a>
      <a href="/shop?page=contact">Contact</a> <a href="/shop?page=jobs">Jobs</a>
    </footer>
    ${consentHtml}
    <script>
      document.getElementById('accept').addEventListener('click', () => document.getElementById('consent').remove());
      const reject = document.getElementById('reject');
      if (reject) reject.addEventListener('click', () => document.getElementById('consent').remove());
      function wireCard(card) {
        card.addEventListener('click', async () => {
          const res = await fetch('/api/shop/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: card.dataset.sku }),
          });
          const body = await res.json();
          document.getElementById('status').textContent = 'Selected ' + card.dataset.sku + ': ' + body.code;
        });
      }
      document.querySelectorAll('.card').forEach(wireCard);
      document.getElementById('more').addEventListener('click', () => {
        const grid = document.getElementById('grid');
        const start = grid.children.length;
        for (let i = start; i < start + 6; i++) {
          const div = document.createElement('div');
          div.className = 'card';
          div.dataset.sku = 'SHP-' + String(i).padStart(2, '0');
          div.innerHTML = '<h3>Extra item ' + i + '</h3><p>$' + ((i * 313 + 57) % 12000 + 500) / 100 + '</p>';
          wireCard(div);
          grid.appendChild(div);
        }
      });
    </script>`;
}

// Slow order confirmation: submitting gives NO immediate UI feedback; the
// server takes ~1.5s to answer and only then does the status line change.
// The server records every submission, so an impatient double submit is
// machine-visible (and fails the agent task's grade).
function orderDelayHtml() {
  return `<!doctype html><title>Fixture Slow Checkout</title>
    <main>
      <h1>Express checkout</h1>
      <nav><a href="/">Home</a> <a href="/feed">Feed</a> <a href="/form">Form</a></nav>
      <form id="slow">
        <input id="email" aria-label="Email" placeholder="you@example.com">
        <button id="confirm" type="submit">Confirm order</button>
      </form>
      <p id="status"></p>
    </main>
    <script>
      document.getElementById('slow').addEventListener('submit', async (event) => {
        event.preventDefault();
        const res = await fetch('/api/slow-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.getElementById('email').value }),
        });
        const body = await res.json();
        document.getElementById('status').textContent = 'Order confirmed: ' + body.code;
      });
    </script>`;
}

// Same-origin iframe page: the registration form lives entirely inside an
// embedded frame, like third-party payment/booking widgets.
function embeddedHtml() {
  return `<!doctype html><title>Fixture Partner Portal</title>
    <main>
      <h1>Partner portal</h1>
      <nav><a href="/">Home</a> <a href="/feed">Feed</a> <a href="/shop">Shop</a></nav>
      <p>Complete your registration in the embedded partner form below.</p>
      <iframe src="/embedded/frame" title="Partner registration" style="width: 480px; height: 260px; border: 1px solid #999;"></iframe>
    </main>`;
}

function embeddedFrameHtml() {
  return `<!doctype html><title>Partner Registration</title>
    <main>
      <h2>Register</h2>
      <form id="reg">
        <input id="name" aria-label="Full name" placeholder="Your name">
        <button id="submit" type="submit">Register</button>
      </form>
      <p id="status">Not registered.</p>
    </main>
    <script>
      document.getElementById('reg').addEventListener('submit', async (event) => {
        event.preventDefault();
        const res = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: document.getElementById('name').value }),
        });
        const body = await res.json();
        document.getElementById('status').textContent = 'Registered: ' + body.code;
      });
    </script>`;
}

export function fixtureHtml(route) {
  const path = route.split('?')[0];
  if (path.startsWith('/form')) return formHtml();
  if (path.startsWith('/shop')) return shopHtml(route);
  if (path.startsWith('/order-delay')) return orderDelayHtml();
  if (path === '/embedded/frame') return embeddedFrameHtml();
  if (path.startsWith('/embedded')) return embeddedHtml();
  if (path.startsWith('/inventory')) return inventoryHtml(route);
  if (path.startsWith('/signup')) return signupHtml();
  if (path.startsWith('/feed')) return feedHtml();
  if (path.startsWith('/steps')) return stepsHtml();
  if (path.startsWith('/story/')) return storyHtml(path);
  if (path === '/start' || path.startsWith('/hop/') || path === '/finish') return hopHtml(path);
  return articleHtml();
}

export function startFixtureServer() {
  const state = { orders: [], signups: [], selections: [], slowOrders: [], embeds: [], accessLog: [] };
  const server = http.createServer((req, res) => {
    const route = (req.url || '/').split('?')[0];
    state.accessLog.push({
      route,
      method: req.method,
      userAgent: req.headers['user-agent'] || '',
      at: Date.now(),
    });
    const readJson = (handler) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch {}
        const response = await handler(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    };
    if (req.method === 'POST' && route === '/api/order') {
      readJson((payload) => {
        const code = orderCode(payload.email || '', payload.coupon || '', payload.country || '');
        state.orders.push({ ...payload, code, at: Date.now() });
        return { ok: true, code };
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/shop/select') {
      readJson((payload) => {
        const code = shopCode(payload.sku || '');
        state.selections.push({ sku: payload.sku || '', code, at: Date.now() });
        return { ok: true, code };
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/slow-order') {
      readJson(async (payload) => {
        // Record the submission immediately, answer slowly: an agent that
        // re-submits during the silent window leaves two records. Default
        // 1.5s sits inside chromux's verify escalation ladder (~2.2s); pass
        // delayMs beyond it to exercise the "no visible change yet" path.
        const delayMs = Math.min(Math.max(Number(payload.delayMs) || 1500, 0), 10000);
        state.slowOrders.push({ email: payload.email || '', at: Date.now() });
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return { ok: true, code: slowOrderCode(payload.email || '') };
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/embed') {
      readJson((payload) => {
        const code = embedCode(payload.name || '');
        state.embeds.push({ name: payload.name || '', code, at: Date.now() });
        return { ok: true, code };
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/signup') {
      readJson((payload) => {
        if (!payload.email || !payload.email.includes('@')) {
          return { ok: false, error: 'A valid email address is required.' };
        }
        const { a, b } = signupChallenge();
        state.signups.push({ email: payload.email, name: payload.name || '', phase: 'challenged', at: Date.now() });
        return { ok: true, challenge: `Verification question: what is ${a} + ${b}?` };
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/signup/verify') {
      readJson((payload) => {
        const { a, b } = signupChallenge();
        if (Number(payload.answer) !== a + b) {
          state.signups.push({ email: payload.email || '', phase: 'failed-verify', at: Date.now() });
          return { ok: false, error: 'Wrong verification answer. Read the question again.' };
        }
        const code = signupCode(payload.email || '');
        state.signups.push({ email: payload.email || '', phase: 'verified', code, at: Date.now() });
        return { ok: true, code };
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fixtureHtml(req.url || '/'));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// Close a fixture server even when a still-open browser tab holds keep-alive
// connections to it (plain server.close() would wait on those forever).
export function closeFixtureServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
    setTimeout(resolve, 3000).unref();
  });
}

// True when any page request looks like it came from a non-browser client
// (curl, wget, node fetch, python, etc.) — used to flag cheating in graded runs.
export function nonBrowserAccess(state) {
  return state.accessLog.filter(entry =>
    entry.route !== '/favicon.ico' &&
    !/Mozilla\//.test(entry.userAgent));
}

// Popup: pairing form, connection status, attached tabs, and the kill switch.

const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const portText = document.getElementById("portText");
const tabsEl = document.getElementById("tabs");
const emptyState = document.getElementById("emptyState");
const attachedLabel = document.getElementById("attachedLabel");
const killBtn = document.getElementById("killBtn");
const enableBtn = document.getElementById("enableBtn");

const pairSection = document.getElementById("pairSection");
const pairSummary = document.getElementById("pairSummary");
const tokenInput = document.getElementById("tokenInput");
const portInput = document.getElementById("portInput");
const pairBtn = document.getElementById("pairBtn");
const pairMsg = document.getElementById("pairMsg");

let hasToken = false;
let userTouchedPairSection = false;
pairSection.addEventListener("toggle", () => { if (pairSection.open) userTouchedPairSection = true; });

function render(status) {
  const connected = status.connected;
  const enabled = status.enabled;
  hasToken = !!status.hasToken;
  dot.className = "dot " + (connected ? "on" : enabled ? "" : "off");
  if (connected) statusText.textContent = "Connected";
  else if (!hasToken) statusText.textContent = "Not paired";
  else if (enabled) statusText.textContent = "Waiting for chromux…";
  else statusText.textContent = "Disconnected (kill switch)";
  portText.textContent = status.port ? `port ${status.port}` : "";

  // Auto-open the pairing form when there is no token yet; otherwise fold it
  // (unless the user opened it themselves this session).
  pairSummary.textContent = hasToken ? "Re-pair with chromux" : "Pair with chromux";
  if (!userTouchedPairSection) pairSection.open = !hasToken;
  if (portInput.value === "47700" && status.port) portInput.value = status.port;

  killBtn.hidden = !enabled;
  enableBtn.hidden = enabled;

  const tabs = status.attachedTabs || [];
  tabsEl.innerHTML = "";
  attachedLabel.hidden = tabs.length === 0;
  emptyState.hidden = tabs.length !== 0;
  for (const tab of tabs) {
    const li = document.createElement("li");
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = tab.title || "(untitled)";
    const u = document.createElement("div");
    u.className = "u";
    u.textContent = tab.url || "";
    li.appendChild(t);
    li.appendChild(u);
    tabsEl.appendChild(li);
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (status) => {
    if (chrome.runtime.lastError || !status) {
      statusText.textContent = "Service worker asleep — retrying…";
      return;
    }
    render(status);
  });
}

pairBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  const port = parseInt(portInput.value, 10) || 47700;
  if (!token) {
    pairMsg.textContent = "Paste the token from chromux pair first.";
    pairMsg.className = "pair-msg err";
    return;
  }
  pairMsg.textContent = "Pairing…";
  pairMsg.className = "pair-msg";
  chrome.runtime.sendMessage({ type: "pair", port, token }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      pairMsg.textContent = "Pairing failed — try again.";
      pairMsg.className = "pair-msg err";
      return;
    }
    pairMsg.textContent = "Paired. Connecting…";
    pairMsg.className = "pair-msg ok";
    tokenInput.value = "";
    setTimeout(refresh, 400);
  });
});

killBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "kill" }, refresh);
});
enableBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "enable" }, refresh);
});

refresh();
setInterval(refresh, 1500);

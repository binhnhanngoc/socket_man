// Zero-dependency Tauri/WebView2 end-to-end test over the raw W3C WebDriver protocol
// (no Selenium/WDIO). Drives the REAL release app through tauri-driver: connects the
// WS echo socket, sends a message and asserts the echo, then sends an HTTP request and
// asserts a 200 response.
//
// Interaction is done via WebDriver `execute/sync` (in-page JS: querySelector + native
// .click(), which React's delegated onClick honors). This is more robust on WebView2
// than the element-find endpoint right after session start. Run via run-e2e.mjs.

const DRIVER = process.env.WD_URL || "http://127.0.0.1:4444";
const APP = process.env.APP_PATH;
if (!APP) {
  console.error("APP_PATH env var (path to the app exe) is required");
  process.exit(2);
}
const ECHO_PORT = process.env.ECHO_PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W3C_ELEM = "element-6066-11e4-a41e-4f1166e4e7c2";

async function wd(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WD ${method} ${path} -> ${res.status} ${JSON.stringify(json?.value)?.slice(0, 200)}`);
  return json.value;
}

let SID = null;
/** Run JS in the page; `script` must `return` its value. */
const js = (script) => wd("POST", `/session/${SID}/execute/sync`, { script, args: [] });

// Set a React-controlled input/textarea value via execute/sync. The key detail:
// React skips onChange unless its internal `_valueTracker` sees a CHANGED value, so
// we reset the tracker to the old value before dispatching the input event. (The
// WebDriver element-find/send-keys endpoint is unreliable on this WebView2; execute
// is solid, so we drive the input entirely in-page.)
async function typeUrl(css, value) {
  return js(`
    const el = document.querySelector(${JSON.stringify(css)});
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    const old = el.value;
    setter.call(el, ${JSON.stringify(value)});
    if (el._valueTracker) el._valueTracker.setValue(old);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;`);
}

async function waitFor(label, script, timeoutMs = 25000, intervalMs = 400) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await js(script);
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for: ${label}${lastErr ? ` (last: ${lastErr.message})` : ""}`);
}

const steps = [];
function record(name, ok, detail = "") {
  steps.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run() {
  const session = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: APP } }, firstMatch: [{}] },
  });
  SID = session.sessionId;
  console.log(`session: ${SID} (${session.capabilities?.browserName} ${session.capabilities?.browserVersion})`);

  // 1) Document ready + brand renders (cold WebView2 start can be slow)
  await waitFor("document ready + brand", "return document.readyState==='complete' && !!document.querySelector('.brand-name')", 35000);
  const brand = await js("return document.querySelector('.brand-name').textContent");
  record("App boots, brand renders", String(brand).includes("SocketMan"), `brand="${brand}"`);

  // 2) WS connect — point the URL at the local hermetic echo server, then connect.
  await waitFor("WS Connect button", "return !!document.querySelector('.conn-bar .btn-rust')", 15000);
  const wsUrl = `ws://127.0.0.1:${ECHO_PORT}`;
  const setWs = await typeUrl(".conn-bar .url-input", wsUrl);
  if (setWs !== wsUrl) throw new Error(`failed to set WS url (got ${JSON.stringify(setWs)})`);
  await js("document.querySelector('.conn-bar .btn-rust').click(); return true");
  await waitFor("WS status = Connected", "return !!document.querySelector('.status-chip.connected')", 30000);
  record(`WS connects to ${wsUrl}`, true);

  // 3) Inbound frame after connect (echo server greeting)
  const afterConnect = await waitFor("first log frame", "return document.querySelectorAll('.log-row').length || false", 20000);
  record("Inbound frame received after connect", afterConnect > 0, `${afterConnect} frame(s)`);

  // 4) Send a message (composer) → echoed back → more frames
  await waitFor("composer Send enabled", "const b=document.querySelector('.composer .btn-rust'); return b && !b.disabled", 15000);
  await js("document.querySelector('.composer .btn-rust').click(); return true");
  const grew = await waitFor(
    "echoed frame",
    `return (document.querySelectorAll('.log-row').length > ${afterConnect}) ? document.querySelectorAll('.log-row').length : false`,
    20000
  );
  record("Sent message is echoed back", grew > afterConnect, `${afterConnect} -> ${grew} frames`);

  // 5) HTTP: switch to the GET request item, send, assert 200
  await waitFor(
    "select GET request item",
    "const b=[...document.querySelectorAll('button.item')].find(x=>x.textContent.includes('GET request')); if(b){b.click(); return true;} return false;",
    15000
  );
  await waitFor("HTTP Send button", "return !!document.querySelector('.http-ws .conn-bar .btn-rust')", 15000);
  const httpUrl = `http://127.0.0.1:${ECHO_PORT}/get`;
  const setHttp = await typeUrl(".http-ws .conn-bar .url-input", httpUrl);
  if (setHttp !== httpUrl) throw new Error(`failed to set HTTP url (got ${JSON.stringify(setHttp)})`);
  await js("document.querySelector('.http-ws .conn-bar .btn-rust').click(); return true");
  const status = await waitFor(
    "HTTP response status pill",
    "const p=document.querySelector('.http-resp .status-pill'); return p ? p.textContent : false",
    30000
  );
  record("HTTP GET returns a 200 response", String(status).includes("200"), `status="${status}"`);
}

let exitCode = 0;
try {
  await run();
} catch (e) {
  console.error("E2E ERROR:", e.message);
  exitCode = 1;
} finally {
  if (SID) {
    try {
      await wd("DELETE", `/session/${SID}`);
    } catch {
      /* ignore */
    }
  }
  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n=== E2E summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0 || passed === 0) exitCode = 1;
  process.exit(exitCode);
}

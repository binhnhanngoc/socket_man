// E2E runner: start tauri-driver (proxying the platform WebView2 driver), wait for
// it to listen, run the WebDriver test against the release app binary, then tear
// tauri-driver down. Windows-first (msedgedriver). Node 18+.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startEchoServer } from "./local-echo-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const DRIVER_PORT = 4444;
const APP_PATH = process.env.APP_PATH || resolve(root, "src-tauri/target/release/socketman.exe");
// msedgedriver matching the installed Edge/WebView2; downloaded into .tools/.
const NATIVE_DRIVER = process.env.MSEDGEDRIVER || resolve(root, ".tools/msedgedriver.exe");

if (!existsSync(APP_PATH)) {
  console.error(`app binary not found: ${APP_PATH}\nbuild it first: npm run tauri build`);
  process.exit(2);
}
if (!existsSync(NATIVE_DRIVER)) {
  console.error(`msedgedriver not found: ${NATIVE_DRIVER}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // tauri-driver answers WebDriver /status with 200 once ready.
      const res = await fetch(`${url}/status`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

// Local echo server makes the e2e hermetic (no external WS/HTTP endpoint / flaky DNS).
const echo = await startEchoServer();
console.log(`local echo server: 127.0.0.1:${echo.port}`);

console.log(`tauri-driver: starting (native-driver=${NATIVE_DRIVER})`);
const driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT), "--native-driver", NATIVE_DRIVER], {
  stdio: ["ignore", "inherit", "inherit"],
  shell: true,
});

let code = 1;
try {
  const up = await waitForPort(`http://127.0.0.1:${DRIVER_PORT}`);
  if (!up) throw new Error("tauri-driver did not become ready on port " + DRIVER_PORT);
  console.log("tauri-driver: ready\n--- running e2e ---");

  await new Promise((res) => {
    const test = spawn(process.execPath, [resolve(here, "tauri-e2e.mjs")], {
      stdio: "inherit",
      env: { ...process.env, APP_PATH, WD_URL: `http://127.0.0.1:${DRIVER_PORT}`, ECHO_PORT: String(echo.port) },
    });
    test.on("exit", (c) => {
      code = c ?? 1;
      res();
    });
  });
} catch (e) {
  console.error("runner error:", e.message);
  code = 1;
} finally {
  try {
    echo.close();
  } catch {
    /* ignore */
  }
  // Kill tauri-driver and any app/driver it spawned.
  try {
    driver.kill();
  } catch {
    /* ignore */
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/F", "/T", "/PID", String(driver.pid)], { stdio: "ignore", shell: true });
    // Belt-and-suspenders: kill stray driver/app processes from this run.
    for (const name of ["tauri-driver.exe", "msedgedriver.exe"]) {
      spawn("taskkill", ["/F", "/IM", name], { stdio: "ignore", shell: true });
    }
  }
  await sleep(500);
  console.log(`\nrunner exit code: ${code}`);
  process.exit(code);
}

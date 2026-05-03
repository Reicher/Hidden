import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 3600 + Math.floor(Math.random() * 400);
const HTTP_URL = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 8000;

function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for: ${label}`));
      }
    }, 50);
  });
}

function startServer() {
  const child = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server start timeout. stderr:\n${stderr}`));
    }, SERVER_START_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("Server running on")) {
        clearTimeout(timer);
        resolve(child);
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}. stderr:\n${stderr}`));
    });
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err?.message || String(err);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(
        `${message}\nInstall browser once with: npx playwright install chromium`
      );
    }
    throw err;
  }
}

async function run() {
  const server = await startServer();
  let browser = null;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const clientErrors = [];
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const attachErrorCapture = (page, label) => {
      page.on("console", (msg) => {
        const text = msg.text();
        const type = msg.type();
        if (type === "error" || text.includes("[client:world-render]")) {
          clientErrors.push(`[${label}:console:${type}] ${text}`);
        }
      });
      page.on("pageerror", (err) => {
        clientErrors.push(`[${label}:pageerror] ${err?.message || String(err)}`);
      });
    };
    attachErrorCapture(pageA, "A");
    attachErrorCapture(pageB, "B");

    await pageA.goto(HTTP_URL, { waitUntil: "domcontentloaded" });
    await pageB.goto(HTTP_URL, { waitUntil: "domcontentloaded" });

    const suffix = Date.now().toString().slice(-6);
    await pageA.fill("#nameInput", `pwA_${suffix}`);
    await pageB.fill("#nameInput", `pwB_${suffix}`);
    await pageA.click("#connectBtn");
    await pageB.click("#connectBtn");

    await Promise.all([
      pageA.waitForFunction(() => !document.getElementById("lobbyView")?.classList.contains("hidden"), null, {
        timeout: 8000
      }),
      pageB.waitForFunction(() => !document.getElementById("lobbyView")?.classList.contains("hidden"), null, {
        timeout: 8000
      })
    ]);

    await pageA.click("#playBtn");
    await pageB.click("#playBtn");

    await Promise.all([
      pageA.waitForFunction(() => !document.body.classList.contains("overlay-active"), null, { timeout: 18000 }),
      pageB.waitForFunction(() => !document.body.classList.contains("overlay-active"), null, { timeout: 18000 })
    ]);

    await sleep(1200);

    assert.equal(clientErrors.length, 0, `Client runtime errors found:\n${clientErrors.join("\n")}`);
    console.log("Browser smoke test passed: ready flow starts match and client renders without runtime errors.");
  } finally {
    try {
      await browser?.close();
    } catch {
      // no-op
    }
    server.kill("SIGTERM");
    await sleep(100);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

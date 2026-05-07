import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { startServer, stopServer } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const HTTP_URL = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 8000;

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
  const server = await startServer({ cwd: process.cwd(), host: HOST, port: PORT, timeoutMs: SERVER_START_TIMEOUT_MS });
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

    const waitUntilPlayReady = (page) =>
      page.waitForFunction(() => {
        const btn = document.getElementById("playBtn");
        if (!btn) return false;
        if (!(btn instanceof HTMLButtonElement)) return false;
        if (btn.disabled) return false;
        const style = window.getComputedStyle(btn);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = btn.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }, null, { timeout: 12000 });

    const clickReadyWithRetry = async (page) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await waitUntilPlayReady(page);
        await page.click("#playBtn");
        const toggled = await page.waitForFunction(() => {
          const btn = document.getElementById("playBtn");
          if (!(btn instanceof HTMLButtonElement)) return false;
          return btn.textContent !== "Redo" || btn.disabled;
        }, null, { timeout: 2500 }).then(() => true).catch(() => false);
        if (toggled) return;
      }
      throw new Error("Failed to toggle ready state after clicking #playBtn");
    };

    await Promise.all([clickReadyWithRetry(pageA), clickReadyWithRetry(pageB)]);

    await Promise.all([
      pageA.waitForFunction(() => !document.body.classList.contains("overlay-active"), null, { timeout: 25000 }),
      pageB.waitForFunction(() => !document.body.classList.contains("overlay-active"), null, { timeout: 25000 })
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
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

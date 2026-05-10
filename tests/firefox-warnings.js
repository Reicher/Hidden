/**
 * Körs mot Firefox och rapporterar ALLA console-meddelanden under sidladdning.
 * Används för att hitta "Layout was forced before the page was fully loaded".
 */
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { firefox } from "playwright";
import { startServer, stopServer } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const HTTP_URL = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 8000;

async function run() {
  const server = await startServer({
    cwd: process.cwd(),
    host: HOST,
    port: PORT,
    timeoutMs: SERVER_START_TIMEOUT_MS,
  });

  let browser = null;
  try {
    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const messages = [];

    page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();
      // Collect everything except routine log spam
      if (
        type !== "log" ||
        text.includes("Layout") ||
        text.includes("Autoplay") ||
        text.includes("forced")
      ) {
        messages.push({ type, text, location: msg.location() });
      }
      // Always collect warnings and errors
      if (type === "warning" || type === "error") {
        messages.push({ type, text, location: msg.location() });
      }
    });
    page.on("pageerror", (err) => {
      messages.push({ type: "pageerror", text: err?.message || String(err) });
    });

    await page.goto(HTTP_URL, { waitUntil: "domcontentloaded" });
    // Wait a bit for any deferred layout reads
    await sleep(800);

    const warnings = messages.filter(
      (m) =>
        m.type === "warning" ||
        m.type === "error" ||
        m.text.includes("Layout") ||
        m.text.includes("forced") ||
        m.text.includes("Autoplay"),
    );

    if (warnings.length === 0) {
      console.log("✓ Inga layout/autoplay-varningar i Firefox.");
    } else {
      console.log(`✗ ${warnings.length} varning(ar) hittades:\n`);
      for (const m of warnings) {
        const loc = m.location
          ? ` @ ${m.location.url}:${m.location.lineNumber}`
          : "";
        console.log(`  [${m.type}]${loc}\n  ${m.text}\n`);
      }
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

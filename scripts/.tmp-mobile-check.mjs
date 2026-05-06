import { chromium } from "playwright";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 3962;
const server = spawn("node", ["server.js"], {
  env: { ...process.env, HOST, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});

let ready = false;
server.stdout.on("data", (d) => {
  const t = d.toString();
  if (t.includes("Server running on")) ready = true;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 120 && !ready; i++) await wait(100);
  if (!ready) throw new Error("server not ready");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://${HOST}:${PORT}`);

  await page.fill("#nameInput", "sens-test");
  await page.click("#connectBtn");
  await page.waitForSelector("#lobbyView:not(.hidden)", { timeout: 15000 });

  await page.click("#lobbySettingsBtn");
  await page.click("#lobbyMenuSettingsBtn");
  await page.waitForSelector("#settingsPanel:not(.hidden)", { timeout: 5000 });

  const initial = await page.textContent("#lookSensitivityValue");
  await page.$eval("#lookSensitivityInput", (el) => {
    el.value = "173";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const afterInput = await page.textContent("#lookSensitivityValue");

  const inputValue = await page.$eval("#lookSensitivityInput", (el) => el.value);

  console.log(`INITIAL=${initial}`);
  console.log(`AFTER_INPUT=${afterInput}`);
  console.log(`INPUT_VALUE=${inputValue}`);

  await browser.close();
  server.kill("SIGTERM");
})().catch(async (e) => {
  console.error(e);
  server.kill("SIGTERM");
  process.exit(1);
});

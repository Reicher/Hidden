import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const HTTP_URL = `http://${HOST}:${PORT}`;
const ORIGIN = HTTP_URL;
const SERVER_START_TIMEOUT_MS = 9000;
const DEBUG_TOKEN = `perf_${Math.random().toString(36).slice(2)}`;

const BOT_COUNT = envInt("PERF_BOT_COUNT", 6);
const INPUT_INTERVAL_MS = envInt("PERF_INPUT_INTERVAL_MS", 70);
const ATTACK_INTERVAL_MS = envInt("PERF_ATTACK_INTERVAL_MS", 380);
const MEASURE_MS = envInt("PERF_MEASURE_MS", 10_000);
const SAMPLE_INTERVAL_MS = envInt("PERF_SAMPLE_INTERVAL_MS", 1000);

const PERF_BUDGET = {
  minFps: envNumber("PERF_MIN_FPS", 15),
  maxFrameP95Ms: envNumber("PERF_MAX_FRAME_P95_MS", 85),
  maxRttP95Ms: envNumber("PERF_MAX_RTT_P95_MS", 220),
  minWorldHz: envNumber("PERF_MIN_WORLD_HZ", 0),
  maxTickP95Ms: envNumber("PERF_MAX_TICK_P95_MS", 22),
  maxTickOverBudgetRatio: envNumber("PERF_MAX_TICK_OVER_BUDGET_RATIO", 0.25),
  maxProcessCpuHostShare: envNumber("PERF_MAX_PROCESS_CPU_HOST_SHARE", 75)
};

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * (sorted.length - 1))));
  return sorted[index];
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err?.message || String(err);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(`${message}\nInstall browser once with: npx playwright install chromium`);
    }
    throw err;
  }
}

function summarizeClientPerf(raw) {
  const frameDurationsMs = Array.isArray(raw?.frameDurationsMs) ? raw.frameDurationsMs : [];
  const rttMs = Array.isArray(raw?.rttMs) ? raw.rttMs : [];
  const sampleDurationMs = Math.max(1, Number(raw?.sampleDurationMs) || 1);
  const avgFrameMs = average(frameDurationsMs);
  const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
  const wsInBytes = Number(raw?.ws?.inBytes || 0);
  const wsOutBytes = Number(raw?.ws?.outBytes || 0);
  const wsInMessages = Number(raw?.ws?.inMessages || 0);
  const wsOutMessages = Number(raw?.ws?.outMessages || 0);
  const worldMessages = Number(raw?.ws?.worldMessages || 0);
  const sampleSec = sampleDurationMs / 1000;

  return {
    sampleDurationMs: round(sampleDurationMs, 1),
    frameSamples: frameDurationsMs.length,
    fpsAvg: round(fps, 2),
    frameP50Ms: round(percentile(frameDurationsMs, 0.5), 3),
    frameP95Ms: round(percentile(frameDurationsMs, 0.95), 3),
    frameP99Ms: round(percentile(frameDurationsMs, 0.99), 3),
    rttSamples: rttMs.length,
    rttP50Ms: round(percentile(rttMs, 0.5), 3),
    rttP95Ms: round(percentile(rttMs, 0.95), 3),
    rttP99Ms: round(percentile(rttMs, 0.99), 3),
    wsInBytes,
    wsOutBytes,
    wsInMessages,
    wsOutMessages,
    wsInBytesPerSec: round(wsInBytes / sampleSec, 2),
    wsOutBytesPerSec: round(wsOutBytes / sampleSec, 2),
    worldMessages,
    worldHz: round(worldMessages / sampleSec, 3)
  };
}

function summarizeServerPerf(debugStatsSamples) {
  const publicRoomSnapshots = debugStatsSamples
    .map((sample) => sample?.liveRooms?.find((room) => room?.roomId === "public"))
    .filter(Boolean);
  const processCpuHostShare = debugStatsSamples
    .map((sample) => Number(sample?.systemMetrics?.process?.cpuPercentHostShare))
    .filter(Number.isFinite);

  const latestRoom = publicRoomSnapshots[publicRoomSnapshots.length - 1] || null;
  const tickP95 = Number(latestRoom?.perf?.tick?.p95Ms || 0);
  const tickOverBudgetRatio = Number(latestRoom?.perf?.tick?.overBudgetRatio || 0);

  return {
    sampleCount: debugStatsSamples.length,
    processCpuHostShareP95: round(percentile(processCpuHostShare, 0.95), 3),
    processCpuHostShareMax: round(percentile(processCpuHostShare, 1), 3),
    roomPerf: latestRoom?.perf || null,
    tickP95Ms: round(tickP95, 3),
    tickOverBudgetRatio: round(tickOverBudgetRatio, 4)
  };
}

async function run() {
  const server = await startServer({
    cwd: process.cwd(),
    host: HOST,
    port: PORT,
    timeoutMs: SERVER_START_TIMEOUT_MS,
    env: {
      DEBUG_VIEW_TOKEN: DEBUG_TOKEN
    }
  });

  const clients = [];
  const inputTimers = [];
  const attackTimers = [];
  const debugStatsSamples = [];
  let browser = null;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try {
        const encoder = new TextEncoder();
        const perf = {
          startedAt: performance.now(),
          frameDurationsMs: [],
          rttMs: [],
          ws: {
            inBytes: 0,
            inMessages: 0,
            outBytes: 0,
            outMessages: 0,
            worldMessages: 0
          }
        };
        const wsInstances = [];
        const MAX_FRAME_SAMPLES = 20_000;
        const MAX_RTT_SAMPLES = 5_000;
        let lastFrameAt = performance.now();
        let pingTimer = null;

        function remember(list, value, max) {
          list.push(value);
          if (list.length > max) list.splice(0, list.length - max);
        }

        function countBytes(raw) {
          if (typeof raw === "string") return encoder.encode(raw).length;
          if (raw instanceof ArrayBuffer) return raw.byteLength;
          if (ArrayBuffer.isView(raw)) return raw.byteLength;
          if (raw && typeof raw.byteLength === "number") return raw.byteLength;
          return 0;
        }

        function frameTick(now) {
          const dt = now - lastFrameAt;
          lastFrameAt = now;
          if (dt > 0 && dt < 1000) remember(perf.frameDurationsMs, dt, MAX_FRAME_SAMPLES);
          requestAnimationFrame(frameTick);
        }
        requestAnimationFrame(frameTick);

        const NativeWebSocket = window.WebSocket;
        class InstrumentedWebSocket extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            wsInstances.push(this);
            this.addEventListener("message", (event) => {
              const bytes = countBytes(event.data);
              perf.ws.inBytes += bytes;
              perf.ws.inMessages += 1;
              if (typeof event.data !== "string") return;
              try {
                const msg = JSON.parse(event.data);
                if (msg?.type === "world") perf.ws.worldMessages += 1;
                if (msg?.type === "pong") {
                  const sentAt = Number(msg.clientSentAt);
                  if (Number.isFinite(sentAt)) {
                    const rtt = performance.now() - sentAt;
                    if (rtt >= 0 && rtt < 10_000) remember(perf.rttMs, rtt, MAX_RTT_SAMPLES);
                  }
                }
              } catch {
                // ignore parse errors in perf instrumentation
              }
            });
          }

          send(data) {
            const bytes = countBytes(data);
            perf.ws.outBytes += bytes;
            perf.ws.outMessages += 1;
            return super.send(data);
          }
        }

        window.WebSocket = InstrumentedWebSocket;

        window.__hiddenPerf = {
          reset() {
            perf.startedAt = performance.now();
            perf.frameDurationsMs = [];
            perf.rttMs = [];
            perf.ws.inBytes = 0;
            perf.ws.inMessages = 0;
            perf.ws.outBytes = 0;
            perf.ws.outMessages = 0;
            perf.ws.worldMessages = 0;
          },
          startPing(intervalMs = 500) {
            if (pingTimer) clearInterval(pingTimer);
            pingTimer = setInterval(() => {
              const ws = wsInstances.find((candidate) => candidate.readyState === NativeWebSocket.OPEN);
              if (!ws) return;
              ws.send(JSON.stringify({ type: "ping", clientSentAt: performance.now() }));
            }, intervalMs);
            return true;
          },
          stopPing() {
            if (pingTimer) clearInterval(pingTimer);
            pingTimer = null;
          },
          snapshot() {
            return {
              sampleDurationMs: performance.now() - perf.startedAt,
              frameDurationsMs: perf.frameDurationsMs.slice(),
              rttMs: perf.rttMs.slice(),
              ws: { ...perf.ws }
            };
          }
        };
      } catch (err) {
        window.__hiddenPerfInitError = err?.message || String(err);
      }
    });

    const page = await context.newPage();
    const clientErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") clientErrors.push(`[console:error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      clientErrors.push(`[pageerror] ${err?.message || String(err)}`);
    });

    for (let i = 0; i < BOT_COUNT; i += 1) {
      clients.push(new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: `perf_bot_${i}` }));
    }
    await Promise.all(clients.map((client) => client.opened));
    for (const client of clients) client.send({ type: "login", name: client.name });
    await waitFor(() => clients.every((client) => client.loggedIn), 10_000, "all bots logged in");

    await page.goto(HTTP_URL, { waitUntil: "domcontentloaded" });
    const perfInitError = await page.evaluate(() => window.__hiddenPerfInitError || "");
    assert.equal(perfInitError, "", `failed to init client perf probe: ${perfInitError}`);
    await page.fill("#nameInput", `perf_browser_${Date.now().toString().slice(-6)}`);
    await page.click("#connectBtn");
    await page.waitForFunction(() => !document.getElementById("lobbyView")?.classList.contains("hidden"), null, {
      timeout: 10_000
    });

    for (let i = 0; i < clients.length; i += 1) {
      const bot = clients[i];
      inputTimers.push(
        setInterval(() => {
          const phase = Date.now() * 0.002 + i;
          bot.send({
            type: "input",
            input: {
              forward: Math.sin(phase) > 0,
              backward: Math.sin(phase) < -0.6,
              left: Math.cos(phase) > 0.4,
              right: Math.cos(phase) < -0.4,
              sprint: Math.sin(phase * 0.7) > 0.6,
              yaw: (phase % (Math.PI * 2)),
              pitch: 0
            }
          });
        }, INPUT_INTERVAL_MS)
      );
      attackTimers.push(
        setInterval(() => {
          bot.send({ type: "attack" });
        }, ATTACK_INTERVAL_MS)
      );
    }

    await page.evaluate(() => {
      window.__hiddenPerf?.reset?.();
    });
    await page.evaluate(() => {
      window.__hiddenPerf?.startPing?.(500);
    });
    const sampleCountTarget = Math.max(1, Math.floor(MEASURE_MS / SAMPLE_INTERVAL_MS));
    for (let i = 0; i < sampleCountTarget; i += 1) {
      await sleep(SAMPLE_INTERVAL_MS);
      const response = await fetch(`${HTTP_URL}/api/debug/stats?token=${encodeURIComponent(DEBUG_TOKEN)}`);
      assert.equal(response.status, 200, `debug stats request failed with status ${response.status}`);
      debugStatsSamples.push(await response.json());
    }
    await page.evaluate(() => {
      window.__hiddenPerf?.stopPing?.();
    });

    const rawClientPerf = await page.evaluate(() => window.__hiddenPerf?.snapshot?.());
    assert(rawClientPerf, "missing client perf snapshot");

    const clientPerf = summarizeClientPerf(rawClientPerf);
    const serverPerf = summarizeServerPerf(debugStatsSamples);

    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        host: HOST,
        port: PORT,
        botCount: BOT_COUNT,
        measureMs: MEASURE_MS,
        sampleIntervalMs: SAMPLE_INTERVAL_MS
      },
      budget: PERF_BUDGET,
      client: clientPerf,
      server: serverPerf
    };

    assert.equal(clientErrors.length, 0, `Client runtime errors found:\n${clientErrors.join("\n")}`);
    assert(clientPerf.fpsAvg >= PERF_BUDGET.minFps, `Low client FPS: ${clientPerf.fpsAvg} < ${PERF_BUDGET.minFps}`);
    assert(
      clientPerf.frameP95Ms <= PERF_BUDGET.maxFrameP95Ms,
      `High client frame p95: ${clientPerf.frameP95Ms}ms > ${PERF_BUDGET.maxFrameP95Ms}ms`
    );
    if (PERF_BUDGET.minWorldHz > 0) {
      assert(clientPerf.worldHz >= PERF_BUDGET.minWorldHz, `Low world update rate: ${clientPerf.worldHz} < ${PERF_BUDGET.minWorldHz}`);
    }
    if (clientPerf.rttSamples >= 4) {
      assert(clientPerf.rttP95Ms <= PERF_BUDGET.maxRttP95Ms, `High RTT p95: ${clientPerf.rttP95Ms}ms > ${PERF_BUDGET.maxRttP95Ms}ms`);
    }
    assert(serverPerf.tickP95Ms <= PERF_BUDGET.maxTickP95Ms, `High server tick p95: ${serverPerf.tickP95Ms}ms > ${PERF_BUDGET.maxTickP95Ms}ms`);
    assert(
      serverPerf.tickOverBudgetRatio <= PERF_BUDGET.maxTickOverBudgetRatio,
      `Server tick budget overrun ratio too high: ${serverPerf.tickOverBudgetRatio} > ${PERF_BUDGET.maxTickOverBudgetRatio}`
    );
    if (Number.isFinite(serverPerf.processCpuHostShareP95) && serverPerf.processCpuHostShareP95 > 0) {
      assert(
        serverPerf.processCpuHostShareP95 <= PERF_BUDGET.maxProcessCpuHostShare,
        `High server process CPU host share p95: ${serverPerf.processCpuHostShareP95}% > ${PERF_BUDGET.maxProcessCpuHostShare}%`
      );
    }

    const logsDir = path.join(process.cwd(), "logs");
    await mkdir(logsDir, { recursive: true });
    const reportPath = path.join(logsDir, "perf-baseline.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`[perf] ok fpsAvg=${clientPerf.fpsAvg} frameP95=${clientPerf.frameP95Ms}ms rttP95=${clientPerf.rttP95Ms}ms worldHz=${clientPerf.worldHz}`);
    console.log(`[perf] server tickP95=${serverPerf.tickP95Ms}ms overBudgetRatio=${serverPerf.tickOverBudgetRatio} cpuHostP95=${serverPerf.processCpuHostShareP95}%`);
    console.log(`[perf] report=${reportPath}`);
  } finally {
    for (const timer of inputTimers) clearInterval(timer);
    for (const timer of attackTimers) clearInterval(timer);
    for (const client of clients) client.close();
    await sleep(120);
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

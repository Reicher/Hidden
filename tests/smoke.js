import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 3200 + Math.floor(Math.random() * 400);
const BASE_URL = `ws://${HOST}:${PORT}`;
const ORIGIN = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 7000;

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

class Client {
  constructor(index) {
    this.index = index;
    this.ws = new WebSocket(BASE_URL, [], { headers: { Origin: ORIGIN } });
    this.state = "connecting";
    this.queuePosition = null;
    this.activePlayers = 0;

    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "full") {
        this.state = "full";
        if (typeof msg.queuePosition === "number") this.queuePosition = msg.queuePosition;
      }

      if (msg.type === "countdown") {
        this.state = "countdown";
      }

      if (msg.type === "possess") {
        this.state = "alive";
      }

      if (msg.type === "world" && msg.session) {
        this.state = msg.session.state;
        this.queuePosition = msg.session.queuePosition ?? null;
        this.activePlayers = msg.session.activePlayers ?? this.activePlayers;
      }
    });
  }

  close() {
    if (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
  }
}

async function run() {
  const server = await startServer();
  const clients = [];

  try {
    for (let i = 0; i < 12; i += 1) {
      clients.push(new Client(i));
    }
    await Promise.all(clients.map((c) => c.opened));

    await waitFor(
      () => clients.slice(0, 10).every((c) => c.state === "alive"),
      15000,
      "first 10 clients alive"
    );

    await waitFor(
      () => clients[10].state === "full" && clients[11].state === "full",
      10000,
      "clients 11-12 in full/queue"
    );

    await waitFor(
      () => clients[10].queuePosition === 1 && clients[11].queuePosition === 2,
      5000,
      "queue positions 1 and 2"
    );

    // Disconnect client at queue position 1; client 12 should move to queue position 1.
    clients[10].close();
    await waitFor(
      () => clients[11].state === "full" && clients[11].queuePosition === 1,
      5000,
      "queue compaction after queued disconnect"
    );

    // Free one active slot; queued client should get countdown then become alive.
    const aliveToDisconnect = clients.slice(0, 10).find((c) => c.state === "alive");
    assert.ok(aliveToDisconnect, "expected at least one alive client to disconnect");
    aliveToDisconnect.close();

    await waitFor(() => clients[11].state === "countdown", 7000, "queued client enters countdown");
    await waitFor(() => clients[11].state === "alive", 7000, "queued client becomes alive");

    assert.ok(
      clients[11].activePlayers <= 10,
      `activePlayers exceeded max: ${clients[11].activePlayers}`
    );

    console.log("Smoke test passed: queue FIFO + disconnect behavior is correct.");
  } finally {
    for (const client of clients) client.close();
    await sleep(100);
    server.kill("SIGTERM");
    await sleep(100);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

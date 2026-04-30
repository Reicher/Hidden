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
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(BASE_URL, [], { headers: { Origin: ORIGIN } });
    this.open = false;
    this.loggedIn = false;
    this.fullRejected = false;
    this.state = "auth";

    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        this.open = true;
        resolve();
      });
      this.ws.once("error", reject);
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "login_ok") {
        this.loggedIn = true;
        this.fullRejected = false;
        this.state = "lobby";
      }
      if (msg.type === "login_error" && String(msg.message || "").includes("full")) {
        this.fullRejected = true;
      }
      if (msg.type === "countdown") this.state = "countdown";
      if (msg.type === "possess") this.state = "alive";
      if (msg.type === "world" && msg.session) this.state = msg.session.state;
    });
  }

  send(payload) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
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
    for (let i = 0; i < 11; i += 1) clients.push(new Client(`p${i}`));
    await Promise.all(clients.map((c) => c.opened));

    for (const client of clients) client.send({ type: "login", name: client.name });

    await waitFor(() => clients.slice(0, 10).every((c) => c.loggedIn), 8000, "first 10 clients logged in");
    await waitFor(() => clients[10].fullRejected, 5000, "11th client rejected when full");

    clients[0].send({ type: "play" });
    await waitFor(() => clients[0].state === "countdown", 4000, "countdown starts after play click");
    await waitFor(() => clients[0].state === "alive", 7000, "client becomes alive after countdown");

    clients[0].close();
    await sleep(250);

    clients[10].send({ type: "login", name: clients[10].name });
    await waitFor(() => clients[10].loggedIn, 7000, "login succeeds after slot is freed");

    console.log("Smoke test passed: login/full/lobby->play flow is correct.");
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

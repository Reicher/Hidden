import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 3400 + Math.floor(Math.random() * 400);
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
    this.loggedIn = false;
    this.state = "auth";
    this.systemChat = [];

    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "login_ok") {
        this.loggedIn = true;
        this.state = "lobby";
      }
      if (msg.type === "countdown") this.state = "countdown";
      if (msg.type === "world" && msg.session) this.state = msg.session.state;
      if (msg.type === "chat" && msg.entry?.system) {
        this.systemChat.push(String(msg.entry.text || ""));
      }
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
  const clients = [new Client("r1"), new Client("r2"), new Client("r3")];

  try {
    await Promise.all(clients.map((client) => client.opened));
    for (const client of clients) client.send({ type: "login", name: client.name });
    await waitFor(() => clients.every((client) => client.loggedIn), 7000, "all clients logged in");

    clients[0].send({ type: "ready" });
    clients[1].send({ type: "ready" });

    await waitFor(
      () => clients[0].systemChat.some((line) => line.includes("2/3 spelare redo") && line.includes("30 sekunder")),
      3000,
      "2/3 ready 30-second message"
    );

    await waitFor(
      () => clients[0].systemChat.some((line) => line.includes("2/3 spelare redo") && line.includes("20 sekunder")),
      12000,
      "2/3 ready 20-second message"
    );

    assert.equal(clients[0].state, "lobby", "countdown must not start before everyone is ready");

    clients[2].send({ type: "ready" });

    await waitFor(
      () => clients[0].state === "countdown" && clients[1].state === "countdown" && clients[2].state === "countdown",
      2500,
      "normal 10-second countdown starts immediately when all are ready"
    );

    await waitFor(
      () => clients[0].systemChat.some((line) => line.includes("Nedräkning startad")),
      2500,
      "normal countdown announcement"
    );

    console.log("Supermajority ready test passed: 2/3 timeout and all-ready fast transition behave correctly.");
  } finally {
    for (const client of clients) client.close();
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

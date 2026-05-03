import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 3200 + Math.floor(Math.random() * 120);
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
  constructor(name, roomPath) {
    this.name = name;
    this.roomPath = roomPath;
    this.ws = new WebSocket(`ws://${HOST}:${PORT}${roomPath}`, [], { headers: { Origin: ORIGIN } });
    this.open = false;
    this.loggedIn = false;
    this.state = "auth";
    this.chatHistory = [];

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
        this.state = "lobby";
        this.chatHistory = msg.chatHistory || [];
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
    const roomCode = "private-room-check";
    const sameRoomA = new Client("sameA", `/${roomCode}`);
    const sameRoomB = new Client("sameB", `/${roomCode}`);
    const otherRoomA = new Client("otherA", "/other-room-check");
    const otherRoomB = new Client("otherB", "/other-room-check");
    clients.push(sameRoomA, sameRoomB, otherRoomA, otherRoomB);

    await Promise.all(clients.map((c) => c.opened));
    clients.forEach((c) => c.send({ type: "login", name: c.name }));

    await waitFor(() => clients.every((c) => c.loggedIn), 6000, "all clients logged in");

    sameRoomA.send({ type: "chat", text: "hej privat" });
    otherRoomA.send({ type: "chat", text: "hej andra" });
    await sleep(250);

    sameRoomA.send({ type: "ready" });
    sameRoomB.send({ type: "ready" });
    otherRoomA.send({ type: "ready" });
    otherRoomB.send({ type: "ready" });

    await waitFor(() => sameRoomA.state === "alive", 13000, "sameRoomA becomes alive");
    await waitFor(() => otherRoomA.state === "alive", 13000, "otherRoomA becomes alive");

    sameRoomA.close();
    sameRoomB.close();
    await sleep(300);

    const recreatedRoomClient = new Client("sameC", `/${roomCode}`);
    clients.push(recreatedRoomClient);
    await recreatedRoomClient.opened;
    recreatedRoomClient.send({ type: "login", name: recreatedRoomClient.name });

    await waitFor(() => recreatedRoomClient.loggedIn, 6000, "recreated room login works");

    assert.equal(
      recreatedRoomClient.chatHistory.some((entry) => entry.text === "hej privat"),
      false,
      "private room chat history should be gone after room empties"
    );

    console.log("Private room test passed: per-path room isolation and cleanup works.");
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

import { spawn } from "node:child_process";
import { WebSocket } from "ws";

export function waitFor(predicate, timeoutMs, label) {
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

export function startServer({ cwd, host, port, timeoutMs = 7000, env = {} }) {
  const child = spawn("node", ["server.js"], {
    cwd,
    env: { ...process.env, HOST: host, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server start timeout. stderr:\n${stderr}`));
    }, timeoutMs);

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

export async function stopServer(child, timeoutMs = 3000) {
  if (!child) return;
  if (child.exitCode != null) return;

  const exited = new Promise((resolve) => {
    child.once("exit", () => resolve());
  });

  try {
    child.kill("SIGTERM");
  } catch {
    // no-op
  }

  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  if (child.exitCode != null) return;

  try {
    child.kill("SIGKILL");
  } catch {
    // no-op
  }
  await exited;
}

export class TestClient {
  constructor({ host, port, origin, name, roomPath = "/", collectSystemChat = false }) {
    this.name = name;
    this.roomPath = roomPath;
    this.open = false;
    this.loggedIn = false;
    this.fullRejected = false;
    this.state = "auth";
    this.chatHistory = [];
    this.systemChat = [];
    this.collectSystemChat = Boolean(collectSystemChat);

    this.ws = new WebSocket(`ws://${host}:${port}${roomPath}`, [], { headers: { Origin: origin } });
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
        this.chatHistory = Array.isArray(msg.chatHistory) ? msg.chatHistory : [];
      }
      if (msg.type === "login_error" && String(msg.message || "").includes("full")) {
        this.fullRejected = true;
      }
      if (msg.type === "countdown") this.state = "countdown";
      if (msg.type === "possess") this.state = "alive";
      if (msg.type === "world" && msg.session) this.state = msg.session.state;
      if (this.collectSystemChat && msg.type === "chat" && msg.entry?.system) {
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

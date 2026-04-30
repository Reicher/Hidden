import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import process from "node:process";

const HOST = "127.0.0.1";
const PORT = 3200 + Math.floor(Math.random() * 120);

function startServer() {
  const child = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(PORT),
      HEARTBEAT_INTERVAL_MS: "100"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server start timeout. stderr:\n${stderr}`));
    }, 7000);

    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Server running on")) {
        clearTimeout(timer);
        resolve(child);
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (${code}). stderr:\n${stderr}`));
    });
  });
}

async function main() {
  const server = await startServer();
  try {
    const socket = new net.Socket();
    await new Promise((resolve, reject) => {
      socket.connect(PORT, HOST, resolve);
      socket.once("error", reject);
    });

    const key = randomBytes(16).toString("base64");
    const request = [
      "GET / HTTP/1.1",
      `Host: ${HOST}:${PORT}`,
      `Origin: http://${HOST}:${PORT}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "\r\n"
    ].join("\r\n");

    socket.write(request);

    const handshake = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket handshake timeout")), 3000);
      socket.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        if (text.includes("101 Switching Protocols")) {
          clearTimeout(timer);
          resolve(text);
        }
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.ok(handshake.includes("101 Switching Protocols"), "expected websocket upgrade success");

    const closed = await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setTimeout(() => reject(new Error("Socket was not terminated by heartbeat")), 1500);
      socket.on("close", () => {
        clearTimeout(timer);
        resolve(Date.now() - start);
      });
      socket.on("error", () => {
        // ignored, close event follows for this test
      });
    });

    assert.ok(closed >= 150, `heartbeat close happened too early: ${closed}ms`);
    console.log("Heartbeat timeout test passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

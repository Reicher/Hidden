import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import net from "node:net";
import process from "node:process";
import { startServer, stopServer } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);

async function main() {
  const server = await startServer({
    cwd: process.cwd(),
    host: HOST,
    port: PORT,
    env: { HEARTBEAT_INTERVAL_MS: "100" }
  });
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
    await stopServer(server);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

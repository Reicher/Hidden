import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import process from "node:process";
import { WebSocket } from "ws";
import { startServer, stopServer } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const BASE_HTTP = `http://${HOST}:${PORT}`;
const BASE_WS = `ws://${HOST}:${PORT}`;
const DEBUG_TOKEN = "hardening-token";

function sendRawUpgrade(pathname) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = "";

    socket.connect(PORT, HOST, () => {
      const request = [
        `GET ${pathname} HTTP/1.1`,
        `Host: ${HOST}:${PORT}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        `Origin: ${BASE_HTTP}`,
        "\r\n"
      ].join("\r\n");
      socket.write(request);
    });

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });

    socket.on("error", reject);
    socket.on("close", () => {
      if (!response) resolve("");
    });
  });
}

function wsConnectAndLogin(name) {
  const ws = new WebSocket(BASE_WS, [], { headers: { Origin: BASE_HTTP } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket login timeout")), 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "login", name }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "login_ok") {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function postLargeDebugSettingsPayload() {
  const largeBody = "x".repeat(20 * 1024);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_HTTP}/api/debug/settings?token=${encodeURIComponent(DEBUG_TOKEN)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(largeBody, "utf8")
        }
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk.toString("utf8");
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, text });
        });
      }
    );
    req.on("error", reject);
    req.write(largeBody);
    req.end();
  });
}

async function run() {
  const server = await startServer({
    cwd: process.cwd(),
    host: HOST,
    port: PORT,
    env: { DEBUG_VIEW_TOKEN: DEBUG_TOKEN }
  });
  try {
    const malformedResponse = await sendRawUpgrade("/%E0%A4%A");
    assert.ok(
      malformedResponse.includes("400 Bad Request"),
      `expected 400 for malformed room path, got:\n${malformedResponse}`
    );

    await wsConnectAndLogin("hardening_player");

    const payloadResponse = await postLargeDebugSettingsPayload();
    assert.equal(payloadResponse.statusCode, 413, `expected 413 for large payload, got ${payloadResponse.statusCode}`);
    assert.ok(payloadResponse.text.includes("payload_too_large"), `unexpected response body: ${payloadResponse.text}`);

    console.log("Hardening test passed.");
  } finally {
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

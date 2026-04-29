import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 3900 + Math.floor(Math.random() * 200);
const URL = `ws://${HOST}:${PORT}`;
const ORIGIN = `http://${HOST}:${PORT}`;

function startServer() {
  const child = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(PORT),
      MAX_MESSAGES_PER_WINDOW: "20",
      MESSAGE_WINDOW_MS: "1000",
      INPUT_UPDATE_MIN_MS: "0",
      SPAM_MAX_DROPS_PER_WINDOW: "8"
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
    const ws = new WebSocket(URL, [], { headers: { Origin: ORIGIN } });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const closePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Expected rate-limit disconnect")), 4000);
      ws.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    for (let i = 0; i < 200; i += 1) {
      ws.send(
        JSON.stringify({
          type: "input",
          input: {
            forward: i % 2 === 0,
            backward: false,
            left: false,
            right: i % 2 === 1,
            yaw: i * 0.01
          }
        })
      );
    }

    const code = await closePromise;
    assert.equal(code, 1008, `expected policy disconnect code 1008, got ${code}`);
    console.log("Rate limit test passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

import assert from "node:assert/strict";
import process from "node:process";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 7000;

async function run() {
  const server = await startServer({ cwd: process.cwd(), host: HOST, port: PORT, timeoutMs: SERVER_START_TIMEOUT_MS });
  const clients = [
    new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "r1", collectSystemChat: true }),
    new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "r2", collectSystemChat: true }),
    new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "r3", collectSystemChat: true })
  ];

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
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

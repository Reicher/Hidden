import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 7000;

async function run() {
  const server = await startServer({ cwd: process.cwd(), host: HOST, port: PORT, timeoutMs: SERVER_START_TIMEOUT_MS });
  const clients = [];

  try {
    for (let i = 0; i < 11; i += 1) {
      clients.push(new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: `p${i}` }));
    }
    await Promise.all(clients.map((c) => c.opened));

    for (const client of clients) client.send({ type: "login", name: client.name });

    await waitFor(() => clients.slice(0, 10).every((c) => c.loggedIn), 8000, "first 10 clients logged in");
    await waitFor(() => clients[10].fullRejected, 5000, "11th client rejected when full");

    for (const client of clients.slice(0, 10)) client.send({ type: "ready" });
    await waitFor(() => clients[0].state === "countdown", 4000, "countdown starts after all are ready");

    clients[1].close();
    await sleep(180);
    const reconnectingClient = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "p1" });
    clients.push(reconnectingClient);
    await reconnectingClient.opened;
    reconnectingClient.send({ type: "login", name: "p1" });
    await waitFor(() => reconnectingClient.loggedIn, 5000, "reconnected player logs in during countdown");

    await waitFor(
      () => clients[0].state === "alive" && reconnectingClient.state === "alive",
      13000,
      "ready reconnect joins and becomes alive after countdown"
    );

    clients[0].close();
    await sleep(250);

    clients[10].send({ type: "login", name: clients[10].name });
    await waitFor(() => clients[10].loggedIn, 7000, "login succeeds after slot is freed");

    console.log("Smoke test passed: login/full/lobby->ready flow is correct.");
  } finally {
    for (const client of clients) client.close();
    await sleep(100);
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

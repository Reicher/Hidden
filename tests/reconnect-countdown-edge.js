import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 3901;
const ORIGIN = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 7000;

async function run() {
  const server = await startServer({ cwd: process.cwd(), host: HOST, port: PORT, timeoutMs: SERVER_START_TIMEOUT_MS });
  const clients = [];
  try {
    for (let i = 0; i < 4; i += 1) {
      const client = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: `edge${i}` });
      clients.push(client);
    }
    await Promise.all(clients.map((client) => client.opened));
    for (const client of clients) client.send({ type: "login", name: client.name });
    await waitFor(() => clients.every((client) => client.loggedIn), 7000, "all clients logged in");

    for (const client of clients) client.send({ type: "ready" });
    await waitFor(() => clients.every((client) => client.state === "countdown"), 5000, "all clients in countdown");

    // Disconnect while countdown is still running, then reconnect after countdown end.
    await delay(8500);
    const reconnectName = clients[0].name;
    clients[0].close();
    await delay(1800);

    await waitFor(() => clients.slice(1).some((client) => client.state === "alive"), 4000, "others entered active match");

    const reconnectingClient = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: reconnectName });
    clients.push(reconnectingClient);
    await reconnectingClient.opened;
    reconnectingClient.send({ type: "login", name: reconnectName });
    await waitFor(() => reconnectingClient.loggedIn, 5000, "reconnected player logged in");
    try {
      await waitFor(
        () => reconnectingClient.state === "alive",
        5000,
        "reconnected player should rejoin active round after countdown edge race"
      );
    } catch (error) {
      const others = clients
        .slice(1)
        .map((client) => `${client.name}:${client.state}`)
        .join(", ");
      throw new Error(
        `Expected reconnect to rejoin active round. reconnectState=${reconnectingClient.state}; others=${others}; cause=${error.message}`
      );
    }
    assert.equal(reconnectingClient.state, "alive");

    console.log("Reconnect countdown edge test passed: reconnect near countdown end rejoins active round.");
  } finally {
    for (const client of clients) {
      try {
        client.close();
      } catch {
        // no-op
      }
    }
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

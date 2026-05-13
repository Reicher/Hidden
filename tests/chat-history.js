import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const PORT = 45000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 7000;

async function run() {
  const server = await startServer({
    cwd: process.cwd(),
    host: HOST,
    port: PORT,
    timeoutMs: SERVER_START_TIMEOUT_MS,
  });
  const clients = [];

  try {
    const alice = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "Alice" });
    const bob = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "Bob" });
    clients.push(alice, bob);

    await Promise.all(clients.map((client) => client.opened));
    alice.send({ type: "login", name: alice.name });
    bob.send({ type: "login", name: bob.name });
    await waitFor(() => clients.every((client) => client.loggedIn), 6000, "players logged in");

    alice.send({ type: "ready" });
    bob.send({ type: "ready" });
    await waitFor(
      () => alice.state === "alive" && bob.state === "alive",
      13000,
      "players entered match",
    );

    const spectator = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "Spec",
    });
    clients.push(spectator);
    await spectator.opened;
    spectator.send({ type: "login", name: spectator.name });
    await waitFor(() => spectator.loggedIn, 6000, "spectator logged in");
    spectator.send({ type: "chat", text: "hej från sidan" });
    await waitFor(
      () => alice.chatHistory.some((entry) => entry.text === "hej från sidan"),
      3000,
      "active player received hidden chat history",
    );

    alice.send({ type: "chat", text: "aktivt fuskmeddelande" });
    await sleep(250);
    assert.equal(
      clients.some((client) =>
        client.chatHistory.some((entry) => entry.text === "aktivt fuskmeddelande"),
      ),
      false,
      "alive players must not be able to write chat messages",
    );

    console.log("Chat history test passed: active players retain hidden history and cannot write.");
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

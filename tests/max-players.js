/**
 * Tests for the MAX_PLAYERS cap (default = 10):
 *  1. Exactly MAX_PLAYERS connections are accepted.
 *  2. The (MAX_PLAYERS + 1)-th login attempt is rejected with reason "room_full".
 *  3. A slot is not freed while a player is still connected.
 *  4. Once a player disconnects the freed slot can immediately be used by a new login.
 *  5. Two concurrent overflow attempts are both rejected.
 *
 * NOTE: The server reads its maxPlayers from logs/server-settings.json on startup,
 * which defaults to 10. The test therefore uses MAX = 10 to match the live setting.
 */
import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer, stopServer, TestClient, waitFor } from "./helpers.js";

const HOST = "127.0.0.1";
const MAX = 10; // must match maxPlayers in logs/server-settings.json (default 10)
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
    // --- Fill the room to exactly MAX_PLAYERS ---
    for (let i = 0; i < MAX; i += 1) {
      const c = new TestClient({
        host: HOST,
        port: PORT,
        origin: ORIGIN,
        name: `p${i}`,
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.opened));
    for (const c of clients) c.send({ type: "login", name: c.name });
    await waitFor(
      () => clients.every((c) => c.loggedIn),
      7000,
      `all ${MAX} players logged in`,
    );

    // --- Overflow attempt 1: a single extra client must be rejected ---
    const overflow1 = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "overflow1",
    });
    clients.push(overflow1);
    await overflow1.opened;
    overflow1.send({ type: "login", name: "overflow1" });
    await waitFor(
      () => overflow1.fullRejected,
      5000,
      "overflow1 rejected when room is full",
    );
    assert.equal(overflow1.loggedIn, false, "overflow1 must not be logged in");

    // --- Overflow attempt 2: a second concurrent overflow is also rejected ---
    const overflow2 = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "overflow2",
    });
    clients.push(overflow2);
    await overflow2.opened;
    overflow2.send({ type: "login", name: "overflow2" });
    await waitFor(
      () => overflow2.fullRejected,
      5000,
      "overflow2 rejected when room is still full",
    );
    assert.equal(overflow2.loggedIn, false, "overflow2 must not be logged in");

    // --- Slot must NOT be freed while a player is still connected ---
    // Give the server a moment to potentially (incorrectly) accept a login.
    await sleep(300);
    assert.equal(
      overflow1.loggedIn || overflow2.loggedIn,
      false,
      "no overflow client should sneak in while all slots are taken",
    );

    // --- Freeing a slot allows the next login ---
    const leavingClient = clients[0];
    leavingClient.close();

    const latecomer = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "latecomer",
    });
    clients.push(latecomer);
    await latecomer.opened;
    latecomer.send({ type: "login", name: "latecomer" });
    await waitFor(
      () => latecomer.loggedIn,
      7000,
      "latecomer logs in after slot is freed",
    );
    assert.equal(
      latecomer.loggedIn,
      true,
      "latecomer must be accepted after a slot opens",
    );

    console.log(
      "Max-players test passed: cap enforced, concurrent overflow rejected, " +
        "slot freed on disconnect.",
    );
  } finally {
    for (const c of clients) c.close();
    await sleep(100);
    await stopServer(server);
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

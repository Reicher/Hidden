/**
 * Tests for match start conditions:
 *  1. A single ready player must NOT trigger the countdown (MIN_PLAYERS_TO_START = 2).
 *  2. Countdown is cancelled when a disconnect drops active countdown players
 *     below MIN_PLAYERS_TO_START, and the remaining players are returned to lobby.
 */
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
    // Use MIN_PLAYERS_TO_START=2 (default) explicitly
    env: { MIN_PLAYERS_TO_START: "2" },
  });

  const clients = [];

  try {
    // --- Scenario 1: single player ready – countdown must NOT start ---
    const solo = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "solo",
    });
    clients.push(solo);
    await solo.opened;
    solo.send({ type: "login", name: "solo" });
    await waitFor(() => solo.loggedIn, 5000, "solo logged in");

    solo.send({ type: "ready" });
    // Wait a moment – countdown should not start with only 1 player.
    await sleep(800);
    assert.equal(
      solo.state,
      "lobby",
      "single ready player must stay in lobby (MIN_PLAYERS_TO_START not reached)",
    );

    // --- Scenario 2: second player joins and both ready → countdown starts ---
    const p2 = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "p2",
    });
    clients.push(p2);
    await p2.opened;
    p2.send({ type: "login", name: "p2" });
    await waitFor(() => p2.loggedIn, 5000, "p2 logged in");
    p2.send({ type: "ready" });

    await waitFor(
      () => solo.state === "countdown" && p2.state === "countdown",
      4000,
      "both players enter countdown when MIN_PLAYERS_TO_START is met",
    );

    // --- Scenario 3: disconnect during countdown drops below min → countdown cancels ---
    // p2 disconnects while countdown is still running (countdown is 10 s by default).
    p2.close();

    await waitFor(
      () => solo.state === "lobby",
      5000,
      "remaining player is returned to lobby when countdown is cancelled",
    );

    // Make sure solo is still connected and can interact normally.
    assert.equal(
      solo.loggedIn,
      true,
      "solo client is still logged in after countdown cancel",
    );

    console.log(
      "Match-start test passed: min-player guard, countdown start on threshold, " +
        "and countdown cancel on disconnect all behave correctly.",
    );
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

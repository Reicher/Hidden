/**
 * Tests that a brand new player (not a reconnect) can join a room while a
 * countdown is already running, press ready before it finishes, and be
 * included in the match from the remaining countdown time.
 *
 * Scenario:
 *  1. Two players (A and B) log in and press ready → 10-second countdown starts.
 *  2. A third player (C) connects and logs in *after* the countdown has begun.
 *  3. C presses ready → server should call toCountdownState with the existing
 *     endsAt, so C joins from whereever the countdown currently is.
 *  4. All three players (A, B, C) reach "alive" before the round timeout.
 *  5. A fourth player (D) who does NOT press ready during the countdown must
 *     stay in "lobby" and NOT be pulled into the match.
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
  });

  const clients = [];

  try {
    // --- Players A and B start the countdown ---
    const playerA = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "latejoin-a",
    });
    const playerB = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "latejoin-b",
    });
    clients.push(playerA, playerB);

    await Promise.all([playerA.opened, playerB.opened]);
    playerA.send({ type: "login", name: "latejoin-a" });
    playerB.send({ type: "login", name: "latejoin-b" });
    await waitFor(
      () => playerA.loggedIn && playerB.loggedIn,
      6000,
      "A and B logged in",
    );

    playerA.send({ type: "ready" });
    playerB.send({ type: "ready" });
    await waitFor(
      () => playerA.state === "countdown" && playerB.state === "countdown",
      4000,
      "A and B enter countdown",
    );

    // --- Player C joins mid-countdown and presses ready ---
    // Wait a moment so the countdown has clearly started and some time has elapsed.
    await sleep(1500);

    const playerC = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "latejoin-c",
    });
    clients.push(playerC);
    await playerC.opened;
    playerC.send({ type: "login", name: "latejoin-c" });
    await waitFor(() => playerC.loggedIn, 5000, "C logged in during countdown");

    // C must still be in lobby (not auto-assigned without pressing ready).
    assert.equal(
      playerC.state,
      "lobby",
      "C must be in lobby before pressing ready",
    );

    playerC.send({ type: "ready" });
    await waitFor(
      () => playerC.state === "countdown",
      3000,
      "C enters countdown after pressing ready",
    );

    // --- Player D joins but does NOT press ready ---
    const playerD = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "latejoin-d",
    });
    clients.push(playerD);
    await playerD.opened;
    playerD.send({ type: "login", name: "latejoin-d" });
    await waitFor(() => playerD.loggedIn, 5000, "D logged in during countdown");

    // --- All three ready players (A, B, C) must become alive when countdown ends ---
    await waitFor(
      () =>
        playerA.state === "alive" &&
        playerB.state === "alive" &&
        playerC.state === "alive",
      15000,
      "A, B and C are all alive after countdown",
    );

    // --- D stayed in lobby (never pressed ready) ---
    assert.equal(
      playerD.state,
      "lobby",
      "D must remain in lobby (never pressed ready)",
    );

    console.log(
      "Late-join countdown test passed: player joining mid-countdown and pressing " +
        "ready is included in the match; non-ready player stays in lobby.",
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

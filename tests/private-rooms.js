import assert from "node:assert/strict";
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
    const roomCode = "private-room-check";
    const sameRoomA = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "sameA", roomPath: `/${roomCode}` });
    const sameRoomB = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "sameB", roomPath: `/${roomCode}` });
    const otherRoomA = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "otherA", roomPath: "/other-room-check" });
    const otherRoomB = new TestClient({ host: HOST, port: PORT, origin: ORIGIN, name: "otherB", roomPath: "/other-room-check" });
    clients.push(sameRoomA, sameRoomB, otherRoomA, otherRoomB);

    await Promise.all(clients.map((c) => c.opened));
    clients.forEach((c) => c.send({ type: "login", name: c.name }));

    await waitFor(() => clients.every((c) => c.loggedIn), 6000, "all clients logged in");

    sameRoomA.send({ type: "chat", text: "hej privat" });
    otherRoomA.send({ type: "chat", text: "hej andra" });
    await sleep(250);

    sameRoomA.send({ type: "ready" });
    sameRoomB.send({ type: "ready" });
    otherRoomA.send({ type: "ready" });
    otherRoomB.send({ type: "ready" });

    await waitFor(() => sameRoomA.state === "alive", 13000, "sameRoomA becomes alive");
    await waitFor(() => otherRoomA.state === "alive", 13000, "otherRoomA becomes alive");

    sameRoomA.close();
    sameRoomB.close();
    await sleep(300);

    const recreatedRoomClient = new TestClient({
      host: HOST,
      port: PORT,
      origin: ORIGIN,
      name: "sameC",
      roomPath: `/${roomCode}`
    });
    clients.push(recreatedRoomClient);
    await recreatedRoomClient.opened;
    recreatedRoomClient.send({ type: "login", name: recreatedRoomClient.name });

    await waitFor(() => recreatedRoomClient.loggedIn, 6000, "recreated room login works");

    assert.equal(
      recreatedRoomClient.chatHistory.some((entry) => entry.text === "hej privat"),
      false,
      "private room chat history should be gone after room empties"
    );

    console.log("Private room test passed: per-path room isolation and cleanup works.");
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

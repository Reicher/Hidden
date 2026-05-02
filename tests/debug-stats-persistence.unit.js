import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createDebugStatsStore } from "../server/debugStats.js";

async function run() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hidden-debug-stats-"));
  try {
    const first = createDebugStatsStore({ rootDir, sampleIntervalMs: 60_000 });

    first.recordRoomEvent({
      type: "session_connected",
      roomId: "public",
      roomCode: null,
      isPrivate: false,
      at: 1_710_000_000_000,
      snapshot: { connected: 1, authenticated: 0, active: 0, countdown: 0, lobby: 0 }
    });
    first.recordRoomEvent({
      type: "session_login",
      roomId: "public",
      roomCode: null,
      isPrivate: false,
      at: 1_710_000_000_100,
      name: "Alice",
      snapshot: { connected: 1, authenticated: 1, active: 0, countdown: 0, lobby: 1 }
    });
    first.recordRoomEvent({
      type: "session_login",
      roomId: "private:abc",
      roomCode: "abc",
      isPrivate: true,
      at: 1_710_000_000_200,
      name: "Bob",
      snapshot: { connected: 1, authenticated: 1, active: 1, countdown: 0, lobby: 0 }
    });
    first.recordRoomEvent({
      type: "session_login",
      roomId: "private:abc",
      roomCode: "abc",
      isPrivate: true,
      at: 1_710_000_000_300,
      name: "Alice",
      snapshot: { connected: 1, authenticated: 1, active: 0, countdown: 1, lobby: 0 }
    });

    await first.close();

    const second = createDebugStatsStore({ rootDir, sampleIntervalMs: 60_000 });
    await sleep(50);

    const snapshot = second.getSnapshot();
    const byName = new Map(snapshot.players.map((player) => [player.name, player]));
    const byRoom = new Map(snapshot.rooms.map((room) => [room.roomId, room]));

    assert.equal(snapshot.totals.totalConnections, 1);
    assert.equal(snapshot.totals.totalLogins, 3);
    assert.equal(snapshot.totals.uniqueNames, 2);

    assert.ok(byName.has("Alice"));
    assert.ok(byName.has("Bob"));
    assert.equal(byName.get("Alice").logins, 2);
    assert.equal(byName.get("Bob").logins, 1);
    assert.deepEqual(byName.get("Alice").rooms, ["private:abc", "public"]);
    assert.deepEqual(byName.get("Bob").rooms, ["private:abc"]);

    assert.ok(byRoom.has("public"));
    assert.ok(byRoom.has("private:abc"));
    assert.equal(byRoom.get("public").totalConnections, 1);
    assert.equal(byRoom.get("public").totalLogins, 1);
    assert.deepEqual(byRoom.get("public").uniqueNames, ["Alice"]);
    assert.equal(byRoom.get("private:abc").totalConnections, 0);
    assert.equal(byRoom.get("private:abc").totalLogins, 2);
    assert.deepEqual(byRoom.get("private:abc").uniqueNames, ["Alice", "Bob"]);

    assert.equal(snapshot.current.connected, 0);
    assert.equal(snapshot.current.authenticated, 0);
    assert.equal(snapshot.current.active, 0);

    await second.close();
    console.log("Debug stats persistence test passed.");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

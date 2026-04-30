import { createRoomRuntime } from "./roomRuntime.js";

const PUBLIC_ROOM_ID = "public";
const PRIVATE_CODE_RE = /^[a-z0-9][a-z0-9-]{2,23}$/i;

function parseRoomFromRequestUrl(rawUrl) {
  const parsed = new URL(rawUrl || "/", "http://localhost");
  const segments = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { ok: true, roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false };
  }

  if (segments.length !== 1) return { ok: false, reason: "invalid_path" };

  const roomCode = decodeURIComponent(segments[0]).toLowerCase();
  if (!PRIVATE_CODE_RE.test(roomCode)) {
    return { ok: false, reason: "invalid_room_code" };
  }

  return { ok: true, roomId: `private:${roomCode}`, roomCode, isPrivate: true };
}

export function attachGameRuntime({ server }) {
  const rooms = new Map();

  function ensureRoom({ roomId, roomCode, isPrivate }) {
    const existing = rooms.get(roomId);
    if (existing) return existing;

    const runtime = createRoomRuntime({
      roomId,
      roomCode,
      isPrivate,
      onRoomEmpty: ({ roomId: emptyRoomId }) => {
        const toRemove = rooms.get(emptyRoomId);
        if (!toRemove) return;
        toRemove.close();
        rooms.delete(emptyRoomId);
      }
    });
    rooms.set(roomId, runtime);
    return runtime;
  }

  ensureRoom({ roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false });

  server.on("upgrade", (req, socket, head) => {
    const route = parseRoomFromRequestUrl(req.url || "/");
    if (!route.ok) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const room = ensureRoom(route);
    room.handleUpgrade(req, socket, head);
  });

  server.on("close", () => {
    for (const room of rooms.values()) room.close();
    rooms.clear();
  });
}

import { createRoomRuntime } from "./roomRuntime.js";
import { createDebugStatsStore } from "./debugStats.js";
import { createSystemMetricsCollector } from "./systemMetrics.js";
import { DEBUG_VIEW_TOKEN } from "./config.js";

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

export function attachGameRuntime({ server, rootDir }) {
  const rooms = new Map();
  const debugStats = createDebugStatsStore({ rootDir });
  const systemMetrics = createSystemMetricsCollector();

  function writeJson(res, statusCode, payload) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(statusCode);
    res.end(JSON.stringify(payload));
  }

  function ensureRoom({ roomId, roomCode, isPrivate }) {
    const existing = rooms.get(roomId);
    if (existing) return existing;

    const runtime = createRoomRuntime({
      roomId,
      roomCode,
      isPrivate,
      onStatsEvent: (event) => {
        debugStats.recordRoomEvent(event);
      },
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

  async function handleHttpRequest({ req, res, requestUrl }) {
    if (requestUrl.pathname !== "/api/debug/stats") return false;
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" });
      return true;
    }

    const tokenFromQuery = requestUrl.searchParams.get("token");
    const tokenFromHeader = req.headers["x-debug-token"];
    const providedToken =
      typeof tokenFromQuery === "string" && tokenFromQuery.trim()
        ? tokenFromQuery.trim()
        : typeof tokenFromHeader === "string"
          ? tokenFromHeader.trim()
          : "";
    const configuredToken = String(DEBUG_VIEW_TOKEN || "").trim();
    if (!configuredToken) {
      writeJson(res, 503, { error: "debug_token_not_configured", authRequired: true });
      return true;
    }
    if (providedToken !== configuredToken) {
      writeJson(res, 401, { error: "unauthorized", authRequired: true });
      return true;
    }

    const payload = debugStats.getSnapshot();
    payload.systemMetrics = await systemMetrics.collect();
    payload.liveRooms = [...rooms.values()].map((room) => room.getDebugSnapshot()).sort((a, b) => {
      if (b.current.connected !== a.current.connected) return b.current.connected - a.current.connected;
      return String(a.roomId).localeCompare(String(b.roomId), "sv");
    });
    payload.authRequired = true;
    payload.logFiles = debugStats.logs;
    writeJson(res, 200, payload);
    return true;
  }

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
    debugStats.close().catch(() => {});
  });

  return {
    handleHttpRequest
  };
}

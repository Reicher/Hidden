import fs from "node:fs";
import path from "node:path";
import { createRoomRuntime } from "./roomRuntime.js";
import { createDebugStatsStore } from "./debugStats.js";
import { createSystemMetricsCollector } from "./systemMetrics.js";
import { createDebugApiHandler } from "./debugApi.js";
import { DEBUG_VIEW_TOKEN, layout, gameplay, aiSettings } from "./config.js";

const PUBLIC_ROOM_ID = "public";
const PRIVATE_CODE_RE = /^[a-z0-9][a-z0-9-]{2,23}$/i;
const RESERVED_ROOM_CODES = new Set(["debug"]);
const SETTINGS_DIR_NAME = "logs";
const SETTINGS_FILE_NAME = "server-settings.json";
const SETTINGS_TMP_FILE_NAME = "server-settings.json.tmp";

function parseRoomFromRequestUrl(rawUrl) {
  const parsed = new URL(rawUrl || "/", "http://localhost");
  const segments = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      ok: true,
      roomId: PUBLIC_ROOM_ID,
      roomCode: null,
      isPrivate: false,
    };
  }

  if (segments.length !== 1) return { ok: false, reason: "invalid_path" };

  let roomCode = "";
  try {
    roomCode = decodeURIComponent(segments[0]).toLowerCase();
  } catch {
    return { ok: false, reason: "invalid_room_code" };
  }
  if (!PRIVATE_CODE_RE.test(roomCode)) {
    return { ok: false, reason: "invalid_room_code" };
  }
  if (RESERVED_ROOM_CODES.has(roomCode)) {
    return { ok: false, reason: "invalid_room_code" };
  }

  return { ok: true, roomId: `private:${roomCode}`, roomCode, isPrivate: true };
}

export function attachGameRuntime({ server, rootDir }) {
  const rooms = new Map();
  const debugStats = createDebugStatsStore({ rootDir });
  const systemMetrics = createSystemMetricsCollector();
  const settingsDir = path.join(rootDir, SETTINGS_DIR_NAME);
  const settingsPath = path.join(settingsDir, SETTINGS_FILE_NAME);
  const settingsTmpPath = path.join(settingsDir, SETTINGS_TMP_FILE_NAME);

  function persistedSettingsPayload() {
    return Object.freeze({
      layoutId: layout.getActive().id,
      gameplaySettings: gameplay.get(),
      aiBehaviorSettings: aiSettings.get(),
    });
  }

  function writePersistedServerSettings() {
    const payload = persistedSettingsPayload();
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      settingsTmpPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(settingsTmpPath, settingsPath);
  }

  function loadPersistedServerSettings() {
    if (!fs.existsSync(settingsPath)) return;
    let raw;
    try {
      raw = fs.readFileSync(settingsPath, "utf8");
    } catch (readError) {
      console.warn(
        `[server-settings] Kunde inte läsa ${settingsPath}: ${readError?.message || readError}. Fortsätter med standardinställningar.`,
      );
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn(
        `[server-settings] Ogiltig JSON i ${settingsPath}: ${error?.message || error}. Fortsätter med standardinställningar.`,
      );
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      console.warn(
        `[server-settings] Ogiltigt innehåll i ${settingsPath}. Fortsätter med standardinställningar.`,
      );
      return;
    }

    const hasLayout =
      typeof parsed.layoutId === "string" && parsed.layoutId.trim() !== "";
    if (hasLayout) layout.setActive(parsed.layoutId);

    const gameplayPatch = parsed.gameplaySettings;
    if (gameplayPatch && typeof gameplayPatch === "object") {
      gameplay.set(gameplay.merge(gameplayPatch));
    }

    const aiBehaviorPatch = parsed.aiBehaviorSettings;
    if (aiBehaviorPatch && typeof aiBehaviorPatch === "object") {
      aiSettings.set(aiSettings.merge(aiBehaviorPatch));
    }
  }

  function ensureRoom({ roomId, roomCode, isPrivate }) {
    const existing = rooms.get(roomId);
    if (existing) return existing;

    const runtime = createRoomRuntime({
      roomId,
      roomCode,
      isPrivate,
      onStatsEvent: (event) => {
        if (event.type === "chat") {
          debugStats.recordChatMessage({
            name: event.name,
            text: event.text,
            at: event.at,
          });
        } else {
          debugStats.recordRoomEvent(event);
        }
      },
      onRoomEmpty: ({ roomId: emptyRoomId }) => {
        const toRemove = rooms.get(emptyRoomId);
        if (!toRemove) return;
        toRemove.close();
        rooms.delete(emptyRoomId);
      },
    });
    rooms.set(roomId, runtime);
    return runtime;
  }

  function closeAllRooms() {
    for (const room of rooms.values()) room.close();
    rooms.clear();
  }

  function restartRoomsForSettingsChange() {
    closeAllRooms();
    ensureRoom({ roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false });
  }

  loadPersistedServerSettings();
  ensureRoom({ roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false });

  const debugApi = createDebugApiHandler({
    DEBUG_VIEW_TOKEN,
    debugStats,
    systemMetrics,
    getRooms: () => rooms.values(),
    layout,
    gameplay,
    aiSettings,
    writePersistedSettings: writePersistedServerSettings,
    restartRoomsForSettingsChange,
  });

  async function handleHttpRequest({ req, res, requestUrl }) {
    return debugApi.handleRequest(req, res, requestUrl);
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
    closeAllRooms();
    debugStats.close().catch(() => {});
  });

  async function shutdown() {
    closeAllRooms();
    await debugStats.close().catch(() => {});
  }

  return {
    handleHttpRequest,
    shutdown,
  };
}

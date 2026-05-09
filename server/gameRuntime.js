import fs from "node:fs";
import path from "node:path";
import { createRoomRuntime } from "./roomRuntime.js";
import { createDebugStatsStore } from "./debugStats.js";
import { createSystemMetricsCollector } from "./systemMetrics.js";
import {
  DEBUG_VIEW_TOKEN,
  getActiveLayoutInfo,
  getAvailableLayouts,
  getAiBehaviorSettings,
  getGameplaySettings,
  hasAiBehaviorSettingsPatch,
  hasGameplaySettingsPatch,
  mergeAiBehaviorSettingsPatch,
  mergeGameplaySettingsPatch,
  setAiBehaviorSettings,
  setActiveLayout,
  setGameplaySettings
} from "./config.js";

const PUBLIC_ROOM_ID = "public";
const PRIVATE_CODE_RE = /^[a-z0-9][a-z0-9-]{2,23}$/i;
const RESERVED_ROOM_CODES = new Set(["debug"]);
const SETTINGS_DIR_NAME = "logs";
const SETTINGS_FILE_NAME = "server-settings.json";
const SETTINGS_TMP_FILE_NAME = "server-settings.json.tmp";
const MAX_DEBUG_SETTINGS_BODY_BYTES = 16 * 1024;

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
      layoutId: getActiveLayoutInfo().id,
      gameplaySettings: getGameplaySettings(),
      aiBehaviorSettings: getAiBehaviorSettings()
    });
  }

  function writePersistedServerSettings() {
    const payload = persistedSettingsPayload();
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsTmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(settingsTmpPath, settingsPath);
  }

  function loadPersistedServerSettings() {
    if (!fs.existsSync(settingsPath)) return;
    const raw = fs.readFileSync(settingsPath, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`[server-settings] Ogiltig JSON i ${settingsPath}: ${error?.message || error}`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`[server-settings] Ogiltigt innehåll i ${settingsPath}.`);
    }

    const hasLayout = typeof parsed.layoutId === "string" && parsed.layoutId.trim() !== "";
    if (hasLayout) setActiveLayout(parsed.layoutId);

    const gameplay = parsed.gameplaySettings;
    if (gameplay && typeof gameplay === "object") {
      setGameplaySettings(mergeGameplaySettingsPatch(gameplay));
    }

    const aiBehavior = parsed.aiBehaviorSettings;
    if (aiBehavior && typeof aiBehavior === "object") {
      setAiBehaviorSettings(mergeAiBehaviorSettingsPatch(aiBehavior));
    }
  }

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

  function closeAllRooms() {
    for (const room of rooms.values()) room.close();
    rooms.clear();
  }

  function restartRoomsForSettingsChange() {
    closeAllRooms();
    ensureRoom({ roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false });
  }

  function getProvidedToken(req, requestUrl) {
    const tokenFromQuery = requestUrl.searchParams.get("token");
    const tokenFromHeader = req.headers["x-debug-token"];
    return typeof tokenFromQuery === "string" && tokenFromQuery.trim()
      ? tokenFromQuery.trim()
      : typeof tokenFromHeader === "string"
        ? tokenFromHeader.trim()
        : "";
  }

  function isDebugAuthorized(req, requestUrl, res) {
    const configuredToken = String(DEBUG_VIEW_TOKEN || "").trim();
    if (!configuredToken) {
      writeJson(res, 503, { error: "debug_token_not_configured", authRequired: true });
      return false;
    }
    if (getProvidedToken(req, requestUrl) !== configuredToken) {
      writeJson(res, 401, { error: "unauthorized", authRequired: true });
      return false;
    }
    return true;
  }

  loadPersistedServerSettings();
  ensureRoom({ roomId: PUBLIC_ROOM_ID, roomCode: null, isPrivate: false });

  async function handleHttpRequest({ req, res, requestUrl }) {
    if (requestUrl.pathname === "/api/room-info") {
      if (req.method !== "GET") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      const gameplay = getGameplaySettings();
      writeJson(res, 200, {
        maxPlayers: gameplay.maxPlayers,
        totalCharacters: gameplay.totalCharacters
      });
      return true;
    }

    if (requestUrl.pathname === "/api/debug/stats") {
      if (req.method !== "GET") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      if (!isDebugAuthorized(req, requestUrl, res)) return true;

      const payload = debugStats.getSnapshot();
      payload.systemMetrics = await systemMetrics.collect();
      payload.liveRooms = [...rooms.values()].map((room) => room.getDebugSnapshot()).sort((a, b) => {
        if (b.current.connected !== a.current.connected) return b.current.connected - a.current.connected;
        return String(a.roomId).localeCompare(String(b.roomId), "sv");
      });
      payload.authRequired = true;
      payload.logFiles = debugStats.logs;
      payload.layout = getActiveLayoutInfo();
      payload.gameplaySettings = getGameplaySettings();
      payload.aiBehaviorSettings = getAiBehaviorSettings();
      writeJson(res, 200, payload);
      return true;
    }

    if (requestUrl.pathname === "/api/debug/settings") {
      if (!isDebugAuthorized(req, requestUrl, res)) return true;
      if (req.method === "GET") {
        writeJson(res, 200, {
          authRequired: true,
          layout: getActiveLayoutInfo(),
          availableLayouts: getAvailableLayouts(),
          gameplaySettings: getGameplaySettings(),
          aiBehaviorSettings: getAiBehaviorSettings()
        });
        return true;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }

      let bodyText = "";
      let bodyBytes = 0;
      for await (const chunk of req) {
        const chunkText = typeof chunk === "string" ? chunk : chunk.toString();
        bodyBytes += Buffer.byteLength(chunkText, "utf8");
        if (bodyBytes > MAX_DEBUG_SETTINGS_BODY_BYTES) {
          writeJson(res, 413, { error: "payload_too_large", maxBytes: MAX_DEBUG_SETTINGS_BODY_BYTES });
          return true;
        }
        bodyText += chunkText;
      }

      let parsedBody = null;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        writeJson(res, 400, { error: "invalid_json" });
        return true;
      }

      const requestedLayoutIdRaw = parsedBody?.layoutId;
      const hasLayoutPatch = typeof requestedLayoutIdRaw === "string" && requestedLayoutIdRaw.trim() !== "";
      const requestedLayoutId = hasLayoutPatch ? String(requestedLayoutIdRaw).trim().toLowerCase() : null;
      const hasGameplayPatch = hasGameplaySettingsPatch(parsedBody);
      const hasAiBehaviorPatch = hasAiBehaviorSettingsPatch(parsedBody);
      if (!hasLayoutPatch && !hasGameplayPatch && !hasAiBehaviorPatch) {
        writeJson(res, 400, { error: "no_settings_provided" });
        return true;
      }

      let changed = false;
      const previousLayoutId = getActiveLayoutInfo().id;
      const previousGameplay = getGameplaySettings();
      const previousAiBehavior = getAiBehaviorSettings();
      try {
        if (hasLayoutPatch && requestedLayoutId) {
          changed = setActiveLayout(requestedLayoutId) || changed;
        }
        if (hasGameplayPatch) {
          changed = setGameplaySettings(mergeGameplaySettingsPatch(parsedBody)) || changed;
        }
        if (hasAiBehaviorPatch) {
          changed = setAiBehaviorSettings(mergeAiBehaviorSettingsPatch(parsedBody)) || changed;
        }
        if (changed) {
          try {
            writePersistedServerSettings();
          } catch (persistError) {
            try {
              setActiveLayout(previousLayoutId);
              setGameplaySettings(previousGameplay);
              setAiBehaviorSettings(previousAiBehavior);
            } catch {
              // If rollback fails, keep throwing the persistence error below.
            }
            writeJson(res, 500, {
              error: "persist_failed",
              message: persistError?.message || String(persistError)
            });
            return true;
          }
          restartRoomsForSettingsChange();
        }
      } catch (error) {
        writeJson(res, 400, { error: "invalid_settings", message: error?.message || String(error) });
        return true;
      }

      writeJson(res, 200, {
        ok: true,
        authRequired: true,
        layout: getActiveLayoutInfo(),
        availableLayouts: getAvailableLayouts(),
        gameplaySettings: getGameplaySettings(),
        aiBehaviorSettings: getAiBehaviorSettings()
      });
      return true;
    }

    return false;
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

  return {
    handleHttpRequest
  };
}

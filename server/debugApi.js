/**
 * Debug HTTP API handler.
 * Extracted from gameRuntime so the routing file stays thin.
 *
 * Exposes:
 *   GET  /api/room-info          – public, gameplay settings summary
 *   GET  /api/debug/stats        – auth-gated live stats
 *   GET  /api/debug/settings     – auth-gated settings read
 *   POST /api/debug/settings     – auth-gated settings write
 */

const MAX_DEBUG_SETTINGS_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

/** Simple in-memory sliding-window rate limiter keyed by IP. */
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  return function isAllowed(ip) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = (hits.get(ip) || []).filter((t) => t > cutoff);
    if (prev.length >= maxRequests) {
      hits.set(ip, prev);
      return false;
    }
    prev.push(now);
    hits.set(ip, prev);
    return true;
  };
}

export function createDebugApiHandler({
  DEBUG_VIEW_TOKEN,
  debugStats,
  systemMetrics,
  getRooms,
  getActiveLayoutInfo,
  getAvailableLayouts,
  getGameplaySettings,
  getAiBehaviorSettings,
  setActiveLayout,
  setGameplaySettings,
  setAiBehaviorSettings,
  hasGameplaySettingsPatch,
  hasAiBehaviorSettingsPatch,
  mergeGameplaySettingsPatch,
  mergeAiBehaviorSettingsPatch,
  writePersistedSettings,
  restartRoomsForSettingsChange,
}) {
  function writeJson(res, statusCode, payload) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(statusCode);
    res.end(JSON.stringify(payload));
  }

  function getProvidedToken(req) {
    const tokenFromHeader = req.headers["x-debug-token"];
    return typeof tokenFromHeader === "string" ? tokenFromHeader.trim() : "";
  }

  function isAuthorized(req, requestUrl, res) {
    const configuredToken = String(DEBUG_VIEW_TOKEN || "").trim();
    if (!configuredToken) {
      writeJson(res, 503, {
        error: "debug_token_not_configured",
        authRequired: true,
      });
      return false;
    }
    if (getProvidedToken(req) !== configuredToken) {
      writeJson(res, 401, { error: "unauthorized", authRequired: true });
      return false;
    }
    return true;
  }

  const settingsPostRateLimit = createRateLimiter(
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS,
  );

  async function handleRequest(req, res, requestUrl) {
    if (
      requestUrl.pathname === "/health" ||
      requestUrl.pathname === "/healthz"
    ) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.writeHead(200);
      res.end(
        JSON.stringify({ ok: true, uptime: Math.floor(process.uptime()) }),
      );
      return true;
    }

    if (requestUrl.pathname === "/api/room-info") {
      if (req.method !== "GET") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      const gameplay = getGameplaySettings();
      writeJson(res, 200, {
        maxPlayers: gameplay.maxPlayers,
        totalCharacters: gameplay.totalCharacters,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/debug/stats") {
      if (req.method !== "GET") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      if (!isAuthorized(req, requestUrl, res)) return true;

      const payload = debugStats.getSnapshot();
      payload.systemMetrics = await systemMetrics.collect();
      payload.liveRooms = [...getRooms()]
        .map((room) => room.getDebugSnapshot())
        .sort((a, b) => {
          if (b.current.connected !== a.current.connected)
            return b.current.connected - a.current.connected;
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
      if (!isAuthorized(req, requestUrl, res)) return true;

      if (req.method === "GET") {
        writeJson(res, 200, {
          authRequired: true,
          layout: getActiveLayoutInfo(),
          availableLayouts: getAvailableLayouts(),
          gameplaySettings: getGameplaySettings(),
          aiBehaviorSettings: getAiBehaviorSettings(),
        });
        return true;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return true;
      }

      const clientIp =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "unknown";
      if (!settingsPostRateLimit(clientIp)) {
        writeJson(res, 429, { error: "too_many_requests" });
        return true;
      }

      let bodyText = "";
      let bodyBytes = 0;
      for await (const chunk of req) {
        const chunkText = typeof chunk === "string" ? chunk : chunk.toString();
        bodyBytes += Buffer.byteLength(chunkText, "utf8");
        if (bodyBytes > MAX_DEBUG_SETTINGS_BODY_BYTES) {
          writeJson(res, 413, {
            error: "payload_too_large",
            maxBytes: MAX_DEBUG_SETTINGS_BODY_BYTES,
          });
          req.destroy();
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
      const hasLayoutPatch =
        typeof requestedLayoutIdRaw === "string" &&
        requestedLayoutIdRaw.trim() !== "";
      const requestedLayoutId = hasLayoutPatch
        ? String(requestedLayoutIdRaw).trim().toLowerCase()
        : null;
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
          changed =
            setGameplaySettings(mergeGameplaySettingsPatch(parsedBody)) ||
            changed;
        }
        if (hasAiBehaviorPatch) {
          changed =
            setAiBehaviorSettings(mergeAiBehaviorSettingsPatch(parsedBody)) ||
            changed;
        }
        if (changed) {
          try {
            writePersistedSettings();
          } catch (persistError) {
            try {
              setActiveLayout(previousLayoutId);
              setGameplaySettings(previousGameplay);
              setAiBehaviorSettings(previousAiBehavior);
            } catch {
              // If rollback also fails, surface the original persistence error.
            }
            writeJson(res, 500, {
              error: "persist_failed",
              message: persistError?.message || String(persistError),
            });
            return true;
          }
          restartRoomsForSettingsChange();
        }
      } catch (error) {
        writeJson(res, 400, {
          error: "invalid_settings",
          message: error?.message || String(error),
        });
        return true;
      }

      writeJson(res, 200, {
        ok: true,
        authRequired: true,
        layout: getActiveLayoutInfo(),
        availableLayouts: getAvailableLayouts(),
        gameplaySettings: getGameplaySettings(),
        aiBehaviorSettings: getAiBehaviorSettings(),
      });
      return true;
    }

    return false;
  }

  return { handleRequest };
}

import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createSession } from "./session.js";
import { rawSizeBytes } from "./net.js";

function closeWsSafe(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    ws.terminate();
  }
}

export function createRoomWsLifecycle({
  roomMeta,
  constants,
  worldStaticPayload = null,
  sessions,
  sockets,
  processClientMessage,
  getLobbyCountdown,
  countdownReadyNames,
  markCountdownReconnectGrace,
  appendSystemChat,
  releaseOwnedCharacter,
  countdownPlayerCount,
  cancelLobbyCountdown,
  maybeStartLobbyCountdown,
  send,
  shortSessionId,
  logEvent,
  logWarn,
  emitStatsEvent,
  onInboundMessage = null,
  onRoomEmpty,
}) {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.isAlive === false) {
        const staleSessionId = ws.sessionId || null;
        logEvent("heartbeat_timeout", {
          sessionId: shortSessionId(staleSessionId),
        });
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, constants.HEARTBEAT_INTERVAL_MS);

  wss.on("error", (err) => {
    console.error(`[ws-server-error] ${err?.message || err}`);
  });

  wss.on("connection", (ws, req) => {
    const sessionId = randomUUID();
    const now = Date.now();
    ws.isAlive = true;
    ws.sessionId = sessionId;
    let cleanedUp = false;

    const cleanupSession = (reason, details = {}) => {
      if (cleanedUp) return;
      cleanedUp = true;

      const closingSession = sessions.get(sessionId);
      if (closingSession?.characterId != null) {
        releaseOwnedCharacter(sessionId);
      }
      if (
        getLobbyCountdown() &&
        closingSession?.state === "countdown" &&
        closingSession?.name
      ) {
        countdownReadyNames.add(String(closingSession.name).toLowerCase());
        markCountdownReconnectGrace(closingSession.name);
      }

      if (closingSession?.authenticated && closingSession.name) {
        appendSystemChat([
          { type: "player", name: closingSession.name },
          { type: "text", text: " lämnade spelet", key: "chat.sys.left" },
        ]);
      }

      sessions.delete(sessionId);
      sockets.delete(sessionId);
      if (getLobbyCountdown()) {
        if (countdownPlayerCount() < constants.MIN_PLAYERS_TO_START) {
          cancelLobbyCountdown();
        }
      } else {
        maybeStartLobbyCountdown(Date.now());
      }
      logEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        name: closingSession?.name || null,
        reason,
        ...details,
      });
      emitStatsEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        name: closingSession?.name || null,
        reason,
      });
      if (
        roomMeta.isPrivate &&
        sessions.size === 0 &&
        typeof onRoomEmpty === "function"
      ) {
        onRoomEmpty({ roomId: roomMeta.roomId, roomCode: roomMeta.roomCode });
      }
    };

    const session = createSession(sessionId, now);

    sessions.set(sessionId, session);
    sockets.set(sessionId, ws);
    logEvent("session_connected", {
      sessionId: shortSessionId(sessionId),
      origin: req.headers.origin || "<missing>",
      ip: req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });
    emitStatsEvent("session_connected", {
      sessionId: shortSessionId(sessionId),
    });
    send(ws, "welcome", {
      sessionId,
      maxPlayers: constants.MAX_PLAYERS,
      roomCode: roomMeta.roomCode || null,
      isPrivate: roomMeta.isPrivate,
    });
    if (worldStaticPayload) {
      send(ws, "world_static", worldStaticPayload);
    }

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      if (typeof onInboundMessage === "function") {
        onInboundMessage({
          sessionId,
          bytes: rawSizeBytes(raw),
          at: Date.now(),
        });
      }
      const result = processClientMessage(sessionId, raw);
      if (result === "abuse") {
        const activeSession = sessions.get(sessionId);
        const reason = activeSession?.net.lastDropReason || "unknown";
        const dropped = activeSession?.net.droppedMessages ?? 0;
        logWarn(
          "ratelimit",
          `Spelare kickad pga. spammning – ${dropped} ignorerade meddelanden (anledning: ${reason}).`,
        );
        cleanupSession("abuse_kick", {
          dropReason: reason,
          droppedMessages: dropped,
        });
        closeWsSafe(ws, 1008, "rate limit");
      }
    });

    ws.on("error", (err) => {
      console.error(`[ws-client-error:${sessionId}] ${err?.message || err}`);
      cleanupSession("socket_error", { error: err?.message || String(err) });
      ws.terminate();
    });

    ws.on("close", (code, closeReasonBuffer) => {
      const closeReason =
        closeReasonBuffer && closeReasonBuffer.length > 0
          ? closeReasonBuffer.toString()
          : "";
      cleanupSession("socket_close", { code, closeReason });
    });
  });

  return { wss, heartbeatInterval };
}

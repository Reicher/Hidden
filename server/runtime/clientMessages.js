import { rawSizeBytes, rawToText } from "./net.js";

export function createClientMessageProcessor({
  sessions,
  roomCode,
  isPrivate,
  constants,
  normalizePlayerName,
  normalizeChatText,
  authenticatedCount,
  activePlayerCount,
  findAuthenticatedByName,
  pruneCountdownReconnectGrace,
  hasCountdownReconnectGrace,
  countdownReadyNames,
  countdownReconnectGraceByName,
  getLobbyCountdown,
  getPendingRoundReset,
  getActiveMatchStartedAt,
  assignCharacterForCountdown,
  clearSpectatorTarget,
  toCountdownState,
  maybeStartLobbyCountdown,
  setSessionSpectating,
  cycleSpectatorTarget,
  returnToLobby,
  releaseOwnedCharacter,
  sendToSession,
  appendSystemChat,
  shortSessionId,
  emitStatsEvent,
  logEvent,
  clampPitch,
  normalizeAngle,
}) {
  function dropMessage(session, reason) {
    session.net.droppedMessages += 1;
    session.net.lastDropReason = reason;
    const now = Date.now();
    if (now - session.net.dropWindowStartAt >= constants.SPAM_DROP_WINDOW_MS) {
      session.net.dropWindowStartAt = now;
      session.net.dropWindowCount = 0;
    }
    session.net.dropWindowCount += 1;
    if (
      session.net.droppedMessages === 1 ||
      session.net.droppedMessages % 10 === 0
    ) {
      logEvent("message_drop", {
        sessionId: shortSessionId(session.id),
        reason,
        droppedTotal: session.net.droppedMessages,
        droppedInWindow: session.net.dropWindowCount,
      });
    }
    return session.net.dropWindowCount > constants.SPAM_MAX_DROPS_PER_WINDOW;
  }

  function processLogin(sessionId, name) {
    const session = sessions.get(sessionId);
    if (!session) return "ignored";
    if (session.authenticated) {
      sendToSession(sessionId, "login_error", {
        message: "Du är redan inloggad.",
      });
      return "ok";
    }

    const normalizedName = normalizePlayerName(name);
    if (normalizedName.length < constants.NAME_MIN_LEN) {
      sendToSession(sessionId, "login_error", {
        message: `Namnet måste vara minst ${constants.NAME_MIN_LEN} tecken.`,
      });
      return "ok";
    }

    if (authenticatedCount() >= constants.MAX_PLAYERS) {
      sendToSession(sessionId, "login_error", {
        message: "Rummet är fullt.",
        reason: "room_full",
        roomCode: roomCode || null,
        isPrivate,
      });
      return "ok";
    }

    if (findAuthenticatedByName(normalizedName)) {
      sendToSession(sessionId, "login_error", {
        message: "Namnet är upptaget.",
      });
      return "ok";
    }

    const loginAt = Date.now();
    pruneCountdownReconnectGrace(loginAt);

    session.authenticated = true;
    session.name = normalizedName;
    session.state = "lobby";
    session.ready = false;
    session.readyAt = 0;
    clearSpectatorTarget(session);
    const normalizedNameKey = normalizedName.toLowerCase();
    const lobbyCountdown = getLobbyCountdown();
    if (lobbyCountdown && countdownReadyNames.has(normalizedNameKey)) {
      session.ready = true;
      toCountdownState(session, lobbyCountdown.endsAt);
    } else {
      const activePlayers = activePlayerCount();
      if (
        !lobbyCountdown &&
        !getPendingRoundReset() &&
        activePlayers > 0 &&
        hasCountdownReconnectGrace(normalizedName, loginAt)
      ) {
        if (assignCharacterForCountdown(session, loginAt)) {
          session.state = "alive";
          session.ready = false;
          session.readyAt = loginAt;
          session.input.attackRequested = false;
          appendSystemChat([
            { type: "player", name: normalizedName },
            { type: "text", text: " återanslöt till pågående runda" },
          ]);
        }
      }
    }
    countdownReconnectGraceByName.delete(normalizedNameKey);

    logEvent("session_login", {
      sessionId: shortSessionId(sessionId),
      name: normalizedName,
    });
    emitStatsEvent("session_login", {
      sessionId: shortSessionId(sessionId),
      name: normalizedName,
    });

    sendToSession(sessionId, "login_ok", {
      name: normalizedName,
      chatHistory: constants.chatHistory,
      maxPlayers: constants.MAX_PLAYERS,
      roomCode: roomCode || null,
      isPrivate,
    });

    // If a countdown is running, immediately inform the new player so they
    // see the join-prompt without waiting for the first world-tick.
    const activeCountdown = getLobbyCountdown();
    if (activeCountdown) {
      const msRemaining = Math.max(0, activeCountdown.endsAt - Date.now());
      if (msRemaining > 0) {
        sendToSession(sessionId, "countdown_info", {
          msRemaining,
          seconds: Math.max(1, Math.ceil(msRemaining / 1000)),
        });
      }
    }

    appendSystemChat([
      { type: "player", name: normalizedName },
      { type: "text", text: " joinade spelet" },
    ]);
    return "ok";
  }

  function processChat(sessionId, textRaw) {
    const session = sessions.get(sessionId);
    if (!session || !session.authenticated) return "ignored";
    if (session.state === "alive") return "ok";
    const text = normalizeChatText(textRaw);
    if (!text) return "ok";
    if (session.state === "spectating") {
      const entry = constants.appendChat({ name: session.name, text });
      logEvent("chat", {
        sessionId: shortSessionId(sessionId),
        name: session.name,
        text,
      });
      if (!isPrivate) emitStatsEvent("chat", { name: session.name, text });
      constants.broadcastChatToNonActivePlayers(entry);
      return "ok";
    }

    const entry = constants.appendChat({ name: session.name, text });
    logEvent("chat", {
      sessionId: shortSessionId(sessionId),
      name: session.name,
      text,
    });
    if (!isPrivate) emitStatsEvent("chat", { name: session.name, text });
    constants.broadcast("chat", { entry });
    return "ok";
  }

  function processClientMessage(sessionId, raw) {
    const session = sessions.get(sessionId);
    if (!session) return "ignored";
    session.net.lastActivityAt = Date.now();

    if (rawSizeBytes(raw) > constants.MAX_MESSAGE_BYTES) {
      return dropMessage(session, "size") ? "abuse" : "dropped";
    }

    let msg;
    try {
      msg = JSON.parse(rawToText(raw));
    } catch {
      return dropMessage(session, "json") ? "abuse" : "dropped";
    }

    const at = Date.now();
    if (at - session.net.windowStartAt >= constants.MESSAGE_WINDOW_MS) {
      session.net.windowStartAt = at;
      session.net.windowCount = 0;
    }
    session.net.windowCount += 1;
    if (session.net.windowCount > constants.MAX_MESSAGES_PER_WINDOW) {
      return dropMessage(session, "rate_window") ? "abuse" : "dropped";
    }

    if (msg.type === "login") return processLogin(sessionId, msg.name);
    if (msg.type === "chat") return processChat(sessionId, msg.text);
    if (msg.type === "ping") {
      const clientSentAt = Number(msg.clientSentAt);
      sendToSession(sessionId, "pong", {
        clientSentAt: Number.isFinite(clientSentAt) ? clientSentAt : null,
        serverAt: at,
      });
      return "ok";
    }

    if (!session.authenticated) {
      return dropMessage(session, "unauthenticated") ? "abuse" : "dropped";
    }

    if (msg.type === "spectate") {
      if (session.state === "alive" || session.state === "countdown") {
        sendToSession(sessionId, "action_error", {
          message: "Du spelar redan i den här rundan.",
        });
        return "ok";
      }
      if (getActiveMatchStartedAt() <= 0) {
        sendToSession(sessionId, "action_error", {
          message: "Ingen match pågår just nu.",
        });
        return "ok";
      }
      setSessionSpectating(session, at, { randomTarget: true });
      return "ok";
    }

    if (msg.type === "spectate_cycle") {
      if (session.state !== "spectating") return "ok";
      const direction = Number(msg.direction) < 0 ? -1 : 1;
      cycleSpectatorTarget(session, direction, at);
      return "ok";
    }

    if (msg.type === "ready") {
      if (session.state === "alive") return "ok";
      if (session.state === "spectating") {
        sendToSession(sessionId, "action_error", {
          message: "Du åskådar just nu. Återgå till lobbyn först.",
        });
        return "ok";
      }
      if (session.state === "won") {
        sendToSession(sessionId, "action_error", {
          message: "Du vann nyss. Återgå till lobbyn för ny runda.",
        });
        return "ok";
      }
      if (session.state === "downed") {
        sendToSession(sessionId, "action_error", {
          message: "Du är nedslagen. Återgå till lobbyn med knappen.",
        });
        return "ok";
      }
      if (getPendingRoundReset()) {
        sendToSession(sessionId, "action_error", {
          message: "Vänta tills vinnaren återgår till lobbyn.",
        });
        return "ok";
      }
      if (getActiveMatchStartedAt() > 0) {
        sendToSession(sessionId, "action_error", {
          message: "Match pågår. Vänta tills rundan är slut.",
        });
        return "ok";
      }
      const wantsReady = msg.ready !== false;
      if (wantsReady) {
        if (!session.ready) {
          session.ready = true;
          const lobbyCountdown = getLobbyCountdown();
          if (lobbyCountdown) toCountdownState(session, lobbyCountdown.endsAt);
          maybeStartLobbyCountdown(at);
        }
      } else if (session.ready) {
        if (session.state === "countdown") {
          sendToSession(sessionId, "action_error", {
            message: "Nedräkning pågår. Du kan inte ångra ready nu.",
          });
          return "ok";
        }
        session.ready = false;
        maybeStartLobbyCountdown(at);
      }
      return "ok";
    }

    if (msg.type === "leave_match") {
      if (
        session.state === "alive" ||
        session.state === "downed" ||
        session.state === "won" ||
        session.state === "spectating"
      ) {
        releaseOwnedCharacter(sessionId);
        returnToLobby(session, "left_match");
        appendSystemChat([
          { type: "player", name: session.name },
          { type: "text", text: " lämnade matchen" },
        ]);
      }
      return "ok";
    }

    if (msg.type === "input") {
      if (at - session.net.lastInputAt < constants.INPUT_UPDATE_MIN_MS) {
        // Frequent input updates are benign; ignore extras instead of counting them as abuse.
        return "ok";
      }
      session.net.lastInputAt = at;

      const input = msg.input || {};
      session.input.forward = Boolean(input.forward);
      session.input.backward = Boolean(input.backward);
      session.input.left = Boolean(input.left);
      session.input.right = Boolean(input.right);
      session.input.sprint = Boolean(input.sprint);
      if (typeof input.yaw === "number" && Number.isFinite(input.yaw)) {
        session.input.yaw = normalizeAngle(input.yaw);
      }
      if (typeof input.pitch === "number" && Number.isFinite(input.pitch)) {
        session.input.pitch = clampPitch(input.pitch);
      }
      return "ok";
    }

    if (msg.type === "attack") {
      if (
        at - session.net.lastAttackRequestAt <
        constants.ATTACK_MESSAGE_MIN_MS
      ) {
        // Frequent attack messages are normal player behaviour (button-mashing).
        // Silently ignore extras instead of counting them as drops/abuse.
        return "ok";
      }
      session.net.lastAttackRequestAt = at;
      session.input.attackRequested =
        session.state === "alive" && session.characterId != null;
      return "ok";
    }

    return dropMessage(session, "unknown_type") ? "abuse" : "dropped";
  }

  return {
    processClientMessage,
  };
}

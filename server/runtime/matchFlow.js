export function createMatchFlow({
  sessions,
  characters,
  constants,
  state,
  countdownReadyNames,
  countdownReconnectGraceByName,
  authenticatedSessions,
  countdownPlayerCount,
  normalizePlayerName,
  shortSessionId,
  sendToSession,
  appendSystemChat,
  logEvent,
  emitStatsEvent,
  pruneCountdownReconnectGrace,
  markCountdownReconnectGrace,
  releaseOwnedCharacter,
  clearSpectatorTarget,
  isCharacterDowned,
  clearDownedState,
  resetArenaForNextRound,
}) {
  function countdownMsRemaining(now = Date.now()) {
    const lobbyCountdown = state.getLobbyCountdown();
    if (!lobbyCountdown) return 0;
    return Math.max(0, lobbyCountdown.endsAt - now);
  }

  function assignCharacterForCountdown(session, now) {
    if (!session || !session.authenticated) return false;
    if (session.characterId != null) {
      const owned = characters[session.characterId];
      if (
        owned?.ownerSessionId === session.id &&
        owned?.controllerType === "PLAYER"
      ) {
        session.input.yaw = owned.yaw;
        session.input.pitch = owned.pitch;
        sendToSession(session.id, "possess", { characterId: owned.id });
        return true;
      }
      session.characterId = null;
    }

    const standingAvailable = characters.find(
      (c) =>
        c.controllerType === "AI" &&
        c.ownerSessionId == null &&
        !isCharacterDowned(c, now),
    );
    const available =
      standingAvailable ||
      characters.find(
        (c) => c.controllerType === "AI" && c.ownerSessionId == null,
      );
    if (!available) {
      session.ready = false;
      session.state = "lobby";
      session.readyAt = 0;
      sendToSession(session.id, "action_error", {
        message: "Ingen ledig karaktär just nu.",
      });
      return false;
    }
    clearDownedState(available);

    available.controllerType = "PLAYER";
    available.ownerSessionId = session.id;
    available.everPlayerControlled = true;
    session.characterId = available.id;
    session.readyAt = now;
    session.input.yaw = available.yaw;
    session.input.pitch = available.pitch;
    session.input.attackRequested = false;

    logEvent("session_possess", {
      sessionId: shortSessionId(session.id),
      name: session.name,
      characterId: available.id,
      x: Number(available.x.toFixed(2)),
      z: Number(available.z.toFixed(2)),
      yaw: Number(available.yaw.toFixed(2)),
    });
    sendToSession(session.id, "possess", { characterId: available.id });
    return true;
  }

  function toCountdownState(session, endsAt) {
    if (!session?.authenticated || !session.ready) return;
    if (session.state === "alive") return;
    const now = Date.now();
    if (!assignCharacterForCountdown(session, now)) return;
    session.state = "countdown";
    session.readyAt = endsAt;
    session.input.attackRequested = false;
    if (session.name)
      countdownReadyNames.add(String(session.name).toLowerCase());
    sendToSession(session.id, "countdown", {
      seconds: Math.max(1, Math.ceil((endsAt - now) / 1000)),
    });
  }

  function cancelLobbyCountdown() {
    const lobbyCountdown = state.getLobbyCountdown();
    if (!lobbyCountdown) return;
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "countdown") continue;
      if (session.characterId != null) {
        releaseOwnedCharacter(session.id);
        session.characterId = null;
      }
      session.state = "lobby";
      session.readyAt = 0;
    }
    state.setLobbyCountdown(null);
    countdownReadyNames.clear();
    countdownReconnectGraceByName.clear();
    appendSystemChat([{ type: "text", text: "Nedräkning avbruten" }]);
  }

  function cancelSupermajorityReadyTimeout() {
    state.setSupermajorityReadyTimeout(null);
  }

  function startSupermajorityReadyTimeout(now) {
    state.setSupermajorityReadyTimeout({
      endsAt: now + constants.SUPERMAJORITY_READY_TIMEOUT_SECONDS * 1000,
      nextAnnounceSecond:
        constants.SUPERMAJORITY_READY_TIMEOUT_SECONDS -
        constants.SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS,
    });
    appendSystemChat([
      {
        type: "text",
        text: `2/3 spelare redo. Matchstart om ${constants.SUPERMAJORITY_READY_TIMEOUT_SECONDS} sekunder om inte alla blir redo tidigare.`,
      },
    ]);
  }

  function announceSupermajorityReadyTimeout(now) {
    const supermajorityReadyTimeout = state.getSupermajorityReadyTimeout();
    if (!supermajorityReadyTimeout) return;
    while (
      supermajorityReadyTimeout.nextAnnounceSecond > 0 &&
      now >=
        supermajorityReadyTimeout.endsAt -
          supermajorityReadyTimeout.nextAnnounceSecond * 1000
    ) {
      const seconds = supermajorityReadyTimeout.nextAnnounceSecond;
      appendSystemChat([
        {
          type: "text",
          text: `2/3 spelare redo. Matchstart om ${seconds} sekunder om inte alla blir redo tidigare.`,
        },
      ]);
      supermajorityReadyTimeout.nextAnnounceSecond -=
        constants.SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS;
    }
  }

  function startLobbyCountdown(
    now,
    seconds = constants.ROUND_COUNTDOWN_SECONDS,
  ) {
    const endsAt = now + seconds * 1000;
    cancelSupermajorityReadyTimeout();
    countdownReadyNames.clear();
    pruneCountdownReconnectGrace(now);
    state.setLobbyCountdown({
      endsAt,
      lastAnnouncedSecond: null,
    });
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "lobby" || !session.ready) continue;
      toCountdownState(session, endsAt);
    }
    logEvent("countdown_start", {
      seconds,
      players: countdownPlayerCount(),
    });
    emitStatsEvent("countdown_start", {
      seconds,
      players: countdownPlayerCount(),
    });
    appendSystemChat([{ type: "text", text: "Nedräkning startad" }]);
  }

  function maybeStartLobbyCountdown(now) {
    if (state.getLobbyCountdown()) return;
    if (state.getActiveMatchStartedAt() > 0) return;
    if (state.getPendingRoundReset()) return;
    const lobbyPlayers = authenticatedSessions().filter(
      (session) => session.state === "lobby",
    );
    if (lobbyPlayers.length < constants.MIN_PLAYERS_TO_START) {
      cancelSupermajorityReadyTimeout();
      return;
    }
    const readyCount = lobbyPlayers.reduce(
      (count, session) => count + (session.ready ? 1 : 0),
      0,
    );
    if (readyCount >= lobbyPlayers.length) {
      startLobbyCountdown(now);
      return;
    }
    const readyNeededForSupermajority = Math.ceil(
      (lobbyPlayers.length * 2) / 3,
    );
    if (readyCount < readyNeededForSupermajority) {
      cancelSupermajorityReadyTimeout();
      return;
    }
    if (!state.getSupermajorityReadyTimeout()) {
      startSupermajorityReadyTimeout(now);
      return;
    }
    announceSupermajorityReadyTimeout(now);
    if (now >= state.getSupermajorityReadyTimeout().endsAt) {
      startLobbyCountdown(now);
    }
  }

  function finalizeLobbyCountdown(now) {
    if (!state.getLobbyCountdown()) return;
    const participants = authenticatedSessions().filter(
      (session) => session.state === "countdown" && session.ready,
    );
    state.setLobbyCountdown(null);
    countdownReadyNames.clear();
    pruneCountdownReconnectGrace(now);
    for (const session of participants)
      markCountdownReconnectGrace(session.name, now);
    appendSystemChat([{ type: "text", text: "Spel startat" }]);
    for (const session of participants) {
      if (
        session.characterId == null &&
        !assignCharacterForCountdown(session, now)
      )
        continue;
      session.state = "alive";
      session.ready = false;
      session.readyAt = now;
      session.input.attackRequested = false;
      emitStatsEvent("session_alive", {
        sessionId: shortSessionId(session.id),
        name: session.name,
      });
    }
  }

  function returnToLobby(session, reason = "return_to_lobby") {
    if (!session) return;
    const previousState = session.state;
    session.state = "lobby";
    session.ready = false;
    session.characterId = null;
    session.readyAt = 0;
    session.input.attackRequested = false;
    session.eliminatedAt = 0;
    session.returnToLobbyAt = 0;
    session.eliminatedByName = null;
    clearSpectatorTarget(session);
    if (previousState !== "lobby") {
      emitStatsEvent("session_lobby", {
        sessionId: shortSessionId(session.id),
        name: session.name,
        reason,
      });
    }
  }

  function endCurrentMatch(now, winnerSession = null) {
    const winnerSessionId = winnerSession?.id || null;
    if (winnerSession?.authenticated && winnerSession.name) {
      winnerSession.stats.wins += 1;
      appendSystemChat([
        { type: "player", name: normalizePlayerName(winnerSession.name) },
        { type: "text", text: " vann matchen!" },
      ]);
      appendSystemChat([
        {
          type: "text",
          text: `Spelet avslutas om ${Math.ceil(constants.MATCH_END_RETURN_TO_LOBBY_MS / 1000)} sekunder`,
        },
      ]);
    }
    const matchEndsAt = winnerSessionId
      ? now + constants.MATCH_END_RETURN_TO_LOBBY_MS
      : 0;

    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (
        winnerSessionId &&
        session.id === winnerSessionId &&
        session.state === "alive" &&
        session.characterId != null
      ) {
        session.state = "won";
        session.ready = false;
        session.readyAt = 0;
        session.input.attackRequested = false;
        session.returnToLobbyAt = matchEndsAt;
        session.eliminatedByName = null;
        continue;
      }
      if (session.state === "alive") returnToLobby(session, "round_ended");
      if (session.state === "downed" || session.state === "spectating") {
        if (!winnerSessionId) {
          returnToLobby(session, "round_ended");
        } else {
          session.readyAt = 0;
          session.input.attackRequested = false;
          session.returnToLobbyAt = matchEndsAt;
        }
      }
      if (session.state === "countdown") {
        releaseOwnedCharacter(session.id);
        session.characterId = null;
        session.state = "lobby";
        session.readyAt = 0;
      }
      session.ready = false;
    }

    state.setLobbyCountdown(null);
    cancelSupermajorityReadyTimeout();
    countdownReadyNames.clear();
    countdownReconnectGraceByName.clear();
    state.setActiveMatchStartedAt(0);
    state.setPendingRoundReset(Boolean(winnerSessionId));
    if (!state.getPendingRoundReset()) resetArenaForNextRound(now);
  }

  return {
    countdownMsRemaining,
    toCountdownState,
    cancelLobbyCountdown,
    maybeStartLobbyCountdown,
    finalizeLobbyCountdown,
    endCurrentMatch,
    assignCharacterForCountdown,
    returnToLobby,
  };
}

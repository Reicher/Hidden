export function createRoomTickLoop({
  constants,
  sessions,
  sockets,
  characters,
  movement,
  checkInvariants,
  pruneCountdownReconnectGrace,
  disconnectIdleSessions,
  releaseOwnedCharacter,
  returnToLobby,
  appendSystemChat,
  authenticatedSessions,
  resetArenaForNextRound,
  getPendingRoundReset,
  setPendingRoundReset,
  getLobbyCountdown,
  countdownPlayerCount,
  cancelLobbyCountdown,
  finalizeLobbyCountdown,
  maybeStartLobbyCountdown,
  isCharacterDowned,
  handleAttack,
  activePlayerCount,
  endCurrentMatch,
  getActiveMatchStartedAt,
  setActiveMatchStartedAt,
  maintainSpectatorTarget,
  aliveSpectatorCandidates,
  scoreboardSnapshot,
  countdownMsRemaining,
  send,
  sendRaw,
  onTick = null,
}) {
  const KNOCKDOWN_RISE_LOCK_MS = 420;
  const LOBBY_BROADCAST_INTERVAL_MS = 250; // 4 Hz when no active match
  let lastTickAt = Date.now();
  let lastBroadcastAt = 0;
  let cachedScoreboard = [];
  let nextScoreboardRefreshAt = 0;

  function isEndMatchState(session) {
    return (
      session.state === "won" ||
      session.state === "downed" ||
      session.state === "spectating"
    );
  }

  function serializeCharacter(c, now) {
    const r = (v) => Math.round(v * 1000) / 1000;
    return {
      id: c.id,
      x: r(c.x),
      z: r(c.z),
      yaw: r(c.yaw),
      pitch: r(c.pitch || 0),
      inspectDownedTargetId: Number.isFinite(c.ai?.inspectDownedTargetId)
        ? Number(c.ai.inspectDownedTargetId)
        : -1,
      inspectDownedActive:
        Number.isFinite(c.ai?.inspectDownedTargetId) &&
        c.ai.inspectDownedTargetId >= 0 &&
        now < Number(c.ai?.inspectDownedUntil || 0),
      controllerType: c.controllerType,
      cooldownMsRemaining: Math.max(
        0,
        constants.ATTACK_COOLDOWN_MS - (now - c.lastAttackAt),
      ),
      attackFlashMsRemaining: Math.max(
        0,
        constants.ATTACK_FLASH_MS - (now - c.lastAttackAt),
      ),
      downedMsRemaining: Math.max(0, c.downedUntil - now),
      downedDurationMs: constants.NPC_DOWNED_RESPAWN_MS,
      fallAwayX: r(c.fallAwayX || 0),
      fallAwayZ: r(c.fallAwayZ || 1),
    };
  }

  function serializeSession(
    session,
    now,
    { alivePlayers, spectatorCandidates },
  ) {
    if (!session) return null;
    const playerCharacter =
      session.characterId != null ? characters[session.characterId] : null;
    const spectatorTargetSession =
      session.spectatingSessionId != null
        ? sessions.get(session.spectatingSessionId)
        : null;
    return {
      state: session.state,
      authenticated: session.authenticated,
      name: session.name,
      characterId: session.characterId,
      ready: Boolean(session.ready || session.state === "countdown"),
      countdownMsRemaining: countdownMsRemaining(now),
      activePlayers: alivePlayers,
      minPlayersToStart: constants.MIN_PLAYERS_TO_START,
      maxPlayers: constants.MAX_PLAYERS,
      returnToLobbyMsRemaining: isEndMatchState(session)
        ? Math.max(0, (session.returnToLobbyAt || 0) - now)
        : 0,
      eliminatedByName:
        session.state === "downed" || session.state === "spectating"
          ? session.eliminatedByName || null
          : null,
      spectatorTargetCharacterId:
        session.state === "spectating"
          ? (session.spectatingCharacterId ?? null)
          : null,
      spectatorTargetName:
        session.state === "spectating"
          ? spectatorTargetSession?.name || null
          : null,
      spectatorCandidates:
        session.state === "spectating"
          ? spectatorCandidates.map((c) => ({
              name: c.name,
              characterId: c.characterId,
            }))
          : [],
      attackCooldownMsRemaining: playerCharacter
        ? Math.max(
            0,
            constants.ATTACK_COOLDOWN_MS - (now - playerCharacter.lastAttackAt),
          )
        : 0,
    };
  }

  const tickInterval = setInterval(() => {
    const now = Date.now();
    const tickStartedAt = now;
    const dt = Math.min(0.1, (now - lastTickAt) / 1000);
    lastTickAt = now;
    checkInvariants(now);
    pruneCountdownReconnectGrace(now);
    disconnectIdleSessions(now);

    let matchEndedByTimeout = false;
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (!isEndMatchState(session)) continue;
      const returnAt = Number(session.returnToLobbyAt || 0);
      if (!Number.isFinite(returnAt) || returnAt <= 0 || now < returnAt)
        continue;
      releaseOwnedCharacter(session.id);
      returnToLobby(session, "match_end_timeout");
      matchEndedByTimeout = true;
    }
    if (matchEndedByTimeout) {
      appendSystemChat([{ type: "text", text: "Spelet avslutat" }]);
    }
    if (getPendingRoundReset()) {
      const hasEndMatchParticipants =
        authenticatedSessions().some(isEndMatchState);
      if (!hasEndMatchParticipants) {
        resetArenaForNextRound(now);
        setPendingRoundReset(false);
      }
    }

    const lobbyCountdown = getLobbyCountdown();
    if (lobbyCountdown) {
      if (countdownPlayerCount() < constants.MIN_PLAYERS_TO_START) {
        cancelLobbyCountdown();
      } else if (now >= lobbyCountdown.endsAt) {
        finalizeLobbyCountdown(now);
      }
    } else {
      maybeStartLobbyCountdown(now);
    }

    for (const c of characters) {
      const currentlyDowned = isCharacterDowned(c, now);
      if (currentlyDowned) {
        c.wasDownedLastTick = true;
        continue;
      }
      if (c.wasDownedLastTick) {
        c.wasDownedLastTick = false;
        c.downedRecoveryUntil = Math.max(
          Number(c.downedRecoveryUntil || 0),
          now + KNOCKDOWN_RISE_LOCK_MS,
        );
        c.ai.mode = "stop";
        c.ai.desiredYaw = c.yaw;
        c.ai.nextDecisionAt = Math.max(
          Number(c.ai.nextDecisionAt || 0),
          c.downedRecoveryUntil,
        );
      }
      if (now < Number(c.downedRecoveryUntil || 0)) continue;

      if (c.controllerType === "AI") {
        movement.updateAI(c, dt, now, { characters, isCharacterDowned });
        continue;
      }

      const ownerSession = c.ownerSessionId
        ? sessions.get(c.ownerSessionId)
        : null;
      if (
        !ownerSession ||
        (ownerSession.state !== "alive" &&
          ownerSession.state !== "countdown" &&
          ownerSession.state !== "won")
      ) {
        c.controllerType = "AI";
        c.ownerSessionId = null;
        continue;
      }

      if (ownerSession.state === "alive" || ownerSession.state === "won")
        movement.updatePlayer(c, ownerSession, dt);

      if (
        ownerSession.state === "alive" &&
        ownerSession.input.attackRequested
      ) {
        handleAttack(c.id, now);
        ownerSession.input.attackRequested = false;
      }
    }

    if (sockets.size === 0) return;

    let alivePlayers = activePlayerCount();
    let activeMatchStartedAt = getActiveMatchStartedAt();
    if (activeMatchStartedAt > 0 && alivePlayers <= 1) {
      let winnerSession = null;
      if (alivePlayers === 1) {
        winnerSession =
          authenticatedSessions().find(
            (session) =>
              session.state === "alive" && session.characterId != null,
          ) || null;
      }
      endCurrentMatch(now, winnerSession);
      alivePlayers = activePlayerCount();
      activeMatchStartedAt = getActiveMatchStartedAt();
    }
    if (alivePlayers > 0 && activeMatchStartedAt === 0) {
      setActiveMatchStartedAt(now);
      activeMatchStartedAt = now;
    }
    if (alivePlayers === 0) {
      setActiveMatchStartedAt(0);
      activeMatchStartedAt = 0;
    }

    // Throttle broadcasts to 4 Hz when no match or countdown is active.
    // During gameplay the full 20 Hz is preserved.
    const needsFullRate = alivePlayers > 0 || getLobbyCountdown() != null;
    if (!needsFullRate && now - lastBroadcastAt < LOBBY_BROADCAST_INTERVAL_MS) {
      if (typeof onTick === "function") {
        onTick({
          at: now,
          durationMs: Math.max(0, Date.now() - tickStartedAt),
        });
      }
      return;
    }
    lastBroadcastAt = now;

    for (const session of sessions.values())
      maintainSpectatorTarget(session, now);

    const match = {
      inProgress: alivePlayers > 0,
      alivePlayers,
      startedAt: activeMatchStartedAt || null,
      elapsedMs: activeMatchStartedAt ? now - activeMatchStartedAt : 0,
      pendingReset: getPendingRoundReset(),
    };
    if (now >= nextScoreboardRefreshAt) {
      cachedScoreboard = scoreboardSnapshot();
      nextScoreboardRefreshAt = now + 250;
    }
    const scoreboard = cachedScoreboard;
    const spectatorCandidates = aliveSpectatorCandidates(now);

    // Serialize the shared world data once; only the per-client session differs.
    // This avoids re-serializing the full characters array for every connected client.
    const sharedJson = JSON.stringify({
      type: "world",
      worldSizeMeters: constants.WORLD_SIZE_METERS,
      worldWidthMeters: constants.WORLD_WIDTH_METERS,
      worldHeightMeters: constants.WORLD_HEIGHT_METERS,
      shelves: constants.SHELVES,
      coolers: constants.COOLERS,
      freezers: constants.FREEZERS,
      scoreboard,
      characters: characters.map((c) => serializeCharacter(c, now)),
      match,
    });

    for (const [sessionId, ws] of sockets.entries()) {
      const session = sessions.get(sessionId);
      const sessionJson = JSON.stringify(
        serializeSession(session, now, { alivePlayers, spectatorCandidates }),
      );
      // Strip the trailing '}' from sharedJson and append the per-client session.
      const body = sharedJson.slice(0, -1) + ',"session":' + sessionJson + "}";
      sendRaw(ws, body);
    }

    if (typeof onTick === "function") {
      onTick({
        at: now,
        durationMs: Math.max(0, Date.now() - tickStartedAt),
      });
    }
  }, constants.TICK_MS);

  return { tickInterval };
}

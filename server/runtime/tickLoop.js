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
  onTick = null
}) {
  const KNOCKDOWN_RISE_LOCK_MS = 420;
  let lastTickAt = Date.now();
  let cachedScoreboard = [];
  let nextScoreboardRefreshAt = 0;

  const tickInterval = setInterval(() => {
    const tickStartedAt = Date.now();
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTickAt) / 1000);
    lastTickAt = now;
    checkInvariants(now);
    pruneCountdownReconnectGrace(now);
    disconnectIdleSessions(now);

    let matchEndedByTimeout = false;
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "won" && session.state !== "downed" && session.state !== "spectating") continue;
      const returnAt = Number(session.returnToLobbyAt || 0);
      if (!Number.isFinite(returnAt) || returnAt <= 0 || now < returnAt) continue;
      releaseOwnedCharacter(session.id);
      returnToLobby(session, "match_end_timeout");
      matchEndedByTimeout = true;
    }
    if (matchEndedByTimeout) {
      appendSystemChat([{ type: "text", text: "Spelet avslutat" }]);
    }
    if (getPendingRoundReset()) {
      const hasEndMatchParticipants = authenticatedSessions().some(
        (session) => session.state === "won" || session.state === "downed" || session.state === "spectating"
      );
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
        c.downedRecoveryUntil = Math.max(Number(c.downedRecoveryUntil || 0), now + KNOCKDOWN_RISE_LOCK_MS);
        c.ai.mode = "stop";
        c.ai.desiredYaw = c.yaw;
        c.ai.nextDecisionAt = Math.max(Number(c.ai.nextDecisionAt || 0), c.downedRecoveryUntil);
      }
      if (now < Number(c.downedRecoveryUntil || 0)) continue;

      if (c.controllerType === "AI") {
        movement.updateAI(c, dt, now, { characters, isCharacterDowned });
        continue;
      }

      const ownerSession = c.ownerSessionId ? sessions.get(c.ownerSessionId) : null;
      if (!ownerSession || (ownerSession.state !== "alive" && ownerSession.state !== "countdown" && ownerSession.state !== "won")) {
        c.controllerType = "AI";
        c.ownerSessionId = null;
        continue;
      }

      if (ownerSession.state === "alive" || ownerSession.state === "won") movement.updatePlayer(c, ownerSession, dt);

      if (ownerSession.state === "alive" && ownerSession.input.attackRequested) {
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
          authenticatedSessions().find((session) => session.state === "alive" && session.characterId != null) || null;
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

    for (const session of sessions.values()) maintainSpectatorTarget(session, now);

    const match = {
      inProgress: alivePlayers > 0,
      alivePlayers,
      startedAt: activeMatchStartedAt || null,
      elapsedMs: activeMatchStartedAt ? now - activeMatchStartedAt : 0
    };
    if (now >= nextScoreboardRefreshAt) {
      cachedScoreboard = scoreboardSnapshot();
      nextScoreboardRefreshAt = now + 250;
    }
    const scoreboard = cachedScoreboard;
    const spectatorCandidates = aliveSpectatorCandidates(now);

    const worldState = {
      worldSizeMeters: constants.WORLD_SIZE_METERS,
      worldWidthMeters: constants.WORLD_WIDTH_METERS,
      worldHeightMeters: constants.WORLD_HEIGHT_METERS,
      shelves: constants.SHELVES,
      coolers: constants.COOLERS,
      freezers: constants.FREEZERS,
      scoreboard,
      characters: characters.map((c) => ({
        id: c.id,
        x: Number(c.x.toFixed(3)),
        z: Number(c.z.toFixed(3)),
        yaw: Number(c.yaw.toFixed(3)),
        pitch: Number((c.pitch || 0).toFixed(3)),
        inspectDownedTargetId: Number.isFinite(c.ai?.inspectDownedTargetId)
          ? Number(c.ai.inspectDownedTargetId)
          : -1,
        inspectDownedActive:
          Number.isFinite(c.ai?.inspectDownedTargetId) &&
          c.ai.inspectDownedTargetId >= 0 &&
          now < Number(c.ai?.inspectDownedUntil || 0),
        controllerType: c.controllerType,
        cooldownMsRemaining: Math.max(0, constants.ATTACK_COOLDOWN_MS - (now - c.lastAttackAt)),
        attackFlashMsRemaining: Math.max(0, constants.ATTACK_FLASH_MS - (now - c.lastAttackAt)),
        downedMsRemaining: Math.max(0, c.downedUntil - now),
        downedDurationMs: constants.NPC_DOWNED_RESPAWN_MS,
        fallAwayX: Number((c.fallAwayX || 0).toFixed(3)),
        fallAwayZ: Number((c.fallAwayZ || 1).toFixed(3))
      }))
    };

    for (const [sessionId, ws] of sockets.entries()) {
      const session = sessions.get(sessionId);
      const playerCharacter = session && session.characterId != null ? characters[session.characterId] : null;
      const spectatorTargetSession =
        session?.spectatingSessionId != null ? sessions.get(session.spectatingSessionId) : null;
      const spectatorTargetName = spectatorTargetSession?.name || null;
      send(ws, "world", {
        ...worldState,
        match,
        session: session
          ? {
              state: session.state,
              authenticated: session.authenticated,
              name: session.name,
              characterId: session.characterId,
              ready: Boolean(session.ready || session.state === "countdown"),
              countdownMsRemaining: countdownMsRemaining(now),
              activePlayers: alivePlayers,
              minPlayersToStart: constants.MIN_PLAYERS_TO_START,
              maxPlayers: constants.MAX_PLAYERS,
              returnToLobbyMsRemaining:
                session.state === "won" || session.state === "downed" || session.state === "spectating"
                  ? Math.max(0, (session.returnToLobbyAt || 0) - now)
                  : 0,
              eliminatedByName:
                session.state === "downed" || session.state === "spectating"
                  ? session.eliminatedByName || null
                  : null,
              spectatorTargetCharacterId:
                session.state === "spectating" ? session.spectatingCharacterId ?? null : null,
              spectatorTargetName: session.state === "spectating" ? spectatorTargetName : null,
              spectatorCandidates:
                session.state === "spectating"
                  ? spectatorCandidates.map((candidate) => ({
                      name: candidate.name,
                      characterId: candidate.characterId
                    }))
                  : [],
              attackCooldownMsRemaining: playerCharacter
                ? Math.max(0, constants.ATTACK_COOLDOWN_MS - (now - playerCharacter.lastAttackAt))
                : 0
            }
          : null
      });
    }

    if (typeof onTick === "function") {
      onTick({
        at: now,
        durationMs: Math.max(0, Date.now() - tickStartedAt)
      });
    }
  }, constants.TICK_MS);

  return { tickInterval };
}

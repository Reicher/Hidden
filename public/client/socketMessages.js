export function handleSocketMessage(msg, ctx) {
  const {
    state,
    constants,
    roomSystem,
    avatarSystem,
    actions,
    inputController,
    getNowMs
  } = ctx;

  if (msg.type === "login_ok") {
    state.authenticated = true;
    state.myName = msg.name || state.pendingLoginName || "";
    actions.resetSessionRuntimeState({ maxPlayers: msg.maxPlayers });
    actions.replaceChat(msg.chatHistory || []);
    actions.setConnectError("");
    actions.setPrivateRoomButtonVisible(false);
    actions.setAppMode("lobby");
    return;
  }

  if (msg.type === "login_error") {
    actions.resetSessionRuntimeState({ clearIdentity: true });
    actions.setAppMode("connect");
    actions.setConnectError(msg.message || "Inloggning misslyckades.");
    actions.setPrivateRoomButtonVisible(msg.reason === "room_full");
    return;
  }

  if (msg.type === "action_error") {
    actions.setCountdownTextFromSession({ state: "lobby" });
    actions.setConnectError(msg.message || "Kunde inte utföra åtgärden.");
    return;
  }

  if (msg.type === "chat") {
    actions.appendChat(msg.entry);
    return;
  }

  if (msg.type === "knockdown_confirm") {
    const victimName = String(msg.victimName || "").trim();
    if (victimName) {
      state.knockdownToastText = `Du slog ner ${victimName}`;
      state.knockdownToastMsRemaining = constants.KNOCKDOWN_TOAST_MS;
      actions.updateKnockdownToast();
    }
    return;
  }

  if (msg.type === "countdown") {
    actions.setCountdownTextFromSession({ countdownMsRemaining: Number(msg.seconds || 1) * 1000 });
    return;
  }

  if (msg.type === "pong") {
    actions.handleDebugPong?.(msg);
    return;
  }

  if (msg.type === "possess") {
    state.myCharacterId = msg.characterId ?? null;
    state.forceYawSyncOnNextWorld = state.myCharacterId != null;
    return;
  }

  if (msg.type !== "world") return;

  const previousCharacterId = state.myCharacterId;
  const previousSessionState = state.sessionState;
  const session = msg.session;

  if (msg.match && typeof msg.match === "object") {
    state.currentMatch = {
      inProgress: Boolean(msg.match.inProgress),
      alivePlayers: Number(msg.match.alivePlayers || 0),
      startedAt: msg.match.startedAt || null,
      elapsedMs: Number(msg.match.elapsedMs || 0)
    };
  } else {
    state.currentMatch = { ...constants.DEFAULT_MATCH_STATE };
  }

  if (session) {
    const previousAttackCooldownMsRemaining = Math.max(0, Number(state.attackCooldownMsRemaining || 0));
    state.sessionState = session.state;
    state.authenticated = Boolean(session.authenticated);
    state.myName = session.name || state.myName;
    state.sessionReady = Boolean(session.ready);
    state.lobbyMinPlayersToStart = Math.max(1, Number(session.minPlayersToStart || state.lobbyMinPlayersToStart || 2));
    state.lobbyMaxPlayers = Math.max(0, Number(session.maxPlayers || state.lobbyMaxPlayers || 0));
    state.myCharacterId = session.characterId ?? null;
    state.activePlayersInGame = Number(session.activePlayers || 0);
    state.winReturnToLobbyMsRemaining = Math.max(0, Number(session.returnToLobbyMsRemaining || 0));
    state.downedByName = session.eliminatedByName ? String(session.eliminatedByName) : "";
    state.spectatorTargetCharacterId = session.spectatorTargetCharacterId ?? null;
    state.spectatorTargetName = session.spectatorTargetName ? String(session.spectatorTargetName) : "";
    state.spectatorCandidates = Array.isArray(session.spectatorCandidates) ? session.spectatorCandidates : [];
    state.attackCooldownMsRemaining = Math.max(0, Number(session.attackCooldownMsRemaining || 0));
    if (state.attackCooldownMsRemaining > constants.CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS) {
      const newCooldownStarted = state.attackCooldownMsRemaining > previousAttackCooldownMsRemaining + 16;
      if (newCooldownStarted || state.attackCooldownMsRemaining > state.attackCooldownVisualMaxMs) {
        state.attackCooldownVisualMaxMs = Math.max(
          state.attackCooldownMsRemaining,
          constants.CROSSHAIR_DEFAULT_COOLDOWN_MS
        );
      }
    }
    actions.updateInGameHud();
    actions.updateSpectatorHud();
    actions.updateDocumentTitle();
    if (previousSessionState !== state.sessionState) actions.refreshGameChat?.();
    if (previousSessionState !== "won" && state.sessionState === "won") {
      actions.queueWinSfx?.();
    }
  } else {
    actions.resetDownedState();
    actions.resetWinState();
    state.spectatorTargetCharacterId = null;
    state.spectatorTargetName = "";
    state.spectatorCandidates = [];
  }

  if (
    previousSessionState === "alive" &&
    (state.sessionState === "downed" || state.sessionState === "won" || state.sessionState === "spectating")
  ) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    actions.resetInputState();
    actions.setGameMenuOpen(false);
    actions.setGameChatOpen(false);
  }

  if (!state.authenticated) {
    actions.setAppMode("connect");
  } else if (
    state.sessionState === "alive" ||
    state.sessionState === "downed" ||
    state.sessionState === "won" ||
    state.sessionState === "spectating"
  ) {
    actions.setConnectError("");
    actions.setAppMode("playing");
  } else {
    actions.setAppMode("lobby");
  }

  actions.setCountdownTextFromSession(session);
  actions.updateLobbyMatchStatus();

  try {
    roomSystem.syncFromWorld({
      worldSizeMeters: msg.worldSizeMeters,
      worldWidthMeters: msg.worldWidthMeters,
      worldHeightMeters: msg.worldHeightMeters,
      shelves: msg.shelves,
      coolers: msg.coolers,
      freezers: msg.freezers
    });

    actions.renderScoreboard(msg.scoreboard || []);

    const worldResult = avatarSystem.applyWorldCharacters({
      characters: msg.characters || [],
      myCharacterId: state.myCharacterId,
      nowMs: getNowMs(),
      hideMyCharacter: state.sessionState === "alive" || state.sessionState === "won"
    });
    const controlledYaw = worldResult?.myYaw ?? null;
    const downedHitEvents = Array.isArray(worldResult?.downedHitEvents) ? worldResult.downedHitEvents : [];
    for (const hitEvent of downedHitEvents) {
      actions.playHitHurtAtPosition?.(hitEvent);
    }

    if (controlledYaw != null) {
      const gainedNewCharacter = state.myCharacterId != null && state.myCharacterId !== previousCharacterId;
      const enteredAliveWithCharacter =
        previousSessionState !== "alive" && state.sessionState === "alive" && state.myCharacterId != null;
      if (gainedNewCharacter || enteredAliveWithCharacter || state.forceYawSyncOnNextWorld) {
        inputController.setYaw(controlledYaw);
        actions.setViewYaw(controlledYaw);
        state.forceYawSyncOnNextWorld = false;
      }
    } else if (state.forceYawSyncOnNextWorld && state.myCharacterId == null) {
      state.forceYawSyncOnNextWorld = false;
    }
  } catch (err) {
    console.error("[client:world-render]", err);
  }
}

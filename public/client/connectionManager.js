/**
 * connectionManager – deep module for the entire network/socket concern.
 *
 * Combines what used to be three shallow files:
 *   socketConnection.js  – connection lifecycle & auto-reconnect
 *   socketContext.js     – trivial context-object wrapper (removed)
 *   socketMessages.js    – incoming message dispatch
 *
 * Public API (returned object):
 *   connectAndLogin({ rawName, wsUrl, minNameLength?, onValidationError? }) → boolean
 *   cancelAutoReconnect()
 *   cancelAutoReconnectOnLoginError()
 *   getSocket()          → socket | null
 *   isConnecting()       → boolean
 *
 * @param {{
 *   createGameSocket: function,
 *   state: object,
 *   constants: object,
 *   roomSystem: object,
 *   avatarSystem: object,
 *   inputController: object,
 *   getNowMs: () => number,
 *   actions: object,
 *   onConnectingChanged?: (connecting: boolean) => void,
 *   onAutoReconnecting?: ({ attempt: number, maxAttempts: number }) => void,
 * }} deps
 */
export function createConnectionManager({
  createGameSocket,
  state,
  constants,
  roomSystem,
  avatarSystem,
  inputController,
  getNowMs,
  actions,
  onConnectingChanged = null,
  onAutoReconnecting = null,
}) {
  // ── Connection state ──────────────────────────────────────────────────────
  let socket = null;
  let socketGeneration = 0;
  let connecting = false;
  let lastConnectParams = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAY_MS = 2000;

  // Per-connection cache for static world data received once via world_static.
  // Lives in this closure so it resets on each new connection.
  let cachedWorldStatic = null;

  // ── Internal helpers ──────────────────────────────────────────────────────
  function setConnecting(nextValue) {
    const next = Boolean(nextValue);
    if (connecting === next) return;
    connecting = next;
    onConnectingChanged?.(connecting);
  }

  function clearReconnectTimer() {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleAutoReconnect() {
    if (!lastConnectParams || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      actions.setAppMode("disconnected");
      actions.setConnectError("Anslutningen bröts. Försök ansluta igen.");
      lastConnectParams = null;
      reconnectAttempts = 0;
      return;
    }
    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    actions.setAppMode("disconnected");
    if (typeof onAutoReconnecting === "function") {
      onAutoReconnecting({ attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    } else {
      actions.setConnectError(
        `Anslutningen bröts. Återansluter om ${RECONNECT_DELAY_MS / 1000}s\u2026 (${attempt}/${MAX_RECONNECT_ATTEMPTS})`,
      );
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!lastConnectParams) return;
      setConnecting(true);
      attachSocket(lastConnectParams.wsUrl, lastConnectParams.rawName);
    }, RECONNECT_DELAY_MS);
  }

  function attachSocket(wsUrl, loginName) {
    const generation = ++socketGeneration;
    cachedWorldStatic = null; // reset per-connection cache

    if (socket) {
      try {
        socket.close(1000, "reconnect");
      } catch {
        // no-op
      }
      socket = null;
    }

    socket = createGameSocket({
      url: wsUrl,
      onOpen: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        socket?.sendJson({ type: "login", name: loginName });
      },
      onMessage: (msg) => {
        if (generation !== socketGeneration) return;
        actions.setPendingLoginName(loginName);
        dispatchMessage(msg);
      },
      onClose: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        actions.resetSessionRuntimeState({ clearIdentity: true });
        actions.setPrivateRoomButtonVisible(false);
        actions.updateDocumentTitle();
        scheduleAutoReconnect();
      },
      onError: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        actions.resetSessionRuntimeState({ maxPlayers: 0 });
        actions.setConnectError("Kunde inte ansluta till servern.");
        actions.setAppMode("connect");
        actions.setPrivateRoomButtonVisible(false);
        actions.updateDocumentTitle();
        if (lastConnectParams && reconnectAttempts > 0) {
          scheduleAutoReconnect();
        } else {
          cancelAutoReconnect();
        }
      },
    });
  }

  // ── Message dispatch (was socketMessages.js) ──────────────────────────────

  function dispatchMessage(msg) {
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
      cancelAutoReconnectOnLoginError(); // internal – no circular dep needed
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
      actions.deferAppendChat?.(msg.entry) || actions.appendChat(msg.entry);
      return;
    }

    if (msg.type === "knockdown_confirm") {
      const victimName = String(msg.victimName || "").trim();
      if (victimName) {
        state.knockdownToastText = `Du slog ned ${victimName}!`;
        state.knockdownToastMsRemaining = constants.KNOCKDOWN_TOAST_MS;
        actions.deferKnockdownToastUpdate?.() || actions.updateKnockdownToast();
      }
      return;
    }

    if (msg.type === "countdown") {
      actions.setCountdownTextFromSession({
        countdownMsRemaining: Number(msg.seconds || 1) * 1000,
      });
      return;
    }

    if (msg.type === "countdown_info") {
      actions.setCountdownTextFromSession({
        countdownMsRemaining: Number(msg.msRemaining || 0),
        state: "lobby",
        authenticated: state.authenticated,
      });
      return;
    }

    if (msg.type === "pong") {
      actions.handleDebugPong?.(msg);
      return;
    }

    if (msg.type === "world_static") {
      cachedWorldStatic = msg;
      try {
        roomSystem.syncFromWorld({
          worldSizeMeters: msg.worldSizeMeters,
          worldWidthMeters: msg.worldWidthMeters,
          worldHeightMeters: msg.worldHeightMeters,
          shelves: msg.shelves,
          coolers: msg.coolers,
          freezers: msg.freezers,
        });
      } catch (err) {
        console.error("[client:world_static]", err);
      }
      return;
    }

    if (msg.type === "possess") {
      state.myCharacterId = msg.characterId ?? null;
      state.forceYawSyncOnNextWorld = state.myCharacterId != null;
      return;
    }

    if (msg.type !== "world") return;

    _handleWorldMessage(msg);
  }

  function _handleWorldMessage(msg) {
    const previousCharacterId = state.myCharacterId;
    const previousSessionState = state.sessionState;
    const session = msg.session;

    if (msg.match && typeof msg.match === "object") {
      state.currentMatch = {
        inProgress: Boolean(msg.match.inProgress),
        alivePlayers: Number(msg.match.alivePlayers || 0),
        startedAt: msg.match.startedAt || null,
        elapsedMs: Number(msg.match.elapsedMs || 0),
        pendingReset: Boolean(msg.match.pendingReset),
      };
    } else {
      state.currentMatch = { ...constants.DEFAULT_MATCH_STATE };
    }

    if (session) {
      const previousAttackCooldownMsRemaining = Math.max(
        0,
        Number(state.attackCooldownMsRemaining || 0),
      );
      const previousSpectatorTargetCharacterId =
        state.spectatorTargetCharacterId;
      const previousDownedByName = state.downedByName;
      state.sessionState = session.state;
      state.authenticated = Boolean(session.authenticated);
      state.myName = session.name || state.myName;
      state.sessionReady = Boolean(session.ready);
      state.lobbyMinPlayersToStart = Math.max(
        1,
        Number(session.minPlayersToStart || state.lobbyMinPlayersToStart || 2),
      );
      state.lobbyMaxPlayers = Math.max(
        0,
        Number(session.maxPlayers || state.lobbyMaxPlayers || 0),
      );
      state.myCharacterId = session.characterId ?? null;
      state.activePlayersInGame = Number(session.activePlayers || 0);
      state.spectatorCount = Number(session.spectatorCount || 0);
      state.winReturnToLobbyMsRemaining = Math.max(
        0,
        Number(session.returnToLobbyMsRemaining || 0),
      );
      state.downedByName = session.eliminatedByName
        ? String(session.eliminatedByName)
        : "";
      state.spectatorTargetCharacterId =
        session.spectatorTargetCharacterId ?? null;
      state.spectatorTargetName = session.spectatorTargetName
        ? String(session.spectatorTargetName)
        : "";
      state.spectatorCandidates = Array.isArray(session.spectatorCandidates)
        ? session.spectatorCandidates
        : [];

      if (state.sessionState === "won" && previousSessionState !== "won") {
        state.winMessageHideAtMs =
          getNowMs() + constants.WIN_MESSAGE_VISIBLE_MS;
        state.knockdownToastMsRemaining = 0;
        actions.updateKnockdownToast?.();
      }
      if (state.downedByName && !previousDownedByName) {
        state.downedMessageSuppressed = false;
        state.downedMessageHideAtMs =
          getNowMs() + constants.DOWNED_MESSAGE_VISIBLE_MS;
      } else if (
        state.downedByName &&
        previousSpectatorTargetCharacterId != null &&
        state.spectatorTargetCharacterId != null &&
        previousSpectatorTargetCharacterId !== state.spectatorTargetCharacterId
      ) {
        state.downedMessageSuppressed = true;
      } else if (!state.downedByName) {
        state.downedMessageSuppressed = false;
        state.downedMessageHideAtMs = 0;
      }

      state.attackCooldownMsRemaining = Math.max(
        0,
        Number(session.attackCooldownMsRemaining || 0),
      );
      if (
        state.attackCooldownMsRemaining >
        constants.CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS
      ) {
        const newCooldownStarted =
          state.attackCooldownMsRemaining >
          previousAttackCooldownMsRemaining + 16;
        if (
          newCooldownStarted ||
          state.attackCooldownMsRemaining > state.attackCooldownVisualMaxMs
        ) {
          state.attackCooldownVisualMaxMs = Math.max(
            state.attackCooldownMsRemaining,
            constants.CROSSHAIR_DEFAULT_COOLDOWN_MS,
          );
        }
      }

      actions.updateInGameHud();
      actions.updateSpectatorHud();
      actions.updateDocumentTitle();

      if (previousSessionState !== state.sessionState) {
        if (
          previousSessionState === "alive" &&
          (state.sessionState === "downed" ||
            state.sessionState === "won" ||
            state.sessionState === "spectating")
        ) {
          actions.deferRefreshGameChat?.() || actions.refreshGameChat?.();
        } else {
          actions.refreshGameChat?.();
        }
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
      (state.sessionState === "downed" ||
        state.sessionState === "won" ||
        state.sessionState === "spectating")
    ) {
      actions.resetInputState();
      actions.setGameMenuOpen(false);
      actions.setGameChatOpen(false);
      if (document.pointerLockElement) {
        if (state.sessionState === "won") {
          requestAnimationFrame(() => document.exitPointerLock?.());
        } else {
          document.exitPointerLock?.();
        }
      }
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
      const staticSrc = cachedWorldStatic || {};
      roomSystem.syncFromWorld({
        worldSizeMeters: msg.worldSizeMeters ?? staticSrc.worldSizeMeters,
        worldWidthMeters: msg.worldWidthMeters ?? staticSrc.worldWidthMeters,
        worldHeightMeters: msg.worldHeightMeters ?? staticSrc.worldHeightMeters,
        shelves: msg.shelves ?? staticSrc.shelves,
        coolers: msg.coolers ?? staticSrc.coolers,
        freezers: msg.freezers ?? staticSrc.freezers,
      });

      actions.renderScoreboard(msg.scoreboard || []);

      const worldResult = avatarSystem.applyWorldCharacters({
        characters: msg.characters || [],
        myCharacterId: state.myCharacterId,
        nowMs: getNowMs(),
        hideMyCharacter:
          state.sessionState === "alive" || state.sessionState === "won",
      });
      const controlledYaw = worldResult?.myYaw ?? null;
      const downedHitEvents = Array.isArray(worldResult?.downedHitEvents)
        ? worldResult.downedHitEvents
        : [];
      for (const hitEvent of downedHitEvents) {
        actions.playHitHurtAtPosition?.(hitEvent);
      }
      if (worldResult?.myAttackFired && downedHitEvents.length === 0) {
        actions.playHitMissSfx?.();
      }

      if (controlledYaw != null) {
        const gainedNewCharacter =
          state.myCharacterId != null &&
          state.myCharacterId !== previousCharacterId;
        const enteredAliveWithCharacter =
          previousSessionState !== "alive" &&
          state.sessionState === "alive" &&
          state.myCharacterId != null;
        if (
          gainedNewCharacter ||
          enteredAliveWithCharacter ||
          state.forceYawSyncOnNextWorld
        ) {
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

  // ── Public API ────────────────────────────────────────────────────────────

  function getSocket() {
    return socket;
  }

  function isConnecting() {
    return connecting;
  }

  function cancelAutoReconnect() {
    clearReconnectTimer();
    reconnectAttempts = 0;
    lastConnectParams = null;
  }

  function cancelAutoReconnectOnLoginError() {
    clearReconnectTimer();
    reconnectAttempts = 0;
    // Keep lastConnectParams so the user can manually retry from the connect screen.
  }

  function connectAndLogin({
    rawName,
    wsUrl,
    minNameLength = 2,
    onValidationError = null,
  }) {
    if (isConnecting()) return false;

    const normalizedName = String(rawName ?? "").trim();
    if (normalizedName.length < minNameLength) {
      if (typeof onValidationError === "function") onValidationError();
      else
        actions.setConnectError(
          `Namn måste vara minst ${minNameLength} tecken.`,
        );
      return false;
    }

    cancelAutoReconnect();
    lastConnectParams = { rawName: normalizedName, wsUrl };

    actions.setPendingLoginName(normalizedName);
    setConnecting(true);
    actions.resetSessionRuntimeState({ clearIdentity: true });
    actions.setConnectError("");
    actions.setPrivateRoomButtonVisible(false);
    actions.resetInputState();
    actions.setAppMode("connect");
    attachSocket(wsUrl, normalizedName);
    return true;
  }

  return {
    getSocket,
    isConnecting,
    connectAndLogin,
    cancelAutoReconnect,
    cancelAutoReconnectOnLoginError,
  };
}

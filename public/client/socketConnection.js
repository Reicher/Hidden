export function createSocketConnectionController({
  createGameSocket,
  handleSocketMessage,
  getSocketMessageContext,
  setPendingLoginName,
  setConnectError,
  setPrivateRoomButtonVisible,
  setAppMode,
  resetSessionRuntimeState,
  updateDocumentTitle,
  resetInputState,
  onConnectingChanged,
  onAutoReconnecting = null,
}) {
  let socket = null;
  let socketGeneration = 0;
  let connecting = false;

  // Auto-reconnect state
  let lastConnectParams = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAY_MS = 2000;

  function setConnecting(nextValue) {
    const next = Boolean(nextValue);
    if (connecting === next) return;
    connecting = next;
    onConnectingChanged?.(connecting);
  }

  function getSocket() {
    return socket;
  }

  function isConnecting() {
    return connecting;
  }

  function cancelAutoReconnect() {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    lastConnectParams = null;
  }

  function scheduleAutoReconnect() {
    if (!lastConnectParams || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      // Give up – show plain disconnect message and let user reconnect manually
      setAppMode("disconnected");
      setConnectError("Anslutningen bröts. Försök ansluta igen.");
      lastConnectParams = null;
      reconnectAttempts = 0;
      return;
    }
    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    setAppMode("disconnected");
    if (typeof onAutoReconnecting === "function") {
      onAutoReconnecting({ attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    } else {
      setConnectError(
        `Anslutningen bröts. Återansluter om ${RECONNECT_DELAY_MS / 1000}s\u2026 (${attempt}/${MAX_RECONNECT_ATTEMPTS})`,
      );
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!lastConnectParams) return; // cancelled
      setConnecting(true);
      attachSocket(lastConnectParams.wsUrl, lastConnectParams.rawName);
    }, RECONNECT_DELAY_MS);
  }

  function attachSocket(wsUrl, loginName) {
    const generation = ++socketGeneration;

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
        setPendingLoginName(loginName);
        handleSocketMessage(msg, getSocketMessageContext());
      },
      onClose: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        resetSessionRuntimeState({ clearIdentity: true });
        setPrivateRoomButtonVisible(false);
        updateDocumentTitle();
        scheduleAutoReconnect();
      },
      onError: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        resetSessionRuntimeState({ maxPlayers: 0 });
        setConnectError("Kunde inte ansluta till servern.");
        setAppMode("connect");
        setPrivateRoomButtonVisible(false);
        updateDocumentTitle();
        // On error during auto-reconnect: count as a failed attempt
        if (lastConnectParams && reconnectAttempts > 0) {
          scheduleAutoReconnect();
        } else {
          cancelAutoReconnect();
        }
      },
    });
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
      else setConnectError(`Namn måste vara minst ${minNameLength} tecken.`);
      return false;
    }

    // Cancel any pending auto-reconnect; this is a fresh manual connection
    cancelAutoReconnect();
    lastConnectParams = { rawName: normalizedName, wsUrl };

    setPendingLoginName(normalizedName);
    setConnecting(true);
    resetSessionRuntimeState({ clearIdentity: true });
    setConnectError("");
    setPrivateRoomButtonVisible(false);
    resetInputState();
    setAppMode("connect");
    attachSocket(wsUrl, normalizedName);
    return true;
  }

  // Call this when login_error is received so auto-reconnect is stopped
  // (wrong name, room full, etc. – retrying wouldn't help).
  function cancelAutoReconnectOnLoginError() {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    // Keep lastConnectParams so the user can manually retry from the connect screen.
  }

  return {
    getSocket,
    isConnecting,
    connectAndLogin,
    cancelAutoReconnectOnLoginError,
    cancelAutoReconnect,
  };
}

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
  onConnectingChanged
}) {
  let socket = null;
  let socketGeneration = 0;
  let connecting = false;

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
        setAppMode("disconnected");
        setConnectError("Anslutningen bröts.");
        setPrivateRoomButtonVisible(false);
        updateDocumentTitle();
      },
      onError: () => {
        if (generation !== socketGeneration) return;
        setConnecting(false);
        resetSessionRuntimeState({ maxPlayers: 0 });
        setConnectError("Kunde inte ansluta till servern.");
        setAppMode("connect");
        setPrivateRoomButtonVisible(false);
        updateDocumentTitle();
      }
    });
  }

  function connectAndLogin({ rawName, wsUrl, minNameLength = 2, onValidationError = null }) {
    if (isConnecting()) return false;

    const normalizedName = String(rawName ?? "").trim();
    if (normalizedName.length < minNameLength) {
      if (typeof onValidationError === "function") onValidationError();
      else setConnectError(`Namn måste vara minst ${minNameLength} tecken.`);
      return false;
    }

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

  return {
    getSocket,
    isConnecting,
    connectAndLogin
  };
}

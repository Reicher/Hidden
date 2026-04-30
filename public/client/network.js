export function createGameSocket({ url, onOpen, onMessage, onClose, onError }) {
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    onOpen?.();
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      console.warn(`[client:ws-parse] Ignoring malformed message: ${err?.message || err}`);
      return;
    }
    onMessage?.(msg);
  });

  ws.addEventListener("close", (event) => {
    onClose?.(event);
  });

  ws.addEventListener("error", (event) => {
    onError?.(event);
  });

  function sendJson(payload) {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  return {
    ws,
    sendJson,
    close: (code, reason) => ws.close(code, reason)
  };
}

export function createGameSocket({ onOpen, onMessage, onClose, onError }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}`);

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
    sendJson
  };
}

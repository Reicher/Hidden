const DEBUG_OVERLAY_ALLOWED_KEY = "hidden_debug_overlay_allowed";
const DEBUG_OVERLAY_REFRESH_MS = 120;
const DEBUG_PING_INTERVAL_MS = 1200;
const DEBUG_FPS_SAMPLE_WINDOW_MS = 1000;

export function createDebugOverlay({
  elements,
  getAppMode,
  getAuthenticated,
  getSocket,
  isTouchDevice,
  storage = localStorage,
  searchParams = new URLSearchParams(location.search),
  now = () => performance.now()
}) {
  const { debugOverlayEl, debugFpsTextEl, debugFrameTimeTextEl, debugPingTextEl } = elements;
  const queryParam = searchParams.get("debugOverlay");
  let allowed = !isTouchDevice || storage.getItem(DEBUG_OVERLAY_ALLOWED_KEY) === "1";
  if (queryParam === "1") {
    allowed = true;
    storage.setItem(DEBUG_OVERLAY_ALLOWED_KEY, "1");
  }
  if (queryParam === "0") {
    allowed = false;
    storage.removeItem(DEBUG_OVERLAY_ALLOWED_KEY);
  }

  let open = false;
  let fps = 0;
  let pingMs = null;
  let lastOverlayUpdateAt = 0;
  let lastPingSentAt = 0;
  let fpsSampleFrames = 0;
  let fpsSampleMs = 0;

  function isVisible() {
    return getAppMode() === "playing" && allowed && open;
  }

  function update() {
    if (!debugOverlayEl) return;
    const visible = isVisible();
    debugOverlayEl.classList.toggle("hidden", !visible);
    if (!visible) return;

    const fpsRounded = Math.max(0, Math.round(fps));
    const frameMs = fps > 0 ? 1000 / fps : null;
    const pingRounded = Number.isFinite(pingMs) ? Math.max(0, Math.round(pingMs)) : null;

    if (debugFpsTextEl) debugFpsTextEl.textContent = `FPS: ${fpsRounded > 0 ? fpsRounded : "--"}`;
    if (debugFrameTimeTextEl) {
      debugFrameTimeTextEl.textContent = `Frame: ${frameMs != null ? frameMs.toFixed(1) : "--"} ms`;
    }
    if (debugPingTextEl) debugPingTextEl.textContent = `Ping: ${pingRounded != null ? pingRounded : "--"} ms`;
  }

  function reset() {
    fps = 0;
    pingMs = null;
    lastOverlayUpdateAt = 0;
    lastPingSentAt = 0;
    fpsSampleFrames = 0;
    fpsSampleMs = 0;
    update();
  }

  function setOpen(nextOpen) {
    open = Boolean(nextOpen) && getAppMode() === "playing" && allowed;
    update();
  }

  function toggle() {
    if (getAppMode() !== "playing" || !allowed) return;
    setOpen(!open);
  }

  function canUse() {
    return Boolean(allowed);
  }

  function enableForDevice() {
    if (allowed) return false;
    allowed = true;
    storage.setItem(DEBUG_OVERLAY_ALLOWED_KEY, "1");
    return true;
  }

  function recordFrame(frameMs) {
    fpsSampleFrames += 1;
    fpsSampleMs += Math.max(0, Number(frameMs) || 0);
    if (fpsSampleMs < DEBUG_FPS_SAMPLE_WINDOW_MS) return;
    fps = fpsSampleMs > 0 ? (fpsSampleFrames * 1000) / fpsSampleMs : 0;
    fpsSampleFrames = 0;
    fpsSampleMs = 0;
  }

  function sendPing(nowMs = now()) {
    if (getAppMode() !== "playing" || !open) return;
    if (nowMs - lastPingSentAt < DEBUG_PING_INTERVAL_MS) return;
    const socket = getSocket();
    if (!socket || !getAuthenticated()) return;
    if (!socket.sendJson({ type: "ping", clientSentAt: nowMs })) return;
    lastPingSentAt = nowMs;
  }

  function handlePong(msg) {
    const clientSentAt = Number(msg?.clientSentAt);
    if (!Number.isFinite(clientSentAt)) return;
    const rttMs = now() - clientSentAt;
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    pingMs = pingMs == null ? rttMs : pingMs + (rttMs - pingMs) * 0.35;
    if (open && getAppMode() === "playing") update();
  }

  function maybeRefresh(nowMs = now()) {
    if (!open || getAppMode() !== "playing") return;
    if (nowMs - lastOverlayUpdateAt < DEBUG_OVERLAY_REFRESH_MS) return;
    lastOverlayUpdateAt = nowMs;
    update();
  }

  return {
    canUse,
    enableForDevice,
    handlePong,
    maybeRefresh,
    recordFrame,
    reset,
    sendPing,
    setOpen,
    toggle,
    update
  };
}

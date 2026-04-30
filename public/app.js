import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import { createAvatarSystem } from "./client/avatars.js";
import { createGameSocket } from "./client/network.js";

const canvas = document.getElementById("game");
const screenRootEl = document.getElementById("screenRoot");
const connectViewEl = document.getElementById("connectView");
const lobbyViewEl = document.getElementById("lobbyView");
const connectErrorEl = document.getElementById("connectError");
const roomInfoEl = document.getElementById("roomInfo");
const nameInputEl = document.getElementById("nameInput");
const connectBtnEl = document.getElementById("connectBtn");
const createPrivateRoomBtnEl = document.getElementById("createPrivateRoomBtn");
const scoreBodyEl = document.getElementById("scoreBody");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtnEl = document.getElementById("chatSendBtn");
const playBtnEl = document.getElementById("playBtn");
const controlsBtnEl = document.getElementById("controlsBtn");
const settingsBtnEl = document.getElementById("settingsBtn");
const creditsBtnEl = document.getElementById("creditsBtn");
const debugBtnEl = document.getElementById("debugBtn");
const countdownOverlayEl = document.getElementById("countdownOverlay");
const countdownTextEl = document.getElementById("countdownText");
const lobbyDialogBackdropEl = document.getElementById("lobbyDialogBackdrop");
const lobbyDialogTitleEl = document.getElementById("lobbyDialogTitle");
const lobbyDialogTextEl = document.getElementById("lobbyDialogText");
const lobbyDialogCloseBtnEl = document.getElementById("lobbyDialogCloseBtn");
const debugBackdropEl = document.getElementById("debugBackdrop");
const debugCloseBtnEl = document.getElementById("debugCloseBtn");
const debugTokenInputEl = document.getElementById("debugTokenInput");
const debugLoginBtnEl = document.getElementById("debugLoginBtn");
const debugClearTokenBtnEl = document.getElementById("debugClearTokenBtn");
const debugAuthErrorEl = document.getElementById("debugAuthError");
const debugSummaryEl = document.getElementById("debugSummary");
const debugChartEl = document.getElementById("debugChart");
const debugRoomsTextEl = document.getElementById("debugRoomsText");
const debugPlayersTextEl = document.getElementById("debugPlayersText");
const debugEventsTextEl = document.getElementById("debugEventsText");
const debugMetaEl = document.getElementById("debugMeta");
const gameHudEl = document.getElementById("gameHud");
const aliveOthersTextEl = document.getElementById("aliveOthersText");
const gameChatMessagesEl = document.getElementById("gameChatMessages");
const gameChatInputRowEl = document.getElementById("gameChatInputRow");
const gameChatInputEl = document.getElementById("gameChatInput");
const mobileControlsEl = document.getElementById("mobileControls");
const mobileLookPadEl = document.getElementById("mobileLookPad");
const mobileSprintBtnEl = document.getElementById("mobileSprintBtn");
const mobileAttackBtnEl = document.getElementById("mobileAttackBtn");
const mobileChatBtnEl = document.getElementById("mobileChatBtn");

const PLAYER_NAME_KEY = "hidden_player_name";
const DEBUG_TOKEN_KEY = "hidden_debug_token";

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize } = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

let socket = null;
let socketGeneration = 0;
let connecting = false;
let authenticated = false;
let appMode = "connect"; // connect | lobby | playing | disconnected
let sessionState = "auth"; // auth | lobby | countdown | alive
let myCharacterId = null;
let myName = "";
let activePlayersInGame = 0;
let gameChatOpen = false;
let debugOpen = false;
let debugPollTimer = null;
let debugLoading = false;

const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  yaw: 0
};

const INPUT_SEND_INTERVAL_MS = 33;
const INPUT_HEARTBEAT_MS = 120;
const LOOK_TOUCH_SENSITIVITY_X = 0.0052;
const LOOK_TOUCH_SENSITIVITY_Y = 0.0045;
const IS_TOUCH_DEVICE =
  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || (navigator.maxTouchPoints || 0) > 0;

let pitch = 0;
let yaw = 0;
let viewPitch = 0;
let viewYaw = 0;
let inputDirty = true;
let lastInputSentAt = 0;
let lastSentSnapshot = "";
let lastFrameAt = performance.now();
let mobileLookPointerId = null;
let mobileLookLastX = 0;
let mobileLookLastY = 0;

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function colorForName(name) {
  const h = hashString(String(name || "").toLowerCase());
  const hue = h % 360;
  const sat = 60 + ((h >>> 9) % 20);
  const light = 62 + ((h >>> 16) % 10);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function normalizeAngle(angle) {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

function clampPitch(value) {
  return Math.max(-1.2, Math.min(1.2, value));
}

function wsScheme() {
  return location.protocol === "https:" ? "wss" : "ws";
}

function activeRoomCodeFromPath() {
  const segments = location.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length !== 1) return null;
  return decodeURIComponent(segments[0]);
}

function activeRoomPath() {
  const code = activeRoomCodeFromPath();
  if (!code) return "/";
  return `/${encodeURIComponent(code)}`;
}

function randomPrivateRoomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const value of bytes) out += alphabet[value % alphabet.length];
  return out;
}

function setRoomInfo() {
  if (!roomInfoEl) return;
  const code = activeRoomCodeFromPath();
  if (code) {
    roomInfoEl.textContent = `Privat rum: ${code}`;
    return;
  }
  roomInfoEl.textContent = "Offentligt rum";
}

function setPrivateRoomButtonVisible(visible) {
  if (!createPrivateRoomBtnEl) return;
  createPrivateRoomBtnEl.classList.toggle("hidden", !visible);
}

function setConnectError(text) {
  if (!connectErrorEl) return;
  connectErrorEl.textContent = text || "";
}

function getDebugToken() {
  return localStorage.getItem(DEBUG_TOKEN_KEY) || "";
}

function setDebugToken(token) {
  if (!token) {
    localStorage.removeItem(DEBUG_TOKEN_KEY);
    return;
  }
  localStorage.setItem(DEBUG_TOKEN_KEY, token);
}

function setDebugError(text) {
  if (!debugAuthErrorEl) return;
  debugAuthErrorEl.textContent = text || "";
}

function formatDateTime(at) {
  if (!at || !Number.isFinite(at)) return "-";
  const date = new Date(at);
  return `${date.toLocaleDateString("sv-SE")} ${date.toLocaleTimeString("sv-SE")}`;
}

function fmtN(value) {
  return Number(value || 0).toLocaleString("sv-SE");
}

function requestPointerLockSafe(targetEl = canvas) {
  try {
    const maybePromise = targetEl?.requestPointerLock?.();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch {
    // ignore pointer lock errors; gameplay flow must continue
  }
}

function updateConnectButton() {
  if (!connectBtnEl) return;
  connectBtnEl.disabled = connecting;
  connectBtnEl.textContent = connecting ? "Ansluter..." : "Anslut";
}

function updateDocumentTitle() {
  const othersPlaying = Math.max(0, activePlayersInGame - (sessionState === "alive" ? 1 : 0));
  if (othersPlaying <= 0) {
    document.title = "Hidden";
    return;
  }
  document.title = `Hidden - ${othersPlaying} spelare`;
}

function openLobbyDialog(title, text) {
  if (!lobbyDialogBackdropEl || !lobbyDialogTitleEl || !lobbyDialogTextEl || !lobbyDialogCloseBtnEl) return;
  lobbyDialogTitleEl.textContent = title;
  lobbyDialogTextEl.textContent = text;
  lobbyDialogBackdropEl.classList.remove("hidden");
  lobbyDialogCloseBtnEl.focus();
}

function closeLobbyDialog() {
  if (!lobbyDialogBackdropEl) return;
  lobbyDialogBackdropEl.classList.add("hidden");
}

function isGameChatFocused() {
  return document.activeElement === gameChatInputEl;
}

function updateMobileControlsVisibility() {
  if (!mobileControlsEl) return;
  const show = IS_TOUCH_DEVICE && appMode === "playing" && sessionState === "alive" && !gameChatOpen;
  mobileControlsEl.classList.toggle("hidden", !show);
  document.body.classList.toggle("mobile-controls-enabled", show);
}

function setGameChatOpen(open, { restorePointerLock = false } = {}) {
  if (!gameChatInputRowEl || !gameChatInputEl) return;
  gameChatOpen = Boolean(open);
  gameChatInputRowEl.classList.toggle("hidden", !gameChatOpen);

  if (gameChatOpen) {
    resetInputState();
    sendInput();
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameChatInputEl.focus();
    updateMobileControlsVisibility();
    return;
  }

  gameChatInputEl.blur();
  if (restorePointerLock && appMode === "playing" && sessionState === "alive") {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
}

function updateInGameHud() {
  if (!aliveOthersTextEl) return;
  const others = Math.max(0, activePlayersInGame - (sessionState === "alive" ? 1 : 0));
  const noun = others === 1 ? "annan" : "andra";
  aliveOthersTextEl.textContent = `${others} ${noun} spelar just nu`;
}

function setAppMode(mode) {
  const previous = appMode;
  appMode = mode;

  const showConnect = mode === "connect" || mode === "disconnected";
  const showLobby = mode === "lobby";

  connectViewEl?.classList.toggle("hidden", !showConnect);
  lobbyViewEl?.classList.toggle("hidden", !showLobby);
  gameHudEl?.classList.toggle("hidden", mode !== "playing");

  const overlayActive = mode !== "playing";
  document.body.classList.toggle("overlay-active", overlayActive);
  if (screenRootEl) screenRootEl.style.pointerEvents = overlayActive ? "auto" : "none";

  if (previous === "playing" && mode !== "playing" && document.pointerLockElement) {
    document.exitPointerLock?.();
  }

  if (previous === "playing" && mode !== "playing") {
    myCharacterId = null;
    resetInputState();
  }

  if (mode !== "lobby" && debugOpen) {
    closeDebugView();
  }

  if (mode !== "playing") setGameChatOpen(false);
  updateMobileControlsVisibility();
  updateInGameHud();
  updateDocumentTitle();
}

async function fetchAndRenderDebugData() {
  if (!debugOpen || debugLoading) return;
  debugLoading = true;
  try {
    const inputToken = debugTokenInputEl?.value?.trim() || "";
    const storedToken = getDebugToken().trim();
    const token = inputToken || storedToken;
    if (token) setDebugToken(token);

    const debugUrl = new URL("/api/debug/stats", location.origin);
    if (token) debugUrl.searchParams.set("token", token);

    const response = await fetch(debugUrl, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (response.status === 401) {
      setDebugError("Fel token för debug-vyn.");
      return;
    }
    if (!response.ok) {
      setDebugError(`Kunde inte läsa debugdata (${response.status}).`);
      return;
    }

    const payload = await response.json();
    setDebugError("");
    renderDebugData(payload);
  } catch {
    setDebugError("Nätverksfel när debugdata skulle hämtas.");
  } finally {
    debugLoading = false;
  }
}

function startDebugPolling() {
  if (debugPollTimer) {
    clearInterval(debugPollTimer);
    debugPollTimer = null;
  }
  fetchAndRenderDebugData();
  debugPollTimer = setInterval(fetchAndRenderDebugData, 5000);
}

function stopDebugPolling() {
  if (!debugPollTimer) return;
  clearInterval(debugPollTimer);
  debugPollTimer = null;
}

function openDebugView() {
  if (!debugBackdropEl) return;
  debugOpen = true;
  debugBackdropEl.classList.remove("hidden");
  closeLobbyDialog();
  if (debugTokenInputEl && !debugTokenInputEl.value) {
    debugTokenInputEl.value = getDebugToken();
  }
  setDebugError("");
  startDebugPolling();
}

function closeDebugView() {
  debugOpen = false;
  stopDebugPolling();
  debugBackdropEl?.classList.add("hidden");
}

function setCountdownTextFromSession(state) {
  if (!countdownTextEl || !playBtnEl || !countdownOverlayEl) return;
  if (state?.state === "countdown") {
    const ms = state.countdownMsRemaining ?? 3000;
    const sec = Math.max(1, Math.ceil(ms / 1000));
    countdownTextEl.textContent = String(sec);
    countdownOverlayEl.classList.remove("hidden");
    playBtnEl.disabled = true;
    return;
  }
  countdownTextEl.textContent = "";
  countdownOverlayEl.classList.add("hidden");
  playBtnEl.disabled = false;
}

function renderScoreboard(players) {
  if (!scoreBodyEl) return;
  scoreBodyEl.textContent = "";
  if (!Array.isArray(players)) return;
  for (const p of players) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = p.name || "-";
    nameCell.style.color = colorForName(p.name);
    tr.appendChild(nameCell);

    const killsCell = document.createElement("td");
    killsCell.textContent = String(p.kills ?? 0);
    tr.appendChild(killsCell);

    const deathsCell = document.createElement("td");
    deathsCell.textContent = String(p.deaths ?? 0);
    tr.appendChild(deathsCell);

    const innocentsCell = document.createElement("td");
    innocentsCell.textContent = String(p.innocents ?? 0);
    tr.appendChild(innocentsCell);

    const statusCell = document.createElement("td");
    statusCell.textContent = p.status || "-";
    tr.appendChild(statusCell);

    scoreBodyEl.appendChild(tr);
  }
}

function renderDebugSummary(data) {
  if (!debugSummaryEl) return;
  const cards = [
    ["Anslutna nu", fmtN(data?.current?.connected)],
    ["Inloggade nu", fmtN(data?.current?.authenticated)],
    ["Spelar nu", fmtN(data?.current?.active)],
    ["Peak anslutna", fmtN(data?.peaks?.connected)],
    ["Totala besök", fmtN(data?.totals?.totalConnections)],
    ["Totala logins", fmtN(data?.totals?.totalLogins)],
    ["Unika namn", fmtN(data?.totals?.uniqueNames)],
    ["Aktiva rum nu", fmtN(data?.current?.roomCountWithSessions)],
    ["Server start", formatDateTime(data?.startedAt)]
  ];
  debugSummaryEl.textContent = "";
  for (const [k, v] of cards) {
    const card = document.createElement("div");
    card.className = "debugStatCard";
    const keyEl = document.createElement("span");
    keyEl.className = "k";
    keyEl.textContent = k;
    const valueEl = document.createElement("span");
    valueEl.className = "v";
    valueEl.textContent = v;
    card.appendChild(keyEl);
    card.appendChild(valueEl);
    debugSummaryEl.appendChild(card);
  }
}

function drawDebugChart(samples) {
  const canvasEl = debugChartEl;
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;

  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const cssWidth = Math.max(300, Math.floor(canvasEl.clientWidth || 960));
  const cssHeight = Math.max(180, Math.floor(canvasEl.clientHeight || 240));
  canvasEl.width = cssWidth * dpr;
  canvasEl.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const points = Array.isArray(samples) ? samples.slice(-200) : [];
  if (points.length < 2) {
    ctx.fillStyle = "#a9b2c3";
    ctx.font = "12px JetBrains Mono";
    ctx.fillText("Ingen historik än - data fylls på över tid.", 12, 22);
    return;
  }

  const values = [];
  for (const sample of points) {
    values.push(Number(sample.connected || 0));
    values.push(Number(sample.authenticated || 0));
    values.push(Number(sample.active || 0));
  }
  const maxY = Math.max(1, ...values);
  const padX = 38;
  const padY = 16;
  const innerW = cssWidth - padX - 10;
  const innerH = cssHeight - padY * 2 - 18;

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padY + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + innerW, y);
    ctx.stroke();
    const value = Math.round(maxY * (1 - i / 4));
    ctx.fillStyle = "#9ca6b8";
    ctx.font = "11px JetBrains Mono";
    ctx.fillText(String(value), 4, y + 4);
  }

  function drawLine(field, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const sample = points[i];
      const x = padX + (innerW * i) / (points.length - 1);
      const value = Number(sample[field] || 0);
      const y = padY + innerH - (value / maxY) * innerH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawLine("connected", "#7ad8ff");
  drawLine("authenticated", "#8de16f");
  drawLine("active", "#ffcf6a");

  const firstAt = Number(points[0].at || 0);
  const lastAt = Number(points[points.length - 1].at || 0);
  const spanMin = Math.max(1, Math.round((lastAt - firstAt) / 60000));
  ctx.fillStyle = "#a9b2c3";
  ctx.font = "11px JetBrains Mono";
  ctx.fillText(`Tidsfönster: ~${spanMin} min`, padX, cssHeight - 5);
  ctx.fillText("anslutna", cssWidth - 274, cssHeight - 5);
  ctx.fillStyle = "#7ad8ff";
  ctx.fillRect(cssWidth - 286, cssHeight - 13, 8, 8);
  ctx.fillStyle = "#a9b2c3";
  ctx.fillText("inloggade", cssWidth - 198, cssHeight - 5);
  ctx.fillStyle = "#8de16f";
  ctx.fillRect(cssWidth - 210, cssHeight - 13, 8, 8);
  ctx.fillStyle = "#a9b2c3";
  ctx.fillText("spelar", cssWidth - 104, cssHeight - 5);
  ctx.fillStyle = "#ffcf6a";
  ctx.fillRect(cssWidth - 116, cssHeight - 13, 8, 8);
}

function renderDebugData(data) {
  renderDebugSummary(data);
  drawDebugChart(data?.samples || []);

  if (debugRoomsTextEl) {
    const rows = Array.isArray(data?.liveRooms) ? data.liveRooms : data?.rooms || [];
    if (rows.length === 0) {
      debugRoomsTextEl.textContent = "Inga rum.";
    } else {
      debugRoomsTextEl.textContent = rows
        .map((room) => {
          const current = room.current || {};
          const label = room.isPrivate ? `privat:${room.roomCode || room.roomId}` : "publik";
          const names = Array.isArray(room.authenticatedNames)
            ? room.authenticatedNames
            : Array.isArray(room.uniqueNames)
              ? room.uniqueNames
              : [];
          return `${label}\nnu: ansl=${current.connected || 0} inlogg=${current.authenticated || 0} spelar=${current.active || 0} lobby=${current.lobby || 0}\ntotal: besok=${room.totalConnections || 0} login=${room.totalLogins || 0}\nnamn: ${
            names.length > 0 ? names.join(", ") : "-"
          }`;
        })
        .join("\n\n");
    }
  }

  if (debugPlayersTextEl) {
    const players = Array.isArray(data?.players) ? data.players.slice(0, 80) : [];
    debugPlayersTextEl.textContent =
      players.length > 0
        ? players
            .map(
              (player) =>
                `${player.name} | logins=${player.logins} | senast=${formatDateTime(player.lastSeenAt)} | rum=${(player.rooms || []).join(", ")}`
            )
            .join("\n")
        : "Inga namn loggade ännu.";
  }

  if (debugEventsTextEl) {
    const events = Array.isArray(data?.recentEvents) ? data.recentEvents.slice(-80).reverse() : [];
    debugEventsTextEl.textContent =
      events.length > 0
        ? events
            .map((event) => {
              const label = event.isPrivate ? `privat:${event.roomCode || event.roomId}` : "publik";
              const snap = event.snapshot || {};
              return `${formatDateTime(event.at)} | ${event.type} | ${label} | ${event.name || "-"} | ansl=${snap.connected || 0} inlogg=${snap.authenticated || 0} spelar=${snap.active || 0}`;
            })
            .join("\n")
        : "Inga events ännu.";
  }

  if (debugMetaEl) {
    debugMetaEl.textContent = `Senast uppdaterad: ${formatDateTime(data?.generatedAt)} | Loggar: logs/debug-events.log + logs/debug-samples.jsonl`;
  }
}

function appendChatLine(container, entry) {
  if (!container) return;
  if (!entry || typeof entry.text !== "string") return;
  const line = document.createElement("p");
  line.className = "chat-line";

  if (entry.system) {
    line.classList.add("chat-system");
    if (Array.isArray(entry.segments) && entry.segments.length > 0) {
      for (const seg of entry.segments) {
        if (seg?.type === "player") {
          const playerSpan = document.createElement("span");
          playerSpan.className = "chat-name";
          playerSpan.style.color = colorForName(seg.name);
          playerSpan.textContent = seg.name || "";
          line.appendChild(playerSpan);
          continue;
        }
        const textSpan = document.createElement("span");
        textSpan.textContent = seg?.text || "";
        line.appendChild(textSpan);
      }
    } else {
      line.textContent = entry.text;
    }
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const nameSpan = document.createElement("span");
  nameSpan.className = "chat-name";
  nameSpan.textContent = `${entry.name || "okänd"}: `;
  nameSpan.style.color = colorForName(entry.name);

  const textSpan = document.createElement("span");
  textSpan.textContent = entry.text;

  line.appendChild(nameSpan);
  line.appendChild(textSpan);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function appendChat(entry) {
  appendChatLine(chatMessagesEl, entry);
  appendChatLine(gameChatMessagesEl, entry);
}

function replaceChat(history) {
  if (chatMessagesEl) chatMessagesEl.textContent = "";
  if (gameChatMessagesEl) gameChatMessagesEl.textContent = "";
  if (!Array.isArray(history)) return;
  for (const entry of history) appendChat(entry);
}

function resetInputState() {
  input.forward = false;
  input.backward = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.yaw = yaw;
  inputDirty = true;
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
      connecting = false;
      updateConnectButton();
      socket?.sendJson({ type: "login", name: loginName });
    },
    onMessage: (msg) => {
      if (generation !== socketGeneration) return;

      if (msg.type === "login_ok") {
        authenticated = true;
        myName = msg.name || loginName;
        replaceChat(msg.chatHistory || []);
        setConnectError("");
        setPrivateRoomButtonVisible(false);
        setAppMode("lobby");
        return;
      }

      if (msg.type === "login_error") {
        authenticated = false;
        myName = "";
        setAppMode("connect");
        setConnectError(msg.message || "Inloggning misslyckades.");
        setPrivateRoomButtonVisible(msg.reason === "room_full");
        return;
      }

      if (msg.type === "action_error") {
        setCountdownTextFromSession({ state: "lobby" });
        setConnectError(msg.message || "Kunde inte utföra åtgärden.");
        return;
      }

      if (msg.type === "chat") {
        appendChat(msg.entry);
        return;
      }

      if (msg.type === "countdown") {
        // world-session hanterar själva visningen; detta är bara om world dröjer.
        setCountdownTextFromSession({ state: "countdown", countdownMsRemaining: 3000 });
        return;
      }

      if (msg.type === "possess") {
        myCharacterId = msg.characterId ?? null;
        return;
      }

      if (msg.type !== "world") return;

      const previousCharacterId = myCharacterId;
      const state = msg.session;
      if (state) {
        sessionState = state.state;
        authenticated = Boolean(state.authenticated);
        myName = state.name || myName;
        myCharacterId = state.characterId ?? null;
        activePlayersInGame = Number(state.activePlayers || 0);
        updateInGameHud();
        updateDocumentTitle();
      }

      if (!authenticated) {
        setAppMode("connect");
      } else if (sessionState === "alive") {
        setConnectError("");
        setAppMode("playing");
      } else {
        setAppMode("lobby");
      }
      setCountdownTextFromSession(state);

      try {
        roomSystem.syncFromWorld({
          roomHalfSize: msg.roomHalfSize,
          shelves: msg.shelves
        });

        renderScoreboard(msg.scoreboard || []);

        const controlledYaw = avatarSystem.applyWorldCharacters({
          characters: msg.characters || [],
          myCharacterId,
          nowMs: performance.now()
        });

        if (controlledYaw != null) {
          const gainedNewCharacter = myCharacterId != null && myCharacterId !== previousCharacterId;
          if (gainedNewCharacter) {
            yaw = controlledYaw;
            viewYaw = controlledYaw;
            input.yaw = yaw;
          }
        }
      } catch (err) {
        console.error("[client:world-render]", err);
      }
    },
    onClose: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      authenticated = false;
      sessionState = "auth";
      myCharacterId = null;
      activePlayersInGame = 0;
      updateConnectButton();
      setAppMode("disconnected");
      setConnectError("Anslutningen bröts.");
      setPrivateRoomButtonVisible(false);
      updateDocumentTitle();
    },
    onError: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      updateConnectButton();
      setConnectError("Kunde inte ansluta till servern.");
      setAppMode("connect");
      setPrivateRoomButtonVisible(false);
      updateDocumentTitle();
    }
  });
}

function connectAndLogin() {
  if (connecting) return;
  if (!nameInputEl) return;
  const rawName = nameInputEl.value.trim();

  if (rawName.length < 2) {
    setConnectError("Namn måste vara minst 2 tecken.");
    return;
  }

  const wsUrl = `${wsScheme()}://${location.host}${activeRoomPath()}`;

  localStorage.setItem(PLAYER_NAME_KEY, rawName);

  connecting = true;
  authenticated = false;
  sessionState = "auth";
  myCharacterId = null;
  myName = "";
  activePlayersInGame = 0;
  updateConnectButton();
  setConnectError("");
  setPrivateRoomButtonVisible(false);
  resetInputState();
  setAppMode("connect");
  attachSocket(wsUrl, rawName);
}

function sendChat() {
  if (!chatInputEl) return;
  const text = chatInputEl.value.trim();
  if (!text || !socket) return;
  socket.sendJson({ type: "chat", text });
  chatInputEl.value = "";
}

function sendGameChat() {
  if (!gameChatInputEl) return;
  const text = gameChatInputEl.value.trim();
  if (!text || !socket) return;
  socket.sendJson({ type: "chat", text });
  gameChatInputEl.value = "";
}

function sendInput() {
  if (appMode !== "playing" || sessionState !== "alive") return;
  const now = performance.now();
  const payload = { type: "input", input };
  const snapshot = JSON.stringify(payload);
  const heartbeatDue = now - lastInputSentAt >= INPUT_HEARTBEAT_MS;
  if (!inputDirty && !heartbeatDue && snapshot === lastSentSnapshot) return;
  if (!socket || !socket.sendJson(payload)) return;
  inputDirty = false;
  lastInputSentAt = now;
  lastSentSnapshot = snapshot;
}

function setMoveInputState(field, active) {
  if (!(field in input)) return;
  if (input[field] === active) return;
  input[field] = active;
  inputDirty = true;
}

function bindHoldButton(el, onStart, onStop) {
  if (!el) return;

  const stop = (event) => {
    if (event && event.pointerId != null && el.hasPointerCapture?.(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
    onStop();
  };

  el.addEventListener("pointerdown", (event) => {
    if (!IS_TOUCH_DEVICE) return;
    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    onStart();
  });
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("lostpointercapture", onStop);
}

function bindMobileControls() {
  if (!IS_TOUCH_DEVICE) return;

  for (const btn of document.querySelectorAll(".mobileDirBtn")) {
    const moveField = btn.dataset.move;
    if (!moveField || !(moveField in input)) continue;
    bindHoldButton(
      btn,
      () => setMoveInputState(moveField, true),
      () => setMoveInputState(moveField, false)
    );
  }

  bindHoldButton(
    mobileSprintBtnEl,
    () => setMoveInputState("sprint", true),
    () => setMoveInputState("sprint", false)
  );

  if (mobileAttackBtnEl) {
    mobileAttackBtnEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (appMode !== "playing" || sessionState !== "alive") return;
      if (gameChatOpen || isGameChatFocused()) return;
      socket?.sendJson({ type: "attack" });
    });
  }

  if (mobileChatBtnEl) {
    mobileChatBtnEl.addEventListener("click", (event) => {
      event.preventDefault();
      if (appMode !== "playing" || sessionState !== "alive") return;
      setGameChatOpen(!gameChatOpen, { restorePointerLock: false });
    });
  }

  if (!mobileLookPadEl) return;
  mobileLookPadEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (mobileLookPointerId != null) return;
    mobileLookPointerId = event.pointerId;
    mobileLookLastX = event.clientX;
    mobileLookLastY = event.clientY;
    mobileLookPadEl.setPointerCapture?.(event.pointerId);
  });

  mobileLookPadEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== mobileLookPointerId) return;
    if (appMode !== "playing" || sessionState !== "alive" || gameChatOpen || isGameChatFocused()) return;

    event.preventDefault();
    const dx = event.clientX - mobileLookLastX;
    const dy = event.clientY - mobileLookLastY;
    mobileLookLastX = event.clientX;
    mobileLookLastY = event.clientY;

    yaw -= dx * LOOK_TOUCH_SENSITIVITY_X;
    pitch = clampPitch(pitch - dy * LOOK_TOUCH_SENSITIVITY_Y);
    input.yaw = yaw;
    inputDirty = true;
    const now = performance.now();
    if (now - lastInputSentAt >= INPUT_SEND_INTERVAL_MS) sendInput();
  });

  const clearLookPointer = (event) => {
    if (event.pointerId !== mobileLookPointerId) return;
    if (mobileLookPadEl.hasPointerCapture?.(event.pointerId)) {
      mobileLookPadEl.releasePointerCapture(event.pointerId);
    }
    mobileLookPointerId = null;
  };

  mobileLookPadEl.addEventListener("pointerup", clearLookPointer);
  mobileLookPadEl.addEventListener("pointercancel", clearLookPointer);
  mobileLookPadEl.addEventListener("lostpointercapture", () => {
    mobileLookPointerId = null;
  });
}

const savedName = localStorage.getItem(PLAYER_NAME_KEY);
if (nameInputEl) nameInputEl.value = savedName != null ? savedName : "";
if (debugTokenInputEl) debugTokenInputEl.value = getDebugToken();
bindMobileControls();

connectBtnEl?.addEventListener("click", connectAndLogin);
createPrivateRoomBtnEl?.addEventListener("click", () => {
  const code = randomPrivateRoomCode();
  location.assign(`/${encodeURIComponent(code)}`);
});
nameInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connectAndLogin();
});
playBtnEl?.addEventListener("click", () => {
  if (!socket || !authenticated) return;
  socket.sendJson({ type: "play" });
  requestPointerLockSafe(canvas);
});
controlsBtnEl?.addEventListener("click", () => {
  openLobbyDialog(
    "Kontroller",
    "PC: WASD rörelse, Shift sprint, mus för att titta runt, vänsterklick attack, C öppnar chat.\nMobil: knappar nere till vänster för rörelse, dra i höger ruta för att titta, Attack/Spring/Chat till höger."
  );
});
settingsBtnEl?.addEventListener("click", () => {
  openLobbyDialog("Inställningar", "Nada just nu.");
});
creditsBtnEl?.addEventListener("click", () => {
  openLobbyDialog(
    "Credits",
    "Skapat av Robin Reicher.\nInspirerat av Adam Spraggs spel \"Hidden in Plain Sight\"."
  );
});
debugBtnEl?.addEventListener("click", openDebugView);
debugCloseBtnEl?.addEventListener("click", closeDebugView);
debugLoginBtnEl?.addEventListener("click", () => {
  setDebugToken(debugTokenInputEl?.value?.trim() || "");
  fetchAndRenderDebugData();
});
debugClearTokenBtnEl?.addEventListener("click", () => {
  setDebugToken("");
  if (debugTokenInputEl) debugTokenInputEl.value = "";
  setDebugError("");
});
debugTokenInputEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  setDebugToken(debugTokenInputEl.value.trim());
  fetchAndRenderDebugData();
});
debugBackdropEl?.addEventListener("click", (event) => {
  if (event.target === debugBackdropEl) closeDebugView();
});

chatSendBtnEl?.addEventListener("click", sendChat);
chatInputEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  sendChat();
});
gameChatInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendGameChat();
    setGameChatOpen(false, { restorePointerLock: true });
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setGameChatOpen(false, { restorePointerLock: true });
  }
});
lobbyDialogCloseBtnEl?.addEventListener("click", closeLobbyDialog);
lobbyDialogBackdropEl?.addEventListener("click", (event) => {
  if (event.target === lobbyDialogBackdropEl) closeLobbyDialog();
});

window.addEventListener("resize", () => {
  resize();
});

window.addEventListener("keydown", (event) => {
  if (debugOpen && event.key === "Escape") {
    event.preventDefault();
    closeDebugView();
    return;
  }
  if (appMode !== "playing") return;
  if (event.code === "KeyC" && sessionState === "alive" && !gameChatOpen && !isGameChatFocused()) {
    event.preventDefault();
    setGameChatOpen(true);
    return;
  }
  if (gameChatOpen || isGameChatFocused()) return;
  let changed = false;
  if (event.code === "KeyW" && !input.forward) {
    input.forward = true;
    changed = true;
  }
  if (event.code === "KeyS" && !input.backward) {
    input.backward = true;
    changed = true;
  }
  if (event.code === "KeyA" && !input.left) {
    input.left = true;
    changed = true;
  }
  if (event.code === "KeyD" && !input.right) {
    input.right = true;
    changed = true;
  }
  if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && !input.sprint) {
    input.sprint = true;
    changed = true;
  }
  if (changed) inputDirty = true;
});

window.addEventListener("keyup", (event) => {
  if (appMode !== "playing") return;
  if (gameChatOpen || isGameChatFocused()) return;
  let changed = false;
  if (event.code === "KeyW" && input.forward) {
    input.forward = false;
    changed = true;
  }
  if (event.code === "KeyS" && input.backward) {
    input.backward = false;
    changed = true;
  }
  if (event.code === "KeyA" && input.left) {
    input.left = false;
    changed = true;
  }
  if (event.code === "KeyD" && input.right) {
    input.right = false;
    changed = true;
  }
  if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && input.sprint) {
    input.sprint = false;
    changed = true;
  }
  if (changed) inputDirty = true;
});

canvas.addEventListener("click", () => {
  if (appMode !== "playing") return;
  if (gameChatOpen) return;
  if (!document.pointerLockElement) {
    requestPointerLockSafe(canvas);
  }
});

document.addEventListener("mousemove", (event) => {
  if (appMode !== "playing") return;
  if (!document.pointerLockElement) return;
  yaw -= event.movementX * 0.0022;
  pitch = clampPitch(pitch - event.movementY * 0.002);

  input.yaw = yaw;
  inputDirty = true;
  const now = performance.now();
  if (now - lastInputSentAt >= INPUT_SEND_INTERVAL_MS) sendInput();
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (appMode !== "playing" || sessionState !== "alive") return;
  if (gameChatOpen || isGameChatFocused()) return;
  socket?.sendJson({ type: "attack" });
});

setInterval(sendInput, INPUT_SEND_INTERVAL_MS);

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSec = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  const viewSmooth = 1 - Math.exp(-deltaSec * 30);
  const yawDelta = normalizeAngle(yaw - viewYaw);
  viewYaw = normalizeAngle(viewYaw + yawDelta * viewSmooth);
  viewPitch += (pitch - viewPitch) * viewSmooth;

  camera.rotation.y = viewYaw;
  camera.rotation.x = viewPitch;
  avatarSystem.animate(deltaSec, myCharacterId);
  renderer.render(scene, camera);
}

animate();
updateConnectButton();
setRoomInfo();
setPrivateRoomButtonVisible(false);
setAppMode("connect");
updateDocumentTitle();

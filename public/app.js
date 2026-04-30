import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import { createAvatarSystem } from "./client/avatars.js";
import { createGameSocket } from "./client/network.js";

const canvas = document.getElementById("game");
const screenRootEl = document.getElementById("screenRoot");
const connectViewEl = document.getElementById("connectView");
const lobbyViewEl = document.getElementById("lobbyView");
const connectErrorEl = document.getElementById("connectError");
const nameInputEl = document.getElementById("nameInput");
const connectBtnEl = document.getElementById("connectBtn");
const scoreBodyEl = document.getElementById("scoreBody");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtnEl = document.getElementById("chatSendBtn");
const playBtnEl = document.getElementById("playBtn");
const controlsBtnEl = document.getElementById("controlsBtn");
const settingsBtnEl = document.getElementById("settingsBtn");
const creditsBtnEl = document.getElementById("creditsBtn");
const countdownTextEl = document.getElementById("countdownText");
const lobbyDialogBackdropEl = document.getElementById("lobbyDialogBackdrop");
const lobbyDialogTitleEl = document.getElementById("lobbyDialogTitle");
const lobbyDialogTextEl = document.getElementById("lobbyDialogText");
const lobbyDialogCloseBtnEl = document.getElementById("lobbyDialogCloseBtn");
const gameHudEl = document.getElementById("gameHud");
const aliveOthersTextEl = document.getElementById("aliveOthersText");
const gameChatMessagesEl = document.getElementById("gameChatMessages");
const gameChatInputRowEl = document.getElementById("gameChatInputRow");
const gameChatInputEl = document.getElementById("gameChatInput");

const PLAYER_NAME_KEY = "hidden_player_name";

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

let pitch = 0;
let yaw = 0;
let viewPitch = 0;
let viewYaw = 0;
let inputDirty = true;
let lastInputSentAt = 0;
let lastSentSnapshot = "";
let lastFrameAt = performance.now();

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

function wsScheme() {
  return location.protocol === "https:" ? "wss" : "ws";
}

function setConnectError(text) {
  if (!connectErrorEl) return;
  connectErrorEl.textContent = text || "";
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

function setGameChatOpen(open, { restorePointerLock = false } = {}) {
  if (!gameChatInputRowEl || !gameChatInputEl) return;
  gameChatOpen = Boolean(open);
  gameChatInputRowEl.classList.toggle("hidden", !gameChatOpen);

  if (gameChatOpen) {
    resetInputState();
    sendInput();
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameChatInputEl.focus();
    return;
  }

  gameChatInputEl.blur();
  if (restorePointerLock && appMode === "playing" && sessionState === "alive") {
    requestPointerLockSafe(canvas);
  }
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
  }

  if (mode !== "playing") setGameChatOpen(false);
  updateInGameHud();
  updateDocumentTitle();
}

function setCountdownTextFromSession(state) {
  if (!countdownTextEl || !playBtnEl) return;
  if (state?.state === "countdown") {
    const ms = state.countdownMsRemaining ?? 3000;
    const sec = Math.max(1, Math.ceil(ms / 1000));
    countdownTextEl.textContent = `Spel startar om ${sec}`;
    playBtnEl.disabled = true;
    return;
  }
  countdownTextEl.textContent = "";
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
        setAppMode("lobby");
        return;
      }

      if (msg.type === "login_error") {
        authenticated = false;
        myName = "";
        setAppMode("connect");
        setConnectError(msg.message || "Inloggning misslyckades.");
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

      roomSystem.syncFromWorld({
        roomHalfSize: msg.roomHalfSize,
        shelves: msg.shelves
      });

      renderScoreboard(msg.scoreboard || []);

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

      if (!authenticated) {
        setAppMode("connect");
      } else if (sessionState === "alive") {
        setConnectError("");
        setAppMode("playing");
      } else {
        setAppMode("lobby");
      }
      setCountdownTextFromSession(state);
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
      updateDocumentTitle();
    },
    onError: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      updateConnectButton();
      setConnectError("Kunde inte ansluta till servern.");
      setAppMode("connect");
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

  const wsUrl = `${wsScheme()}://${location.host}`;

  localStorage.setItem(PLAYER_NAME_KEY, rawName);

  connecting = true;
  authenticated = false;
  sessionState = "auth";
  myCharacterId = null;
  myName = "";
  activePlayersInGame = 0;
  updateConnectButton();
  setConnectError("");
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

const savedName = localStorage.getItem(PLAYER_NAME_KEY);
if (nameInputEl) nameInputEl.value = savedName != null ? savedName : "";

connectBtnEl?.addEventListener("click", connectAndLogin);
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
    "WASD: rörelse\nShift: springa (dum ide)\nMus: titta runt\nVänsterklick: attack\nC: öppna chat i spelet"
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
  if (appMode !== "playing") return;
  if (event.code === "KeyC" && sessionState === "alive") {
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
  pitch -= event.movementY * 0.002;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));

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
setAppMode("connect");
updateDocumentTitle();

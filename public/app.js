import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import { createAvatarSystem } from "./client/avatars.js";
import { createGameSocket } from "./client/network.js";

const canvas = document.getElementById("game");
const statusEl = document.getElementById("status");
const helpEl = document.getElementById("help");

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize } = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

let myCharacterId = null;
let sessionState = "connecting";

const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  yaw: 0
};
const INPUT_SEND_INTERVAL_MS = 50;
const INPUT_HEARTBEAT_MS = 200;

let pitch = 0;
let yaw = 0;
let inputDirty = true;
let lastInputSentAt = 0;
let lastSentSnapshot = "";
let lastFrameAt = performance.now();

const crosshair = document.createElement("div");
crosshair.className = "crosshair";
document.body.appendChild(crosshair);

const socket = createGameSocket({
  onOpen: () => {
    sessionState = "countdown";
    inputDirty = true;
  },
  onMessage: (msg) => {
    if (msg.type === "countdown") {
      sessionState = "countdown";
      return;
    }

    if (msg.type === "full") {
      sessionState = "full";
      myCharacterId = null;
      return;
    }

    if (msg.type === "possess") {
      sessionState = "alive";
      myCharacterId = msg.characterId;
      return;
    }

    if (msg.type !== "world") return;

    roomSystem.syncFromWorld({
      roomHalfSize: msg.roomHalfSize,
      shelves: msg.shelves
    });

    const state = msg.session;
    if (state) {
      sessionState = state.state;
      myCharacterId = state.characterId ?? null;
    }

    const controlledYaw = avatarSystem.applyWorldCharacters({
      characters: msg.characters || [],
      myCharacterId,
      nowMs: performance.now()
    });
    if (controlledYaw != null) {
      yaw = controlledYaw;
      input.yaw = yaw;
    }

    updateStatus(state);
  },
  onClose: () => {
    sessionState = "disconnected";
    statusEl.textContent = "Frånkopplad från servern";
  },
  onError: () => {
    sessionState = "disconnected";
    statusEl.textContent = "Nätverksfel mot servern";
  }
});

function updateStatus(state) {
  if (sessionState === "full") {
    statusEl.style.color = "#ff5a5f";
    statusEl.textContent = "Spelet är fullt.";
    if (state?.queuePosition) {
      helpEl.textContent = `Köplats: ${state.queuePosition}. Startar automatiskt när en plats frigörs.`;
    } else {
      helpEl.textContent = "Väntar på ledig plats, startar automatiskt när en plats frigörs.";
    }
    return;
  }

  statusEl.style.color = "#9be564";
  if (sessionState === "alive") {
    const currentPlayers = state ? `${state.activePlayers}/${state.maxPlayers}` : "?";
    statusEl.textContent = `Spelar nu (${currentPlayers})`;
    helpEl.textContent = "WASD, mus, vänsterklick";
    return;
  }

  if (sessionState === "countdown") {
    const ms = state?.countdownMsRemaining ?? 3000;
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    statusEl.textContent = `Startar spel om ${seconds}...`;
    return;
  }

  if (sessionState === "connecting") {
    statusEl.textContent = "Ansluter...";
    return;
  }

  statusEl.textContent = "Väntar...";
}

function sendInput() {
  const now = performance.now();
  const payload = {
    type: "input",
    input
  };
  const snapshot = JSON.stringify(payload);
  const heartbeatDue = now - lastInputSentAt >= INPUT_HEARTBEAT_MS;
  if (!inputDirty && !heartbeatDue && snapshot === lastSentSnapshot) return;
  if (!socket.sendJson(payload)) return;
  inputDirty = false;
  lastInputSentAt = now;
  lastSentSnapshot = snapshot;
}

window.addEventListener("resize", () => {
  resize();
});

window.addEventListener("keydown", (event) => {
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
  if (changed) inputDirty = true;
});

window.addEventListener("keyup", (event) => {
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
  if (changed) inputDirty = true;
});

canvas.addEventListener("click", async () => {
  if (document.pointerLockElement !== canvas) {
    await canvas.requestPointerLock();
  }
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.002;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));

  input.yaw = yaw;
  inputDirty = true;
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  socket.sendJson({ type: "attack" });
});

setInterval(sendInput, INPUT_SEND_INTERVAL_MS);

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSec = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  avatarSystem.animate(deltaSec);
  renderer.render(scene, camera);
}

animate();

import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import { createAvatarSystem, drawCountdownCharacterPreview } from "./client/avatars.js";
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
const lobbySettingsBtnEl = document.getElementById("lobbySettingsBtn");
const lobbyMenuBackdropEl = document.getElementById("lobbyMenuBackdrop");
const lobbyMenuSettingsBtnEl = document.getElementById("lobbyMenuSettingsBtn");
const lobbyMenuCreditsBtnEl = document.getElementById("lobbyMenuCreditsBtn");
const lobbyMenuCloseBtnEl = document.getElementById("lobbyMenuCloseBtn");
const lobbyMatchStatusEl = document.getElementById("lobbyMatchStatus");
const lobbyMatchStatusTitleEl = document.getElementById("lobbyMatchStatusTitle");
const debugBtnEl = document.getElementById("debugBtn");
const countdownOverlayEl = document.getElementById("countdownOverlay");
const countdownTextEl = document.getElementById("countdownText");
const countdownCharacterCanvasEl = document.getElementById("countdownCharacterCanvas");
const countdownCharacterMetaEl = document.getElementById("countdownCharacterMeta");
const countdownControlsTextEl = document.getElementById("countdownControlsText");
const lobbyDialogBackdropEl = document.getElementById("lobbyDialogBackdrop");
const lobbyDialogTitleEl = document.getElementById("lobbyDialogTitle");
const lobbyDialogTextEl = document.getElementById("lobbyDialogText");
const settingsPanelEl = document.getElementById("settingsPanel");
const mobileControlsModeBtnEl = document.getElementById("mobileControlsModeBtn");
const mobileControlsModeHelpEl = document.getElementById("mobileControlsModeHelp");
const musicVolumeInputEl = document.getElementById("musicVolumeInput");
const musicMuteBtnEl = document.getElementById("musicMuteBtn");
const sfxVolumeInputEl = document.getElementById("sfxVolumeInput");
const sfxMuteBtnEl = document.getElementById("sfxMuteBtn");
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
const crosshairHudEl = document.getElementById("crosshairHud");
const crosshairCooldownArcEl = document.getElementById("crosshairCooldownArc");
const aliveOthersTextEl = document.getElementById("aliveOthersText");
const knockdownToastEl = document.getElementById("knockdownToast");
const winOverlayEl = document.getElementById("winOverlay");
const winTitleEl = document.getElementById("winTitle");
const winCountdownTextEl = document.getElementById("winCountdownText");
const winLobbyBtnEl = document.getElementById("winLobbyBtn");
const gameMenuBtnEl = document.getElementById("gameMenuBtn");
const gameMenuBackdropEl = document.getElementById("gameMenuBackdrop");
const gameMenuSettingsBtnEl = document.getElementById("gameMenuSettingsBtn");
const gameMenuCreditsBtnEl = document.getElementById("gameMenuCreditsBtn");
const gameMenuCloseBtnEl = document.getElementById("gameMenuCloseBtn");
const gameMenuLobbyBtnEl = document.getElementById("gameMenuLobbyBtn");
const gameChatNoticeEl = document.getElementById("gameChatNotice");
const gameChatMessagesEl = document.getElementById("gameChatMessages");
const gameChatInputRowEl = document.getElementById("gameChatInputRow");
const gameChatInputEl = document.getElementById("gameChatInput");
const mobileControlsEl = document.getElementById("mobileControls");
const mobileJoystickBaseEl = document.getElementById("mobileJoystickBase");
const mobileJoystickKnobEl = document.getElementById("mobileJoystickKnob");
const mobileLookPadEl = document.getElementById("mobileLookPad");
const mobileSprintBtnEl = document.getElementById("mobileSprintBtn");
const mobileAttackBtnEl = document.getElementById("mobileAttackBtn");
const downedOverlayEl = document.getElementById("downedOverlay");
const downedByTextEl = document.getElementById("downedByText");
const downedCountdownTextEl = document.getElementById("downedCountdownText");
const downedLobbyBtnEl = document.getElementById("downedLobbyBtn");

const PLAYER_NAME_KEY = "hidden_player_name";
const DEBUG_TOKEN_KEY = "hidden_debug_token";
const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";
const AUDIO_SETTINGS_KEY = "hidden_audio_settings";

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize } = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

let socket = null;
let socketGeneration = 0;
let connecting = false;
let authenticated = false;
let appMode = "connect"; // connect | lobby | playing | disconnected
let sessionState = "auth"; // auth | lobby | countdown | alive | downed | won
let myCharacterId = null;
let myName = "";
let sessionReady = false;
let activePlayersInGame = 0;
let attackCooldownMsRemaining = 0;
let attackCooldownVisualMaxMs = 1000;
let gameChatOpen = false;
let gameMenuOpen = false;
let lobbyMenuOpen = false;
let debugOpen = false;
let debugPollTimer = null;
let debugLoading = false;
let leavingGameManually = false;
let forceYawSyncOnNextWorld = false;
let currentMatch = { inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 };
let lobbyScoreboard = [];
let lobbyCountdownMsRemaining = 0;
let lobbyMinPlayersToStart = 2;
let lobbyMaxPlayers = 0;
let winReturnToLobbyMsRemaining = 0;
let downedByName = "";
let knockdownToastText = "";
let knockdownToastMsRemaining = 0;

const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  yaw: 0,
  pitch: 0
};

const INPUT_SEND_INTERVAL_MS = 33;
const INPUT_HEARTBEAT_MS = 120;
const CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS = 8;
const CROSSHAIR_DEFAULT_COOLDOWN_MS = 1000;
const CROSSHAIR_RING_CIRCUMFERENCE = Math.PI * 26;
const CROSSHAIR_HIT_DISTANCE_METERS = 2.8;
const GAME_CHAT_MAX_LINES = 5;
const DEBUG_LIST_LIMIT = 20;
const LOOK_TOUCH_SENSITIVITY_X = 0.0052;
const LOOK_TOUCH_SENSITIVITY_Y = 0.0045;
const JOYSTICK_DEADZONE = 0.16;
const DOWNED_CAMERA_HEIGHT = 4.6;
const DOWNED_CAMERA_POS_SMOOTH_RATE = 9;
const KNOCKDOWN_TOAST_MS = 5000;
const FORCE_MOBILE_UI = new URLSearchParams(location.search).get("mobileUi") === "1";
const MOBILE_CONTROLS_PREFS = Object.freeze(["auto", "on", "off"]);
const IS_TOUCH_DEVICE = (() => {
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const hoverNone = window.matchMedia && window.matchMedia("(hover: none)").matches;
  const touchApi = "ontouchstart" in window;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  return coarsePointer || hoverNone || touchApi || touchPoints || mobileUa || FORCE_MOBILE_UI;
})();

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
let mobileMovePointerId = null;
let joystickCurrentX = 0;
let joystickCurrentY = 0;
let mobileControlsPreference = normalizeMobileControlsPreference(localStorage.getItem(MOBILE_CONTROLS_PREF_KEY));
let audioSettings = loadAudioSettings();
const musicLoopEl = new Audio("/assets/music.wav");
musicLoopEl.loop = true;
musicLoopEl.preload = "auto";
const GAMEPLAY_SUMMARY_TEXT = "Håll dig gömd, hitta spelare och slå ner dem.";
const DESKTOP_CONTROLS_TEXT = "Desktop: C: WASD rörelse, Shift sprint, mus för att titta runt, vänsterklick attack.";
const MOBILE_CONTROLS_TEXT =
  "Mobil: joystick nere till vänster för rörelse, Attack/Spring i mitten, dra i höger ruta för att titta.";
let lastCountdownPreviewCharacterId = null;

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

function normalizeMobileControlsPreference(value) {
  if (value === "on" || value === "off" || value === "auto") return value;
  return "auto";
}

function persistMobileControlsPreference(value) {
  const normalized = normalizeMobileControlsPreference(value);
  mobileControlsPreference = normalized;
  localStorage.setItem(MOBILE_CONTROLS_PREF_KEY, normalized);
}

function mobileControlsEnabledByPreference() {
  if (mobileControlsPreference === "on") return true;
  if (mobileControlsPreference === "off") return false;
  return IS_TOUCH_DEVICE;
}

function controlsTextForCurrentMode() {
  return `${GAMEPLAY_SUMMARY_TEXT}\n${
    mobileControlsEnabledByPreference() ? MOBILE_CONTROLS_TEXT : DESKTOP_CONTROLS_TEXT
  }`;
}

function mobileControlsLabel(pref) {
  if (pref === "on") return "På";
  if (pref === "off") return "Av";
  return "Auto";
}

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeAudioSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    musicVolume: clampVolume(src.musicVolume ?? 80),
    musicMuted: Boolean(src.musicMuted),
    sfxVolume: clampVolume(src.sfxVolume ?? 90),
    sfxMuted: Boolean(src.sfxMuted)
  };
}

function loadAudioSettings() {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return normalizeAudioSettings(null);
    return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    return normalizeAudioSettings(null);
  }
}

function persistAudioSettings() {
  localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioSettings));
}

function refreshAudioSettingsUi() {
  if (mobileControlsModeBtnEl) {
    mobileControlsModeBtnEl.textContent = mobileControlsLabel(mobileControlsPreference);
  }
  if (mobileControlsModeHelpEl) {
    if (mobileControlsPreference === "on") {
      mobileControlsModeHelpEl.textContent = "På: mobilkontroller visas alltid under spel.";
    } else if (mobileControlsPreference === "off") {
      mobileControlsModeHelpEl.textContent = "Av: använd tangentbord/mus även på touch-enhet.";
    } else {
      mobileControlsModeHelpEl.textContent = "Auto: visar mobilkontroller på touch-enheter.";
    }
  }
  if (musicVolumeInputEl) musicVolumeInputEl.value = String(audioSettings.musicVolume);
  if (sfxVolumeInputEl) sfxVolumeInputEl.value = String(audioSettings.sfxVolume);
  if (musicMuteBtnEl) musicMuteBtnEl.textContent = audioSettings.musicMuted ? "Avmuta" : "Muta";
  if (sfxMuteBtnEl) sfxMuteBtnEl.textContent = audioSettings.sfxMuted ? "Avmuta" : "Muta";
  syncMusicLoop();
}

function syncMusicLoop() {
  musicLoopEl.volume = Math.max(0, Math.min(1, audioSettings.musicVolume / 100));
  const shouldPlay =
    appMode === "playing" && !audioSettings.musicMuted && musicLoopEl.volume > 0;
  if (shouldPlay) {
    const playPromise = musicLoopEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
    return;
  }
  musicLoopEl.pause();
  musicLoopEl.currentTime = 0;
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

function openLobbyDialog(title, text, { showSettings = false } = {}) {
  if (!lobbyDialogBackdropEl || !lobbyDialogTitleEl || !lobbyDialogTextEl || !lobbyDialogCloseBtnEl) return;
  setLobbyMenuOpen(false);
  lobbyDialogTitleEl.textContent = title;
  lobbyDialogTextEl.textContent = text;
  lobbyDialogTextEl.classList.toggle("hidden", showSettings);
  if (settingsPanelEl) settingsPanelEl.classList.toggle("hidden", !showSettings);
  if (showSettings) refreshAudioSettingsUi();
  lobbyDialogBackdropEl.classList.remove("hidden");
  updateScreenRootPointerEvents();
  if (showSettings && musicVolumeInputEl) {
    musicVolumeInputEl.focus();
  } else {
    lobbyDialogCloseBtnEl.focus();
  }
}

function closeLobbyDialog() {
  if (!lobbyDialogBackdropEl) return;
  lobbyDialogBackdropEl.classList.add("hidden");
  if (settingsPanelEl) settingsPanelEl.classList.add("hidden");
  lobbyDialogTextEl?.classList.remove("hidden");
  updateScreenRootPointerEvents();
  if (appMode === "playing" && (sessionState === "alive" || sessionState === "won")) {
    requestPointerLockSafe(canvas);
  }
}

function isGameChatFocused() {
  return document.activeElement === gameChatInputEl;
}

function updateMobileControlsVisibility() {
  if (!mobileControlsEl) return;
  const wasShown = !mobileControlsEl.classList.contains("hidden");
  const show =
    mobileControlsEnabledByPreference() &&
    appMode === "playing" &&
    (sessionState === "alive" || sessionState === "won") &&
    !gameChatOpen &&
    !gameMenuOpen;
  mobileControlsEl.classList.toggle("hidden", !show);
  document.body.classList.toggle("mobile-controls-enabled", show);
  if (wasShown && !show) resetJoystickState();
}

function isMobileChatDisabledInGame() {
  return true;
}

function setGameChatOpen(open, { restorePointerLock = false } = {}) {
  if (!gameChatInputRowEl) return;
  const canOpen = Boolean(open) && !isMobileChatDisabledInGame();
  gameChatOpen = canOpen;
  gameChatInputRowEl.classList.toggle("hidden", !canOpen);
  if (canOpen) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameChatInputEl?.focus();
  } else {
    gameChatInputEl?.blur();
  }
  if (restorePointerLock && appMode === "playing" && (sessionState === "alive" || sessionState === "won")) {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
}

function setGameMenuOpen(open, { restorePointerLock = false } = {}) {
  if (!gameMenuBackdropEl) return;
  gameMenuOpen = Boolean(open);
  gameMenuBackdropEl.classList.toggle("hidden", !gameMenuOpen);
  if (gameMenuOpen) {
    resetInputState();
    sendInput();
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameMenuSettingsBtnEl?.focus();
    updateMobileControlsVisibility();
    return;
  }
  if (restorePointerLock && appMode === "playing" && (sessionState === "alive" || sessionState === "won")) {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
}

function setLobbyMenuOpen(open) {
  if (!lobbyMenuBackdropEl) return;
  lobbyMenuOpen = Boolean(open);
  lobbyMenuBackdropEl.classList.toggle("hidden", !lobbyMenuOpen);
  if (lobbyMenuOpen) {
    lobbyMenuSettingsBtnEl?.focus();
  } else if (appMode === "lobby") {
    lobbySettingsBtnEl?.focus();
  }
}

function updateLobbyMatchStatus() {
  if (!lobbyMatchStatusEl || !lobbyMatchStatusTitleEl) return;
  const show = appMode === "lobby";
  lobbyMatchStatusEl.classList.toggle("hidden", !show);
  if (!show) return;

  if (currentMatch.inProgress) {
    const elapsedMinutes = Math.floor(Math.max(0, Number(currentMatch.elapsedMs || 0)) / 60000);
    lobbyMatchStatusTitleEl.textContent = `Spel Startat (${elapsedMinutes} minuter)`;
    return;
  }

  const minPlayers = Math.max(1, Number(lobbyMinPlayersToStart || 2));
  const players = Array.isArray(lobbyScoreboard) ? lobbyScoreboard : [];
  const playerCount = players.length;
  const maxPlayers = Math.max(playerCount, Number(lobbyMaxPlayers || 0));
  const readyCount = players.reduce((acc, player) => acc + (player?.ready ? 1 : 0), 0);
  const readyEligibleCount = players.reduce((acc, player) => {
    const status = String(player?.status || "").toLowerCase();
    const canReady = status === "väntar" || status === "redo" || status === "nedräkning";
    return acc + (canReady ? 1 : 0);
  }, 0);
  const playersText = `Spelare ${playerCount}/${maxPlayers}`;
  const readyText = `Redo ${readyCount}/${readyEligibleCount}`;
  const countdownRunning =
    lobbyCountdownMsRemaining > 0 ||
    players.some((player) => String(player?.status || "").toLowerCase() === "nedräkning") ||
    sessionState === "countdown";

  if (countdownRunning) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Startar match`;
    return;
  }
  if (playerCount < minPlayers) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Väntar på fler spelare`;
    return;
  }
  if (readyCount < readyEligibleCount) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Väntar på att spelare ska bli redo (${readyText})`;
    return;
  }
  lobbyMatchStatusTitleEl.textContent = `${playersText} - Startar match`;
}

function updateReadyButton() {
  if (!playBtnEl) return;
  if (!authenticated) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Redo";
    return;
  }
  if (sessionState === "alive") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Spelar...";
    return;
  }
  if (currentMatch.inProgress) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Match pågår";
    return;
  }
  if (sessionState === "countdown" && sessionReady) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Nedräkning...";
    return;
  }
  if (sessionReady) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Inte redo";
    return;
  }
  playBtnEl.disabled = false;
  playBtnEl.textContent = "Redo";
}

function resetDownedState() {
  downedByName = "";
}

function resetWinState() {
  winReturnToLobbyMsRemaining = 0;
}

function resetKnockdownToast() {
  knockdownToastText = "";
  knockdownToastMsRemaining = 0;
}

function updateInGameHud() {
  if (!aliveOthersTextEl) return;
  const others = Math.max(0, activePlayersInGame - (sessionState === "alive" ? 1 : 0));
  const noun = others === 1 ? "annan" : "andra";
  aliveOthersTextEl.textContent = `${others} ${noun} spelar just nu`;
  if (gameChatNoticeEl) {
    gameChatNoticeEl.textContent = sessionState === "won" ? "Chatt" : "Systemhändelser";
  }
}

function updateDownedOverlay() {
  if (!downedOverlayEl || !downedByTextEl || !downedCountdownTextEl) return;
  const downed = appMode === "playing" && sessionState === "downed";
  downedOverlayEl.classList.toggle("hidden", !downed);
  gameMenuBtnEl?.classList.toggle("hidden", downed);
  if (!downed) return;

  const killer = downedByName ? String(downedByName) : "okänd spelare";
  downedByTextEl.textContent = `Du blev nedslagen av ${killer}`;
  downedCountdownTextEl.textContent = "Tryck på knappen för att återgå till lobbyn.";
}

function updateWinOverlay() {
  if (!winOverlayEl || !winTitleEl || !winCountdownTextEl) return;
  const won = appMode === "playing" && sessionState === "won";
  winOverlayEl.classList.toggle("hidden", !won);
  gameMenuBtnEl?.classList.toggle("hidden", won);
  if (!won) return;
  winTitleEl.textContent = "Du vann!";
  const sec = Math.max(0, Math.ceil(winReturnToLobbyMsRemaining / 1000));
  winCountdownTextEl.textContent = `Återgå till lobbyn om ${sec}`;
}

function updateKnockdownToast() {
  if (!knockdownToastEl) return;
  const visible =
    appMode === "playing" && sessionState !== "won" && knockdownToastMsRemaining > 0 && Boolean(knockdownToastText);
  knockdownToastEl.classList.toggle("hidden", !visible);
  if (visible) knockdownToastEl.textContent = knockdownToastText;
}

function updateCrosshairHud(deltaSec) {
  if (!crosshairHudEl || !crosshairCooldownArcEl) return;

  const inActiveGameplay = appMode === "playing" && sessionState === "alive" && myCharacterId != null;
  crosshairHudEl.classList.toggle("hidden", !inActiveGameplay);
  if (!inActiveGameplay) return;

  attackCooldownMsRemaining = Math.max(0, attackCooldownMsRemaining - Math.max(0, deltaSec) * 1000);
  const onCooldown = attackCooldownMsRemaining > CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS;
  crosshairHudEl.classList.toggle("cooldown", onCooldown);

  if (onCooldown) {
    const visualMax = Math.max(120, attackCooldownVisualMaxMs || CROSSHAIR_DEFAULT_COOLDOWN_MS);
    const cooldownRatio = Math.max(0, Math.min(1, attackCooldownMsRemaining / visualMax));
    const dashOffset = CROSSHAIR_RING_CIRCUMFERENCE * (1 - cooldownRatio);
    crosshairCooldownArcEl.style.strokeDashoffset = dashOffset.toFixed(3);
    crosshairHudEl.classList.remove("targeting");
    return;
  }

  crosshairCooldownArcEl.style.strokeDashoffset = CROSSHAIR_RING_CIRCUMFERENCE.toFixed(3);
  camera.updateMatrixWorld(true);
  const aimingAtCharacter = avatarSystem.isAimingAtCharacter({
    myCharacterId,
    maxDistance: CROSSHAIR_HIT_DISTANCE_METERS
  });
  crosshairHudEl.classList.toggle("targeting", aimingAtCharacter);
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
  updateScreenRootPointerEvents();

  if (previous === "playing" && mode !== "playing" && document.pointerLockElement) {
    document.exitPointerLock?.();
  }

  if (previous === "playing" && mode !== "playing") {
    myCharacterId = null;
    attackCooldownMsRemaining = 0;
    attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
    resetInputState();
  }

  if (mode !== "lobby" && debugOpen) {
    closeDebugView();
  }

  if (mode !== "playing") setGameChatOpen(false);
  if (mode !== "playing") setGameMenuOpen(false);
  if (mode !== "lobby") setLobbyMenuOpen(false);
  if (mode === "playing" && isMobileChatDisabledInGame() && gameChatOpen) setGameChatOpen(false);
  if (mode === "connect" || mode === "disconnected") setCountdownTextFromSession({ state: "lobby" });
  updateReadyButton();
  updateMobileControlsVisibility();
  updateLobbyMatchStatus();
  updateInGameHud();
  updateDownedOverlay();
  updateWinOverlay();
  updateKnockdownToast();
  syncMusicLoop();
  updateDocumentTitle();
}

function updateScreenRootPointerEvents() {
  if (!screenRootEl) return;
  const overlayActive = appMode !== "playing";
  const dialogOpenInGame =
    appMode === "playing" && lobbyDialogBackdropEl && !lobbyDialogBackdropEl.classList.contains("hidden");
  screenRootEl.style.pointerEvents = overlayActive || dialogOpenInGame ? "auto" : "none";
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
  if (!countdownTextEl || !countdownOverlayEl) return;
  const ms = Number(state?.countdownMsRemaining || 0);
  lobbyCountdownMsRemaining = ms;
  if (countdownControlsTextEl) countdownControlsTextEl.textContent = controlsTextForCurrentMode();
  if (ms > 0) {
    const sec = Math.max(1, Math.ceil(ms / 1000));
    countdownTextEl.textContent = String(sec);
    const characterId = state?.characterId ?? myCharacterId;
    if (countdownCharacterCanvasEl && characterId != null) {
      if (characterId !== lastCountdownPreviewCharacterId) {
        drawCountdownCharacterPreview(countdownCharacterCanvasEl, characterId);
        lastCountdownPreviewCharacterId = characterId;
      }
      if (countdownCharacterMetaEl) countdownCharacterMetaEl.textContent = `Karaktär #${characterId + 1}`;
    } else {
      lastCountdownPreviewCharacterId = null;
      if (countdownCharacterMetaEl) countdownCharacterMetaEl.textContent = "Väljer karaktär...";
    }
    countdownOverlayEl.classList.remove("hidden");
    updateLobbyMatchStatus();
    updateReadyButton();
    return;
  }
  lastCountdownPreviewCharacterId = null;
  countdownTextEl.textContent = "";
  countdownOverlayEl.classList.add("hidden");
  updateLobbyMatchStatus();
  updateReadyButton();
}

function renderScoreboard(players) {
  if (!scoreBodyEl) return;
  lobbyScoreboard = Array.isArray(players) ? players.slice() : [];
  scoreBodyEl.textContent = "";
  if (!Array.isArray(players)) {
    updateLobbyMatchStatus();
    return;
  }
  for (const p of players) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = p.name || "-";
    nameCell.style.color = colorForName(p.name);
    tr.appendChild(nameCell);

    const winsCell = document.createElement("td");
    winsCell.textContent = String(p.wins ?? 0);
    tr.appendChild(winsCell);

    const knockdownsCell = document.createElement("td");
    knockdownsCell.textContent = String(p.knockdowns ?? 0);
    tr.appendChild(knockdownsCell);

    const streakCell = document.createElement("td");
    streakCell.textContent = String(p.streak ?? 0);
    tr.appendChild(streakCell);

    const downedCell = document.createElement("td");
    downedCell.textContent = String(p.downed ?? 0);
    tr.appendChild(downedCell);

    const innocentsCell = document.createElement("td");
    innocentsCell.textContent = String(p.innocents ?? 0);
    tr.appendChild(innocentsCell);

    const statusCell = document.createElement("td");
    statusCell.className = "status-cell";
    const readyLamp = document.createElement("span");
    readyLamp.className = `ready-lamp ${p.ready ? "on" : "off"}`;
    readyLamp.setAttribute("aria-hidden", "true");
    statusCell.appendChild(readyLamp);
    const statusText = document.createElement("span");
    statusText.className = "status-label";
    statusText.textContent = p.status || "-";
    statusCell.appendChild(statusText);
    tr.appendChild(statusCell);

    scoreBodyEl.appendChild(tr);
  }
  updateLobbyMatchStatus();
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

function formatRoomLabel(room) {
  if (!room) return "-";
  return room.isPrivate ? `privat:${room.roomCode || room.roomId}` : "publik";
}

function buildDebugRoomRows(data) {
  const activeRooms = Array.isArray(data?.liveRooms) ? data.liveRooms : [];
  const historicalRooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const byId = new Map();

  for (const room of historicalRooms) {
    const roomId = String(room?.roomId || "").trim();
    if (!roomId) continue;
    byId.set(roomId, {
      roomId,
      roomCode: room.roomCode || null,
      isPrivate: Boolean(room.isPrivate),
      lastEventAt: Number(room.lastEventAt || 0),
      uniqueNames: Array.isArray(room.uniqueNames) ? room.uniqueNames : [],
      hasLive: false,
      authenticatedNames: []
    });
  }

  for (const room of activeRooms) {
    const roomId = String(room?.roomId || "").trim();
    if (!roomId) continue;
    const existing = byId.get(roomId) || {
      roomId,
      roomCode: room.roomCode || null,
      isPrivate: Boolean(room.isPrivate),
      lastEventAt: 0,
      uniqueNames: [],
      hasLive: false,
      authenticatedNames: []
    };
    existing.roomCode = room.roomCode || existing.roomCode;
    existing.isPrivate = Boolean(room.isPrivate);
    existing.hasLive = true;
    existing.authenticatedNames = Array.isArray(room.authenticatedNames) ? room.authenticatedNames : [];
    byId.set(roomId, existing);
  }

  return [...byId.values()].sort((a, b) => {
    if (a.hasLive !== b.hasLive) return a.hasLive ? -1 : 1;
    if (b.lastEventAt !== a.lastEventAt) return b.lastEventAt - a.lastEventAt;
    return a.roomId.localeCompare(b.roomId, "sv");
  });
}

function renderDebugData(data) {
  renderDebugSummary(data);
  drawDebugChart(data?.samples || []);
  const roomRows = buildDebugRoomRows(data);
  const roomLabelById = new Map(roomRows.map((room) => [room.roomId, formatRoomLabel(room)]));

  if (debugRoomsTextEl) {
    if (roomRows.length === 0) {
      debugRoomsTextEl.textContent = "Inga rum.";
    } else {
      const visible = roomRows.slice(0, DEBUG_LIST_LIMIT);
      const activeRows = visible.filter((room) => room.hasLive);
      const historicalRows = visible.filter((room) => !room.hasLive);
      const lines = [];

      if (activeRows.length > 0) {
        lines.push(`Aktiva (${activeRows.length}):`);
        for (const room of activeRows) {
          const names = room.authenticatedNames.length > 0 ? room.authenticatedNames.join(", ") : "-";
          lines.push(`${formatRoomLabel(room)} | namn: ${names}`);
        }
      }
      if (historicalRows.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push(`Tidigare (${historicalRows.length}):`);
        for (const room of historicalRows) {
          const names = room.uniqueNames.length > 0 ? room.uniqueNames.join(", ") : "-";
          lines.push(`${formatRoomLabel(room)} | senast: ${formatDateTime(room.lastEventAt)} | namn: ${names}`);
        }
      }

      debugRoomsTextEl.textContent = lines.join("\n");
    }
  }

  if (debugPlayersTextEl) {
    const players = Array.isArray(data?.players) ? data.players.slice(0, DEBUG_LIST_LIMIT) : [];
    debugPlayersTextEl.textContent =
      players.length > 0
        ? players
            .map(
              (player) =>
                `${player.name} | senast: ${formatDateTime(player.lastSeenAt)} | rum: ${
                  (player.rooms || []).map((roomId) => roomLabelById.get(roomId) || roomId).join(", ") || "-"
                }`
            )
            .join("\n")
        : "Inga namn loggade ännu.";
  }

  if (debugEventsTextEl) {
    const events = Array.isArray(data?.recentEvents)
      ? data.recentEvents.slice(-DEBUG_LIST_LIMIT).reverse()
      : [];
    debugEventsTextEl.textContent =
      events.length > 0
        ? events
            .map((event) => {
              const label = formatRoomLabel(event);
              const name = event.name || "-";
              return `${formatDateTime(event.at)} | ${event.type} | ${label} | ${name}`;
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
  const mirrorToGameChat = Boolean(entry?.system) || sessionState === "won";
  if (mirrorToGameChat) {
    appendChatLine(gameChatMessagesEl, entry);
    if (gameChatMessagesEl) {
      while (gameChatMessagesEl.children.length > GAME_CHAT_MAX_LINES) {
        gameChatMessagesEl.removeChild(gameChatMessagesEl.firstElementChild);
      }
    }
  }
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
  input.pitch = pitch;
  inputDirty = true;
  resetJoystickState();
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
        sessionReady = false;
        attackCooldownMsRemaining = 0;
        attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
        currentMatch = { inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 };
        lobbyScoreboard = [];
        lobbyCountdownMsRemaining = 0;
        lobbyMinPlayersToStart = 2;
        lobbyMaxPlayers = Math.max(0, Number(msg.maxPlayers || 0));
        resetDownedState();
        resetWinState();
        resetKnockdownToast();
        replaceChat(msg.chatHistory || []);
        setConnectError("");
        setPrivateRoomButtonVisible(false);
        setAppMode("lobby");
        return;
      }

      if (msg.type === "login_error") {
        authenticated = false;
        myName = "";
        sessionReady = false;
        attackCooldownMsRemaining = 0;
        attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
        currentMatch = { inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 };
        lobbyScoreboard = [];
        lobbyCountdownMsRemaining = 0;
        lobbyMinPlayersToStart = 2;
        lobbyMaxPlayers = 0;
        resetDownedState();
        resetWinState();
        resetKnockdownToast();
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

      if (msg.type === "knockdown_confirm") {
        const victimName = String(msg.victimName || "").trim();
        if (victimName) {
          knockdownToastText = `Du slog ner ${victimName}`;
          knockdownToastMsRemaining = KNOCKDOWN_TOAST_MS;
          updateKnockdownToast();
        }
        return;
      }

      if (msg.type === "countdown") {
        // world-session hanterar själva visningen; detta är bara om world dröjer.
        setCountdownTextFromSession({ countdownMsRemaining: Number(msg.seconds || 1) * 1000 });
        return;
      }

      if (msg.type === "possess") {
        myCharacterId = msg.characterId ?? null;
        forceYawSyncOnNextWorld = myCharacterId != null;
        return;
      }

      if (msg.type !== "world") return;

      const previousCharacterId = myCharacterId;
      const previousSessionState = sessionState;
      let enteredAlive = false;
      const state = msg.session;
      if (msg.match && typeof msg.match === "object") {
        currentMatch = {
          inProgress: Boolean(msg.match.inProgress),
          alivePlayers: Number(msg.match.alivePlayers || 0),
          startedAt: msg.match.startedAt || null,
          elapsedMs: Number(msg.match.elapsedMs || 0)
        };
      } else {
        currentMatch = { inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 };
      }
      if (state) {
        sessionState = state.state;
        authenticated = Boolean(state.authenticated);
        myName = state.name || myName;
        sessionReady = Boolean(state.ready);
        lobbyMinPlayersToStart = Math.max(1, Number(state.minPlayersToStart || lobbyMinPlayersToStart || 2));
        lobbyMaxPlayers = Math.max(0, Number(state.maxPlayers || lobbyMaxPlayers || 0));
        myCharacterId = state.characterId ?? null;
        activePlayersInGame = Number(state.activePlayers || 0);
        winReturnToLobbyMsRemaining = Math.max(0, Number(state.returnToLobbyMsRemaining || 0));
        downedByName = state.eliminatedByName ? String(state.eliminatedByName) : "";
        attackCooldownMsRemaining = Math.max(0, Number(state.attackCooldownMsRemaining || 0));
        if (attackCooldownMsRemaining > CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS) {
          attackCooldownVisualMaxMs = Math.max(
            attackCooldownVisualMaxMs * 0.9,
            attackCooldownMsRemaining,
            CROSSHAIR_DEFAULT_COOLDOWN_MS
          );
        }
        updateInGameHud();
        updateDocumentTitle();
        enteredAlive = previousSessionState !== "alive" && sessionState === "alive";
      } else {
        resetDownedState();
        resetWinState();
      }

      if (previousSessionState === "alive" && (sessionState === "downed" || sessionState === "won")) {
        if (document.pointerLockElement) document.exitPointerLock?.();
        resetInputState();
        setGameMenuOpen(false);
        setGameChatOpen(false);
      }

      if (!authenticated) {
        setAppMode("connect");
      } else if (sessionState === "alive" || sessionState === "downed" || sessionState === "won") {
        setConnectError("");
        setAppMode("playing");
        if (enteredAlive) requestPointerLockSafe(canvas);
      } else {
        setAppMode("lobby");
      }
      setCountdownTextFromSession(state);
      updateLobbyMatchStatus();

      try {
        roomSystem.syncFromWorld({
          worldSizeMeters: msg.worldSizeMeters,
          roomHalfSize: msg.roomHalfSize,
          shelves: msg.shelves,
          coolers: msg.coolers,
          freezers: msg.freezers
        });

        renderScoreboard(msg.scoreboard || []);

        const controlledYaw = avatarSystem.applyWorldCharacters({
          characters: msg.characters || [],
          myCharacterId,
          nowMs: performance.now(),
          hideMyCharacter: sessionState === "alive" || sessionState === "won"
        });

        if (controlledYaw != null) {
          const gainedNewCharacter = myCharacterId != null && myCharacterId !== previousCharacterId;
          const enteredAliveWithCharacter =
            previousSessionState !== "alive" && sessionState === "alive" && myCharacterId != null;
          if (gainedNewCharacter || enteredAliveWithCharacter || forceYawSyncOnNextWorld) {
            yaw = controlledYaw;
            viewYaw = controlledYaw;
            input.yaw = yaw;
            input.pitch = pitch;
            forceYawSyncOnNextWorld = false;
          }
        } else if (forceYawSyncOnNextWorld && myCharacterId == null) {
          forceYawSyncOnNextWorld = false;
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
      sessionReady = false;
      myCharacterId = null;
      attackCooldownMsRemaining = 0;
      attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
      activePlayersInGame = 0;
      currentMatch = { inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 };
      lobbyScoreboard = [];
      lobbyCountdownMsRemaining = 0;
      lobbyMinPlayersToStart = 2;
      lobbyMaxPlayers = 0;
      resetDownedState();
      resetWinState();
      resetKnockdownToast();
      updateConnectButton();
      if (leavingGameManually) {
        leavingGameManually = false;
        setAppMode("connect");
        setConnectError("");
      } else {
        setAppMode("disconnected");
        setConnectError("Anslutningen bröts.");
      }
      setPrivateRoomButtonVisible(false);
      updateDocumentTitle();
    },
    onError: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      attackCooldownMsRemaining = 0;
      attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
      lobbyScoreboard = [];
      lobbyCountdownMsRemaining = 0;
      lobbyMinPlayersToStart = 2;
      lobbyMaxPlayers = 0;
      resetDownedState();
      resetWinState();
      resetKnockdownToast();
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
  sessionReady = false;
  myCharacterId = null;
  attackCooldownMsRemaining = 0;
  attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
  myName = "";
  activePlayersInGame = 0;
  lobbyMaxPlayers = 0;
  resetDownedState();
  resetWinState();
  resetKnockdownToast();
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

function requestReturnToLobby() {
  if (!socket || !authenticated) return;
  socket.sendJson({ type: "leave_match" });
  setGameMenuOpen(false);
}

function leaveGameCompletely() {
  if (!socket) return;
  setGameMenuOpen(false);
  leavingGameManually = true;
  try {
    socket.close(1000, "left_game");
  } catch {
    // no-op
  }
}

function sendInput() {
  if (appMode !== "playing" || (sessionState !== "alive" && sessionState !== "won")) return;
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

function resetMoveDirectionalInput() {
  setMoveInputState("forward", false);
  setMoveInputState("backward", false);
  setMoveInputState("left", false);
  setMoveInputState("right", false);
}

function updateJoystickVisual() {
  if (!mobileJoystickKnobEl || !mobileJoystickBaseEl) return;
  const radius = mobileJoystickBaseEl.clientWidth * 0.5;
  const travel = Math.max(0, radius - mobileJoystickKnobEl.clientWidth * 0.5 - 4);
  mobileJoystickKnobEl.style.transform = `translate(calc(-50% + ${joystickCurrentX * travel}px), calc(-50% + ${joystickCurrentY * travel}px))`;
}

function applyMovementFromJoystick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < JOYSTICK_DEADZONE) {
    resetMoveDirectionalInput();
    return;
  }

  setMoveInputState("forward", y < -JOYSTICK_DEADZONE * 0.75);
  setMoveInputState("backward", y > JOYSTICK_DEADZONE * 0.75);
  setMoveInputState("left", x < -JOYSTICK_DEADZONE * 0.75);
  setMoveInputState("right", x > JOYSTICK_DEADZONE * 0.75);
}

function resetJoystickState() {
  joystickCurrentX = 0;
  joystickCurrentY = 0;
  updateJoystickVisual();
  resetMoveDirectionalInput();
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
  updateJoystickVisual();

  bindHoldButton(
    mobileSprintBtnEl,
    () => setMoveInputState("sprint", true),
    () => setMoveInputState("sprint", false)
  );

  if (mobileAttackBtnEl) {
    mobileAttackBtnEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (appMode !== "playing" || (sessionState !== "alive" && sessionState !== "won")) return;
      if (gameMenuOpen) return;
      if (gameChatOpen || isGameChatFocused()) return;
      socket?.sendJson({ type: "attack" });
    });
  }

  if (mobileJoystickBaseEl) {
    const updateFromPointer = (event) => {
      const rect = mobileJoystickBaseEl.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.5;
      const maxRadius = Math.max(1, rect.width * 0.5);
      const dx = (event.clientX - centerX) / maxRadius;
      const dy = (event.clientY - centerY) / maxRadius;
      const mag = Math.hypot(dx, dy);
      const scale = mag > 1 ? 1 / mag : 1;
      joystickCurrentX = dx * scale;
      joystickCurrentY = dy * scale;
      updateJoystickVisual();
      applyMovementFromJoystick(joystickCurrentX, joystickCurrentY);
    };

    mobileJoystickBaseEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (gameMenuOpen) return;
      if (mobileMovePointerId != null) return;
      mobileMovePointerId = event.pointerId;
      mobileJoystickBaseEl.setPointerCapture?.(event.pointerId);
      updateFromPointer(event);
    });

    mobileJoystickBaseEl.addEventListener("pointermove", (event) => {
      if (event.pointerId !== mobileMovePointerId) return;
      if (appMode !== "playing" || (sessionState !== "alive" && sessionState !== "won")) return;
      if (gameMenuOpen) return;
      event.preventDefault();
      updateFromPointer(event);
      const now = performance.now();
      if (now - lastInputSentAt >= INPUT_SEND_INTERVAL_MS) sendInput();
    });

    const stopMovePointer = (event) => {
      if (event.pointerId !== mobileMovePointerId) return;
      if (mobileJoystickBaseEl.hasPointerCapture?.(event.pointerId)) {
        mobileJoystickBaseEl.releasePointerCapture(event.pointerId);
      }
      mobileMovePointerId = null;
      resetJoystickState();
    };

    mobileJoystickBaseEl.addEventListener("pointerup", stopMovePointer);
    mobileJoystickBaseEl.addEventListener("pointercancel", stopMovePointer);
    mobileJoystickBaseEl.addEventListener("lostpointercapture", () => {
      mobileMovePointerId = null;
      resetJoystickState();
    });
  }

  if (!mobileLookPadEl) return;
  mobileLookPadEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (gameMenuOpen) return;
    if (mobileLookPointerId != null) return;
    mobileLookPointerId = event.pointerId;
    mobileLookLastX = event.clientX;
    mobileLookLastY = event.clientY;
    mobileLookPadEl.setPointerCapture?.(event.pointerId);
  });

  mobileLookPadEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== mobileLookPointerId) return;
    if (gameMenuOpen) return;
    if (
      appMode !== "playing" ||
      (sessionState !== "alive" && sessionState !== "won") ||
      gameChatOpen ||
      isGameChatFocused()
    ) {
      return;
    }

    event.preventDefault();
    const dx = event.clientX - mobileLookLastX;
    const dy = event.clientY - mobileLookLastY;
    mobileLookLastX = event.clientX;
    mobileLookLastY = event.clientY;

    yaw -= dx * LOOK_TOUCH_SENSITIVITY_X;
    pitch = clampPitch(pitch - dy * LOOK_TOUCH_SENSITIVITY_Y);
    input.yaw = yaw;
    input.pitch = pitch;
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
if (IS_TOUCH_DEVICE) document.body.classList.add("touch-device");
refreshAudioSettingsUi();
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
  if (sessionState === "alive" || sessionState === "downed" || sessionState === "won") return;
  if (sessionReady && sessionState === "countdown") return;
  const nextReady = !sessionReady;
  socket.sendJson({ type: "ready", ready: nextReady });
  sessionReady = nextReady;
  updateReadyButton();
});
lobbySettingsBtnEl?.addEventListener("click", () => {
  if (appMode !== "lobby") return;
  setLobbyMenuOpen(!lobbyMenuOpen);
});
lobbyMenuSettingsBtnEl?.addEventListener("click", () => {
  setLobbyMenuOpen(false);
  openLobbyDialog("Inställningar", "", { showSettings: true });
});
lobbyMenuCreditsBtnEl?.addEventListener("click", () => {
  setLobbyMenuOpen(false);
  openLobbyDialog(
    "Om spelet",
    "Skapat av Robin Reicher.\nMusik av Adam von Friesendorff.\nInspirerat av Adam Spraggs spel \"Hidden in Plain Sight\"."
  );
});
lobbyMenuCloseBtnEl?.addEventListener("click", () => {
  setLobbyMenuOpen(false);
});
lobbyMenuBackdropEl?.addEventListener("click", (event) => {
  if (event.target === lobbyMenuBackdropEl) setLobbyMenuOpen(false);
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
gameMenuBtnEl?.addEventListener("click", () => {
  if (appMode !== "playing") return;
  if (sessionState !== "alive") return;
  setGameMenuOpen(!gameMenuOpen);
});
gameMenuCloseBtnEl?.addEventListener("click", () => {
  setGameMenuOpen(false, { restorePointerLock: true });
});
gameMenuSettingsBtnEl?.addEventListener("click", () => {
  setGameMenuOpen(false);
  openLobbyDialog("Inställningar", "", { showSettings: true });
});
gameMenuCreditsBtnEl?.addEventListener("click", () => {
  setGameMenuOpen(false);
  openLobbyDialog(
    "Om spelet",
    "Skapat av Robin Reicher.\nMusik av Adam von Friesendorff.\nInspirerat av Adam Spraggs spel \"Hidden in Plain Sight\"."
  );
});
gameMenuLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
downedLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
winLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
gameMenuBackdropEl?.addEventListener("click", (event) => {
  if (event.target === gameMenuBackdropEl) setGameMenuOpen(false, { restorePointerLock: true });
});
lobbyDialogCloseBtnEl?.addEventListener("click", closeLobbyDialog);
lobbyDialogBackdropEl?.addEventListener("click", (event) => {
  if (event.target === lobbyDialogBackdropEl) closeLobbyDialog();
});
musicVolumeInputEl?.addEventListener("input", () => {
  audioSettings.musicVolume = clampVolume(musicVolumeInputEl.value);
  persistAudioSettings();
  refreshAudioSettingsUi();
});
musicMuteBtnEl?.addEventListener("click", () => {
  audioSettings.musicMuted = !audioSettings.musicMuted;
  persistAudioSettings();
  refreshAudioSettingsUi();
});
sfxVolumeInputEl?.addEventListener("input", () => {
  audioSettings.sfxVolume = clampVolume(sfxVolumeInputEl.value);
  persistAudioSettings();
  refreshAudioSettingsUi();
});
sfxMuteBtnEl?.addEventListener("click", () => {
  audioSettings.sfxMuted = !audioSettings.sfxMuted;
  persistAudioSettings();
  refreshAudioSettingsUi();
});
mobileControlsModeBtnEl?.addEventListener("click", () => {
  const idx = MOBILE_CONTROLS_PREFS.indexOf(mobileControlsPreference);
  const next = MOBILE_CONTROLS_PREFS[(idx + 1) % MOBILE_CONTROLS_PREFS.length];
  persistMobileControlsPreference(next);
  refreshAudioSettingsUi();
  if (countdownControlsTextEl) countdownControlsTextEl.textContent = controlsTextForCurrentMode();
  updateMobileControlsVisibility();
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
  if (appMode === "lobby" && event.key === "Escape") {
    if (!lobbyMenuOpen && lobbyDialogBackdropEl?.classList.contains("hidden")) return;
    event.preventDefault();
    if (lobbyMenuOpen) {
      setLobbyMenuOpen(false);
      return;
    }
    closeLobbyDialog();
    return;
  }
  if (appMode === "playing" && event.key === "Escape") {
    if (sessionState !== "alive") return;
    if (lobbyDialogBackdropEl && !lobbyDialogBackdropEl.classList.contains("hidden")) {
      event.preventDefault();
      closeLobbyDialog();
      requestPointerLockSafe(canvas);
      return;
    }
    event.preventDefault();
    setGameMenuOpen(!gameMenuOpen, { restorePointerLock: true });
    return;
  }
  if (appMode !== "playing") return;
  if (sessionState !== "alive" && sessionState !== "won") return;
  if (gameMenuOpen) return;
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
  if (sessionState !== "alive" && sessionState !== "won") return;
  if (gameMenuOpen) return;
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
  if (sessionState !== "alive" && sessionState !== "won") return;
  if (gameMenuOpen) return;
  if (gameChatOpen) return;
  if (!document.pointerLockElement) {
    requestPointerLockSafe(canvas);
  }
});

document.addEventListener("mousemove", (event) => {
  if (appMode !== "playing") return;
  if (sessionState !== "alive" && sessionState !== "won") return;
  if (gameMenuOpen) return;
  if (!document.pointerLockElement) return;
  yaw -= event.movementX * 0.0022;
  pitch = clampPitch(pitch - event.movementY * 0.002);

  input.yaw = yaw;
  input.pitch = pitch;
  inputDirty = true;
  const now = performance.now();
  if (now - lastInputSentAt >= INPUT_SEND_INTERVAL_MS) sendInput();
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (appMode !== "playing" || sessionState !== "alive") return;
  if (gameMenuOpen) return;
  if (gameChatOpen || isGameChatFocused()) return;
  if (document.pointerLockElement !== canvas) return;
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
  roomSystem.update?.(deltaSec);
  const controlledCharacterId =
    appMode === "playing" && (sessionState === "alive" || sessionState === "won") ? myCharacterId : null;
  avatarSystem.animate(deltaSec, controlledCharacterId);
  if (appMode === "playing" && sessionState === "downed") {
    const corpsePos = avatarSystem.getCharacterPosition(myCharacterId);
    if (corpsePos) {
      const posSmooth = 1 - Math.exp(-deltaSec * DOWNED_CAMERA_POS_SMOOTH_RATE);
      camera.position.x += (corpsePos.x - camera.position.x) * posSmooth;
      camera.position.z += (corpsePos.z - camera.position.z) * posSmooth;
      camera.position.y += (DOWNED_CAMERA_HEIGHT - camera.position.y) * posSmooth;
    }
    camera.rotation.set(-Math.PI / 2 + 0.0001, 0, 0);
  }
  if (appMode === "playing" && sessionState === "won") {
    winReturnToLobbyMsRemaining = Math.max(0, winReturnToLobbyMsRemaining - deltaSec * 1000);
  }
  knockdownToastMsRemaining = Math.max(0, knockdownToastMsRemaining - deltaSec * 1000);
  updateDownedOverlay();
  updateWinOverlay();
  updateKnockdownToast();
  updateCrosshairHud(deltaSec);
  renderer.render(scene, camera);
}

animate();
updateConnectButton();
setRoomInfo();
setPrivateRoomButtonVisible(false);
setAppMode("connect");
updateDocumentTitle();

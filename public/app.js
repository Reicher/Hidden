import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import { createAvatarSystem, drawCountdownCharacterPreview } from "./client/avatars.js";
import { createGameSocket } from "./client/network.js";
import { createChatUi } from "./client/chatUi.js";
import {
  updateCrosshairHud as updateCrosshairHudUi,
  updateDownedOverlay as updateDownedOverlayUi,
  updateInGameHud as updateInGameHudUi,
  updateKnockdownToast as updateKnockdownToastUi,
  updateWinOverlay as updateWinOverlayUi
} from "./client/hudUi.js";
import { GAME_CREDITS_TEXT } from "./client/about.js";
import { createInputController } from "./client/inputControls.js";
import { handleSocketMessage } from "./client/socketMessages.js";
import { normalizeAngle, hashString, colorForName } from "./client/utils.js";
import { renderScoreboard as renderScoreboardFn } from "./client/scoreboard.js";
import {
  clampVolume,
  normalizeAudioSettings,
  loadAudioSettings,
  persistAudioSettings
} from "./client/audioSettings.js";
import {
  canvas, screenRootEl,
  connectViewEl, connectErrorEl, roomInfoEl, nameInputEl, connectBtnEl, createPrivateRoomBtnEl,
  lobbyViewEl, scoreBodyEl, chatMessagesEl, chatInputEl, chatSendBtnEl, playBtnEl,
  lobbyMatchStatusEl, lobbyMatchStatusTitleEl,
  lobbySettingsBtnEl, lobbyMenuBackdropEl, lobbyMenuSettingsBtnEl, lobbyMenuCreditsBtnEl, lobbyMenuCloseBtnEl,
  lobbyDialogBackdropEl, lobbyDialogTitleEl, lobbyDialogTextEl, lobbyDialogCloseBtnEl, settingsPanelEl,
  countdownOverlayEl, countdownTextEl, countdownCharacterCanvasEl, countdownCharacterMetaEl, countdownControlsTextEl,
  gameHudEl, crosshairHudEl, crosshairCooldownArcEl, aliveOthersTextEl, knockdownToastEl,
  gameMenuBtnEl, gameMenuBackdropEl, gameMenuSettingsBtnEl, gameMenuCreditsBtnEl, gameMenuCloseBtnEl, gameMenuLobbyBtnEl,
  gameChatNoticeEl, gameChatBoxEl, gameChatMessagesEl, gameChatInputRowEl, gameChatInputEl,
  mobileControlsModeBtnEl, musicVolumeInputEl, musicMuteBtnEl, sfxVolumeInputEl, sfxMuteBtnEl,
  mobileControlsEl, mobileJoystickBaseEl, mobileJoystickKnobEl, mobileLookPadEl, mobileSprintBtnEl, mobileAttackBtnEl,
  downedOverlayEl, downedByTextEl, downedCountdownTextEl, downedLobbyBtnEl, downedChatBtnEl, downedSpectateBtnEl,
  winOverlayEl, winTitleEl, winCountdownTextEl, winLobbyBtnEl,
  spectatorHudEl, spectatorTargetTextEl, spectatorPrevBtnEl, spectatorNextBtnEl, spectatorLobbyBtnEl, spectatorChatBtnEl
} from "./client/domRefs.js";

const PLAYER_NAME_KEY = "hidden_player_name";
const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";
const RESERVED_PATH_CODES = new Set(["debug"]);

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize } = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

let socket = null;
let socketGeneration = 0;
let connecting = false;
let authenticated = false;
let appMode = "connect"; // connect | lobby | playing | disconnected
let sessionState = "auth"; // auth | lobby | countdown | alive | downed | won | spectating
let myCharacterId = null;
let myName = "";
let sessionReady = false;
let activePlayersInGame = 0;
let attackCooldownMsRemaining = 0;
let attackCooldownVisualMaxMs = 1000;
let gameChatOpen = false;
let gameMenuOpen = false;
let lobbyMenuOpen = false;
let forceYawSyncOnNextWorld = false;
const DEFAULT_MATCH_STATE = Object.freeze({ inProgress: false, alivePlayers: 0, startedAt: null, elapsedMs: 0 });
let currentMatch = { ...DEFAULT_MATCH_STATE };
let lobbyScoreboard = [];
let lobbyCountdownMsRemaining = 0;
let lobbyMinPlayersToStart = 2;
let lobbyMaxPlayers = 0;
let winReturnToLobbyMsRemaining = 0;
let downedByName = "";
let knockdownToastText = "";
let knockdownToastMsRemaining = 0;
let pendingLoginName = "";
let spectatorTargetCharacterId = null;
let spectatorTargetName = "";
let spectatorCandidates = [];

const INPUT_SEND_INTERVAL_MS = 33;
const INPUT_HEARTBEAT_MS = 120;
const CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS = 8;
const CROSSHAIR_DEFAULT_COOLDOWN_MS = 1000;
const CROSSHAIR_RING_CIRCUMFERENCE = Math.PI * 26;
const CROSSHAIR_HIT_DISTANCE_METERS = 2.8;
const GAME_CHAT_MAX_LINES = 5;
const GAME_CHAT_OPEN_SHORTCUT = "KeyC";
const LOOK_TOUCH_SENSITIVITY_X = 0.0052;
const LOOK_TOUCH_SENSITIVITY_Y = 0.0045;
const JOYSTICK_DEADZONE = 0.16;
const DOWNED_CAMERA_HEIGHT = 4.6;
const DOWNED_CAMERA_POS_SMOOTH_RATE = 9;
const KNOCKDOWN_TOAST_MS = 5000;
const SPECTATOR_CAMERA_DISTANCE = 1.42;
const SPECTATOR_CAMERA_HEIGHT_OFFSET = 0.28;
const SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET = 0.12;
const SPECTATOR_CAMERA_POS_SMOOTH_RATE = 12;
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

let viewPitch = 0;
let viewYaw = 0;
let lastFrameAt = performance.now();
let mobileControlsPreference = normalizeMobileControlsPreference(localStorage.getItem(MOBILE_CONTROLS_PREF_KEY));
let audioSettings = loadAudioSettings();
const musicLoopEl = new Audio("/assets/music.wav");
musicLoopEl.loop = true;
musicLoopEl.preload = "auto";
const GAMEPLAY_SUMMARY_TEXT = "Håll dig gömd, hitta spelare och slå ner dem.";
const DESKTOP_CONTROLS_TEXT = "Desktop: WASD rörelse, Shift sprint, mus för att titta runt, vänsterklick attack.";
const MOBILE_CONTROLS_TEXT =
  "Mobil: joystick nere till vänster för rörelse, Attack/Spring i mitten, dra i höger ruta för att titta.";
let lastCountdownPreviewCharacterId = null;

const chatUi = createChatUi({
  lobbyMessagesEl: chatMessagesEl,
  gameMessagesEl: gameChatMessagesEl,
  colorForName,
  shouldMirrorToGameChat: (entry) => {
    if (sessionState === "alive") return Boolean(entry?.system);
    return true;
  },
  maxGameLines: GAME_CHAT_MAX_LINES
});

function clampPitch(value) {
  return Math.max(-1.2, Math.min(1.2, value));
}

const inputController = createInputController({
  canvas,
  mobileJoystickBaseEl,
  mobileJoystickKnobEl,
  mobileLookPadEl,
  mobileSprintBtnEl,
  mobileAttackBtnEl,
  isTouchDevice: IS_TOUCH_DEVICE,
  inputSendIntervalMs: INPUT_SEND_INTERVAL_MS,
  inputHeartbeatMs: INPUT_HEARTBEAT_MS,
  lookTouchSensitivityX: LOOK_TOUCH_SENSITIVITY_X,
  lookTouchSensitivityY: LOOK_TOUCH_SENSITIVITY_Y,
  joystickDeadzone: JOYSTICK_DEADZONE,
  clampPitch,
  getSocket: () => socket,
  getAppMode: () => appMode,
  getSessionState: () => sessionState,
  getGameMenuOpen: () => gameMenuOpen,
  getGameChatOpen: () => gameChatOpen,
  isGameChatFocused,
  requestPointerLock: requestPointerLockSafe
});

function wsScheme() {
  return location.protocol === "https:" ? "wss" : "ws";
}

function activeRoomCodeFromPath() {
  const segments = location.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length !== 1) return null;
  try {
    const roomCode = decodeURIComponent(segments[0]);
    if (!roomCode) return null;
    if (RESERVED_PATH_CODES.has(roomCode.toLowerCase())) return null;
    return roomCode;
  } catch {
    return null;
  }
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
  if (pref === "off") return "AV";
  return "Auto";
}

function refreshAudioSettingsUi() {
  if (mobileControlsModeBtnEl) {
    mobileControlsModeBtnEl.textContent = mobileControlsLabel(mobileControlsPreference);
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

function canOpenInGameChat() {
  if (appMode !== "playing") return false;
  return sessionState === "downed" || sessionState === "spectating" || sessionState === "won";
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

function setGameChatOpen(open, { restorePointerLock = false } = {}) {
  if (!gameChatInputRowEl || !gameChatBoxEl || !gameChatNoticeEl) return;
  const canOpen = Boolean(open) && canOpenInGameChat();
  gameChatOpen = canOpen;
  gameChatBoxEl.classList.toggle("open", canOpen);
  gameChatInputRowEl.classList.toggle("hidden", !canOpen);
  gameChatNoticeEl.textContent = canOpen || sessionState === "won" ? "Chatt" : "Systemhändelser";
  chatUi.setGameLineLimit(canOpen ? null : GAME_CHAT_MAX_LINES);
  if (canOpen) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameChatInputEl?.focus();
  } else {
    gameChatInputEl?.blur();
  }
  if (!canOpenInGameChat()) gameChatOpen = false;
  if (restorePointerLock && appMode === "playing" && (sessionState === "alive" || sessionState === "won")) {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
  updateDownedOverlay();
  updateSpectatorHud();
}

function setGameMenuOpen(open, { restorePointerLock = false } = {}) {
  if (!gameMenuBackdropEl) return;
  gameMenuOpen = Boolean(open);
  gameMenuBackdropEl.classList.toggle("hidden", !gameMenuOpen);
  if (gameMenuOpen) {
    resetInputState();
    inputController.sendInput();
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
    lobbyMatchStatusTitleEl.textContent = `Match pågår (${elapsedMinutes} min) - Du väntar på nästa runda`;
    return;
  }

  const minPlayers = Math.max(1, Number(lobbyMinPlayersToStart || 2));
  const players = Array.isArray(lobbyScoreboard) ? lobbyScoreboard : [];
  const playerCount = players.length;
  const maxPlayers = Math.max(playerCount, Number(lobbyMaxPlayers || 0));
  const readyCount = players.reduce((acc, player) => acc + (player?.ready ? 1 : 0), 0);
  const readyEligibleCount = players.reduce((acc, player) => {
    const status = String(player?.status || "").toLowerCase();
    const canReady = status === "i lobby";
    return acc + (canReady ? 1 : 0);
  }, 0);
  const playersText = `Spelare ${playerCount}/${maxPlayers}`;
  const readyText = `Redo ${readyCount}/${readyEligibleCount}`;
  const countdownRunning =
    lobbyCountdownMsRemaining > 0 ||
    sessionState === "countdown";

  if (countdownRunning) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Startar match`;
    return;
  }
  if (playerCount < minPlayers) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Väntar på fler spelare`;
    return;
  }
  if (readyEligibleCount === 0) {
    lobbyMatchStatusTitleEl.textContent = `${playersText} - Väntar på nästa runda`;
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
    playBtnEl.textContent = "Du spelar";
    return;
  }
  if (sessionState === "spectating") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Åskådar";
    return;
  }
  if (currentMatch.inProgress) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Åskåda";
    return;
  }
  if (sessionState === "countdown" && sessionReady) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Match startar...";
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

function resetSessionRuntimeState({ maxPlayers = 0, clearIdentity = false } = {}) {
  if (clearIdentity) {
    authenticated = false;
    myName = "";
    sessionState = "auth";
    myCharacterId = null;
  }
  sessionReady = false;
  activePlayersInGame = 0;
  attackCooldownMsRemaining = 0;
  attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
  currentMatch = { ...DEFAULT_MATCH_STATE };
  lobbyScoreboard = [];
  lobbyCountdownMsRemaining = 0;
  lobbyMinPlayersToStart = 2;
  lobbyMaxPlayers = Math.max(0, Number(maxPlayers || 0));
  resetDownedState();
  resetWinState();
  resetKnockdownToast();
  spectatorTargetCharacterId = null;
  spectatorTargetName = "";
  spectatorCandidates = [];
}

function updateInGameHud() {
  updateInGameHudUi({
    aliveOthersTextEl,
    gameChatNoticeEl,
    activePlayersInGame,
    sessionState
  });
  if (gameChatOpen && gameChatNoticeEl) gameChatNoticeEl.textContent = "Chatt";
}

function updateDownedOverlay() {
  updateDownedOverlayUi({
    downedOverlayEl,
    downedByTextEl,
    downedCountdownTextEl,
    downedSpectateBtnEl,
    gameMenuBtnEl,
    appMode,
    sessionState,
    downedByName,
    canSpectate: currentMatch.inProgress && activePlayersInGame > 0,
    returnToLobbyMsRemaining: winReturnToLobbyMsRemaining
  });
  if (downedChatBtnEl) downedChatBtnEl.textContent = gameChatOpen ? "Stäng chatt" : "Chatt";
}

function updateWinOverlay() {
  updateWinOverlayUi({
    winOverlayEl,
    winTitleEl,
    winCountdownTextEl,
    gameMenuBtnEl,
    appMode,
    sessionState,
    winReturnToLobbyMsRemaining
  });
}

function updateSpectatorHud() {
  if (!spectatorHudEl || !spectatorTargetTextEl) return;
  const spectating = appMode === "playing" && sessionState === "spectating";
  spectatorHudEl.classList.toggle("hidden", !spectating);
  if (!spectating) return;
  const targetName = spectatorTargetName ? String(spectatorTargetName) : "ingen";
  spectatorTargetTextEl.textContent = `Åskådar ${targetName}`;
  const canCycle = Array.isArray(spectatorCandidates) && spectatorCandidates.length > 1;
  if (spectatorPrevBtnEl) spectatorPrevBtnEl.disabled = !canCycle;
  if (spectatorNextBtnEl) spectatorNextBtnEl.disabled = !canCycle;
  if (spectatorChatBtnEl) spectatorChatBtnEl.textContent = gameChatOpen ? "Stäng chatt" : "Chatt";
}

function updateKnockdownToast() {
  updateKnockdownToastUi({
    knockdownToastEl,
    appMode,
    sessionState,
    knockdownToastMsRemaining,
    knockdownToastText
  });
}

function requestSpectate() {
  if (!socket || !authenticated) return;
  socket.sendJson({ type: "spectate" });
}

function requestSpectatorCycle(direction) {
  if (!socket || sessionState !== "spectating") return;
  const step = Number(direction) < 0 ? -1 : 1;
  socket.sendJson({ type: "spectate_cycle", direction: step });
}

function updateCrosshairHud(deltaSec) {
  const next = updateCrosshairHudUi({
    crosshairHudEl,
    crosshairCooldownArcEl,
    appMode,
    sessionState,
    myCharacterId,
    attackCooldownMsRemaining,
    attackCooldownVisualMaxMs,
    deltaSec,
    crosshairCooldownMinVisibleMs: CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS,
    crosshairDefaultCooldownMs: CROSSHAIR_DEFAULT_COOLDOWN_MS,
    crosshairRingCircumference: CROSSHAIR_RING_CIRCUMFERENCE,
    crosshairHitDistanceMeters: CROSSHAIR_HIT_DISTANCE_METERS,
    camera,
    avatarSystem
  });
  attackCooldownMsRemaining = next.attackCooldownMsRemaining;
  attackCooldownVisualMaxMs = next.attackCooldownVisualMaxMs;
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

  if (mode !== "playing") setGameChatOpen(false);
  if (mode !== "playing") setGameMenuOpen(false);
  if (mode !== "lobby") setLobbyMenuOpen(false);
  if (mode === "playing" && gameChatOpen && !canOpenInGameChat()) setGameChatOpen(false);
  if (mode === "connect" || mode === "disconnected") setCountdownTextFromSession({ state: "lobby" });
  updateReadyButton();
  updateMobileControlsVisibility();
  updateLobbyMatchStatus();
  updateInGameHud();
  updateDownedOverlay();
  updateWinOverlay();
  updateSpectatorHud();
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
  renderScoreboardFn(scoreBodyEl, players, colorForName);
  updateLobbyMatchStatus();
}

function appendChat(entry) {
  chatUi.appendChat(entry);
}

function replaceChat(history) {
  chatUi.replaceChat(history);
}

function resetInputState() {
  inputController.resetInputState();
}

const socketState = {
  get authenticated() {
    return authenticated;
  },
  set authenticated(value) {
    authenticated = value;
  },
  get myName() {
    return myName;
  },
  set myName(value) {
    myName = value;
  },
  get sessionState() {
    return sessionState;
  },
  set sessionState(value) {
    sessionState = value;
  },
  get sessionReady() {
    return sessionReady;
  },
  set sessionReady(value) {
    sessionReady = value;
  },
  get myCharacterId() {
    return myCharacterId;
  },
  set myCharacterId(value) {
    myCharacterId = value;
  },
  get activePlayersInGame() {
    return activePlayersInGame;
  },
  set activePlayersInGame(value) {
    activePlayersInGame = value;
  },
  get attackCooldownMsRemaining() {
    return attackCooldownMsRemaining;
  },
  set attackCooldownMsRemaining(value) {
    attackCooldownMsRemaining = value;
  },
  get attackCooldownVisualMaxMs() {
    return attackCooldownVisualMaxMs;
  },
  set attackCooldownVisualMaxMs(value) {
    attackCooldownVisualMaxMs = value;
  },
  get forceYawSyncOnNextWorld() {
    return forceYawSyncOnNextWorld;
  },
  set forceYawSyncOnNextWorld(value) {
    forceYawSyncOnNextWorld = value;
  },
  get currentMatch() {
    return currentMatch;
  },
  set currentMatch(value) {
    currentMatch = value;
  },
  get lobbyMinPlayersToStart() {
    return lobbyMinPlayersToStart;
  },
  set lobbyMinPlayersToStart(value) {
    lobbyMinPlayersToStart = value;
  },
  get lobbyMaxPlayers() {
    return lobbyMaxPlayers;
  },
  set lobbyMaxPlayers(value) {
    lobbyMaxPlayers = value;
  },
  get winReturnToLobbyMsRemaining() {
    return winReturnToLobbyMsRemaining;
  },
  set winReturnToLobbyMsRemaining(value) {
    winReturnToLobbyMsRemaining = value;
  },
  get downedByName() {
    return downedByName;
  },
  set downedByName(value) {
    downedByName = value;
  },
  get knockdownToastText() {
    return knockdownToastText;
  },
  set knockdownToastText(value) {
    knockdownToastText = value;
  },
  get knockdownToastMsRemaining() {
    return knockdownToastMsRemaining;
  },
  set knockdownToastMsRemaining(value) {
    knockdownToastMsRemaining = value;
  },
  get pendingLoginName() {
    return pendingLoginName;
  },
  set pendingLoginName(value) {
    pendingLoginName = value;
  },
  get spectatorTargetCharacterId() {
    return spectatorTargetCharacterId;
  },
  set spectatorTargetCharacterId(value) {
    spectatorTargetCharacterId = value;
  },
  get spectatorTargetName() {
    return spectatorTargetName;
  },
  set spectatorTargetName(value) {
    spectatorTargetName = value;
  },
  get spectatorCandidates() {
    return spectatorCandidates;
  },
  set spectatorCandidates(value) {
    spectatorCandidates = value;
  }
};

const socketMessageContext = {
  state: socketState,
  constants: {
    DEFAULT_MATCH_STATE,
    CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS,
    CROSSHAIR_DEFAULT_COOLDOWN_MS,
    KNOCKDOWN_TOAST_MS
  },
  roomSystem,
  avatarSystem,
  inputController,
  getNowMs: () => performance.now(),
  actions: {
    resetSessionRuntimeState,
    replaceChat,
    appendChat,
    refreshGameChat: () => chatUi.refreshGameChat(),
    setConnectError,
    setPrivateRoomButtonVisible,
    setAppMode,
    setCountdownTextFromSession,
    updateLobbyMatchStatus,
    updateInGameHud,
    updateDocumentTitle,
    updateKnockdownToast,
    updateSpectatorHud,
    resetDownedState,
    resetWinState,
    resetInputState,
    setGameMenuOpen,
    setGameChatOpen,
    requestPointerLockSafe,
    renderScoreboard,
    setViewYaw: (value) => {
      viewYaw = value;
    }
  }
};

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
      socketState.pendingLoginName = loginName;
      handleSocketMessage(msg, socketMessageContext);
    },
    onClose: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      resetSessionRuntimeState({ clearIdentity: true });
      updateConnectButton();
      setAppMode("disconnected");
      setConnectError("Anslutningen bröts.");
      setPrivateRoomButtonVisible(false);
      updateDocumentTitle();
    },
    onError: () => {
      if (generation !== socketGeneration) return;
      connecting = false;
      resetSessionRuntimeState({ maxPlayers: 0 });
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
  const rawName = String(nameInputEl.value ?? "").trim();

  if (rawName.length < 2) {
    setConnectError("Namn måste vara minst 2 tecken.");
    return;
  }

  const wsUrl = `${wsScheme()}://${location.host}${activeRoomPath()}`;

  localStorage.setItem(PLAYER_NAME_KEY, rawName);
  pendingLoginName = rawName;

  connecting = true;
  resetSessionRuntimeState({ clearIdentity: true });
  updateConnectButton();
  setConnectError("");
  setPrivateRoomButtonVisible(false);
  resetInputState();
  setAppMode("connect");
  attachSocket(wsUrl, rawName);
}

function sendChatFromInput(inputEl) {
  if (!inputEl) return;
  const text = String(inputEl.value ?? "").trim();
  if (!text || !socket) return;
  socket.sendJson({ type: "chat", text });
  inputEl.value = "";
}

function sendLobbyChat() {
  sendChatFromInput(chatInputEl);
}

function sendInGameChat() {
  if (!canOpenInGameChat()) return;
  sendChatFromInput(gameChatInputEl);
}

function requestReturnToLobby() {
  if (!socket || !authenticated) return;
  socket.sendJson({ type: "leave_match" });
  setGameMenuOpen(false);
}

function updateSpectatorCamera(deltaSec) {
  if (sessionState !== "spectating") return;
  const target = avatarSystem.getCharacterCameraState(spectatorTargetCharacterId);
  if (!target) return;

  const desiredX = target.x - Math.sin(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
  const desiredZ = target.z - Math.cos(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
  const desiredY = target.eyeHeight + SPECTATOR_CAMERA_HEIGHT_OFFSET;
  const posSmooth = 1 - Math.exp(-deltaSec * SPECTATOR_CAMERA_POS_SMOOTH_RATE);
  camera.position.x += (desiredX - camera.position.x) * posSmooth;
  camera.position.z += (desiredZ - camera.position.z) * posSmooth;
  camera.position.y += (desiredY - camera.position.y) * posSmooth;

  camera.lookAt(target.x, target.eyeHeight + SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET, target.z);
}

const savedName = localStorage.getItem(PLAYER_NAME_KEY);
if (nameInputEl) nameInputEl.value = savedName != null ? savedName : "";
if (IS_TOUCH_DEVICE) document.body.classList.add("touch-device");
refreshAudioSettingsUi();
inputController.bind();

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
  if (currentMatch.inProgress) {
    requestSpectate();
    return;
  }
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
  openLobbyDialog("Om spelet", GAME_CREDITS_TEXT);
});
lobbyMenuCloseBtnEl?.addEventListener("click", () => {
  setLobbyMenuOpen(false);
});
lobbyMenuBackdropEl?.addEventListener("click", (event) => {
  if (event.target === lobbyMenuBackdropEl) setLobbyMenuOpen(false);
});

chatSendBtnEl?.addEventListener("click", sendLobbyChat);
chatInputEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  sendLobbyChat();
});
gameChatInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendInGameChat();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setGameChatOpen(false, { restorePointerLock: true });
  }
});
gameMenuBtnEl?.addEventListener("click", () => {
  if (appMode !== "playing") return;
  if (sessionState !== "alive" && sessionState !== "spectating") return;
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
  openLobbyDialog("Om spelet", GAME_CREDITS_TEXT);
});
gameMenuLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
downedLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
downedChatBtnEl?.addEventListener("click", () => {
  setGameChatOpen(!gameChatOpen);
});
downedSpectateBtnEl?.addEventListener("click", requestSpectate);
winLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
spectatorPrevBtnEl?.addEventListener("click", () => {
  requestSpectatorCycle(-1);
});
spectatorNextBtnEl?.addEventListener("click", () => {
  requestSpectatorCycle(1);
});
spectatorLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
spectatorChatBtnEl?.addEventListener("click", () => {
  setGameChatOpen(!gameChatOpen);
});
gameMenuBackdropEl?.addEventListener("click", (event) => {
  if (event.target === gameMenuBackdropEl) setGameMenuOpen(false, { restorePointerLock: true });
});
lobbyDialogCloseBtnEl?.addEventListener("click", closeLobbyDialog);
lobbyDialogBackdropEl?.addEventListener("click", (event) => {
  if (event.target === lobbyDialogBackdropEl) closeLobbyDialog();
});
musicVolumeInputEl?.addEventListener("input", () => {
  audioSettings.musicVolume = clampVolume(musicVolumeInputEl.value);
  persistAudioSettings(audioSettings);
  refreshAudioSettingsUi();
});
musicMuteBtnEl?.addEventListener("click", () => {
  audioSettings.musicMuted = !audioSettings.musicMuted;
  persistAudioSettings(audioSettings);
  refreshAudioSettingsUi();
});
sfxVolumeInputEl?.addEventListener("input", () => {
  audioSettings.sfxVolume = clampVolume(sfxVolumeInputEl.value);
  persistAudioSettings(audioSettings);
  refreshAudioSettingsUi();
});
sfxMuteBtnEl?.addEventListener("click", () => {
  audioSettings.sfxMuted = !audioSettings.sfxMuted;
  persistAudioSettings(audioSettings);
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

function isTextInputTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return Boolean(target.isContentEditable);
}

window.addEventListener("keydown", (event) => {
  if (
    !IS_TOUCH_DEVICE &&
    appMode === "playing" &&
    event.code === GAME_CHAT_OPEN_SHORTCUT &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.repeat &&
    !isTextInputTarget(event.target) &&
    canOpenInGameChat()
  ) {
    event.preventDefault();
    setGameChatOpen(true);
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
    if (gameChatOpen) {
      event.preventDefault();
      setGameChatOpen(false, { restorePointerLock: true });
      return;
    }
    if (sessionState !== "alive" && sessionState !== "spectating") return;
    if (lobbyDialogBackdropEl && !lobbyDialogBackdropEl.classList.contains("hidden")) {
      event.preventDefault();
      closeLobbyDialog();
      requestPointerLockSafe(canvas);
      return;
    }
    event.preventDefault();
    setGameMenuOpen(!gameMenuOpen, { restorePointerLock: true });
  }
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSec = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  const yaw = inputController.getYaw();
  const pitch = inputController.getPitch();

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
  if (appMode === "playing" && sessionState === "spectating") {
    updateSpectatorCamera(deltaSec);
  }
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
  if (appMode === "playing" && (sessionState === "won" || sessionState === "downed" || sessionState === "spectating")) {
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

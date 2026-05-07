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
import { createSocketConnectionController } from "./client/socketConnection.js";
import { createSocketState, createSocketMessageContext } from "./client/socketContext.js";
import { bindAppEventHandlers } from "./client/appBindings.js";
import { normalizeAngle, colorForName } from "./client/utils.js";
import { renderScoreboard as renderScoreboardFn } from "./client/scoreboard.js";
import {
  MOBILE_CONTROLS_PREFS,
  wsScheme,
  activeRoomCodeFromPath,
  activeRoomPath,
  randomPrivateRoomCode,
  normalizeMobileControlsPreference,
  mobileControlsLabel
} from "./client/appHelpers.js";
import {
  clampVolume,
  loadAudioSettings,
  persistAudioSettings
} from "./client/audioSettings.js";
import {
  loadLookSettings,
  persistLookSettings,
  lookSensitivityMultiplier,
  lookSmoothingRate
} from "./client/lookSettings.js";
import {
  canvas, screenRootEl,
  connectViewEl, connectErrorEl, roomInfoEl, nameInputEl, connectBtnEl, createPrivateRoomBtnEl,
  newsCardEl, newsVersionEl, newsPublishedAtEl, newsNotesEl,
  lobbyViewEl, scoreBodyEl, chatMessagesEl, chatInputEl, chatSendBtnEl, playBtnEl,
  lobbyMatchStatusEl, lobbyMatchStatusTitleEl,
  lobbySettingsBtnEl, lobbyMenuBackdropEl, lobbyMenuSettingsBtnEl, lobbyMenuCreditsBtnEl, lobbyMenuCloseBtnEl,
  lobbyDialogBackdropEl, lobbyDialogTitleEl, lobbyDialogTextEl, lobbyDialogCloseBtnEl, settingsPanelEl,
  countdownOverlayEl, countdownTextEl, countdownCharacterCanvasEl, countdownCharacterMetaEl, countdownControlsTextEl,
  gameHudEl, crosshairHudEl, crosshairCooldownArcEl, aliveOthersTextEl,
  debugOverlayEl, debugFpsTextEl, debugFrameTimeTextEl, debugPingTextEl, knockdownToastEl,
  gameMenuBtnEl, gameMenuBackdropEl, gameMenuSettingsBtnEl, gameMenuCreditsBtnEl, gameMenuCloseBtnEl, gameMenuLobbyBtnEl,
  gameChatNoticeEl, gameChatBoxEl, gameChatMessagesEl, gameChatInputRowEl, gameChatInputEl,
  mobileControlsModeBtnEl, fullscreenModeCheckboxEl, settingsFullscreenHelpEl,
  lookSensitivityInputEl, lookSensitivityValueEl, lookSmoothingToggleBtnEl,
  musicVolumeInputEl, musicMuteBtnEl, sfxVolumeInputEl, sfxMuteBtnEl,
  mobileControlsEl, mobileJoystickBaseEl, mobileJoystickKnobEl, mobileLookPadEl, mobileSprintBtnEl, mobileAttackBtnEl,
  downedOverlayEl, downedByTextEl, downedCountdownTextEl, downedLobbyBtnEl, downedChatBtnEl, downedSpectateBtnEl,
  winOverlayEl, winTitleEl, winCountdownTextEl, winLobbyBtnEl,
  spectatorHudEl, spectatorTargetTextEl, spectatorPrevBtnEl, spectatorNextBtnEl, spectatorLobbyBtnEl, spectatorChatBtnEl
} from "./client/domRefs.js";

const PLAYER_NAME_KEY = "hidden_player_name";
const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";
const DEBUG_OVERLAY_ALLOWED_KEY = "hidden_debug_overlay_allowed";

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize } = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

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
let socketConnection = null;

const INPUT_SEND_INTERVAL_MS = 33;
const INPUT_HEARTBEAT_MS = 120;
const CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS = 8;
const CROSSHAIR_DEFAULT_COOLDOWN_MS = 1000;
const CROSSHAIR_RING_CIRCUMFERENCE = Math.PI * 26;
const CROSSHAIR_HIT_DISTANCE_METERS = 2.8;
const GAME_CHAT_MAX_LINES = 5;
const GAME_CHAT_OPEN_SHORTCUT = "KeyC";
const DEBUG_OVERLAY_TOGGLE_SHORTCUT = "KeyP";
const DEBUG_OVERLAY_REFRESH_MS = 120;
const DEBUG_PING_INTERVAL_MS = 1200;
const DEBUG_OVERLAY_TOUCH_HOLD_MS = 900;
const DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS = 2600;
const DEBUG_FPS_SAMPLE_WINDOW_MS = 1000;
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
const DEBUG_OVERLAY_QUERY_PARAM = new URLSearchParams(location.search).get("debugOverlay");
const IS_TOUCH_DEVICE = (() => {
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const hoverNone = window.matchMedia && window.matchMedia("(hover: none)").matches;
  const touchApi = "ontouchstart" in window;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  return coarsePointer || hoverNone || touchApi || touchPoints || mobileUa || FORCE_MOBILE_UI;
})();
let debugOverlayAllowed = !IS_TOUCH_DEVICE || localStorage.getItem(DEBUG_OVERLAY_ALLOWED_KEY) === "1";
if (DEBUG_OVERLAY_QUERY_PARAM === "1") {
  debugOverlayAllowed = true;
  localStorage.setItem(DEBUG_OVERLAY_ALLOWED_KEY, "1");
}
if (DEBUG_OVERLAY_QUERY_PARAM === "0") {
  debugOverlayAllowed = false;
  localStorage.removeItem(DEBUG_OVERLAY_ALLOWED_KEY);
}

let viewPitch = 0;
let viewYaw = 0;
let lastFrameAt = performance.now();
let mobileControlsPreference = normalizeMobileControlsPreference(localStorage.getItem(MOBILE_CONTROLS_PREF_KEY));
let audioSettings = loadAudioSettings();
let lookSettings = loadLookSettings();
let debugOverlayOpen = false;
let debugFps = 0;
let debugPingMs = null;
let lastDebugOverlayUpdateAt = 0;
let lastDebugPingSentAt = 0;
let debugFpsSampleFrames = 0;
let debugFpsSampleMs = 0;
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
  getLookSensitivityMultiplier: () => {
    const liveValue = Number(lookSensitivityInputEl?.value);
    if (Number.isFinite(liveValue)) return Math.max(0.1, liveValue / 100);
    return lookSensitivityMultiplier(lookSettings);
  },
  joystickDeadzone: JOYSTICK_DEADZONE,
  clampPitch,
  getSocket: () => socketConnection?.getSocket() || null,
  getAppMode: () => appMode,
  getSessionState: () => sessionState,
  getGameMenuOpen: () => gameMenuOpen,
  getGameChatOpen: () => gameChatOpen,
  isGameChatFocused,
  requestPointerLock: requestPointerLockSafe
});

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

async function setNewsCard() {
  if (!newsCardEl || !newsVersionEl || !newsPublishedAtEl || !newsNotesEl) return;
  const formatTimestamp = (value) => {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    const asDate = new Date(raw);
    if (!Number.isFinite(asDate.getTime())) return raw;
    return new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(asDate);
  };

  try {
    const response = await fetch(`/news.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const payload = await response.json();
    const version = typeof payload?.version === "string" ? payload.version.trim() : "";
    const publishedAt = formatTimestamp(payload?.publishedAt);
    const notes = typeof payload?.notes === "string" ? payload.notes.trim() : "";

    newsVersionEl.textContent = version ? `Nyheter version ${version}` : "Nyheter version -";
    if (publishedAt) {
      newsPublishedAtEl.textContent = publishedAt;
      newsPublishedAtEl.classList.remove("hidden");
    } else {
      newsPublishedAtEl.textContent = "";
      newsPublishedAtEl.classList.add("hidden");
    }
    newsNotesEl.textContent = notes || "Inga release notes hittades.";
  } catch {
    newsVersionEl.textContent = "Nyheter version -";
    newsPublishedAtEl.textContent = "";
    newsPublishedAtEl.classList.add("hidden");
    newsNotesEl.textContent = "Inga nyheter tillgängliga just nu.";
  }
}

function setConnectError(text) {
  if (!connectErrorEl) return;
  connectErrorEl.textContent = text || "";
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

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isFullscreenSupported() {
  return Boolean(
    document.fullscreenEnabled ||
    document.webkitFullscreenEnabled ||
    typeof document.documentElement?.requestFullscreen === "function" ||
    typeof document.documentElement?.webkitRequestFullscreen === "function"
  );
}

function isFullscreenActive() {
  return Boolean(getFullscreenElement());
}

function setFullscreenHelpText() {
  if (!settingsFullscreenHelpEl) return;
  if (isFullscreenSupported()) {
    settingsFullscreenHelpEl.textContent = isFullscreenActive()
      ? "Fullscreen är aktivt. Avmarkera rutan för att lämna."
      : "Markera rutan för att gå in i fullscreen.";
    return;
  }
  settingsFullscreenHelpEl.textContent = IS_TOUCH_DEVICE
    ? "Fullscreen stöds inte här (vanligt på iPhone/iPad Safari)."
    : "Fullscreen stöds inte i den här webbläsaren.";
}

async function setFullscreenEnabled(enabled) {
  const wantsFullscreen = Boolean(enabled);
  if (!isFullscreenSupported()) {
    refreshAudioSettingsUi();
    return false;
  }
  try {
    if (wantsFullscreen && !isFullscreenActive()) {
      const targetEl = document.documentElement;
      if (typeof targetEl?.requestFullscreen === "function") {
        const maybePromise = targetEl.requestFullscreen();
        if (maybePromise && typeof maybePromise.catch === "function") {
          await maybePromise.catch(() => {});
        }
      } else if (typeof targetEl?.webkitRequestFullscreen === "function") {
        targetEl.webkitRequestFullscreen();
      }
    } else if (!wantsFullscreen && isFullscreenActive()) {
      if (typeof document.exitFullscreen === "function") {
        const maybePromise = document.exitFullscreen();
        if (maybePromise && typeof maybePromise.catch === "function") {
          await maybePromise.catch(() => {});
        }
      } else if (typeof document.webkitExitFullscreen === "function") {
        document.webkitExitFullscreen();
      }
    }
  } catch {
    // ignore fullscreen API failures; UI will resync from actual fullscreen state
  }
  const applied = wantsFullscreen ? isFullscreenActive() : !isFullscreenActive();
  refreshAudioSettingsUi();
  return applied;
}

function refreshAudioSettingsUi() {
  if (mobileControlsModeBtnEl) {
    mobileControlsModeBtnEl.textContent = mobileControlsLabel(mobileControlsPreference);
  }
  if (fullscreenModeCheckboxEl) {
    const supported = isFullscreenSupported();
    fullscreenModeCheckboxEl.disabled = !supported;
    fullscreenModeCheckboxEl.checked = supported && isFullscreenActive();
  }
  setFullscreenHelpText();
  if (lookSensitivityInputEl) lookSensitivityInputEl.value = String(lookSettings.sensitivity);
  if (lookSensitivityValueEl) lookSensitivityValueEl.textContent = `${lookSettings.sensitivity}%`;
  if (lookSmoothingToggleBtnEl) {
    lookSmoothingToggleBtnEl.textContent = lookSettings.smoothingEnabled ? "På" : "Av";
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
  const connecting = socketConnection?.isConnecting?.() || false;
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
  const dialogCardEl = document.getElementById("lobbyDialogCard");
  if (dialogCardEl) dialogCardEl.scrollTop = 0;
  updateScreenRootPointerEvents();
  updateMobileControlsVisibility();
  if (showSettings && musicVolumeInputEl && !IS_TOUCH_DEVICE) {
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
  updateMobileControlsVisibility();
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
  const lobbyDialogOpen =
    appMode === "playing" && lobbyDialogBackdropEl && !lobbyDialogBackdropEl.classList.contains("hidden");
  const show =
    mobileControlsEnabledByPreference() &&
    appMode === "playing" &&
    (sessionState === "alive" || sessionState === "won") &&
    !gameChatOpen &&
    !gameMenuOpen &&
    !lobbyDialogOpen;
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
  debugFps = 0;
  debugPingMs = null;
  lastDebugOverlayUpdateAt = 0;
  lastDebugPingSentAt = 0;
  debugFpsSampleFrames = 0;
  debugFpsSampleMs = 0;
  spectatorTargetCharacterId = null;
  spectatorTargetName = "";
  spectatorCandidates = [];
  updateDebugOverlay();
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

function updateDebugOverlay() {
  if (!debugOverlayEl) return;
  const visible = appMode === "playing" && debugOverlayAllowed && debugOverlayOpen;
  debugOverlayEl.classList.toggle("hidden", !visible);
  if (!visible) return;

  const fpsRounded = Math.max(0, Math.round(debugFps));
  const frameMs = debugFps > 0 ? 1000 / debugFps : null;
  const pingRounded = Number.isFinite(debugPingMs) ? Math.max(0, Math.round(debugPingMs)) : null;

  if (debugFpsTextEl) debugFpsTextEl.textContent = `FPS: ${fpsRounded > 0 ? fpsRounded : "--"}`;
  if (debugFrameTimeTextEl) debugFrameTimeTextEl.textContent = `Frame: ${frameMs != null ? frameMs.toFixed(1) : "--"} ms`;
  if (debugPingTextEl) debugPingTextEl.textContent = `Ping: ${pingRounded != null ? pingRounded : "--"} ms`;
}

function setDebugOverlayOpen(open) {
  debugOverlayOpen = Boolean(open) && appMode === "playing" && debugOverlayAllowed;
  updateDebugOverlay();
}

function toggleDebugOverlay() {
  if (appMode !== "playing" || !debugOverlayAllowed) return;
  setDebugOverlayOpen(!debugOverlayOpen);
}

function canUseDebugOverlay() {
  return Boolean(debugOverlayAllowed);
}

function enableDebugOverlayForDevice() {
  if (debugOverlayAllowed) return false;
  debugOverlayAllowed = true;
  localStorage.setItem(DEBUG_OVERLAY_ALLOWED_KEY, "1");
  return true;
}

function sendDebugPing(nowMs = performance.now()) {
  if (appMode !== "playing" || !debugOverlayOpen) return;
  if (nowMs - lastDebugPingSentAt < DEBUG_PING_INTERVAL_MS) return;
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || !authenticated) return;
  if (!activeSocket.sendJson({ type: "ping", clientSentAt: nowMs })) return;
  lastDebugPingSentAt = nowMs;
}

function handleDebugPong(msg) {
  const clientSentAt = Number(msg?.clientSentAt);
  if (!Number.isFinite(clientSentAt)) return;
  const rttMs = performance.now() - clientSentAt;
  if (!Number.isFinite(rttMs) || rttMs < 0) return;
  debugPingMs = debugPingMs == null ? rttMs : debugPingMs + (rttMs - debugPingMs) * 0.35;
  if (debugOverlayOpen && appMode === "playing") updateDebugOverlay();
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
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || !authenticated) return;
  activeSocket.sendJson({ type: "spectate" });
}

function requestSpectatorCycle(direction) {
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || sessionState !== "spectating") return;
  const step = Number(direction) < 0 ? -1 : 1;
  activeSocket.sendJson({ type: "spectate_cycle", direction: step });
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
    setDebugOverlayOpen(false);
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
  updateDebugOverlay();
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

const socketState = createSocketState({
  authenticated: { get: () => authenticated, set: (value) => { authenticated = value; } },
  myName: { get: () => myName, set: (value) => { myName = value; } },
  sessionState: { get: () => sessionState, set: (value) => { sessionState = value; } },
  sessionReady: { get: () => sessionReady, set: (value) => { sessionReady = value; } },
  myCharacterId: { get: () => myCharacterId, set: (value) => { myCharacterId = value; } },
  activePlayersInGame: { get: () => activePlayersInGame, set: (value) => { activePlayersInGame = value; } },
  attackCooldownMsRemaining: {
    get: () => attackCooldownMsRemaining,
    set: (value) => { attackCooldownMsRemaining = value; }
  },
  attackCooldownVisualMaxMs: {
    get: () => attackCooldownVisualMaxMs,
    set: (value) => { attackCooldownVisualMaxMs = value; }
  },
  forceYawSyncOnNextWorld: { get: () => forceYawSyncOnNextWorld, set: (value) => { forceYawSyncOnNextWorld = value; } },
  currentMatch: { get: () => currentMatch, set: (value) => { currentMatch = value; } },
  lobbyMinPlayersToStart: { get: () => lobbyMinPlayersToStart, set: (value) => { lobbyMinPlayersToStart = value; } },
  lobbyMaxPlayers: { get: () => lobbyMaxPlayers, set: (value) => { lobbyMaxPlayers = value; } },
  winReturnToLobbyMsRemaining: {
    get: () => winReturnToLobbyMsRemaining,
    set: (value) => { winReturnToLobbyMsRemaining = value; }
  },
  downedByName: { get: () => downedByName, set: (value) => { downedByName = value; } },
  knockdownToastText: { get: () => knockdownToastText, set: (value) => { knockdownToastText = value; } },
  knockdownToastMsRemaining: {
    get: () => knockdownToastMsRemaining,
    set: (value) => { knockdownToastMsRemaining = value; }
  },
  pendingLoginName: { get: () => pendingLoginName, set: (value) => { pendingLoginName = value; } },
  spectatorTargetCharacterId: {
    get: () => spectatorTargetCharacterId,
    set: (value) => { spectatorTargetCharacterId = value; }
  },
  spectatorTargetName: { get: () => spectatorTargetName, set: (value) => { spectatorTargetName = value; } },
  spectatorCandidates: { get: () => spectatorCandidates, set: (value) => { spectatorCandidates = value; } }
});

const socketMessageContext = createSocketMessageContext({
  socketState,
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
    handleDebugPong,
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
});

socketConnection = createSocketConnectionController({
  createGameSocket,
  handleSocketMessage,
  getSocketMessageContext: () => socketMessageContext,
  setPendingLoginName: (name) => {
    pendingLoginName = name;
  },
  setConnectError,
  setPrivateRoomButtonVisible,
  setAppMode,
  resetSessionRuntimeState,
  updateDocumentTitle,
  resetInputState,
  onConnectingChanged: () => {
    updateConnectButton();
  }
});

function connectAndLogin() {
  if (!nameInputEl) return;
  const rawName = String(nameInputEl.value ?? "");
  const trimmedName = rawName.trim();
  const wsUrl = `${wsScheme()}://${location.host}${activeRoomPath()}`;

  const started = socketConnection?.connectAndLogin({
    rawName: trimmedName,
    wsUrl,
    minNameLength: 2,
    onValidationError: () => {
      setConnectError("Namn måste vara minst 2 tecken.");
    }
  });
  if (started) localStorage.setItem(PLAYER_NAME_KEY, trimmedName);
}

function sendChatFromInput(inputEl) {
  if (!inputEl) return;
  const text = String(inputEl.value ?? "").trim();
  const activeSocket = socketConnection?.getSocket();
  if (!text || !activeSocket) return;
  activeSocket.sendJson({ type: "chat", text });
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
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || !authenticated) return;
  activeSocket.sendJson({ type: "leave_match" });
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
document.addEventListener("fullscreenchange", refreshAudioSettingsUi);
document.addEventListener("webkitfullscreenchange", refreshAudioSettingsUi);
refreshAudioSettingsUi();
inputController.bind();
bindAppEventHandlers({
  elements: {
    canvas,
    connectBtnEl,
    createPrivateRoomBtnEl,
    nameInputEl,
    playBtnEl,
    lobbySettingsBtnEl,
    lobbyMenuBackdropEl,
    lobbyMenuSettingsBtnEl,
    lobbyMenuCreditsBtnEl,
    lobbyMenuCloseBtnEl,
    chatSendBtnEl,
    chatInputEl,
    gameChatInputEl,
    gameMenuBtnEl,
    gameMenuBackdropEl,
    gameMenuSettingsBtnEl,
    gameMenuCreditsBtnEl,
    gameMenuCloseBtnEl,
    gameMenuLobbyBtnEl,
    downedLobbyBtnEl,
    downedChatBtnEl,
    downedSpectateBtnEl,
    winLobbyBtnEl,
    spectatorPrevBtnEl,
    spectatorNextBtnEl,
    spectatorLobbyBtnEl,
    spectatorChatBtnEl,
    lobbyDialogBackdropEl,
    lobbyDialogCloseBtnEl,
    lookSensitivityInputEl,
    lookSensitivityValueEl,
    lookSmoothingToggleBtnEl,
    musicVolumeInputEl,
    musicMuteBtnEl,
    sfxVolumeInputEl,
    sfxMuteBtnEl,
    mobileControlsModeBtnEl,
    fullscreenModeCheckboxEl,
    countdownControlsTextEl
  },
  constants: {
    GAME_CREDITS_TEXT,
    MOBILE_CONTROLS_PREFS,
    GAME_CHAT_OPEN_SHORTCUT,
    DEBUG_OVERLAY_TOGGLE_SHORTCUT,
    DEBUG_OVERLAY_TOUCH_HOLD_MS,
    DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS,
    IS_TOUCH_DEVICE
  },
  deps: {
    randomPrivateRoomCode,
    clampVolume,
    persistAudioSettings,
    persistLookSettings
  },
  actions: {
    connectAndLogin,
    requestSpectate,
    requestSpectatorCycle,
    sendLobbyChat,
    sendInGameChat,
    requestReturnToLobby,
    setLobbyMenuOpen,
    openLobbyDialog,
    setGameChatOpen,
    setGameMenuOpen,
    closeLobbyDialog,
    refreshAudioSettingsUi,
    persistMobileControlsPreference,
    setFullscreenEnabled,
    setLookSettings: (next) => {
      lookSettings = next;
    },
    controlsTextForCurrentMode,
    updateMobileControlsVisibility,
    requestPointerLockSafe,
    toggleDebugOverlay,
    canUseDebugOverlay,
    enableDebugOverlayForDevice,
    updateReadyButton,
    resize,
    getActiveSocket: () => socketConnection?.getSocket() || null
  },
  state: {
    getAuthenticated: () => authenticated,
    getCurrentMatch: () => currentMatch,
    getSessionState: () => sessionState,
    getSessionReady: () => sessionReady,
    setSessionReady: (value) => {
      sessionReady = Boolean(value);
    },
    getAppMode: () => appMode,
    getLobbyMenuOpen: () => lobbyMenuOpen,
    getGameChatOpen: () => gameChatOpen,
    getGameMenuOpen: () => gameMenuOpen,
    canOpenInGameChat,
    getAudioSettings: () => audioSettings,
    getLookSettings: () => lookSettings,
    getMobileControlsPreference: () => mobileControlsPreference
  }
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSec = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  const frameMs = Math.max(0, deltaSec * 1000);
  debugFpsSampleFrames += 1;
  debugFpsSampleMs += frameMs;
  if (debugFpsSampleMs >= DEBUG_FPS_SAMPLE_WINDOW_MS) {
    debugFps = debugFpsSampleMs > 0 ? (debugFpsSampleFrames * 1000) / debugFpsSampleMs : 0;
    debugFpsSampleFrames = 0;
    debugFpsSampleMs = 0;
  }
  sendDebugPing(now);
  const yaw = inputController.getYaw();
  const pitch = inputController.getPitch();

  const smoothingRate = lookSmoothingRate(lookSettings);
  const viewSmooth = smoothingRate > 0 ? 1 - Math.exp(-deltaSec * smoothingRate) : 1;
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
  if (debugOverlayOpen && appMode === "playing" && now - lastDebugOverlayUpdateAt >= DEBUG_OVERLAY_REFRESH_MS) {
    lastDebugOverlayUpdateAt = now;
    updateDebugOverlay();
  }
  if (appMode === "playing") renderer.render(scene, camera);
}

animate();
updateConnectButton();
setRoomInfo();
setPrivateRoomButtonVisible(false);
setNewsCard();
setAppMode("connect");
updateDocumentTitle();

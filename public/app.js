import { createSceneSystem } from "./client/scene.js";
import { createRoomSystem } from "./client/room.js";
import {
  createAvatarSystem,
  drawCountdownCharacterPreview,
} from "./client/avatars.js";
import { createGameSocket } from "./client/network.js";
import { createChatUi } from "./client/chatUi.js";
import {
  updateCrosshairHud as updateCrosshairHudUi,
  updateDownedOverlay as updateDownedOverlayUi,
  updateInGameHud as updateInGameHudUi,
  updateKnockdownToast as updateKnockdownToastUi,
  updateSpectatorHud as updateSpectatorHudUi,
  updateWinOverlay as updateWinOverlayUi,
} from "./client/hudUi.js";
import {
  updateLobbyMatchStatus as updateLobbyMatchStatusUi,
  updateReadyButton as updateReadyButtonUi,
} from "./client/lobbyUi.js";
import { GAME_CREDITS_TEXT } from "./client/about.js";
import { createInputController } from "./client/inputControls.js";
import { handleSocketMessage } from "./client/socketMessages.js";
import { createSocketConnectionController } from "./client/socketConnection.js";
import { createSocketMessageContext } from "./client/socketContext.js";
import { createConnectScreen } from "./client/connectScreen.js";
import { createSettingsController } from "./client/settingsController.js";
import { createDebugOverlay } from "./client/debugOverlay.js";
import {
  createClientState,
  DEFAULT_MATCH_STATE,
} from "./client/clientState.js";
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
  mobileControlsLabel,
} from "./client/appHelpers.js";
import { clampVolume, persistAudioSettings } from "./client/audioSettings.js";
import { persistLookSettings } from "./client/lookSettings.js";
import {
  canvas,
  screenRootEl,
  connectViewEl,
  connectErrorEl,
  roomInfoEl,
  nameInputEl,
  connectBtnEl,
  startFullscreenCheckboxEl,
  createPrivateRoomBtnEl,
  newsCardEl,
  newsVersionEl,
  newsPublishedAtEl,
  newsNotesEl,
  lobbyViewEl,
  scoreBodyEl,
  chatMessagesEl,
  chatInputEl,
  chatSendBtnEl,
  playBtnEl,
  lobbyMatchStatusEl,
  lobbyMatchStatusTitleEl,
  lobbyStatusRowEl,
  lobbyStatusTextEl,
  lobbyPlayersMetaEl,
  lobbySettingsBtnEl,
  lobbyMenuBackdropEl,
  lobbyMenuSettingsBtnEl,
  lobbyMenuCreditsBtnEl,
  lobbyMenuCloseBtnEl,
  lobbyDialogBackdropEl,
  lobbyDialogTitleEl,
  lobbyDialogTextEl,
  lobbyDialogCloseBtnEl,
  settingsPanelEl,
  countdownOverlayEl,
  countdownTextEl,
  countdownCharacterCanvasEl,
  countdownControlsTextEl,
  countdownJoinBtnEl,
  gameHudEl,
  crosshairHudEl,
  crosshairCooldownArcEl,
  aliveOthersTextEl,
  debugOverlayEl,
  debugFpsTextEl,
  debugFrameTimeTextEl,
  debugPingTextEl,
  knockdownToastEl,
  gameMenuBtnEl,
  gameMenuBackdropEl,
  gameMenuSettingsBtnEl,
  gameMenuCreditsBtnEl,
  gameMenuCloseBtnEl,
  gameMenuLobbyBtnEl,
  gameChatNoticeEl,
  gameChatBoxEl,
  gameChatMessagesEl,
  gameChatInputRowEl,
  gameChatInputEl,
  gameChatSendBtnEl,
  mobileControlsModeBtnEl,
  fullscreenModeCheckboxEl,
  settingsFullscreenHelpEl,
  lookSensitivityInputEl,
  lookSensitivityValueEl,
  lookSmoothingToggleBtnEl,
  musicVolumeInputEl,
  musicMuteBtnEl,
  sfxVolumeInputEl,
  sfxMuteBtnEl,
  mobileControlsEl,
  mobileJoystickBaseEl,
  mobileJoystickKnobEl,
  mobileLookPadEl,
  mobileSprintBtnEl,
  mobileAttackBtnEl,
  mobileLandscapePromptEl,
  downedOverlayEl,
  downedByTextEl,
  downedCountdownTextEl,
  downedLobbyBtnEl,
  winOverlayEl,
  winTitleEl,
  winCountdownTextEl,
  winLobbyBtnEl,
  spectatorHudEl,
  spectatorTargetTextEl,
  spectatorPrevBtnEl,
  spectatorNextBtnEl,
  spectatorActionRowEl,
  spectatorLobbyBtnEl,
} from "./client/domRefs.js";

const PLAYER_NAME_KEY = "hidden_player_name";
const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";

const sceneSystem = createSceneSystem(canvas);
const { renderer, scene, camera, resize, setRenderScale, getRenderScale } =
  sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

const { state: clientState, socketState } = createClientState();
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
const DEBUG_OVERLAY_TOUCH_HOLD_MS = 900;
const DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS = 2600;
const HUD_OVERLAY_REFRESH_MS = 120;
const CROSSHAIR_AIM_CHECK_MS = 66;
const LOOK_TOUCH_SENSITIVITY_X = 0.0052;
const LOOK_TOUCH_SENSITIVITY_Y = 0.0045;
const JOYSTICK_DEADZONE = 0.16;
const DOWNED_CAMERA_HEIGHT = 4.6;
const DOWNED_CAMERA_POS_SMOOTH_RATE = 9;
const DOWNED_MESSAGE_VISIBLE_MS = 2800;
const WIN_MESSAGE_VISIBLE_MS = 2000;
const KNOCKDOWN_TOAST_MS = 5000;
const SPECTATOR_CAMERA_DISTANCE = 1.42;
const SPECTATOR_CAMERA_HEIGHT_OFFSET = 0.28;
const SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET = 0.12;
const SPECTATOR_CAMERA_POS_SMOOTH_RATE = 12;
const MOBILE_FRAME_MS_DEGRADE_THRESHOLD = 24;
const MOBILE_FRAME_MS_UPGRADE_THRESHOLD = 19;
const MOBILE_RENDER_SCALE_MIN = 0.72;
const MOBILE_RENDER_SCALE_MAX = 1;
const MOBILE_RENDER_SCALE_STEP_DOWN = 0.07;
const MOBILE_RENDER_SCALE_STEP_UP = 0.04;
const MOBILE_RENDER_SCALE_ADJUST_COOLDOWN_MS = 1500;
const FORCE_MOBILE_UI =
  new URLSearchParams(location.search).get("mobileUi") === "1";
const IS_TOUCH_DEVICE = (() => {
  const coarsePointer =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const hoverNone =
    window.matchMedia && window.matchMedia("(hover: none)").matches;
  const touchApi = "ontouchstart" in window;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(
    navigator.userAgent || "",
  );
  return (
    coarsePointer ||
    hoverNone ||
    touchApi ||
    touchPoints ||
    mobileUa ||
    FORCE_MOBILE_UI
  );
})();

let lastFrameAt = performance.now();
let mobileControlsPreference = normalizeMobileControlsPreference(
  localStorage.getItem(MOBILE_CONTROLS_PREF_KEY),
);
let smoothFrameMs = 16.7;
let lastQualityAdjustAt = 0;
let lastOverlayUiUpdateAt = 0;
let cachedCrosshairAimingAtCharacter = false;
let lastCrosshairAimCheckAt = 0;
let lastScoreboardSignature = "";
const GAMEPLAY_SUMMARY_TEXT = "Håll dig gömd, hitta spelare och slå ner dem.";
const DESKTOP_CONTROLS_TEXT =
  "Desktop: WASD rörelse, Shift sprint, mus för att titta runt, vänsterklick attack.";
const MOBILE_CONTROLS_TEXT =
  "Mobil: joystick nere till vänster för rörelse, Attack/Spring i mitten, dra i höger ruta för att titta.";
let lastCountdownPreviewCharacterId = null;

const chatUi = createChatUi({
  lobbyMessagesEl: chatMessagesEl,
  gameMessagesEl: gameChatMessagesEl,
  colorForName,
  shouldMirrorToGameChat: (entry) => {
    if (clientState.sessionState === "alive") return Boolean(entry?.system);
    return true;
  },
  maxGameLines: GAME_CHAT_MAX_LINES,
});

function clampPitch(value) {
  return Math.max(-1.2, Math.min(1.2, value));
}

const settingsController = createSettingsController({
  elements: {
    fullscreenModeCheckboxEl,
    lookSensitivityInputEl,
    lookSensitivityValueEl,
    lookSmoothingToggleBtnEl,
    mobileControlsModeBtnEl,
    musicMuteBtnEl,
    musicVolumeInputEl,
    settingsFullscreenHelpEl,
    sfxMuteBtnEl,
    sfxVolumeInputEl,
    startFullscreenCheckboxEl,
  },
  camera,
  getAppMode: () => clientState.appMode,
  getMobileControlsPreference: () => mobileControlsPreference,
  isTouchDevice: IS_TOUCH_DEVICE,
  mobileControlsLabel,
});
const {
  bindFullscreenListeners,
  getAudioSettings,
  getLookSettings,
  playHitHurtAtPosition,
  playUiBlipSfx,
  refreshSettingsUi: refreshAudioSettingsUi,
  setFullscreenEnabled,
  setLookSettings,
  syncMusicLoop,
} = settingsController;

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
    return settingsController.getLookSensitivityMultiplier();
  },
  joystickDeadzone: JOYSTICK_DEADZONE,
  clampPitch,
  getSocket: () => socketConnection?.getSocket() || null,
  getAppMode: () => clientState.appMode,
  getSessionState: () => clientState.sessionState,
  getGameMenuOpen: () => clientState.gameMenuOpen,
  getGameChatOpen: () => clientState.gameChatOpen,
  isGameChatFocused,
  requestPointerLock: requestPointerLockSafe,
});

const connectScreen = createConnectScreen({
  elements: {
    connectErrorEl,
    createPrivateRoomBtnEl,
    newsCardEl,
    newsNotesEl,
    newsPublishedAtEl,
    newsVersionEl,
    roomInfoEl,
  },
  activeRoomCodeFromPath,
});
const {
  setConnectError,
  setNewsCard,
  setPrivateRoomButtonVisible,
  setRoomInfo,
} = connectScreen;

const debugOverlay = createDebugOverlay({
  elements: {
    debugOverlayEl,
    debugFpsTextEl,
    debugFrameTimeTextEl,
    debugPingTextEl,
  },
  getAppMode: () => clientState.appMode,
  getAuthenticated: () => clientState.authenticated,
  getSocket: () => socketConnection?.getSocket() || null,
  isTouchDevice: IS_TOUCH_DEVICE,
});
const {
  canUse: canUseDebugOverlay,
  enableForDevice: enableDebugOverlayForDevice,
  handlePong: handleDebugPong,
  maybeRefresh: maybeRefreshDebugOverlay,
  recordFrame: recordDebugFrame,
  reset: resetDebugOverlay,
  sendPing: sendDebugPing,
  setOpen: setDebugOverlayOpen,
  toggle: toggleDebugOverlay,
  update: updateDebugOverlay,
} = debugOverlay;

function lobbyRoomNameFromPath() {
  const roomCode = activeRoomCodeFromPath();
  if (!roomCode) return "Offentligt rum";
  return roomCode;
}

function scoreboardSignature(players) {
  if (!Array.isArray(players) || players.length <= 0) return "";
  return players
    .map((p) =>
      [
        p?.name || "",
        p?.ready ? 1 : 0,
        p?.wins ?? 0,
        p?.knockdowns ?? 0,
        p?.streak ?? 0,
        p?.downed ?? 0,
        p?.innocents ?? 0,
        p?.status || "",
      ].join(":"),
    )
    .join("|");
}

function adaptRenderScale(nowMs, frameMs) {
  if (!IS_TOUCH_DEVICE || clientState.appMode !== "playing") return;
  smoothFrameMs += (frameMs - smoothFrameMs) * 0.06;
  if (nowMs - lastQualityAdjustAt < MOBILE_RENDER_SCALE_ADJUST_COOLDOWN_MS)
    return;

  const currentScale = getRenderScale?.() ?? MOBILE_RENDER_SCALE_MAX;
  if (
    smoothFrameMs >= MOBILE_FRAME_MS_DEGRADE_THRESHOLD &&
    currentScale > MOBILE_RENDER_SCALE_MIN
  ) {
    const next = Math.max(
      MOBILE_RENDER_SCALE_MIN,
      currentScale - MOBILE_RENDER_SCALE_STEP_DOWN,
    );
    if (setRenderScale?.(next)) lastQualityAdjustAt = nowMs;
    return;
  }
  if (
    smoothFrameMs <= MOBILE_FRAME_MS_UPGRADE_THRESHOLD &&
    currentScale < MOBILE_RENDER_SCALE_MAX
  ) {
    const next = Math.min(
      MOBILE_RENDER_SCALE_MAX,
      currentScale + MOBILE_RENDER_SCALE_STEP_UP,
    );
    if (setRenderScale?.(next)) lastQualityAdjustAt = nowMs;
  }
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
    mobileControlsEnabledByPreference()
      ? MOBILE_CONTROLS_TEXT
      : DESKTOP_CONTROLS_TEXT
  }`;
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
  const othersPlaying = Math.max(
    0,
    clientState.activePlayersInGame -
      (clientState.sessionState === "alive" ? 1 : 0),
  );
  if (othersPlaying <= 0) {
    document.title = "Hidden";
    return;
  }
  document.title = `Hidden - ${othersPlaying} spelare`;
}

function openLobbyDialog(title, text, { showSettings = false } = {}) {
  if (
    !lobbyDialogBackdropEl ||
    !lobbyDialogTitleEl ||
    !lobbyDialogTextEl ||
    !lobbyDialogCloseBtnEl
  )
    return;
  setLobbyMenuOpen(false);
  lobbyDialogTitleEl.textContent = title;
  lobbyDialogTextEl.textContent = text;
  lobbyDialogTextEl.classList.toggle("hidden", showSettings);
  if (settingsPanelEl)
    settingsPanelEl.classList.toggle("hidden", !showSettings);
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
  if (
    clientState.appMode === "playing" &&
    (clientState.sessionState === "alive" || clientState.sessionState === "won")
  ) {
    requestPointerLockSafe(canvas);
  }
}

function isGameChatFocused() {
  return document.activeElement === gameChatInputEl;
}

function canOpenInGameChat() {
  if (clientState.appMode !== "playing") return false;
  if (clientState.winReturnToLobbyMsRemaining > 0) return false;
  return (
    clientState.sessionState === "downed" ||
    clientState.sessionState === "spectating" ||
    clientState.sessionState === "won"
  );
}

function updateMobileControlsVisibility() {
  if (!mobileControlsEl) return;
  const isPortrait =
    (window.matchMedia &&
      window.matchMedia("(orientation: portrait)").matches) ||
    window.innerHeight > window.innerWidth;
  const showLandscapePrompt =
    IS_TOUCH_DEVICE && clientState.appMode === "playing" && isPortrait;
  const wasShown = !mobileControlsEl.classList.contains("hidden");
  const lobbyDialogOpen =
    clientState.appMode === "playing" &&
    lobbyDialogBackdropEl &&
    !lobbyDialogBackdropEl.classList.contains("hidden");
  const show =
    mobileControlsEnabledByPreference() &&
    clientState.appMode === "playing" &&
    (clientState.sessionState === "alive" ||
      clientState.sessionState === "won") &&
    !clientState.gameChatOpen &&
    !clientState.gameMenuOpen &&
    !lobbyDialogOpen &&
    !showLandscapePrompt;
  mobileControlsEl.classList.toggle("hidden", !show);
  document.body.classList.toggle("mobile-controls-enabled", show);
  mobileLandscapePromptEl?.classList.toggle("hidden", !showLandscapePrompt);
  if (mobileLandscapePromptEl)
    mobileLandscapePromptEl.setAttribute(
      "aria-hidden",
      showLandscapePrompt ? "false" : "true",
    );
  if (wasShown && !show) inputController.resetJoystickState?.();
}

function updateGameChatAvailability() {
  const available = clientState.appMode === "playing" && canOpenInGameChat();
  gameChatBoxEl?.classList.toggle("hidden", !available);
  gameChatNoticeEl?.classList.toggle("hidden", !available);
  if (available) {
    // Show full chat history so messages sent while the player was alive are visible.
    chatUi.setGameLineLimit(null);
    return;
  }
  clientState.gameChatOpen = false;
  gameChatBoxEl?.classList.remove("open");
  gameChatInputRowEl?.classList.add("hidden");
  gameChatInputEl?.blur();
  chatUi.setGameLineLimit(GAME_CHAT_MAX_LINES);
}

function setGameChatOpen(open, { restorePointerLock = false } = {}) {
  if (!gameChatInputRowEl || !gameChatBoxEl || !gameChatNoticeEl) return;
  updateGameChatAvailability();
  const canOpen = Boolean(open) && canOpenInGameChat();
  clientState.gameChatOpen = canOpen;
  gameChatBoxEl.classList.toggle("open", canOpen);
  gameChatInputRowEl.classList.toggle("hidden", !canOpen);
  gameChatNoticeEl.textContent =
    canOpen || clientState.sessionState === "won" ? "Chatt" : "Systemhändelser";
  chatUi.setGameLineLimit(canOpen ? null : GAME_CHAT_MAX_LINES);
  if (canOpen) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameChatInputEl?.focus();
  } else {
    gameChatInputEl?.blur();
  }
  if (!canOpenInGameChat()) clientState.gameChatOpen = false;
  if (
    restorePointerLock &&
    clientState.appMode === "playing" &&
    (clientState.sessionState === "alive" || clientState.sessionState === "won")
  ) {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
  updateDownedOverlay();
  updateSpectatorHud();
}

function setGameMenuOpen(open, { restorePointerLock = false } = {}) {
  if (!gameMenuBackdropEl) return;
  clientState.gameMenuOpen = Boolean(open);
  gameMenuBackdropEl.classList.toggle("hidden", !clientState.gameMenuOpen);
  if (clientState.gameMenuOpen) {
    resetInputState();
    inputController.sendInput();
    if (document.pointerLockElement) document.exitPointerLock?.();
    gameMenuSettingsBtnEl?.focus();
    updateMobileControlsVisibility();
    return;
  }
  if (
    restorePointerLock &&
    clientState.appMode === "playing" &&
    (clientState.sessionState === "alive" || clientState.sessionState === "won")
  ) {
    requestPointerLockSafe(canvas);
  }
  updateMobileControlsVisibility();
}

function setLobbyMenuOpen(open) {
  if (!lobbyMenuBackdropEl) return;
  clientState.lobbyMenuOpen = Boolean(open);
  lobbyMenuBackdropEl.classList.toggle("hidden", !clientState.lobbyMenuOpen);
  if (clientState.lobbyMenuOpen) {
    lobbyMenuSettingsBtnEl?.focus();
  } else if (clientState.appMode === "lobby") {
    lobbySettingsBtnEl?.focus();
  }
}

function updateLobbyMatchStatus() {
  updateLobbyMatchStatusUi({
    lobbyMatchStatusEl,
    lobbyMatchStatusTitleEl,
    lobbyStatusRowEl,
    lobbyStatusTextEl,
    lobbyPlayersMetaEl,
    appMode: clientState.appMode,
    roomName: lobbyRoomNameFromPath(),
    lobbyScoreboard: clientState.lobbyScoreboard,
    lobbyMaxPlayers: clientState.lobbyMaxPlayers,
    currentMatch: clientState.currentMatch,
    lobbyMinPlayersToStart: clientState.lobbyMinPlayersToStart,
    lobbyCountdownMsRemaining: clientState.lobbyCountdownMsRemaining,
    sessionState: clientState.sessionState,
  });
}

function updateReadyButton() {
  updateReadyButtonUi({
    playBtnEl,
    authenticated: clientState.authenticated,
    sessionState: clientState.sessionState,
    currentMatch: clientState.currentMatch,
    sessionReady: clientState.sessionReady,
    lobbyCountdownMsRemaining: clientState.lobbyCountdownMsRemaining,
  });
}

function resetDownedState() {
  clientState.downedByName = "";
  clientState.downedMessageHideAtMs = 0;
  clientState.downedMessageSuppressed = false;
}

function resetWinState() {
  clientState.winReturnToLobbyMsRemaining = 0;
  clientState.winMessageHideAtMs = 0;
}

function resetKnockdownToast() {
  clientState.knockdownToastText = "";
  clientState.knockdownToastMsRemaining = 0;
}

function resetSessionRuntimeState({
  maxPlayers = 0,
  clearIdentity = false,
} = {}) {
  if (clearIdentity) {
    clientState.authenticated = false;
    clientState.myName = "";
    clientState.sessionState = "auth";
    clientState.myCharacterId = null;
  }
  clientState.sessionReady = false;
  clientState.activePlayersInGame = 0;
  clientState.attackCooldownMsRemaining = 0;
  clientState.attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
  clientState.currentMatch = { ...DEFAULT_MATCH_STATE };
  clientState.lobbyScoreboard = [];
  clientState.lobbyCountdownMsRemaining = 0;
  clientState.lobbyMinPlayersToStart = 2;
  clientState.lobbyMaxPlayers = Math.max(0, Number(maxPlayers || 0));
  resetDownedState();
  resetWinState();
  resetKnockdownToast();
  resetDebugOverlay();
  clientState.spectatorTargetCharacterId = null;
  clientState.spectatorTargetName = "";
  clientState.spectatorCandidates = [];
  lastScoreboardSignature = "";
  cachedCrosshairAimingAtCharacter = false;
  lastCrosshairAimCheckAt = 0;
}

function updateInGameHud() {
  updateGameChatAvailability();
  if (
    !IS_TOUCH_DEVICE &&
    clientState.appMode === "playing" &&
    canOpenInGameChat() &&
    !clientState.gameChatOpen
  ) {
    setGameChatOpen(true);
  }
  updateInGameHudUi({
    aliveOthersTextEl,
    gameChatNoticeEl,
    activePlayersInGame: clientState.activePlayersInGame,
    sessionState: clientState.sessionState,
  });
  if (clientState.gameChatOpen && gameChatNoticeEl)
    gameChatNoticeEl.textContent = "Chatt";
}

function updateDownedOverlay() {
  updateDownedOverlayUi({
    downedOverlayEl,
    downedByTextEl,
    downedCountdownTextEl,
    gameMenuBtnEl,
    appMode: clientState.appMode,
    sessionState: clientState.sessionState,
    downedByName: clientState.downedByName,
    showDownedMessage:
      Boolean(clientState.downedByName) &&
      !clientState.downedMessageSuppressed &&
      performance.now() < clientState.downedMessageHideAtMs,
    returnToLobbyMsRemaining: clientState.winReturnToLobbyMsRemaining,
  });
}

function updateWinOverlay() {
  updateWinOverlayUi({
    winOverlayEl,
    winTitleEl,
    winCountdownTextEl,
    gameMenuBtnEl,
    appMode: clientState.appMode,
    sessionState: clientState.sessionState,
    winReturnToLobbyMsRemaining: clientState.winReturnToLobbyMsRemaining,
    showWinTitle: performance.now() < clientState.winMessageHideAtMs,
  });
}

function updateSpectatorHud() {
  updateSpectatorHudUi({
    spectatorHudEl,
    spectatorTargetTextEl,
    spectatorPrevBtnEl,
    spectatorNextBtnEl,
    spectatorActionRowEl,
    appMode: clientState.appMode,
    sessionState: clientState.sessionState,
    spectatorTargetName: clientState.spectatorTargetName,
    spectatorCandidates: clientState.spectatorCandidates,
    downedByName: clientState.downedByName,
  });
}

function updateKnockdownToast() {
  updateKnockdownToastUi({
    knockdownToastEl,
    appMode: clientState.appMode,
    sessionState: clientState.sessionState,
    knockdownToastMsRemaining: clientState.knockdownToastMsRemaining,
    knockdownToastText: clientState.knockdownToastText,
  });
}

function requestSpectate() {
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || !clientState.authenticated) return;
  activeSocket.sendJson({ type: "spectate" });
}

function requestSpectatorCycle(direction) {
  const activeSocket = socketConnection?.getSocket();
  if (!activeSocket || clientState.sessionState !== "spectating") return;
  const step = Number(direction) < 0 ? -1 : 1;
  clientState.downedMessageSuppressed = true;
  updateDownedOverlay();
  activeSocket.sendJson({ type: "spectate_cycle", direction: step });
}

function updateCrosshairHud(deltaSec, nowMs) {
  const canProbeAim =
    clientState.appMode === "playing" &&
    clientState.sessionState === "alive" &&
    clientState.myCharacterId != null &&
    clientState.attackCooldownMsRemaining <= CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS;

  if (
    canProbeAim &&
    nowMs - lastCrosshairAimCheckAt >= CROSSHAIR_AIM_CHECK_MS
  ) {
    camera.updateMatrixWorld(true);
    cachedCrosshairAimingAtCharacter = avatarSystem.isAimingAtCharacter({
      myCharacterId: clientState.myCharacterId,
      maxDistance: CROSSHAIR_HIT_DISTANCE_METERS,
    });
    lastCrosshairAimCheckAt = nowMs;
  }
  if (!canProbeAim) {
    cachedCrosshairAimingAtCharacter = false;
    lastCrosshairAimCheckAt = 0;
  }

  const next = updateCrosshairHudUi({
    crosshairHudEl,
    crosshairCooldownArcEl,
    appMode: clientState.appMode,
    sessionState: clientState.sessionState,
    myCharacterId: clientState.myCharacterId,
    attackCooldownMsRemaining: clientState.attackCooldownMsRemaining,
    attackCooldownVisualMaxMs: clientState.attackCooldownVisualMaxMs,
    deltaSec,
    crosshairCooldownMinVisibleMs: CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS,
    crosshairDefaultCooldownMs: CROSSHAIR_DEFAULT_COOLDOWN_MS,
    crosshairRingCircumference: CROSSHAIR_RING_CIRCUMFERENCE,
    crosshairHitDistanceMeters: CROSSHAIR_HIT_DISTANCE_METERS,
    camera,
    avatarSystem,
    aimingAtCharacter: cachedCrosshairAimingAtCharacter,
  });
  clientState.attackCooldownMsRemaining = next.attackCooldownMsRemaining;
  clientState.attackCooldownVisualMaxMs = next.attackCooldownVisualMaxMs;
}

function setAppMode(mode) {
  const previous = clientState.appMode;
  clientState.appMode = mode;

  const showConnect = mode === "connect" || mode === "disconnected";
  const showLobby = mode === "lobby";

  connectViewEl?.classList.toggle("hidden", !showConnect);
  lobbyViewEl?.classList.toggle("hidden", !showLobby);
  gameHudEl?.classList.toggle("hidden", mode !== "playing");

  const overlayActive = mode !== "playing";
  document.body.classList.toggle("overlay-active", overlayActive);
  updateScreenRootPointerEvents();

  if (
    previous === "playing" &&
    mode !== "playing" &&
    document.pointerLockElement
  ) {
    document.exitPointerLock?.();
  }

  if (previous === "playing" && mode !== "playing") {
    clientState.myCharacterId = null;
    clientState.attackCooldownMsRemaining = 0;
    clientState.attackCooldownVisualMaxMs = CROSSHAIR_DEFAULT_COOLDOWN_MS;
    resetKnockdownToast();
    setDebugOverlayOpen(false);
    resetInputState();
  }

  if (mode !== "playing") setGameChatOpen(false);
  if (mode !== "playing") setGameMenuOpen(false);
  if (mode !== "lobby") setLobbyMenuOpen(false);
  if (mode === "playing" && clientState.gameChatOpen && !canOpenInGameChat())
    setGameChatOpen(false);
  if (mode === "connect" || mode === "disconnected")
    setCountdownTextFromSession({ state: "lobby" });
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
  const overlayActive = clientState.appMode !== "playing";
  const dialogOpenInGame =
    clientState.appMode === "playing" &&
    lobbyDialogBackdropEl &&
    !lobbyDialogBackdropEl.classList.contains("hidden");
  screenRootEl.style.pointerEvents =
    overlayActive || dialogOpenInGame ? "auto" : "none";
}

function setCountdownTextFromSession(state) {
  if (!countdownTextEl || !countdownOverlayEl) return;
  const ms = Number(state?.countdownMsRemaining || 0);
  clientState.lobbyCountdownMsRemaining = ms;
  if (countdownControlsTextEl)
    countdownControlsTextEl.textContent = controlsTextForCurrentMode();
  // Show join button when the player is in lobby (watching countdown) but not yet participating
  const canJoin =
    ms > 0 && state?.state === "lobby" && Boolean(state?.authenticated);
  countdownJoinBtnEl?.classList.toggle("hidden", !canJoin);
  if (ms > 0) {
    const sec = Math.max(1, Math.ceil(ms / 1000));
    countdownTextEl.textContent = String(sec);
    const characterId = state?.characterId ?? clientState.myCharacterId;
    if (countdownCharacterCanvasEl && characterId != null) {
      if (characterId !== lastCountdownPreviewCharacterId) {
        drawCountdownCharacterPreview(countdownCharacterCanvasEl, characterId);
        lastCountdownPreviewCharacterId = characterId;
      }
    } else {
      lastCountdownPreviewCharacterId = null;
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
  const nextPlayers = Array.isArray(players) ? players : [];
  const nextSignature = scoreboardSignature(nextPlayers);
  if (nextSignature === lastScoreboardSignature) return;
  lastScoreboardSignature = nextSignature;
  clientState.lobbyScoreboard = nextPlayers.slice();
  renderScoreboardFn(scoreBodyEl, nextPlayers, colorForName);
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

const socketMessageContext = createSocketMessageContext({
  socketState,
  constants: {
    DEFAULT_MATCH_STATE,
    CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS,
    CROSSHAIR_DEFAULT_COOLDOWN_MS,
    DOWNED_MESSAGE_VISIBLE_MS,
    WIN_MESSAGE_VISIBLE_MS,
    KNOCKDOWN_TOAST_MS,
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
    playHitHurtAtPosition,
    cancelAutoReconnect: () =>
      socketConnection?.cancelAutoReconnectOnLoginError?.(),
    setViewYaw: (value) => {
      clientState.viewYaw = value;
    },
  },
});

socketConnection = createSocketConnectionController({
  createGameSocket,
  handleSocketMessage,
  getSocketMessageContext: () => socketMessageContext,
  setPendingLoginName: (name) => {
    clientState.pendingLoginName = name;
  },
  setConnectError,
  setPrivateRoomButtonVisible,
  setAppMode,
  resetSessionRuntimeState,
  updateDocumentTitle,
  resetInputState,
  onConnectingChanged: () => {
    updateConnectButton();
  },
  onAutoReconnecting: ({ attempt, maxAttempts }) => {
    setConnectError(
      `Anslutningen bröts. Återansluter om ${2}s\u2026 (försök ${attempt}/${maxAttempts})`,
    );
  },
});

async function connectAndLogin() {
  if (!nameInputEl) return;
  const rawName = String(nameInputEl.value ?? "");
  const trimmedName = rawName.trim();
  const wsUrl = `${wsScheme()}://${location.host}${activeRoomPath()}`;
  if (trimmedName.length < 2) {
    setConnectError("Namn måste vara minst 2 tecken.");
    return;
  }
  if (startFullscreenCheckboxEl?.checked) {
    await setFullscreenEnabled(true);
  }

  const started = socketConnection?.connectAndLogin({
    rawName: trimmedName,
    wsUrl,
    minNameLength: 2,
    onValidationError: () => {
      setConnectError("Namn måste vara minst 2 tecken.");
    },
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
  if (!activeSocket || !clientState.authenticated) return;
  activeSocket.sendJson({ type: "leave_match" });
  setGameMenuOpen(false);
}

function updateSpectatorCamera(deltaSec) {
  if (clientState.sessionState !== "spectating") return;
  const target = avatarSystem.getCharacterCameraState(
    clientState.spectatorTargetCharacterId,
  );
  if (!target) return;

  if (
    clientState.downedByName &&
    clientState.spectatorTargetName &&
    clientState.spectatorTargetName === clientState.myName
  ) {
    const posSmooth = 1 - Math.exp(-deltaSec * DOWNED_CAMERA_POS_SMOOTH_RATE);
    camera.position.x += (target.x - camera.position.x) * posSmooth;
    camera.position.z += (target.z - camera.position.z) * posSmooth;
    camera.position.y += (DOWNED_CAMERA_HEIGHT - camera.position.y) * posSmooth;
    camera.rotation.set(-Math.PI / 2 + 0.0001, 0, 0);
    return;
  }

  const desiredX = target.x - Math.sin(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
  const desiredZ = target.z - Math.cos(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
  const desiredY = target.eyeHeight + SPECTATOR_CAMERA_HEIGHT_OFFSET;
  const posSmooth = 1 - Math.exp(-deltaSec * SPECTATOR_CAMERA_POS_SMOOTH_RATE);
  camera.position.x += (desiredX - camera.position.x) * posSmooth;
  camera.position.z += (desiredZ - camera.position.z) * posSmooth;
  camera.position.y += (desiredY - camera.position.y) * posSmooth;

  camera.lookAt(
    target.x,
    target.eyeHeight + SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET,
    target.z,
  );
}

const savedName = localStorage.getItem(PLAYER_NAME_KEY);
if (nameInputEl) nameInputEl.value = savedName != null ? savedName : "";
if (IS_TOUCH_DEVICE) document.body.classList.add("touch-device");
bindFullscreenListeners();
refreshAudioSettingsUi();
inputController.bind();
bindAppEventHandlers({
  elements: {
    canvas,
    connectBtnEl,
    startFullscreenCheckboxEl,
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
    gameChatSendBtnEl,
    gameChatInputEl,
    gameMenuBtnEl,
    gameMenuBackdropEl,
    gameMenuSettingsBtnEl,
    gameMenuCreditsBtnEl,
    gameMenuCloseBtnEl,
    gameMenuLobbyBtnEl,
    downedLobbyBtnEl,
    winLobbyBtnEl,
    spectatorPrevBtnEl,
    spectatorNextBtnEl,
    spectatorLobbyBtnEl,
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
    countdownControlsTextEl,
    countdownJoinBtnEl,
  },
  constants: {
    GAME_CREDITS_TEXT,
    MOBILE_CONTROLS_PREFS,
    GAME_CHAT_OPEN_SHORTCUT,
    DEBUG_OVERLAY_TOGGLE_SHORTCUT,
    DEBUG_OVERLAY_TOUCH_HOLD_MS,
    DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS,
    IS_TOUCH_DEVICE,
  },
  deps: {
    randomPrivateRoomCode,
    clampVolume,
    persistAudioSettings,
    persistLookSettings,
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
    setLookSettings,
    controlsTextForCurrentMode,
    updateMobileControlsVisibility,
    requestPointerLockSafe,
    toggleDebugOverlay,
    canUseDebugOverlay,
    enableDebugOverlayForDevice,
    updateReadyButton,
    resize,
    playUiBlipSfx,
    getActiveSocket: () => socketConnection?.getSocket() || null,
    requestJoinCountdown: () => {
      const activeSocket = socketConnection?.getSocket();
      if (!activeSocket || !clientState.authenticated) return;
      if (
        clientState.sessionState !== "lobby" ||
        clientState.lobbyCountdownMsRemaining <= 0
      )
        return;
      activeSocket.sendJson({ type: "ready", ready: true });
      clientState.sessionReady = true;
      updateReadyButton();
    },
  },
  state: {
    getAuthenticated: () => clientState.authenticated,
    getCurrentMatch: () => clientState.currentMatch,
    getSessionState: () => clientState.sessionState,
    getSessionReady: () => clientState.sessionReady,
    setSessionReady: (value) => {
      clientState.sessionReady = Boolean(value);
    },
    getAppMode: () => clientState.appMode,
    getLobbyMenuOpen: () => clientState.lobbyMenuOpen,
    getGameChatOpen: () => clientState.gameChatOpen,
    getGameMenuOpen: () => clientState.gameMenuOpen,
    canOpenInGameChat,
    getAudioSettings,
    getLookSettings,
    getMobileControlsPreference: () => mobileControlsPreference,
  },
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  if (document.hidden) {
    lastFrameAt = now;
    return;
  }
  const deltaSec = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  const frameMs = Math.max(0, deltaSec * 1000);
  recordDebugFrame(frameMs);
  if (clientState.appMode !== "playing") return;
  sendDebugPing(now);
  adaptRenderScale(now, frameMs);
  const yaw = inputController.getYaw();
  const pitch = inputController.getPitch();

  const smoothingRate = settingsController.getLookSmoothingRate();
  const viewSmooth =
    smoothingRate > 0 ? 1 - Math.exp(-deltaSec * smoothingRate) : 1;
  const yawDelta = normalizeAngle(yaw - clientState.viewYaw);
  clientState.viewYaw = normalizeAngle(
    clientState.viewYaw + yawDelta * viewSmooth,
  );
  clientState.viewPitch += (pitch - clientState.viewPitch) * viewSmooth;

  camera.rotation.y = clientState.viewYaw;
  camera.rotation.x = clientState.viewPitch;
  roomSystem.update?.(deltaSec);
  const controlledCharacterId =
    clientState.appMode === "playing" &&
    (clientState.sessionState === "alive" || clientState.sessionState === "won")
      ? clientState.myCharacterId
      : null;
  avatarSystem.animate(deltaSec, controlledCharacterId);
  if (
    clientState.appMode === "playing" &&
    clientState.sessionState === "spectating"
  ) {
    updateSpectatorCamera(deltaSec);
  }
  if (
    clientState.appMode === "playing" &&
    clientState.sessionState === "downed"
  ) {
    const corpsePos = avatarSystem.getCharacterPosition(
      clientState.myCharacterId,
    );
    if (corpsePos) {
      const posSmooth = 1 - Math.exp(-deltaSec * DOWNED_CAMERA_POS_SMOOTH_RATE);
      camera.position.x += (corpsePos.x - camera.position.x) * posSmooth;
      camera.position.z += (corpsePos.z - camera.position.z) * posSmooth;
      camera.position.y +=
        (DOWNED_CAMERA_HEIGHT - camera.position.y) * posSmooth;
    }
    camera.rotation.set(-Math.PI / 2 + 0.0001, 0, 0);
  }
  if (
    clientState.appMode === "playing" &&
    (clientState.sessionState === "won" ||
      clientState.sessionState === "downed" ||
      clientState.sessionState === "spectating")
  ) {
    clientState.winReturnToLobbyMsRemaining = Math.max(
      0,
      clientState.winReturnToLobbyMsRemaining - deltaSec * 1000,
    );
  }
  clientState.knockdownToastMsRemaining = Math.max(
    0,
    clientState.knockdownToastMsRemaining - deltaSec * 1000,
  );
  if (now - lastOverlayUiUpdateAt >= HUD_OVERLAY_REFRESH_MS) {
    lastOverlayUiUpdateAt = now;
    updateDownedOverlay();
    updateWinOverlay();
    updateKnockdownToast();
  }
  updateCrosshairHud(deltaSec, now);
  maybeRefreshDebugOverlay(now);
  if (clientState.appMode === "playing") renderer.render(scene, camera);
}

animate();
updateConnectButton();
setRoomInfo();
setPrivateRoomButtonVisible(false);
setNewsCard();
setAppMode("connect");
updateDocumentTitle();

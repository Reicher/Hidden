import { createSceneSystem } from "./client/scene.js";
import { createCameraController } from "./client/cameraController.js";
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
import { createConnectionManager } from "./client/connectionManager.js";
import { createConnectScreen } from "./client/connectScreen.js";
import { createSettingsController } from "./client/settingsController.js";
import { createDebugOverlay } from "./client/debugOverlay.js";
import {
  createClientState,
  DEFAULT_MATCH_STATE,
} from "./client/clientState.js";
import { bindAppEventHandlers } from "./client/appBindings.js";
import { createPanelState } from "./client/panelState.js";
import { normalizeAngle, colorForName } from "./client/utils.js";
import {
  renderScoreboard as renderScoreboardFn,
  scoreboardSignature,
} from "./client/scoreboard.js";
import { updateCountdownOverlay } from "./client/countdownUi.js";
import {
  MOBILE_CONTROLS_PREFS,
  wsScheme,
  activeRoomCodeFromPath,
  activeRoomPath,
  randomPrivateRoomCode,
  normalizeMobileControlsPreference,
  mobileControlsLabel,
} from "./client/appHelpers.js";
import { createMobileControls } from "./client/mobileControls.js";
import {
  PLAYER_NAME_KEY,
  MOBILE_CONTROLS_PREF_KEY,
  INPUT_SEND_INTERVAL_MS,
  INPUT_HEARTBEAT_MS,
  LOOK_TOUCH_SENSITIVITY_X,
  LOOK_TOUCH_SENSITIVITY_Y,
  JOYSTICK_DEADZONE,
  CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS,
  CROSSHAIR_DEFAULT_COOLDOWN_MS,
  CROSSHAIR_RING_CIRCUMFERENCE,
  CROSSHAIR_HIT_DISTANCE_METERS,
  CROSSHAIR_AIM_CHECK_MS,
  HUD_OVERLAY_REFRESH_MS,
  GAME_CHAT_MAX_LINES,
  GAME_CHAT_OPEN_SHORTCUT,
  DEBUG_OVERLAY_TOGGLE_SHORTCUT,
  DEBUG_OVERLAY_TOUCH_HOLD_MS,
  DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS,
  DOWNED_MESSAGE_VISIBLE_MS,
  WIN_MESSAGE_VISIBLE_MS,
  KNOCKDOWN_TOAST_MS,
  DOWNED_CAMERA_HEIGHT,
  DOWNED_CAMERA_POS_SMOOTH_RATE,
  SPECTATOR_CAMERA_DISTANCE,
  SPECTATOR_CAMERA_HEIGHT_OFFSET,
  SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET,
  SPECTATOR_CAMERA_POS_SMOOTH_RATE,
  MOBILE_FRAME_MS_DEGRADE_THRESHOLD,
  MOBILE_FRAME_MS_UPGRADE_THRESHOLD,
  MOBILE_RENDER_SCALE_MIN,
  MOBILE_RENDER_SCALE_MAX,
  MOBILE_RENDER_SCALE_STEP_DOWN,
  MOBILE_RENDER_SCALE_STEP_UP,
  MOBILE_RENDER_SCALE_ADJUST_COOLDOWN_MS,
  GAMEPLAY_SUMMARY_TEXT,
  DESKTOP_CONTROLS_TEXT,
  MOBILE_CONTROLS_TEXT,
  IS_TOUCH_DEVICE,
} from "./client/appConstants.js";
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

const sceneSystem = createSceneSystem(canvas);
const {
  renderer,
  scene,
  camera,
  resize,
  adaptRenderScale: _adaptRenderScale,
} = sceneSystem;
const roomSystem = createRoomSystem({ scene, renderer });
const avatarSystem = createAvatarSystem({ scene, camera });

const { state: clientState } = createClientState();
let socketConnection = null;

let lastFrameAt = performance.now();
let lastOverlayUiUpdateAt = 0;
let cachedCrosshairAimingAtCharacter = false;
let lastCrosshairAimCheckAt = 0;
let lastScoreboardSignature = "";

const { updateSpectatorCamera, updateDownedCamera } = createCameraController({
  camera,
  avatarSystem,
  constants: {
    SPECTATOR_CAMERA_DISTANCE,
    SPECTATOR_CAMERA_HEIGHT_OFFSET,
    SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET,
    SPECTATOR_CAMERA_POS_SMOOTH_RATE,
    DOWNED_CAMERA_HEIGHT,
    DOWNED_CAMERA_POS_SMOOTH_RATE,
  },
});
let lastCountdownPreviewCharacterId = null;

const mobileControls = createMobileControls(
  { mobileControlsEl, mobileLandscapePromptEl, lobbyDialogBackdropEl },
  {
    isTouchDevice: IS_TOUCH_DEVICE,
    initialPreference: normalizeMobileControlsPreference(
      localStorage.getItem(MOBILE_CONTROLS_PREF_KEY),
    ),
    normalizePreference: normalizeMobileControlsPreference,
    gameplaySummaryText: GAMEPLAY_SUMMARY_TEXT,
    desktopControlsText: DESKTOP_CONTROLS_TEXT,
    mobileControlsText: MOBILE_CONTROLS_TEXT,
    getAppMode: () => clientState.appMode,
    getSessionState: () => clientState.sessionState,
    getGameChatOpen: () => clientState.gameChatOpen,
    getGameMenuOpen: () => clientState.gameMenuOpen,
    resetJoystickState: () => inputController?.resetJoystickState?.(),
  },
);
const {
  controlsTextForCurrentMode,
  getMobileControlsPreference,
  persistMobileControlsPreference,
  updateMobileControlsVisibility,
  mobileControlsEnabledByPreference,
} = mobileControls;

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
  getMobileControlsPreference,
  isTouchDevice: IS_TOUCH_DEVICE,
  mobileControlsLabel,
});
const {
  bindFullscreenListeners,
  clampVolume,
  getAudioSettings,
  getLookSettings,
  persistAudioSettings,
  persistLookSettings,
  playHitHurtAtPosition,
  playHitMissSfx,
  playUiBlipSfx,
  refreshSettingsUi: refreshAudioSettingsUi,
  setFullscreenEnabled,
  setLookSettings,
  syncMusicLoop,
} = settingsController;

const inputController = createInputController({
  canvas,
  mobile: {
    joystickBaseEl: mobileJoystickBaseEl,
    joystickKnobEl: mobileJoystickKnobEl,
    lookPadEl: mobileLookPadEl,
    sprintBtnEl: mobileSprintBtnEl,
    attackBtnEl: mobileAttackBtnEl,
  },
  config: {
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
  },
  app: {
    getSocket: () => socketConnection?.getSocket() || null,
    getAppMode: () => clientState.appMode,
    getSessionState: () => clientState.sessionState,
    getGameMenuOpen: () => clientState.gameMenuOpen,
    getGameChatOpen: () => clientState.gameChatOpen,
    isGameChatFocused: () => isGameChatFocused(),
    requestPointerLock: requestPointerLockSafe,
  },
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
    spectatorCount: clientState.spectatorCount,
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

const {
  canOpenInGameChat,
  closeLobbyDialog,
  isGameChatFocused,
  openLobbyDialog,
  setGameChatOpen,
  setGameMenuOpen,
  setLobbyMenuOpen,
  updateGameChatAvailability,
} = createPanelState(
  {
    gameChatBoxEl,
    gameChatNoticeEl,
    gameChatInputRowEl,
    gameChatInputEl,
    gameMenuBackdropEl,
    gameMenuSettingsBtnEl,
    lobbyMenuBackdropEl,
    lobbyMenuSettingsBtnEl,
    lobbySettingsBtnEl,
    lobbyDialogBackdropEl,
    lobbyDialogTitleEl,
    lobbyDialogTextEl,
    lobbyDialogCloseBtnEl,
    settingsPanelEl,
    musicVolumeInputEl,
  },
  {
    getAppMode: () => clientState.appMode,
    getSessionState: () => clientState.sessionState,
    getWinReturnToLobbyMsRemaining: () =>
      clientState.winReturnToLobbyMsRemaining,
    setGameChatOpen: (v) => {
      clientState.gameChatOpen = v;
    },
    setGameMenuOpen: (v) => {
      clientState.gameMenuOpen = v;
    },
    setLobbyMenuOpen: (v) => {
      clientState.lobbyMenuOpen = v;
    },
    chatUi,
    gameChatMaxLines: GAME_CHAT_MAX_LINES,
    isTouchDevice: IS_TOUCH_DEVICE,
    requestPointerLockSafe: () => requestPointerLockSafe(canvas),
    resetInputState,
    sendInput: () => inputController.sendInput(),
    updateMobileControlsVisibility,
    updateDownedOverlay,
    updateSpectatorHud,
    updateScreenRootPointerEvents,
    refreshAudioSettingsUi,
  },
);

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

  if (previous !== "playing" && mode === "playing") {
    // Reset avatar position tracking so all characters snap to their
    // current server positions on the first rendered frame.
    avatarSystem.resetAllAvatarTracking();
    // Reliable fade-in: set black instantly via inline style, then
    // transition to transparent in the next frame.
    const fadeEl = document.getElementById("gameStartFade");
    if (fadeEl) {
      fadeEl.style.transition = "none";
      fadeEl.style.opacity = "1";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fadeEl.style.transition = "opacity 1s ease-out";
          fadeEl.style.opacity = "0";
        });
      });
    }
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
  const ms = Number(state?.countdownMsRemaining || 0);
  clientState.lobbyCountdownMsRemaining = ms;
  ({ lastCountdownPreviewCharacterId } = updateCountdownOverlay({
    countdownTextEl,
    countdownOverlayEl,
    countdownControlsTextEl,
    countdownCharacterCanvasEl,
    countdownJoinBtnEl,
    countdownMsRemaining: ms,
    sessionState: state?.state ?? clientState.sessionState,
    authenticated: state?.authenticated ?? clientState.authenticated,
    characterId: state?.characterId ?? clientState.myCharacterId,
    lastCountdownPreviewCharacterId,
    isTouchDevice: mobileControlsEnabledByPreference(),
    drawCharacterPreview: drawCountdownCharacterPreview,
  }));
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

const deferredChatEntries = [];
let deferredChatFlushScheduled = false;

function replaceChat(history) {
  deferredChatEntries.length = 0;
  chatUi.replaceChat(history);
}

function deferUiWork(callback) {
  if (typeof callback !== "function") return false;
  if (typeof requestAnimationFrame !== "function") return false;
  requestAnimationFrame(callback);
  return true;
}

function deferAppendChat(entry) {
  if (typeof requestAnimationFrame !== "function") return false;
  deferredChatEntries.push(entry);
  if (deferredChatFlushScheduled) return true;
  deferredChatFlushScheduled = true;
  requestAnimationFrame(() => {
    deferredChatFlushScheduled = false;
    const entries = deferredChatEntries.splice(0, deferredChatEntries.length);
    for (const queuedEntry of entries) appendChat(queuedEntry);
  });
  return true;
}

function resetInputState() {
  inputController.resetInputState();
}

socketConnection = createConnectionManager({
  createGameSocket,
  state: clientState,
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
    setPendingLoginName: (name) => {
      clientState.pendingLoginName = name;
    },
    resetSessionRuntimeState,
    replaceChat,
    appendChat,
    deferAppendChat,
    refreshGameChat: () => chatUi.refreshGameChat(),
    deferRefreshGameChat: () => deferUiWork(() => chatUi.refreshGameChat()),
    setConnectError,
    setPrivateRoomButtonVisible,
    setAppMode,
    setCountdownTextFromSession,
    updateLobbyMatchStatus,
    updateInGameHud,
    updateDocumentTitle,
    updateKnockdownToast,
    deferKnockdownToastUpdate: () => deferUiWork(updateKnockdownToast),
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
    playHitMissSfx,
    setViewYaw: (value) => {
      clientState.viewYaw = value;
    },
  },
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
    getMobileControlsPreference,
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
  _adaptRenderScale(now, frameMs, {
    isTouchDevice: IS_TOUCH_DEVICE,
    isPlaying: clientState.appMode === "playing",
    degradeThreshold: MOBILE_FRAME_MS_DEGRADE_THRESHOLD,
    upgradeThreshold: MOBILE_FRAME_MS_UPGRADE_THRESHOLD,
    scaleMin: MOBILE_RENDER_SCALE_MIN,
    scaleMax: MOBILE_RENDER_SCALE_MAX,
    stepDown: MOBILE_RENDER_SCALE_STEP_DOWN,
    stepUp: MOBILE_RENDER_SCALE_STEP_UP,
    cooldownMs: MOBILE_RENDER_SCALE_ADJUST_COOLDOWN_MS,
  });
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
  const sessionState = clientState.sessionState;
  const controlledCharacterId =
    sessionState === "alive" || sessionState === "won"
      ? clientState.myCharacterId
      : null;
  avatarSystem.animate(deltaSec, controlledCharacterId);
  if (sessionState === "spectating")
    updateSpectatorCamera(deltaSec, clientState);
  if (sessionState === "downed") updateDownedCamera(deltaSec, clientState);
  if (
    sessionState === "won" ||
    sessionState === "downed" ||
    sessionState === "spectating"
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
  renderer.render(scene, camera);
}

animate();
updateConnectButton();
setRoomInfo();
setPrivateRoomButtonVisible(false);
setNewsCard();
setAppMode("connect");
updateDocumentTitle();

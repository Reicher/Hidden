import { t } from "./i18n.js";

function isTextInputTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return Boolean(target.isContentEditable);
}

export function bindAppEventHandlers({
  elements,
  constants,
  deps,
  actions,
  state,
}) {
  const {
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
    gameChatInputEl,
    gameChatSendBtnEl,
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
  } = elements;

  const {
    MOBILE_CONTROLS_PREFS,
    GAME_CHAT_OPEN_SHORTCUT,
    DEBUG_OVERLAY_TOGGLE_SHORTCUT,
    DEBUG_OVERLAY_TOUCH_HOLD_MS,
    DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS,
    IS_TOUCH_DEVICE,
  } = constants;

  const {
    randomPrivateRoomCode,
    clampVolume,
    persistAudioSettings,
    persistLookSettings,
  } = deps;

  const {
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
    setLookSettings,
    controlsTextForCurrentMode,
    updateMobileControlsVisibility,
    setFullscreenEnabled,
    requestPointerLockSafe,
    toggleDebugOverlay,
    canUseDebugOverlay,
    enableDebugOverlayForDevice,
    updateReadyButton,
    resize,
    playUiBlipSfx,
    getActiveSocket,
    requestJoinCountdown,
  } = actions;

  let debugLongPressTimer = null;
  let suppressNextGameMenuClick = false;
  let lastTouchBlipButton = null;
  let lastTouchBlipAt = 0;

  function clearDebugLongPressTimer() {
    if (debugLongPressTimer == null) return;
    clearTimeout(debugLongPressTimer);
    debugLongPressTimer = null;
  }

  function mutateAudioSetting(mutate) {
    const audioSettings = state.getAudioSettings();
    mutate(audioSettings);
    persistAudioSettings(audioSettings);
    refreshAudioSettingsUi();
  }

  function handleResize() {
    resize();
    updateMobileControlsVisibility();
  }

  function buttonFromEventTarget(target) {
    if (!(target instanceof Element)) return null;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement)) return null;
    if (button.disabled) return null;
    return button;
  }

  connectBtnEl?.addEventListener("click", connectAndLogin);
  startFullscreenCheckboxEl?.addEventListener("change", () => {
    refreshAudioSettingsUi();
  });
  countdownJoinBtnEl?.addEventListener("click", () => {
    requestJoinCountdown?.();
  });
  createPrivateRoomBtnEl?.addEventListener("click", () => {
    const code = randomPrivateRoomCode();
    location.assign(`/${encodeURIComponent(code)}`);
  });
  nameInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectAndLogin();
  });
  playBtnEl?.addEventListener("click", () => {
    const activeSocket = getActiveSocket();
    if (!activeSocket || !state.getAuthenticated()) return;
    if (state.getCurrentMatch().inProgress) {
      requestSpectate();
      return;
    }
    const sessionState = state.getSessionState();
    if (
      sessionState === "alive" ||
      sessionState === "downed" ||
      sessionState === "won"
    )
      return;
    if (state.getSessionReady() && sessionState === "countdown") return;
    const nextReady = !state.getSessionReady();
    activeSocket.sendJson({ type: "ready", ready: nextReady });
    state.setSessionReady(nextReady);
    updateReadyButton();
  });
  lobbySettingsBtnEl?.addEventListener("click", () => {
    if (state.getAppMode() !== "lobby") return;
    setLobbyMenuOpen(!state.getLobbyMenuOpen());
  });
  lobbyMenuSettingsBtnEl?.addEventListener("click", () => {
    setLobbyMenuOpen(false);
    openLobbyDialog(t("menu.settings"), "", { showSettings: true });
  });
  lobbyMenuCreditsBtnEl?.addEventListener("click", () => {
    setLobbyMenuOpen(false);
    openLobbyDialog(t("menu.about"), t("about.credits"));
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
  gameChatSendBtnEl?.addEventListener("click", sendInGameChat);
  gameMenuBtnEl?.addEventListener("click", () => {
    if (suppressNextGameMenuClick) {
      suppressNextGameMenuClick = false;
      return;
    }
    if (state.getAppMode() !== "playing") return;
    const sessionState = state.getSessionState();
    if (sessionState !== "alive" && sessionState !== "spectating") return;
    setGameMenuOpen(!state.getGameMenuOpen());
  });
  gameMenuBtnEl?.addEventListener("pointerdown", (event) => {
    if (!IS_TOUCH_DEVICE) return;
    if (event.pointerType && event.pointerType !== "touch") return;
    if (state.getAppMode() !== "playing") return;
    const unlockMode = !canUseDebugOverlay?.();
    const holdMs = unlockMode
      ? DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS
      : DEBUG_OVERLAY_TOUCH_HOLD_MS;
    clearDebugLongPressTimer();
    debugLongPressTimer = setTimeout(() => {
      debugLongPressTimer = null;
      suppressNextGameMenuClick = true;
      if (!canUseDebugOverlay?.()) enableDebugOverlayForDevice?.();
      toggleDebugOverlay?.();
    }, holdMs);
  });
  gameMenuBtnEl?.addEventListener("pointerup", clearDebugLongPressTimer);
  gameMenuBtnEl?.addEventListener("pointercancel", clearDebugLongPressTimer);
  gameMenuBtnEl?.addEventListener(
    "lostpointercapture",
    clearDebugLongPressTimer,
  );
  gameMenuCloseBtnEl?.addEventListener("click", () => {
    setGameMenuOpen(false, { restorePointerLock: true });
  });
  gameMenuSettingsBtnEl?.addEventListener("click", () => {
    setGameMenuOpen(false);
    openLobbyDialog(t("menu.settings"), "", { showSettings: true });
  });
  gameMenuCreditsBtnEl?.addEventListener("click", () => {
    setGameMenuOpen(false);
    openLobbyDialog(t("menu.about"), t("about.credits"));
  });
  gameMenuLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
  downedLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
  winLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
  spectatorPrevBtnEl?.addEventListener("click", () => {
    requestSpectatorCycle(-1);
  });
  spectatorNextBtnEl?.addEventListener("click", () => {
    requestSpectatorCycle(1);
  });
  spectatorLobbyBtnEl?.addEventListener("click", requestReturnToLobby);
  gameMenuBackdropEl?.addEventListener("click", (event) => {
    if (event.target === gameMenuBackdropEl)
      setGameMenuOpen(false, { restorePointerLock: true });
  });
  lobbyDialogCloseBtnEl?.addEventListener("click", closeLobbyDialog);
  lobbyDialogBackdropEl?.addEventListener("click", (event) => {
    if (event.target === lobbyDialogBackdropEl) closeLobbyDialog();
  });
  musicVolumeInputEl?.addEventListener("input", () => {
    mutateAudioSetting((s) => {
      s.musicVolume = clampVolume(musicVolumeInputEl.value);
    });
  });
  musicMuteBtnEl?.addEventListener("click", () => {
    mutateAudioSetting((s) => {
      s.musicMuted = !s.musicMuted;
    });
  });
  sfxVolumeInputEl?.addEventListener("input", () => {
    mutateAudioSetting((s) => {
      s.sfxVolume = clampVolume(sfxVolumeInputEl.value);
    });
  });
  sfxMuteBtnEl?.addEventListener("click", () => {
    mutateAudioSetting((s) => {
      s.sfxMuted = !s.sfxMuted;
    });
  });
  mobileControlsModeBtnEl?.addEventListener("click", () => {
    const idx = MOBILE_CONTROLS_PREFS.indexOf(
      state.getMobileControlsPreference(),
    );
    const next =
      MOBILE_CONTROLS_PREFS[(idx + 1) % MOBILE_CONTROLS_PREFS.length];
    persistMobileControlsPreference(next);
    refreshAudioSettingsUi();
    if (countdownControlsTextEl)
      countdownControlsTextEl.textContent = controlsTextForCurrentMode();
    updateMobileControlsVisibility();
  });
  fullscreenModeCheckboxEl?.addEventListener("change", () => {
    const nextEnabled = Boolean(fullscreenModeCheckboxEl.checked);
    const maybePromise = setFullscreenEnabled?.(nextEnabled);
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise
        .then((applied) => {
          if (applied === false) refreshAudioSettingsUi();
        })
        .catch(() => {
          refreshAudioSettingsUi();
        });
      return;
    }
    refreshAudioSettingsUi();
  });
  lookSensitivityInputEl?.addEventListener("input", () => {
    const lookSettings = state.getLookSettings();
    const nextValue = Number(lookSensitivityInputEl.value);
    const next = {
      ...lookSettings,
      sensitivity: Number.isFinite(nextValue)
        ? nextValue
        : lookSettings.sensitivity,
    };
    if (typeof setLookSettings === "function") setLookSettings(next);
    if (lookSensitivityValueEl) {
      const liveValue = Number(lookSensitivityInputEl.value);
      lookSensitivityValueEl.textContent = `${Number.isFinite(liveValue) ? Math.round(liveValue) : next.sensitivity}%`;
    }
    persistLookSettings(next);
  });
  lookSmoothingToggleBtnEl?.addEventListener("click", () => {
    const lookSettings = state.getLookSettings();
    const next = {
      ...lookSettings,
      smoothingEnabled: !lookSettings.smoothingEnabled,
    };
    setLookSettings(next);
    refreshAudioSettingsUi();
    persistLookSettings(next);
  });
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!IS_TOUCH_DEVICE) return;
      if (event.pointerType && event.pointerType !== "touch") return;
      const button = buttonFromEventTarget(event.target);
      if (!button) return;
      lastTouchBlipButton = button;
      lastTouchBlipAt = performance.now();
      playUiBlipSfx?.();
    },
    { capture: true },
  );
  document.addEventListener("click", (event) => {
    const button = buttonFromEventTarget(event.target);
    if (!button) return;
    if (
      IS_TOUCH_DEVICE &&
      button === lastTouchBlipButton &&
      performance.now() - lastTouchBlipAt < 900
    ) {
      lastTouchBlipButton = null;
      return;
    }
    playUiBlipSfx?.();
  });

  window.addEventListener("keydown", (event) => {
    if (
      !IS_TOUCH_DEVICE &&
      state.getAppMode() === "playing" &&
      event.code === GAME_CHAT_OPEN_SHORTCUT &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat &&
      !isTextInputTarget(event.target) &&
      state.canOpenInGameChat()
    ) {
      event.preventDefault();
      setGameChatOpen(true);
      return;
    }
    if (
      state.getAppMode() === "playing" &&
      event.code === DEBUG_OVERLAY_TOGGLE_SHORTCUT &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat &&
      !isTextInputTarget(event.target)
    ) {
      event.preventDefault();
      toggleDebugOverlay?.();
      return;
    }
    if (state.getAppMode() === "lobby" && event.key === "Escape") {
      if (
        !state.getLobbyMenuOpen() &&
        lobbyDialogBackdropEl?.classList.contains("hidden")
      )
        return;
      event.preventDefault();
      if (state.getLobbyMenuOpen()) {
        setLobbyMenuOpen(false);
        return;
      }
      closeLobbyDialog();
      return;
    }
    if (state.getAppMode() === "playing" && event.key === "Escape") {
      if (state.getGameChatOpen()) {
        event.preventDefault();
        setGameChatOpen(false, { restorePointerLock: true });
        return;
      }
      const sessionState = state.getSessionState();
      if (sessionState !== "alive" && sessionState !== "spectating") return;
      if (
        lobbyDialogBackdropEl &&
        !lobbyDialogBackdropEl.classList.contains("hidden")
      ) {
        event.preventDefault();
        closeLobbyDialog();
        requestPointerLockSafe(canvas);
        return;
      }
      event.preventDefault();
      setGameMenuOpen(!state.getGameMenuOpen(), { restorePointerLock: true });
    }
  });
}

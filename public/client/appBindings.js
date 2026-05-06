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
  state
}) {
  const {
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
    musicVolumeInputEl,
    musicMuteBtnEl,
    sfxVolumeInputEl,
    sfxMuteBtnEl,
    mobileControlsModeBtnEl,
    countdownControlsTextEl
  } = elements;

  const {
    GAME_CREDITS_TEXT,
    MOBILE_CONTROLS_PREFS,
    GAME_CHAT_OPEN_SHORTCUT,
    IS_TOUCH_DEVICE
  } = constants;

  const {
    randomPrivateRoomCode,
    clampVolume,
    persistAudioSettings
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
    controlsTextForCurrentMode,
    updateMobileControlsVisibility,
    requestPointerLockSafe,
    updateReadyButton,
    resize,
    getActiveSocket
  } = actions;

  connectBtnEl?.addEventListener("click", connectAndLogin);
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
    if (sessionState === "alive" || sessionState === "downed" || sessionState === "won") return;
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
    if (state.getAppMode() !== "playing") return;
    const sessionState = state.getSessionState();
    if (sessionState !== "alive" && sessionState !== "spectating") return;
    setGameMenuOpen(!state.getGameMenuOpen());
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
    setGameChatOpen(!state.getGameChatOpen());
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
    setGameChatOpen(!state.getGameChatOpen());
  });
  gameMenuBackdropEl?.addEventListener("click", (event) => {
    if (event.target === gameMenuBackdropEl) setGameMenuOpen(false, { restorePointerLock: true });
  });
  lobbyDialogCloseBtnEl?.addEventListener("click", closeLobbyDialog);
  lobbyDialogBackdropEl?.addEventListener("click", (event) => {
    if (event.target === lobbyDialogBackdropEl) closeLobbyDialog();
  });
  musicVolumeInputEl?.addEventListener("input", () => {
    const audioSettings = state.getAudioSettings();
    audioSettings.musicVolume = clampVolume(musicVolumeInputEl.value);
    persistAudioSettings(audioSettings);
    refreshAudioSettingsUi();
  });
  musicMuteBtnEl?.addEventListener("click", () => {
    const audioSettings = state.getAudioSettings();
    audioSettings.musicMuted = !audioSettings.musicMuted;
    persistAudioSettings(audioSettings);
    refreshAudioSettingsUi();
  });
  sfxVolumeInputEl?.addEventListener("input", () => {
    const audioSettings = state.getAudioSettings();
    audioSettings.sfxVolume = clampVolume(sfxVolumeInputEl.value);
    persistAudioSettings(audioSettings);
    refreshAudioSettingsUi();
  });
  sfxMuteBtnEl?.addEventListener("click", () => {
    const audioSettings = state.getAudioSettings();
    audioSettings.sfxMuted = !audioSettings.sfxMuted;
    persistAudioSettings(audioSettings);
    refreshAudioSettingsUi();
  });
  mobileControlsModeBtnEl?.addEventListener("click", () => {
    const idx = MOBILE_CONTROLS_PREFS.indexOf(state.getMobileControlsPreference());
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
    if (state.getAppMode() === "lobby" && event.key === "Escape") {
      if (!state.getLobbyMenuOpen() && lobbyDialogBackdropEl?.classList.contains("hidden")) return;
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
      if (lobbyDialogBackdropEl && !lobbyDialogBackdropEl.classList.contains("hidden")) {
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

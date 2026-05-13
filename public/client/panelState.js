/**
 * Panel-toggle logic for game chat, game menu, lobby menu and lobby dialog.
 *
 * All functions are pure regarding DOM but need callbacks for side-effects
 * (pointer lock, overlay refreshes, etc.) passed via a `deps` object.
 *
 * createPanelState(elements, deps) → { setGameChatOpen, setGameMenuOpen,
 *   setLobbyMenuOpen, openLobbyDialog, closeLobbyDialog,
 *   updateGameChatAvailability, isGameChatFocused, canOpenInGameChat }
 */

/**
 * @param {object} elements  - DOM element references
 * @param {object} deps      - callbacks and state accessors
 * @returns {object}
 */
export function createPanelState(
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
    // () => string
    getAppMode,
    // () => string
    getSessionState,
    // (value: boolean) => void
    setGameChatOpen: _setGameChatOpenState,
    // (value: boolean) => void
    setGameMenuOpen: _setGameMenuOpenState,
    // (value: boolean) => void
    setLobbyMenuOpen: _setLobbyMenuOpenState,
    // chatUi instance
    chatUi,
    // number constant
    gameChatMaxLines,
    // boolean
    isTouchDevice,
    // () => void
    requestPointerLockSafe,
    // () => void
    resetInputState,
    // () => void
    sendInput,
    // () => void
    updateMobileControlsVisibility,
    // () => void
    updateDownedOverlay,
    // () => void
    updateSpectatorHud,
    // () => void
    updateScreenRootPointerEvents,
    // () => void
    refreshAudioSettingsUi,
  },
) {
  function maybeRestorePointerLock(restorePointerLock) {
    if (
      restorePointerLock &&
      getAppMode() === "playing" &&
      (getSessionState() === "alive" || getSessionState() === "won")
    ) {
      requestPointerLockSafe();
    }
  }

  function isGameChatFocused() {
    return document.activeElement === gameChatInputEl;
  }

  function canOpenInGameChat() {
    if (getAppMode() !== "playing") return false;
    const s = getSessionState();
    return s === "downed" || s === "spectating" || s === "won";
  }

  function updateGameChatAvailability() {
    const available = getAppMode() === "playing" && canOpenInGameChat();
    gameChatBoxEl?.classList.toggle("hidden", !available);
    gameChatNoticeEl?.classList.toggle("hidden", !available);
    if (available) {
      chatUi.setGameLineLimit(null);
      return;
    }
    _setGameChatOpenState(false);
    gameChatBoxEl?.classList.remove("open");
    gameChatInputRowEl?.classList.add("hidden");
    gameChatInputEl?.blur();
    chatUi.setGameLineLimit(gameChatMaxLines);
  }

  function setGameChatOpen(open, { restorePointerLock = false } = {}) {
    if (!gameChatInputRowEl || !gameChatBoxEl || !gameChatNoticeEl) return;
    updateGameChatAvailability();
    const canOpen = Boolean(open) && canOpenInGameChat();
    _setGameChatOpenState(canOpen);
    gameChatBoxEl.classList.toggle("open", canOpen);
    gameChatInputRowEl.classList.toggle("hidden", !canOpen);
    gameChatNoticeEl.textContent =
      canOpen || getSessionState() === "won" ? "Chatt" : "Systemhändelser";
    chatUi.setGameLineLimit(canOpen ? null : gameChatMaxLines);
    if (canOpen) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      gameChatInputEl?.focus();
    } else {
      gameChatInputEl?.blur();
    }
    if (!canOpenInGameChat()) _setGameChatOpenState(false);
    maybeRestorePointerLock(restorePointerLock);
    updateMobileControlsVisibility();
    updateDownedOverlay();
    updateSpectatorHud();
  }

  function setGameMenuOpen(open, { restorePointerLock = false } = {}) {
    if (!gameMenuBackdropEl) return;
    const isOpen = Boolean(open);
    _setGameMenuOpenState(isOpen);
    gameMenuBackdropEl.classList.toggle("hidden", !isOpen);
    if (isOpen) {
      resetInputState();
      sendInput();
      if (document.pointerLockElement) document.exitPointerLock?.();
      gameMenuSettingsBtnEl?.focus();
      updateMobileControlsVisibility();
      return;
    }
    maybeRestorePointerLock(restorePointerLock);
    updateMobileControlsVisibility();
  }

  function setLobbyMenuOpen(open) {
    if (!lobbyMenuBackdropEl) return;
    const isOpen = Boolean(open);
    _setLobbyMenuOpenState(isOpen);
    lobbyMenuBackdropEl.classList.toggle("hidden", !isOpen);
    if (isOpen) {
      lobbyMenuSettingsBtnEl?.focus();
    } else if (getAppMode() === "lobby") {
      lobbySettingsBtnEl?.focus();
    }
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
    if (showSettings && musicVolumeInputEl && !isTouchDevice) {
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
    maybeRestorePointerLock(true);
  }

  return {
    canOpenInGameChat,
    closeLobbyDialog,
    isGameChatFocused,
    openLobbyDialog,
    setGameChatOpen,
    setGameMenuOpen,
    setLobbyMenuOpen,
    updateGameChatAvailability,
  };
}

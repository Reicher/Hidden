/**
 * Central DOM element reference module.
 * All getElementById calls for the game UI are kept here so that app.js
 * does not open with ~90 lines of element queries.
 */

// ─── Core layout ──────────────────────────────────────────────────────────────
export const canvas                  = document.getElementById("game");
export const screenRootEl            = document.getElementById("screenRoot");

// ─── Connect screen ───────────────────────────────────────────────────────────
export const connectViewEl           = document.getElementById("connectView");
export const connectErrorEl          = document.getElementById("connectError");
export const roomInfoEl              = document.getElementById("roomInfo");
export const nameInputEl             = document.getElementById("nameInput");
export const connectBtnEl            = document.getElementById("connectBtn");
export const createPrivateRoomBtnEl  = document.getElementById("createPrivateRoomBtn");
export const newsCardEl              = document.getElementById("newsCard");
export const newsVersionEl           = document.getElementById("newsVersion");
export const newsPublishedAtEl       = document.getElementById("newsPublishedAt");
export const newsNotesEl             = document.getElementById("newsNotes");

// ─── Lobby screen ─────────────────────────────────────────────────────────────
export const lobbyViewEl             = document.getElementById("lobbyView");
export const scoreBodyEl             = document.getElementById("scoreBody");
export const chatMessagesEl          = document.getElementById("chatMessages");
export const chatInputEl             = document.getElementById("chatInput");
export const chatSendBtnEl           = document.getElementById("chatSendBtn");
export const playBtnEl               = document.getElementById("playBtn");
export const lobbyMatchStatusEl      = document.getElementById("lobbyMatchStatus");
export const lobbyMatchStatusTitleEl = document.getElementById("lobbyMatchStatusTitle");
export const lobbyStatusRowEl        = document.getElementById("lobbyStatusRow");
export const lobbyStatusTextEl       = document.getElementById("lobbyStatusText");
export const lobbyPlayersMetaEl      = document.getElementById("lobbyPlayersMeta");

// ─── Lobby menu / settings ────────────────────────────────────────────────────
export const lobbySettingsBtnEl      = document.getElementById("lobbySettingsBtn");
export const lobbyMenuBackdropEl     = document.getElementById("lobbyMenuBackdrop");
export const lobbyMenuSettingsBtnEl  = document.getElementById("lobbyMenuSettingsBtn");
export const lobbyMenuCreditsBtnEl   = document.getElementById("lobbyMenuCreditsBtn");
export const lobbyMenuCloseBtnEl     = document.getElementById("lobbyMenuCloseBtn");

// ─── Lobby dialog ─────────────────────────────────────────────────────────────
export const lobbyDialogBackdropEl   = document.getElementById("lobbyDialogBackdrop");
export const lobbyDialogTitleEl      = document.getElementById("lobbyDialogTitle");
export const lobbyDialogTextEl       = document.getElementById("lobbyDialogText");
export const lobbyDialogCloseBtnEl   = document.getElementById("lobbyDialogCloseBtn");
export const settingsPanelEl         = document.getElementById("settingsPanel");

// ─── Countdown overlay ────────────────────────────────────────────────────────
export const countdownOverlayEl          = document.getElementById("countdownOverlay");
export const countdownTextEl             = document.getElementById("countdownText");
export const countdownCharacterCanvasEl  = document.getElementById("countdownCharacterCanvas");
export const countdownControlsTextEl     = document.getElementById("countdownControlsText");

// ─── In-game HUD ──────────────────────────────────────────────────────────────
export const gameHudEl               = document.getElementById("gameHud");
export const crosshairHudEl          = document.getElementById("crosshairHud");
export const crosshairCooldownArcEl  = document.getElementById("crosshairCooldownArc");
export const aliveOthersTextEl       = document.getElementById("aliveOthersText");
export const debugOverlayEl          = document.getElementById("debugOverlay");
export const debugFpsTextEl          = document.getElementById("debugFpsText");
export const debugFrameTimeTextEl    = document.getElementById("debugFrameTimeText");
export const debugPingTextEl         = document.getElementById("debugPingText");
export const knockdownToastEl        = document.getElementById("knockdownToast");

// ─── Game menu ────────────────────────────────────────────────────────────────
export const gameMenuBtnEl           = document.getElementById("gameMenuBtn");
export const gameMenuBackdropEl      = document.getElementById("gameMenuBackdrop");
export const gameMenuSettingsBtnEl   = document.getElementById("gameMenuSettingsBtn");
export const gameMenuCreditsBtnEl    = document.getElementById("gameMenuCreditsBtn");
export const gameMenuCloseBtnEl      = document.getElementById("gameMenuCloseBtn");
export const gameMenuLobbyBtnEl      = document.getElementById("gameMenuLobbyBtn");

// ─── In-game chat ─────────────────────────────────────────────────────────────
export const gameChatNoticeEl        = document.getElementById("gameChatNotice");
export const gameChatBoxEl           = document.getElementById("gameChatBox");
export const gameChatMessagesEl      = document.getElementById("gameChatMessages");
export const gameChatInputRowEl      = document.getElementById("gameChatInputRow");
export const gameChatInputEl         = document.getElementById("gameChatInput");
export const gameChatSendBtnEl       = document.getElementById("gameChatSendBtn");

// ─── Settings panel ───────────────────────────────────────────────────────────
export const mobileControlsModeBtnEl = document.getElementById("mobileControlsModeBtn");
export const fullscreenModeCheckboxEl = document.getElementById("fullscreenModeCheckbox");
export const settingsFullscreenHelpEl = document.getElementById("settingsFullscreenHelp");
export const lookSensitivityInputEl  = document.getElementById("lookSensitivityInput");
export const lookSensitivityValueEl  = document.getElementById("lookSensitivityValue");
export const lookSmoothingToggleBtnEl = document.getElementById("lookSmoothingToggleBtn");
export const musicVolumeInputEl      = document.getElementById("musicVolumeInput");
export const musicMuteBtnEl          = document.getElementById("musicMuteBtn");
export const sfxVolumeInputEl        = document.getElementById("sfxVolumeInput");
export const sfxMuteBtnEl            = document.getElementById("sfxMuteBtn");

// ─── Mobile controls ──────────────────────────────────────────────────────────
export const mobileControlsEl        = document.getElementById("mobileControls");
export const mobileJoystickBaseEl    = document.getElementById("mobileJoystickBase");
export const mobileJoystickKnobEl    = document.getElementById("mobileJoystickKnob");
export const mobileLookPadEl         = document.getElementById("mobileLookPad");
export const mobileSprintBtnEl       = document.getElementById("mobileSprintBtn");
export const mobileAttackBtnEl       = document.getElementById("mobileAttackBtn");
export const mobileLandscapePromptEl = document.getElementById("mobileLandscapePrompt");

// ─── Downed overlay ───────────────────────────────────────────────────────────
export const downedOverlayEl         = document.getElementById("downedOverlay");
export const downedByTextEl          = document.getElementById("downedByText");
export const downedCountdownTextEl   = document.getElementById("downedCountdownText");
export const downedLobbyBtnEl        = document.getElementById("downedLobbyBtn");

// ─── Win overlay ──────────────────────────────────────────────────────────────
export const winOverlayEl            = document.getElementById("winOverlay");
export const winTitleEl              = document.getElementById("winTitle");
export const winCountdownTextEl      = document.getElementById("winCountdownText");
export const winLobbyBtnEl           = document.getElementById("winLobbyBtn");

// ─── Spectator HUD ────────────────────────────────────────────────────────────
export const spectatorHudEl          = document.getElementById("spectatorHud");
export const spectatorTargetTextEl   = document.getElementById("spectatorTargetText");
export const spectatorPrevBtnEl      = document.getElementById("spectatorPrevBtn");
export const spectatorNextBtnEl      = document.getElementById("spectatorNextBtn");
export const spectatorActionRowEl    = document.getElementById("spectatorActionRow");
export const spectatorLobbyBtnEl     = document.getElementById("spectatorLobbyBtn");

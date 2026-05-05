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

// ─── Lobby screen ─────────────────────────────────────────────────────────────
export const lobbyViewEl             = document.getElementById("lobbyView");
export const scoreBodyEl             = document.getElementById("scoreBody");
export const chatMessagesEl          = document.getElementById("chatMessages");
export const chatInputEl             = document.getElementById("chatInput");
export const chatSendBtnEl           = document.getElementById("chatSendBtn");
export const playBtnEl               = document.getElementById("playBtn");
export const lobbyMatchStatusEl      = document.getElementById("lobbyMatchStatus");
export const lobbyMatchStatusTitleEl = document.getElementById("lobbyMatchStatusTitle");

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
export const countdownCharacterMetaEl    = document.getElementById("countdownCharacterMeta");
export const countdownControlsTextEl     = document.getElementById("countdownControlsText");

// ─── In-game HUD ──────────────────────────────────────────────────────────────
export const gameHudEl               = document.getElementById("gameHud");
export const crosshairHudEl          = document.getElementById("crosshairHud");
export const crosshairCooldownArcEl  = document.getElementById("crosshairCooldownArc");
export const aliveOthersTextEl       = document.getElementById("aliveOthersText");
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

// ─── Settings panel ───────────────────────────────────────────────────────────
export const mobileControlsModeBtnEl = document.getElementById("mobileControlsModeBtn");
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

// ─── Downed overlay ───────────────────────────────────────────────────────────
export const downedOverlayEl         = document.getElementById("downedOverlay");
export const downedByTextEl          = document.getElementById("downedByText");
export const downedCountdownTextEl   = document.getElementById("downedCountdownText");
export const downedLobbyBtnEl        = document.getElementById("downedLobbyBtn");
export const downedChatBtnEl         = document.getElementById("downedChatBtn");
export const downedSpectateBtnEl     = document.getElementById("downedSpectateBtn");

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
export const spectatorLobbyBtnEl     = document.getElementById("spectatorLobbyBtn");
export const spectatorChatBtnEl      = document.getElementById("spectatorChatBtn");

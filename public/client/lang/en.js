/**
 * English – secondary language
 */
export default {
  // ── Connect screen ─────────────────────────────────────────────────────
  "connect.tagline": "Blend in. Find the players. Strike first.",
  "connect.namePlaceholder": "Your name",
  "connect.startFullscreen": "Start in fullscreen",
  "connect.connectBtn": "Connect",
  "connect.createPrivateRoom": "Create private room",

  // ── News card ──────────────────────────────────────────────────────────
  "news.versionDefault": "News version -",
  "news.version": "News version {v}",
  "news.loading": "Fetching latest version notes.",
  "news.noNotes": "No release notes found.",
  "news.unavailable": "No news available right now.",

  // ── Room info ──────────────────────────────────────────────────────────
  "room.public": "Public room",
  "room.private": "Private room: {code}",
  "room.capacity": "Max {max} players of {total} characters",

  // ── Lobby ──────────────────────────────────────────────────────────────

  "lobby.status.waiting": "Waiting for players",
  "lobby.status.starting": "Starting match",
  "lobby.status.inProgress": "Match in progress ({min} min)",
  "lobby.status.waitingReady": "Waiting for ready ({text})",
  "lobby.players": "{count}/{max} players",
  "lobby.ready.label": "Ready {count}/{total}",

  // ── Chat ───────────────────────────────────────────────────────────────
  "chat.placeholder": "Type in chat...",
  "chat.sendBtn": "Send",
  "chat.gamePlaceholder": "Type message...",
  "chat.gameBtn": "Chat",
  "chat.systemEvents": "System events",
  "chat.open": "Chat",

  // ── Menu ───────────────────────────────────────────────────────────────
  "menu.title": "Menu",
  "menu.settings": "Settings",
  "menu.about": "About",
  "menu.close": "Close",
  "menu.returnToLobby": "Return to lobby",
  "menu.gameMenuLabel": "Game menu",

  // ── Ready / play button ────────────────────────────────────────────────
  "ready.ready": "Ready",
  "ready.playing": "Playing",
  "ready.spectating": "Spectating",
  "ready.ending": "Ending match...",
  "ready.spectate": "Spectate",
  "ready.starting": "Match starting...",
  "ready.notReady": "Not ready",
  "ready.join": "Join",

  // ── Settings panel ─────────────────────────────────────────────────────
  "settings.mobileControls": "Mobile controls",
  "settings.fullscreen": "Fullscreen",
  "settings.fullscreenHelp.unsupported":
    "Fullscreen is not supported in this browser.",
  "settings.fullscreenHelp.unsupportedTouch":
    "Fullscreen not supported here (common on iPhone/iPad Safari).",
  "settings.fullscreenHelp.active":
    "Fullscreen is active. Uncheck the box to exit.",
  "settings.fullscreenHelp.inactive": "",
  "settings.trackpadHelp":
    "Trackpad: try higher sensitivity (160–220%) and disable smoothing.",
  "settings.sensitivity": "Look sensitivity",
  "settings.lookSmoothing": "Look smoothing",
  "settings.on": "On",
  "settings.off": "Off",
  "settings.musicVolume": "Music volume",
  "settings.sfxVolume": "Sound volume",
  "settings.mute": "Mute",
  "settings.unmute": "Unmute",
  "settings.audioSaved": "Settings are saved locally",
  "settings.language": "Language",
  "settings.mobileControlsAuto": "Auto",

  // ── Countdown overlay ──────────────────────────────────────────────────
  "countdown.heading": "Match starts in",
  "countdown.tagline": "Take down opponents – last player wins.",
  "countdown.characterLabel": "Your character",
  "countdown.characterCanvasLabel": "Character preview",
  "countdown.joinBtn": "Join the match",
  "countdown.controlsTitle": "Controls",
  "countdown.ctrl.movement": "Movement",
  "countdown.ctrl.sprint": "Sprint",
  "countdown.ctrl.attack": "Left click<br>Attack",
  "countdown.ctrl.look": "Drag<br>Look around",
  "countdown.ctrl.mobileHint":
    "Use the on-screen controls to move, look around and attack.",

  // ── HUD ────────────────────────────────────────────────────────────────
  "hud.playersInMatch": "{count} {noun} in match",
  "hud.playerNoun": "players",
  "hud.spectatorCount": "{count} spectating",
  "hud.spectating": "Spectating {name}",
  "hud.spectatingNone": "Spectating no one",
  "hud.spectatorPrev": "Previous player",
  "hud.spectatorNext": "Next player",
  "hud.downedBy": "You were taken down by {name}",
  "hud.unknownPlayer": "unknown player",
  "hud.returningToLobby": "Returning to lobby in {sec} seconds",
  "hud.winTitle": "You won!",
  "hud.matchEnding": "Match ending",
  "hud.knockdown": "You took down {name}",

  // ── Mobile controls ────────────────────────────────────────────────────
  "mobile.sprint": "Sprint",
  "mobile.attack": "Attack",
  "mobile.lookPad": "Drag here to look",
  "mobile.landscape": "Rotate your phone to landscape to play.",

  // ── Scoreboard headers ─────────────────────────────────────────────────
  "score.name": "Name",
  "score.wins": "Wins",
  "score.knockdowns": "Knockdowns",
  "score.streak": "Streak",
  "score.downed": "Downed",
  "score.innocents": "Innocents",
  "score.status": "Status",
  "score.wins.short": "W",
  "score.knockdowns.short": "K",
  "score.streak.short": "S",
  "score.downed.short": "D",
  "score.innocents.short": "I",
  "score.status.short": "St",

  // ── Scoreboard status labels ───────────────────────────────────────────
  "score.statusLobby": "Lobby",
  "score.statusSpectating": "Spec",
  "score.statusPlaying": "Game",

  // ── System chat messages ───────────────────────────────────────────────
  "chat.sys.joined": " joined the game",
  "chat.sys.left": " left the game",
  "chat.sys.leftMatch": " left the match",
  "chat.sys.reconnected": " reconnected to the ongoing round",
  "chat.sys.countdownStarted": "Countdown started",
  "chat.sys.countdownCancelled": "Countdown cancelled",
  "chat.sys.matchStarted": "Match started",
  "chat.sys.matchEnded": "Match ended",
  "chat.sys.won": " won the match!",
  "chat.sys.matchEnding": "Game ends in {sec} seconds",
  "chat.sys.knockedDown": " knocked down ",
  "chat.sys.supermajority":
    "2/3 players ready. Match starts in {sec} seconds unless everyone readies up sooner.",

  // ── About / credits ────────────────────────────────────────────────────
  "about.credits":
    'Created by Robin Reicher.\nMusic by Adam von Friesendorff.\nInspired by Adam Spragg\'s game "Hidden in Plain Sight".',

  // ── Gameplay summary (used in controls card) ───────────────────────────
  "gameplay.summary": "Stay hidden, find players and take them down.",
  "gameplay.desktopControls":
    "Desktop: WASD movement, Shift sprint, mouse to look around, left click attack.",
  "gameplay.mobileControls":
    "Mobile: joystick bottom-left for movement, Attack/Sprint in middle, drag right area to look.",
};

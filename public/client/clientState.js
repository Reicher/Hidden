export const DEFAULT_MATCH_STATE = Object.freeze({
  inProgress: false,
  alivePlayers: 0,
  startedAt: null,
  elapsedMs: 0,
});

export function createClientState() {
  const state = {
    authenticated: false,
    appMode: "connect",
    sessionState: "auth",
    myCharacterId: null,
    myName: "",
    sessionReady: false,
    activePlayersInGame: 0,
    spectatorCount: 0,
    attackCooldownMsRemaining: 0,
    attackCooldownVisualMaxMs: 1000,
    gameChatOpen: false,
    gameMenuOpen: false,
    lobbyMenuOpen: false,
    forceYawSyncOnNextWorld: false,
    currentMatch: { ...DEFAULT_MATCH_STATE },
    lobbyScoreboard: [],
    lobbyCountdownMsRemaining: 0,
    lobbyMinPlayersToStart: 2,
    lobbyMaxPlayers: 0,
    winReturnToLobbyMsRemaining: 0,
    winMessageHideAtMs: 0,
    downedByName: "",
    downedMessageHideAtMs: 0,
    downedMessageSuppressed: false,
    knockdownToastText: "",
    knockdownToastMsRemaining: 0,
    pendingLoginName: "",
    spectatorTargetCharacterId: null,
    spectatorTargetName: "",
    spectatorCandidates: [],
    viewPitch: 0,
    viewYaw: 0,
  };

  return { state };
}

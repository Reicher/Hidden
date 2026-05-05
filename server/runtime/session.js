/**
 * Create the initial session object for a newly connected WebSocket client.
 *
 * @param {string} sessionId - UUID for this session
 * @param {number} now       - current timestamp (ms), used to seed net timers
 * @returns {object} mutable session state
 */
export function createSession(sessionId, now) {
  return {
    id: sessionId,
    authenticated: false,
    name: null,
    state: "auth",
    ready: false,
    readyAt: 0,
    characterId: null,
    spectatingCharacterId: null,
    spectatingSessionId: null,
    eliminatedAt: 0,
    returnToLobbyAt: 0,
    eliminatedByName: null,
    stats: {
      wins: 0,
      knockdowns: 0,
      downed: 0,
      innocents: 0,
      streak: 0
    },
    input: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      yaw: 0,
      pitch: 0,
      attackRequested: false
    },
    net: {
      lastInputAt: 0,
      lastAttackRequestAt: 0,
      lastActivityAt: now,
      windowStartAt: now,
      windowCount: 0,
      droppedMessages: 0,
      lastDropReason: null,
      dropWindowStartAt: now,
      dropWindowCount: 0
    }
  };
}

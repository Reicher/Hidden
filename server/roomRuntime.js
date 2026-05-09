import { randomUUID } from "node:crypto";
import {
  WORLD_SIZE_METERS,
  WORLD_WIDTH_METERS,
  WORLD_HEIGHT_METERS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  NPC_DOWNED_RESPAWN_MS,
  TOTAL_CHARACTERS,
  TICK_MS,
  MOVE_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  TURN_SPEED,
  AI_DECISION_MS_MIN,
  AI_DECISION_MS_MAX,
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  ATTACK_HALF_ANGLE,
  ATTACK_FLASH_MS,
  CHARACTER_RADIUS,
  NPC_INSPECT_DOWNED_CHANCE,
  NPC_INSPECT_DOWNED_RADIUS_METERS,
  NPC_SOCIAL_SEPARATION_WEIGHT,
  NPC_STOP_CHANCE,
  NPC_MOVE_DECISION_INTERVAL_MIN_MS,
  NPC_MOVE_DECISION_INTERVAL_MAX_MS,
  NPC_STOP_DURATION_MIN_MS,
  NPC_STOP_DURATION_MAX_MS,
  HEARTBEAT_INTERVAL_MS,
  IDLE_SESSION_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  INPUT_UPDATE_MIN_MS,
  ATTACK_MESSAGE_MIN_MS,
  MESSAGE_WINDOW_MS,
  MAX_MESSAGES_PER_WINDOW,
  SPAM_DROP_WINDOW_MS,
  SPAM_MAX_DROPS_PER_WINDOW,
  ALLOWED_ORIGINS,
  ALLOW_MISSING_ORIGIN,
  INVARIANT_LOG_COOLDOWN_MS,
  SHELVES,
  COOLERS,
  FREEZERS
} from "./config.js";
import { normalizeAngle, canAttack, markAttack, collectVictimIds } from "./runtime/combat.js";
import { createMovementSystem } from "./runtime/ai.js";
import { createSpectatorSystem } from "./runtime/spectator.js";
import { createRoomLogger, createInvariantChecker } from "./runtime/logger.js";
import { createCharacterSystem } from "./runtime/characters.js";
import { createClientMessageProcessor } from "./runtime/clientMessages.js";
import { createRoomTickLoop } from "./runtime/tickLoop.js";
import { createRoomWsLifecycle } from "./runtime/wsLifecycle.js";
import { createMatchFlow } from "./runtime/matchFlow.js";

const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 20;
const CHAT_MAX_LEN = 220;
const CHAT_HISTORY_LIMIT = 80;
const ROUND_COUNTDOWN_SECONDS = 10;
const SUPERMAJORITY_READY_TIMEOUT_SECONDS = 30;
const SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS = 10;
const MAX_LOOK_PITCH_RAD = 1.2;
const MATCH_END_RETURN_TO_LOBBY_MS = 10000;
const COUNTDOWN_RECONNECT_GRACE_MS = 7000;

export function createRoomRuntime({ roomId, roomCode, isPrivate, onRoomEmpty = null, onStatsEvent = null }) {
  const sessions = new Map();
  const sockets = new Map();
  const chatHistory = [];
  let lobbyCountdown = null;
  let supermajorityReadyTimeout = null;
  let pendingRoundReset = false;
  const countdownReadyNames = new Set();
  const countdownReconnectGraceByName = new Map();
  let activeMatchStartedAt = 0;
  const roomTag = isPrivate ? `privat:${roomCode}` : "publik";
  let closed = false;
  const perfStartedAt = Date.now();
  const TICK_DURATION_HISTORY_LIMIT = 1200;
  const tickDurationHistoryMs = [];
  const perfStats = {
    tick: {
      totalTicks: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      overBudgetTicks: 0
    },
    network: {
      inMessages: 0,
      inBytes: 0,
      outMessages: 0,
      outBytes: 0
    }
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  const charSystem = createCharacterSystem({
    totalCharacters: TOTAL_CHARACTERS,
    worldWidthMeters: WORLD_WIDTH_METERS,
    worldHeightMeters: WORLD_HEIGHT_METERS,
    obstacles: [...SHELVES, ...COOLERS, ...FREEZERS],
    characterRadius: CHARACTER_RADIUS,
    aiDecisionMsMin: AI_DECISION_MS_MIN,
    aiDecisionMsMax: AI_DECISION_MS_MAX,
    npcDownedRespawnMs: NPC_DOWNED_RESPAWN_MS,
    permanentDownedUntil: Number.MAX_SAFE_INTEGER,
    maxLookPitchRad: MAX_LOOK_PITCH_RAD,
    getActiveMatchStartedAt: () => activeMatchStartedAt,
    rand
  });
  const characters = charSystem.characters;
  const {
    clampPitch,
    isCharacterDowned,
    clearDownedState,
    computeFallAwayVector,
    downCharacter,
    releaseOwnedCharacter,
    resetArenaForNextRound
  } = charSystem;

  function shortSessionId(sessionId) {
    return sessionId ? String(sessionId).slice(0, 8) : "-";
  }

  function sortedNumeric(values) {
    return values.slice().sort((a, b) => a - b);
  }

  function percentile(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = sortedNumeric(values);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * (sorted.length - 1))));
    return sorted[index];
  }

  function avg(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function recordInboundBytes(bytes) {
    const value = Number(bytes);
    perfStats.network.inMessages += 1;
    perfStats.network.inBytes += Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }

  function recordOutboundBytes(bytes) {
    const value = Number(bytes);
    perfStats.network.outMessages += 1;
    perfStats.network.outBytes += Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }

  function recordTickDuration(durationMs) {
    const duration = Math.max(0, Number(durationMs) || 0);
    perfStats.tick.totalTicks += 1;
    perfStats.tick.totalDurationMs += duration;
    perfStats.tick.maxDurationMs = Math.max(perfStats.tick.maxDurationMs, duration);
    if (duration > TICK_MS) perfStats.tick.overBudgetTicks += 1;
    tickDurationHistoryMs.push(duration);
    if (tickDurationHistoryMs.length > TICK_DURATION_HISTORY_LIMIT) {
      tickDurationHistoryMs.splice(0, tickDurationHistoryMs.length - TICK_DURATION_HISTORY_LIMIT);
    }
  }

  function perfSnapshot() {
    const now = Date.now();
    const elapsedSec = Math.max(0.001, (now - perfStartedAt) / 1000);
    const tickSamples = tickDurationHistoryMs.slice();
    const tickTotal = perfStats.tick.totalTicks;
    const avgTickMs = tickTotal > 0 ? perfStats.tick.totalDurationMs / tickTotal : 0;
    const overBudgetRatio = tickTotal > 0 ? perfStats.tick.overBudgetTicks / tickTotal : 0;

    return {
      collectedAt: now,
      runtimeSec: round(elapsedSec, 2),
      network: {
        inMessages: perfStats.network.inMessages,
        outMessages: perfStats.network.outMessages,
        inBytes: perfStats.network.inBytes,
        outBytes: perfStats.network.outBytes,
        inBytesPerSec: round(perfStats.network.inBytes / elapsedSec, 2),
        outBytesPerSec: round(perfStats.network.outBytes / elapsedSec, 2),
        inMessagesPerSec: round(perfStats.network.inMessages / elapsedSec, 2),
        outMessagesPerSec: round(perfStats.network.outMessages / elapsedSec, 2)
      },
      tick: {
        totalTicks: tickTotal,
        avgDurationMs: round(avgTickMs, 3),
        maxDurationMs: round(perfStats.tick.maxDurationMs, 3),
        overBudgetTicks: perfStats.tick.overBudgetTicks,
        overBudgetRatio: round(overBudgetRatio, 4),
        windowSamples: tickSamples.length,
        windowAvgMs: round(avg(tickSamples), 3),
        p50Ms: round(percentile(tickSamples, 0.5), 3),
        p95Ms: round(percentile(tickSamples, 0.95), 3),
        p99Ms: round(percentile(tickSamples, 0.99), 3)
      }
    };
  }

  function authenticatedSessions() {
    return [...sessions.values()].filter((s) => s.authenticated);
  }

  function authenticatedCount() {
    let count = 0;
    for (const s of sessions.values()) if (s.authenticated) count += 1;
    return count;
  }

  function activePlayerCount() {
    let count = 0;
    for (const s of sessions.values()) {
      if (!s.authenticated) continue;
      if (s.state === "alive" && s.characterId != null) count += 1;
    }
    return count;
  }

  function countdownPlayerCount() {
    let count = 0;
    for (const s of sessions.values()) {
      if (!s.authenticated) continue;
      if (s.state === "countdown") count += 1;
    }
    return count;
  }

  function stateSummary() {
    return `anslutna=${sockets.size} spelar=${activePlayerCount()} nedrakning=${countdownPlayerCount()}`;
  }

  function debugStateSnapshot() {
    const connected = sockets.size;
    const authenticated = authenticatedCount();
    const active = activePlayerCount();
    const countdown = countdownPlayerCount();
    return {
      connected,
      authenticated,
      active,
      countdown,
      lobby: Math.max(0, authenticated - active - countdown)
    };
  }

  function emitStatsEvent(type, details = {}) {
    if (typeof onStatsEvent !== "function") return;
    try {
      onStatsEvent({
        type,
        roomId,
        roomCode: roomCode || null,
        isPrivate,
        at: Date.now(),
        ...details,
        snapshot: debugStateSnapshot()
      });
    } catch {
      // keep game runtime independent from debug tracking errors.
    }
  }

  const { logWarn, logEvent } = createRoomLogger(roomTag, stateSummary);
  const { checkInvariants } = createInvariantChecker({
    characters,
    sessions,
    getActivePlayerCount: activePlayerCount,
    logWarn,
    totalCharacters: TOTAL_CHARACTERS,
    maxPlayers: MAX_PLAYERS,
    cooldownMs: INVARIANT_LOG_COOLDOWN_MS
  });

  function normalizePlayerName(raw) {
    const trimmed = String(raw || "").trim().replace(/\s+/g, " ");
    return trimmed.slice(0, NAME_MAX_LEN);
  }

  function normalizeNameKey(name) {
    const trimmed = String(name || "").trim();
    return trimmed ? trimmed.toLowerCase() : "";
  }

  function markCountdownReconnectGrace(name, now = Date.now()) {
    const key = normalizeNameKey(name);
    if (!key) return;
    countdownReconnectGraceByName.set(key, now + COUNTDOWN_RECONNECT_GRACE_MS);
  }

  function pruneCountdownReconnectGrace(now = Date.now()) {
    for (const [key, until] of countdownReconnectGraceByName.entries()) {
      if (now >= until) countdownReconnectGraceByName.delete(key);
    }
  }

  function hasCountdownReconnectGrace(name, now = Date.now()) {
    const key = normalizeNameKey(name);
    if (!key) return false;
    pruneCountdownReconnectGrace(now);
    const until = countdownReconnectGraceByName.get(key);
    return Number.isFinite(until) && now < until;
  }

function normalizeChatText(raw) {
  const trimmed = String(raw || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return trimmed.slice(0, CHAT_MAX_LEN);
}

function sanitizeSystemTextSegment(raw) {
  return String(raw || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, CHAT_MAX_LEN);
}

  function findAuthenticatedByName(name) {
    const key = name.toLowerCase();
    for (const s of sessions.values()) {
      if (!s.authenticated || !s.name) continue;
      if (s.name.toLowerCase() === key) return s;
    }
    return null;
  }

  function compareScoreboardEntries(a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.knockdowns !== a.knockdowns) return b.knockdowns - a.knockdowns;
    if (b.streak !== a.streak) return b.streak - a.streak;
    if (a.downed !== b.downed) return a.downed - b.downed;
    return a.name.localeCompare(b.name, "sv");
  }

  function compareSessionsForScoreboard(a, b) {
    return compareScoreboardEntries(
      {
        name: a.name,
        wins: a.stats.wins,
        knockdowns: a.stats.knockdowns,
        streak: a.stats.streak,
        downed: a.stats.downed
      },
      {
        name: b.name,
        wins: b.stats.wins,
        knockdowns: b.stats.knockdowns,
        streak: b.stats.streak,
        downed: b.stats.downed
      }
    );
  }

  function sortedAuthenticatedSessionsForScoreboard() {
    return authenticatedSessions().sort(compareSessionsForScoreboard);
  }

  function statusLabel(session) {
    if (!session?.authenticated) return "disconnected";
    if (session.state === "lobby" || session.state === "countdown") return "i lobby";
    if (session.state === "spectating") return "åskådar";
    if (session.state === "alive" || session.state === "won" || session.state === "downed") return "i spel";
    return "disconnected";
  }

  const spectator = createSpectatorSystem({
    sessions,
    characters,
    isCharacterDowned,
    getSortedActiveSessions: sortedAuthenticatedSessionsForScoreboard,
    releaseOwnedCharacter,
    getActiveMatchStartedAt: () => activeMatchStartedAt
  });
  const {
    aliveSpectatorCandidates,
    clearSpectatorTarget,
    setSessionSpectating,
    cycleSpectatorTarget,
    maintainSpectatorTarget
  } = spectator;

  function scoreboardSnapshot() {
    return sortedAuthenticatedSessionsForScoreboard()
      .map((s) => ({
        name: s.name,
        wins: s.stats.wins,
        knockdowns: s.stats.knockdowns,
        downed: s.stats.downed,
        streak: s.stats.streak,
        innocents: s.stats.innocents,
        status: statusLabel(s),
        ready: Boolean(s.ready || s.state === "countdown")
      }))
      .sort((a, b) => compareScoreboardEntries(a, b));
  }

  function send(ws, type, payload = {}) {
    if (ws.readyState !== ws.OPEN) return;
    const body = JSON.stringify({ type, ...payload });
    ws.send(body);
    recordOutboundBytes(Buffer.byteLength(body, "utf8"));
  }

  function sendToSession(sessionId, type, payload = {}) {
    const ws = sockets.get(sessionId);
    if (!ws) return;
    send(ws, type, payload);
  }

  function broadcast(type, payload = {}) {
    for (const ws of sockets.values()) send(ws, type, payload);
  }

  function appendChat({ name, text, system = false, segments = null }) {
    const entry = {
      id: randomUUID(),
      at: Date.now(),
      name,
      text,
      system: Boolean(system),
      segments: Array.isArray(segments) ? segments : null
    };
    chatHistory.push(entry);
    if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
    return entry;
  }

  function appendSystemChat(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    const normalized = [];
    let plainText = "";
    for (const seg of segments) {
      if (seg?.type === "player") {
        const playerName = normalizePlayerName(seg.name);
        if (!playerName) continue;
        normalized.push({ type: "player", name: playerName });
        plainText += playerName;
        continue;
      }
      const text = sanitizeSystemTextSegment(seg?.text || "");
      if (!text) continue;
      normalized.push({ type: "text", text });
      plainText += text;
    }
    if (normalized.length === 0 || !plainText) return null;
    const entry = appendChat({ name: "System", text: plainText, system: true, segments: normalized });
    broadcast("chat", { entry });
    return entry;
  }

  const {
    countdownMsRemaining,
    toCountdownState,
    cancelLobbyCountdown,
    maybeStartLobbyCountdown,
    finalizeLobbyCountdown,
    endCurrentMatch,
    assignCharacterForCountdown,
    returnToLobby
  } = createMatchFlow({
    sessions,
    characters,
    constants: {
      ROUND_COUNTDOWN_SECONDS,
      SUPERMAJORITY_READY_TIMEOUT_SECONDS,
      SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS,
      MATCH_END_RETURN_TO_LOBBY_MS,
      MIN_PLAYERS_TO_START
    },
    state: {
      getLobbyCountdown: () => lobbyCountdown,
      setLobbyCountdown: (value) => {
        lobbyCountdown = value;
      },
      getSupermajorityReadyTimeout: () => supermajorityReadyTimeout,
      setSupermajorityReadyTimeout: (value) => {
        supermajorityReadyTimeout = value;
      },
      getPendingRoundReset: () => pendingRoundReset,
      setPendingRoundReset: (value) => {
        pendingRoundReset = Boolean(value);
      },
      getActiveMatchStartedAt: () => activeMatchStartedAt,
      setActiveMatchStartedAt: (value) => {
        activeMatchStartedAt = Number(value) || 0;
      }
    },
    countdownReadyNames,
    countdownReconnectGraceByName,
    authenticatedSessions,
    activePlayerCount,
    countdownPlayerCount,
    normalizePlayerName,
    shortSessionId,
    sendToSession,
    appendSystemChat,
    logEvent,
    emitStatsEvent,
    pruneCountdownReconnectGrace,
    markCountdownReconnectGrace,
    hasCountdownReconnectGrace,
    releaseOwnedCharacter,
    clearSpectatorTarget,
    isCharacterDowned,
    clearDownedState,
    resetArenaForNextRound
  });

  function handleCharacterEliminated(charId, attackerId, now) {
    const c = characters[charId];
    const attacker = attackerId != null ? characters[attackerId] : null;
    const attackerSession =
      attacker?.ownerSessionId != null ? sessions.get(attacker.ownerSessionId) : null;
    const fallAway = computeFallAwayVector(attacker, c);
    const owner = c.ownerSessionId;

    if (owner) {
      const ownerSession = sessions.get(owner);
      if (ownerSession) {
        ownerSession.stats.downed += 1;
        ownerSession.stats.streak = 0;
        logEvent("player_eliminated", {
          sessionId: shortSessionId(owner),
          name: ownerSession.name,
          characterId: charId
        });
        ownerSession.state = "downed";
        ownerSession.ready = false;
        ownerSession.readyAt = 0;
        ownerSession.characterId = charId;
        ownerSession.input.attackRequested = false;
        ownerSession.eliminatedAt = now;
        ownerSession.returnToLobbyAt = 0;
        ownerSession.eliminatedByName = attackerSession?.name || null;
      }
    }
    c.controllerType = "AI";
    c.ownerSessionId = null;
    downCharacter(c, now, fallAway.x, fallAway.z);
  }

  function handleAttack(attackerId, now) {
    const attacker = characters[attackerId];
    if (!attacker) return;
    if (isCharacterDowned(attacker, now)) return;
    if (!canAttack({ attacker, now, cooldownMs: ATTACK_COOLDOWN_MS })) return;
    markAttack(attacker, now);

    const victims = collectVictimIds({
      characters,
      attackerId,
      attackRange: ATTACK_RANGE,
      attackHalfAngle: ATTACK_HALF_ANGLE
    }).filter((victimId) => !isCharacterDowned(characters[victimId], now));

    const attackerSessionId = attacker.ownerSessionId;
    const attackerSession = attackerSessionId ? sessions.get(attackerSessionId) : null;

    for (const victimId of victims) {
      const victimOwner = characters[victimId].ownerSessionId;
      const victimSession = victimOwner ? sessions.get(victimOwner) : null;
      if (attackerSession?.authenticated) {
        if (victimOwner && victimOwner !== attackerSessionId) {
          attackerSession.stats.knockdowns += 1;
          attackerSession.stats.streak += 1;
          if (victimSession?.authenticated && victimSession.name) {
            sendToSession(attackerSessionId, "knockdown_confirm", { victimName: victimSession.name });
            appendSystemChat([
              { type: "player", name: attackerSession.name },
              { type: "text", text: " slog ner " },
              { type: "player", name: victimSession.name }
            ]);
          }
        } else if (!victimOwner) {
          attackerSession.stats.innocents += 1;
        }
      }
      handleCharacterEliminated(victimId, attackerId, now);
    }

    logEvent("attack", {
      sessionId: shortSessionId(attackerSessionId),
      attackerCharacterId: attackerId,
      victims: victims.length,
      victimCharacterIds: victims
    });
  }

  const ROOM_BOUNDARY_MIN_X = -WORLD_WIDTH_METERS * 0.5;
  const ROOM_BOUNDARY_MAX_X = WORLD_WIDTH_METERS * 0.5;
  const ROOM_BOUNDARY_MIN_Z = -WORLD_HEIGHT_METERS * 0.5;
  const ROOM_BOUNDARY_MAX_Z = WORLD_HEIGHT_METERS * 0.5;
  const WALL_AVOIDANCE_MARGIN = 1.5;
  const SHELF_AVOIDANCE_MARGIN = 1.1;
  const STATIC_OBSTACLES = [...SHELVES, ...COOLERS, ...FREEZERS];

  const roomBoundaries = {
    minX: ROOM_BOUNDARY_MIN_X,
    maxX: ROOM_BOUNDARY_MAX_X,
    minZ: ROOM_BOUNDARY_MIN_Z,
    maxZ: ROOM_BOUNDARY_MAX_Z
  };
  const movement = createMovementSystem({
    boundaries: roomBoundaries,
    obstacles: STATIC_OBSTACLES,
    wallMargin: WALL_AVOIDANCE_MARGIN,
    shelfMargin: SHELF_AVOIDANCE_MARGIN,
    characterRadius: CHARACTER_RADIUS,
    aiDecisionMsMin: AI_DECISION_MS_MIN,
    aiDecisionMsMax: AI_DECISION_MS_MAX,
    moveSpeed: MOVE_SPEED,
    sprintMultiplier: PLAYER_SPRINT_MULTIPLIER,
    turnSpeed: TURN_SPEED,
    inspectDownedChance: NPC_INSPECT_DOWNED_CHANCE,
    inspectDownedNearbyRadius: NPC_INSPECT_DOWNED_RADIUS_METERS,
    socialSeparationWeight: NPC_SOCIAL_SEPARATION_WEIGHT,
    stopChance: NPC_STOP_CHANCE,
    moveDecisionIntervalMinMs: NPC_MOVE_DECISION_INTERVAL_MIN_MS,
    moveDecisionIntervalMaxMs: NPC_MOVE_DECISION_INTERVAL_MAX_MS,
    stopDurationMinMs: NPC_STOP_DURATION_MIN_MS,
    stopDurationMaxMs: NPC_STOP_DURATION_MAX_MS,
    rand,
    clampPitch
  });

  function isOriginAllowed(origin) {
    if (!origin || String(origin).trim() === "") return ALLOW_MISSING_ORIGIN;
    return ALLOWED_ORIGINS.has(String(origin).trim());
  }

  const { processClientMessage } = createClientMessageProcessor({
    sessions,
    roomCode,
    isPrivate,
    constants: {
      NAME_MIN_LEN,
      MAX_PLAYERS,
      MAX_MESSAGE_BYTES,
      INPUT_UPDATE_MIN_MS,
      ATTACK_MESSAGE_MIN_MS,
      MESSAGE_WINDOW_MS,
      MAX_MESSAGES_PER_WINDOW,
      SPAM_DROP_WINDOW_MS,
      SPAM_MAX_DROPS_PER_WINDOW,
      chatHistory,
      appendChat,
      broadcast
    },
    normalizePlayerName,
    normalizeChatText,
    authenticatedCount,
    activePlayerCount,
    findAuthenticatedByName,
    pruneCountdownReconnectGrace,
    hasCountdownReconnectGrace,
    countdownReadyNames,
    countdownReconnectGraceByName,
    getLobbyCountdown: () => lobbyCountdown,
    getPendingRoundReset: () => pendingRoundReset,
    getActiveMatchStartedAt: () => activeMatchStartedAt,
    assignCharacterForCountdown,
    clearSpectatorTarget,
    toCountdownState,
    maybeStartLobbyCountdown,
    setSessionSpectating,
    cycleSpectatorTarget,
    returnToLobby,
    releaseOwnedCharacter,
    sendToSession,
    appendSystemChat,
    shortSessionId,
    emitStatsEvent,
    logEvent,
    clampPitch,
    normalizeAngle
  });

  function disconnectIdleSessions(now) {
    for (const [sessionId, session] of sessions.entries()) {
      const ws = sockets.get(sessionId);
      if (!ws) continue;
      const idleForMs = now - session.net.lastActivityAt;
      if (idleForMs < IDLE_SESSION_TIMEOUT_MS) continue;
      logWarn(
        "anslutning",
        `idle-timeout sid=${shortSessionId(sessionId)} idleMs=${idleForMs}`
      );
      try {
        ws.close(1001, "idle timeout");
      } catch {
        ws.terminate();
      }
    }
  }

  const { tickInterval } = createRoomTickLoop({
    constants: {
      TICK_MS,
      WORLD_SIZE_METERS,
      WORLD_WIDTH_METERS,
      WORLD_HEIGHT_METERS,
      SHELVES,
      COOLERS,
      FREEZERS,
      ATTACK_COOLDOWN_MS,
      ATTACK_FLASH_MS,
      NPC_DOWNED_RESPAWN_MS,
      MIN_PLAYERS_TO_START,
      MAX_PLAYERS
    },
    sessions,
    sockets,
    characters,
    movement,
    checkInvariants,
    pruneCountdownReconnectGrace,
    disconnectIdleSessions,
    releaseOwnedCharacter,
    returnToLobby,
    appendSystemChat,
    authenticatedSessions,
    resetArenaForNextRound,
    getPendingRoundReset: () => pendingRoundReset,
    setPendingRoundReset: (value) => {
      pendingRoundReset = Boolean(value);
    },
    getLobbyCountdown: () => lobbyCountdown,
    countdownPlayerCount,
    cancelLobbyCountdown,
    finalizeLobbyCountdown,
    maybeStartLobbyCountdown,
    isCharacterDowned,
    handleAttack,
    activePlayerCount,
    endCurrentMatch,
    getActiveMatchStartedAt: () => activeMatchStartedAt,
    setActiveMatchStartedAt: (value) => {
      activeMatchStartedAt = Number(value) || 0;
    },
    maintainSpectatorTarget,
    aliveSpectatorCandidates,
    scoreboardSnapshot,
    countdownMsRemaining,
    send,
    onTick: ({ durationMs }) => {
      recordTickDuration(durationMs);
    }
  });

  const { wss, heartbeatInterval } = createRoomWsLifecycle({
    roomMeta: {
      roomId,
      roomCode,
      isPrivate
    },
    constants: {
      HEARTBEAT_INTERVAL_MS,
      MIN_PLAYERS_TO_START,
      MAX_PLAYERS
    },
    sessions,
    sockets,
    processClientMessage,
    getLobbyCountdown: () => lobbyCountdown,
    countdownReadyNames,
    markCountdownReconnectGrace,
    appendSystemChat,
    releaseOwnedCharacter,
    countdownPlayerCount,
    cancelLobbyCountdown,
    maybeStartLobbyCountdown,
    send,
    shortSessionId,
    logEvent,
    logWarn,
    emitStatsEvent,
    onInboundMessage: ({ bytes }) => {
      recordInboundBytes(bytes);
    },
    onRoomEmpty
  });

  tickInterval.unref?.();
  heartbeatInterval.unref?.();

  logEvent("runtime_started", {
    worldSizeMeters: WORLD_SIZE_METERS,
    worldWidthMeters: WORLD_WIDTH_METERS,
    worldHeightMeters: WORLD_HEIGHT_METERS,
    maxPlayers: MAX_PLAYERS,
    totalCharacters: TOTAL_CHARACTERS
  });
  emitStatsEvent("runtime_started");

  function handleUpgrade(req, socket, head) {
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      logWarn("ws-origin", `blocked origin=${origin || "<missing>"}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(tickInterval);
    clearInterval(heartbeatInterval);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, "room closed");
      } catch {
        ws.terminate();
      }
    }
    sessions.clear();
    sockets.clear();
    wss.close();
  }

  return {
    roomId,
    roomCode,
    isPrivate,
    handleUpgrade,
    close,
    getSessionCount: () => sessions.size,
    getDebugSnapshot: () => ({
      roomId,
      roomCode: roomCode || null,
      isPrivate,
      current: debugStateSnapshot(),
      perf: perfSnapshot(),
      names: authenticatedSessions()
        .map((session) => session.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "sv"))
    })
  };
}

import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
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
import { rawSizeBytes, rawToText } from "./runtime/net.js";
import { obstacleHalfExtents } from "./runtime/physics.js";
import { createMovementSystem } from "./runtime/ai.js";
import {
  createSpectatorSystem,
  SPECTATOR_CYCLE_NEXT,
  SPECTATOR_CYCLE_PREV
} from "./runtime/spectator.js";
import { createSession } from "./runtime/session.js";
import { createRoomLogger, createInvariantChecker } from "./runtime/logger.js";
import { createCharacterSystem } from "./runtime/characters.js";

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
  let cachedScoreboard = [];
  let nextScoreboardRefreshAt = 0;
  let lobbyCountdown = null;
  let supermajorityReadyTimeout = null;
  let pendingRoundReset = false;
  const countdownReadyNames = new Set();
  const countdownReconnectGraceByName = new Map();
  let activeMatchStartedAt = 0;
  const roomTag = isPrivate ? `privat:${roomCode}` : "publik";
  let closed = false;

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
    return `anslutna=${sockets.size} inloggade=${authenticatedCount()} spelar=${activePlayerCount()} nedrakning=${countdownPlayerCount()}`;
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

  const { logInfo, logWarn, logEvent } = createRoomLogger(roomTag, stateSummary);
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
    ws.send(JSON.stringify({ type, ...payload }));
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

  function countdownMsRemaining(now = Date.now()) {
    if (!lobbyCountdown) return 0;
    return Math.max(0, lobbyCountdown.endsAt - now);
  }

  function toCountdownState(session, endsAt) {
    if (!session?.authenticated || !session.ready) return;
    if (session.state === "alive") return;
    if (!assignCharacterForCountdown(session, Date.now())) return;
    session.state = "countdown";
    session.readyAt = endsAt;
    session.input.attackRequested = false;
    if (session.name) countdownReadyNames.add(String(session.name).toLowerCase());
    sendToSession(session.id, "countdown", {
      seconds: Math.max(1, Math.ceil((endsAt - Date.now()) / 1000))
    });
  }

  function cancelLobbyCountdown() {
    if (!lobbyCountdown) return;
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "countdown") continue;
      if (session.characterId != null) {
        releaseOwnedCharacter(session.id);
        session.characterId = null;
      }
      session.state = "lobby";
      session.readyAt = 0;
    }
    lobbyCountdown = null;
    countdownReadyNames.clear();
    countdownReconnectGraceByName.clear();
    appendSystemChat([{ type: "text", text: "Nedräkning avbruten" }]);
  }

  function cancelSupermajorityReadyTimeout() {
    supermajorityReadyTimeout = null;
  }

  function startSupermajorityReadyTimeout(now) {
    supermajorityReadyTimeout = {
      endsAt: now + SUPERMAJORITY_READY_TIMEOUT_SECONDS * 1000,
      nextAnnounceSecond: SUPERMAJORITY_READY_TIMEOUT_SECONDS - SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS
    };
    appendSystemChat([
      {
        type: "text",
        text: `2/3 spelare redo. Matchstart om ${SUPERMAJORITY_READY_TIMEOUT_SECONDS} sekunder om inte alla blir redo tidigare.`
      }
    ]);
  }

  function announceSupermajorityReadyTimeout(now) {
    if (!supermajorityReadyTimeout) return;
    while (
      supermajorityReadyTimeout.nextAnnounceSecond > 0 &&
      now >= supermajorityReadyTimeout.endsAt - supermajorityReadyTimeout.nextAnnounceSecond * 1000
    ) {
      const seconds = supermajorityReadyTimeout.nextAnnounceSecond;
      appendSystemChat([
        {
          type: "text",
          text: `2/3 spelare redo. Matchstart om ${seconds} sekunder om inte alla blir redo tidigare.`
        }
      ]);
      supermajorityReadyTimeout.nextAnnounceSecond -= SUPERMAJORITY_READY_NOTIFY_STEP_SECONDS;
    }
  }

  function startLobbyCountdown(now, seconds = ROUND_COUNTDOWN_SECONDS) {
    const endsAt = now + seconds * 1000;
    cancelSupermajorityReadyTimeout();
    countdownReadyNames.clear();
    pruneCountdownReconnectGrace(now);
    lobbyCountdown = {
      endsAt,
      lastAnnouncedSecond: null
    };
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "lobby" || !session.ready) continue;
      toCountdownState(session, endsAt);
    }
    logEvent("countdown_start", {
      seconds,
      players: countdownPlayerCount()
    });
    emitStatsEvent("countdown_start", {
      seconds,
      players: countdownPlayerCount()
    });
    appendSystemChat([{ type: "text", text: "Nedräkning startad" }]);
  }

  function maybeStartLobbyCountdown(now) {
    if (lobbyCountdown) return;
    if (activeMatchStartedAt > 0) return;
    if (pendingRoundReset) return;
    const lobbyPlayers = authenticatedSessions().filter((session) => session.state === "lobby");
    if (lobbyPlayers.length < MIN_PLAYERS_TO_START) {
      cancelSupermajorityReadyTimeout();
      return;
    }
    const readyCount = lobbyPlayers.reduce((count, session) => count + (session.ready ? 1 : 0), 0);
    if (readyCount >= lobbyPlayers.length) {
      startLobbyCountdown(now);
      return;
    }
    const readyNeededForSupermajority = Math.ceil((lobbyPlayers.length * 2) / 3);
    if (readyCount < readyNeededForSupermajority) {
      cancelSupermajorityReadyTimeout();
      return;
    }
    if (!supermajorityReadyTimeout) {
      startSupermajorityReadyTimeout(now);
      return;
    }
    announceSupermajorityReadyTimeout(now);
    if (now >= supermajorityReadyTimeout.endsAt) {
      startLobbyCountdown(now);
    }
  }

  function finalizeLobbyCountdown(now) {
    if (!lobbyCountdown) return;
    const participants = authenticatedSessions().filter((session) => session.state === "countdown" && session.ready);
    lobbyCountdown = null;
    countdownReadyNames.clear();
    pruneCountdownReconnectGrace(now);
    for (const session of participants) markCountdownReconnectGrace(session.name, now);
    appendSystemChat([{ type: "text", text: "Spel startat" }]);
    for (const session of participants) {
      if (session.characterId == null && !assignCharacterForCountdown(session, now)) continue;
      session.state = "alive";
      session.ready = false;
      session.readyAt = now;
      session.input.attackRequested = false;
      emitStatsEvent("session_alive", {
        sessionId: shortSessionId(session.id),
        name: session.name
      });
    }
  }

  function endCurrentMatch(now, winnerSession = null) {
    const winnerSessionId = winnerSession?.id || null;
    if (winnerSession?.authenticated && winnerSession.name) {
      winnerSession.stats.wins += 1;
      appendSystemChat([
        { type: "player", name: winnerSession.name },
        { type: "text", text: " vann matchen!" }
      ]);
      appendSystemChat([
        { type: "text", text: `Spelet avslutas om ${Math.ceil(MATCH_END_RETURN_TO_LOBBY_MS / 1000)} sekunder` }
      ]);
    }
    const matchEndsAt = winnerSessionId ? now + MATCH_END_RETURN_TO_LOBBY_MS : 0;

    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (winnerSessionId && session.id === winnerSessionId && session.state === "alive" && session.characterId != null) {
        session.state = "won";
        session.ready = false;
        session.readyAt = 0;
        session.input.attackRequested = false;
        session.returnToLobbyAt = matchEndsAt;
        session.eliminatedByName = null;
        continue;
      }
      if (session.state === "alive") returnToLobby(session, "round_ended");
      if (session.state === "downed") {
        if (!winnerSessionId) {
          returnToLobby(session, "round_ended");
        } else {
          session.ready = false;
          session.readyAt = 0;
          session.input.attackRequested = false;
          session.returnToLobbyAt = matchEndsAt;
        }
      }
      if (session.state === "spectating") {
        if (!winnerSessionId) {
          returnToLobby(session, "round_ended");
        } else {
          session.ready = false;
          session.readyAt = 0;
          session.input.attackRequested = false;
          session.returnToLobbyAt = matchEndsAt;
        }
      }
      if (session.state === "countdown") {
        session.state = "lobby";
        session.readyAt = 0;
      }
      session.ready = false;
    }

    lobbyCountdown = null;
    cancelSupermajorityReadyTimeout();
    countdownReadyNames.clear();
    countdownReconnectGraceByName.clear();
    activeMatchStartedAt = 0;
    pendingRoundReset = Boolean(winnerSessionId);
    if (!pendingRoundReset) resetArenaForNextRound(now);
  }

  function assignCharacterForCountdown(session, now) {
    if (!session || !session.authenticated) return false;
    if (session.characterId != null) {
      const owned = characters[session.characterId];
      if (owned?.ownerSessionId === session.id && owned?.controllerType === "PLAYER") {
        session.input.yaw = owned.yaw;
        session.input.pitch = owned.pitch;
        sendToSession(session.id, "possess", { characterId: owned.id });
        return true;
      }
      session.characterId = null;
    }

    const standingAvailable = characters.find(
      (c) => c.controllerType === "AI" && c.ownerSessionId == null && !isCharacterDowned(c, now)
    );
    const available =
      standingAvailable || characters.find((c) => c.controllerType === "AI" && c.ownerSessionId == null);
    if (!available) {
      session.ready = false;
      session.state = "lobby";
      session.readyAt = 0;
      sendToSession(session.id, "action_error", { message: "Ingen ledig karaktär just nu." });
      return false;
    }
    clearDownedState(available);

    available.controllerType = "PLAYER";
    available.ownerSessionId = session.id;
    available.everPlayerControlled = true;
    session.characterId = available.id;
    session.readyAt = now;
    session.input.yaw = available.yaw;
    session.input.pitch = available.pitch;
    session.input.attackRequested = false;

    logEvent("session_possess", {
      sessionId: shortSessionId(session.id),
      name: session.name,
      characterId: available.id,
      x: Number(available.x.toFixed(2)),
      z: Number(available.z.toFixed(2)),
      yaw: Number(available.yaw.toFixed(2))
    });
    sendToSession(session.id, "possess", { characterId: available.id });
    return true;
  }

  function returnToLobby(session, reason = "return_to_lobby") {
    if (!session) return;
    const previousState = session.state;
    session.state = "lobby";
    session.ready = false;
    session.characterId = null;
    session.readyAt = 0;
    session.input.attackRequested = false;
    session.eliminatedAt = 0;
    session.returnToLobbyAt = 0;
    session.eliminatedByName = null;
    clearSpectatorTarget(session);
    if (previousState !== "lobby") {
      emitStatsEvent("session_lobby", {
        sessionId: shortSessionId(session.id),
        name: session.name,
        reason
      });
    }
  }

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
    rand,
    clampPitch
  });

  function dropMessage(session, reason) {
    session.net.droppedMessages += 1;
    session.net.lastDropReason = reason;
    const now = Date.now();
    if (now - session.net.dropWindowStartAt >= SPAM_DROP_WINDOW_MS) {
      session.net.dropWindowStartAt = now;
      session.net.dropWindowCount = 0;
    }
    session.net.dropWindowCount += 1;
    if (session.net.droppedMessages === 1 || session.net.droppedMessages % 10 === 0) {
      logEvent("message_drop", {
        sessionId: shortSessionId(session.id),
        reason,
        droppedTotal: session.net.droppedMessages,
        droppedInWindow: session.net.dropWindowCount
      });
    }
    return session.net.dropWindowCount > SPAM_MAX_DROPS_PER_WINDOW;
  }

  function isOriginAllowed(origin) {
    if (!origin || String(origin).trim() === "") return ALLOW_MISSING_ORIGIN;
    return ALLOWED_ORIGINS.has(String(origin).trim());
  }

  function processLogin(sessionId, name) {
    const session = sessions.get(sessionId);
    if (!session) return "ignored";
    if (session.authenticated) {
      sendToSession(sessionId, "login_error", { message: "Du är redan inloggad." });
      return "ok";
    }

    const normalizedName = normalizePlayerName(name);
    if (normalizedName.length < NAME_MIN_LEN) {
      sendToSession(sessionId, "login_error", { message: `Namnet måste vara minst ${NAME_MIN_LEN} tecken.` });
      return "ok";
    }

    if (authenticatedCount() >= MAX_PLAYERS) {
      sendToSession(sessionId, "login_error", {
        message: "Rummet är fullt.",
        reason: "room_full",
        roomCode: roomCode || null,
        isPrivate
      });
      return "ok";
    }

    if (findAuthenticatedByName(normalizedName)) {
      sendToSession(sessionId, "login_error", { message: "Namnet är upptaget." });
      return "ok";
    }

    const loginAt = Date.now();
    pruneCountdownReconnectGrace(loginAt);

    session.authenticated = true;
    session.name = normalizedName;
    session.state = "lobby";
    session.ready = false;
    session.readyAt = 0;
    clearSpectatorTarget(session);
    const normalizedNameKey = normalizedName.toLowerCase();
    if (lobbyCountdown && countdownReadyNames.has(normalizedNameKey)) {
      session.ready = true;
      toCountdownState(session, lobbyCountdown.endsAt);
    } else {
      const activePlayers = activePlayerCount();
      if (
        !lobbyCountdown &&
        !pendingRoundReset &&
        activePlayers > 0 &&
        hasCountdownReconnectGrace(normalizedName, loginAt)
      ) {
        if (assignCharacterForCountdown(session, loginAt)) {
          session.state = "alive";
          session.ready = false;
          session.readyAt = loginAt;
          session.input.attackRequested = false;
          appendSystemChat([
            { type: "player", name: normalizedName },
            { type: "text", text: " återanslöt till pågående runda" }
          ]);
        }
      }
    }
    countdownReconnectGraceByName.delete(normalizedNameKey);

    logEvent("session_login", {
      sessionId: shortSessionId(sessionId),
      name: normalizedName
    });
    emitStatsEvent("session_login", {
      sessionId: shortSessionId(sessionId),
      name: normalizedName
    });

    sendToSession(sessionId, "login_ok", {
      name: normalizedName,
      chatHistory,
      maxPlayers: MAX_PLAYERS,
      roomCode: roomCode || null,
      isPrivate
    });
    appendSystemChat([
      { type: "player", name: normalizedName },
      { type: "text", text: " joinade spelet" }
    ]);
    return "ok";
  }

  function processChat(sessionId, textRaw) {
    const session = sessions.get(sessionId);
    if (!session || !session.authenticated) return "ignored";
    if (session.state === "alive") return "ok";
    const text = normalizeChatText(textRaw);
    if (!text) return "ok";

    const entry = appendChat({ name: session.name, text });
    logEvent("chat", {
      sessionId: shortSessionId(sessionId),
      name: session.name,
      text
    });
    broadcast("chat", { entry });
    return "ok";
  }

  function processClientMessage(sessionId, raw) {
    const session = sessions.get(sessionId);
    if (!session) return "ignored";
    session.net.lastActivityAt = Date.now();

    if (rawSizeBytes(raw) > MAX_MESSAGE_BYTES) {
      return dropMessage(session, "size") ? "abuse" : "dropped";
    }

    let msg;
    try {
      msg = JSON.parse(rawToText(raw));
    } catch {
      return dropMessage(session, "json") ? "abuse" : "dropped";
    }

    const at = Date.now();
    if (at - session.net.windowStartAt >= MESSAGE_WINDOW_MS) {
      session.net.windowStartAt = at;
      session.net.windowCount = 0;
    }
    session.net.windowCount += 1;
    if (session.net.windowCount > MAX_MESSAGES_PER_WINDOW) {
      return dropMessage(session, "rate_window") ? "abuse" : "dropped";
    }

    if (msg.type === "login") return processLogin(sessionId, msg.name);
    if (msg.type === "chat") return processChat(sessionId, msg.text);

    if (!session.authenticated) {
      return dropMessage(session, "unauthenticated") ? "abuse" : "dropped";
    }

    if (msg.type === "spectate") {
      if (session.state === "alive" || session.state === "countdown") {
        sendToSession(sessionId, "action_error", { message: "Du spelar redan i den här rundan." });
        return "ok";
      }
      if (activeMatchStartedAt <= 0) {
        sendToSession(sessionId, "action_error", { message: "Ingen match pågår just nu." });
        return "ok";
      }
      setSessionSpectating(session, at, { randomTarget: true });
      return "ok";
    }

    if (msg.type === "spectate_cycle") {
      if (session.state !== "spectating") return "ok";
      const direction = Number(msg.direction) < 0 ? SPECTATOR_CYCLE_PREV : SPECTATOR_CYCLE_NEXT;
      spectator.cycleSpectatorTarget(session, direction, at);
      return "ok";
    }

    if (msg.type === "ready" || msg.type === "play") {
      if (session.state === "alive") return "ok";
      if (session.state === "spectating") {
        sendToSession(sessionId, "action_error", { message: "Du åskådar just nu. Återgå till lobbyn först." });
        return "ok";
      }
      if (session.state === "won") {
        sendToSession(sessionId, "action_error", { message: "Du vann nyss. Återgå till lobbyn för ny runda." });
        return "ok";
      }
      if (session.state === "downed") {
        sendToSession(sessionId, "action_error", { message: "Du är nedslagen. Återgå till lobbyn med knappen." });
        return "ok";
      }
      if (pendingRoundReset) {
        sendToSession(sessionId, "action_error", { message: "Vänta tills vinnaren återgår till lobbyn." });
        return "ok";
      }
      if (activeMatchStartedAt > 0) {
        sendToSession(sessionId, "action_error", { message: "Match pågår. Vänta tills rundan är slut." });
        return "ok";
      }
      const wantsReady = msg.type === "play" ? true : msg.ready !== false;
      if (wantsReady) {
        if (!session.ready) {
          session.ready = true;
          if (lobbyCountdown) toCountdownState(session, lobbyCountdown.endsAt);
          maybeStartLobbyCountdown(at);
        }
      } else if (session.ready) {
        if (session.state === "countdown") {
          sendToSession(sessionId, "action_error", { message: "Nedräkning pågår. Du kan inte ångra ready nu." });
          return "ok";
        }
        session.ready = false;
        maybeStartLobbyCountdown(at);
      }
      return "ok";
    }

    if (msg.type === "leave_match") {
      if (session.state === "alive" || session.state === "downed" || session.state === "won" || session.state === "spectating") {
        releaseOwnedCharacter(sessionId);
        returnToLobby(session, "left_match");
        appendSystemChat([
          { type: "player", name: session.name },
          { type: "text", text: " lämnade matchen" }
        ]);
      }
      return "ok";
    }

    if (msg.type === "input") {
      if (at - session.net.lastInputAt < INPUT_UPDATE_MIN_MS) {
        // Frequent input updates are benign; ignore extras instead of counting them as abuse.
        return "ok";
      }
      session.net.lastInputAt = at;

      const input = msg.input || {};
      session.input.forward = Boolean(input.forward);
      session.input.backward = Boolean(input.backward);
      session.input.left = Boolean(input.left);
      session.input.right = Boolean(input.right);
      session.input.sprint = Boolean(input.sprint);
      if (typeof input.yaw === "number" && Number.isFinite(input.yaw)) {
        session.input.yaw = normalizeAngle(input.yaw);
      }
      if (typeof input.pitch === "number" && Number.isFinite(input.pitch)) {
        session.input.pitch = clampPitch(input.pitch);
      }
      return "ok";
    }

    if (msg.type === "attack") {
      if (at - session.net.lastAttackRequestAt < ATTACK_MESSAGE_MIN_MS) {
        return dropMessage(session, "rate_attack") ? "abuse" : "dropped";
      }
      session.net.lastAttackRequestAt = at;
      session.input.attackRequested = session.state === "alive" && session.characterId != null;
      return "ok";
    }

    return dropMessage(session, "unknown_type") ? "abuse" : "dropped";
  }

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

  let lastTickAt = Date.now();
  const tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTickAt) / 1000);
    lastTickAt = now;
    checkInvariants(now);
    pruneCountdownReconnectGrace(now);
    disconnectIdleSessions(now);

    let matchEndedByTimeout = false;
    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state !== "won" && session.state !== "downed" && session.state !== "spectating") continue;
      const returnAt = Number(session.returnToLobbyAt || 0);
      if (!Number.isFinite(returnAt) || returnAt <= 0 || now < returnAt) continue;
      releaseOwnedCharacter(session.id);
      returnToLobby(session, "match_end_timeout");
      matchEndedByTimeout = true;
    }
    if (matchEndedByTimeout) {
      appendSystemChat([{ type: "text", text: "Spelet avslutat" }]);
    }
    if (pendingRoundReset) {
      const hasEndMatchParticipants = authenticatedSessions().some(
        (session) => session.state === "won" || session.state === "downed" || session.state === "spectating"
      );
      if (!hasEndMatchParticipants) {
        resetArenaForNextRound(now);
        pendingRoundReset = false;
      }
    }

    if (lobbyCountdown) {
      if (countdownPlayerCount() < MIN_PLAYERS_TO_START) {
        cancelLobbyCountdown();
      } else {
        if (now >= lobbyCountdown.endsAt) finalizeLobbyCountdown(now);
      }
    } else {
      maybeStartLobbyCountdown(now);
    }

    for (const c of characters) {
      if (isCharacterDowned(c, now)) {
        continue;
      }

      if (c.controllerType === "AI") {
        movement.updateAI(c, dt, now);
        continue;
      }

      const ownerSession = c.ownerSessionId ? sessions.get(c.ownerSessionId) : null;
      if (!ownerSession || (ownerSession.state !== "alive" && ownerSession.state !== "countdown" && ownerSession.state !== "won")) {
        c.controllerType = "AI";
        c.ownerSessionId = null;
        continue;
      }

      if (ownerSession.state === "alive" || ownerSession.state === "won") movement.updatePlayer(c, ownerSession, dt);

      if (ownerSession.state === "alive" && ownerSession.input.attackRequested) {
        handleAttack(c.id, now);
        ownerSession.input.attackRequested = false;
      }
    }

    if (sockets.size === 0) return;

    let alivePlayers = activePlayerCount();
    if (activeMatchStartedAt > 0 && alivePlayers <= 1) {
      let winnerSession = null;
      if (alivePlayers === 1) {
        winnerSession =
          authenticatedSessions().find((session) => session.state === "alive" && session.characterId != null) || null;
      }
      endCurrentMatch(now, winnerSession);
      alivePlayers = activePlayerCount();
    }
    if (alivePlayers > 0 && activeMatchStartedAt === 0) activeMatchStartedAt = now;
    if (alivePlayers === 0) activeMatchStartedAt = 0;

    for (const session of sessions.values()) maintainSpectatorTarget(session, now);

    const match = {
      inProgress: alivePlayers > 0,
      alivePlayers,
      startedAt: activeMatchStartedAt || null,
      elapsedMs: activeMatchStartedAt ? now - activeMatchStartedAt : 0
    };
    if (now >= nextScoreboardRefreshAt) {
      cachedScoreboard = scoreboardSnapshot();
      nextScoreboardRefreshAt = now + 250;
    }
    const scoreboard = cachedScoreboard;
    const spectatorCandidates = aliveSpectatorCandidates(now);

    const worldState = {
      worldSizeMeters: WORLD_SIZE_METERS,
      worldWidthMeters: WORLD_WIDTH_METERS,
      worldHeightMeters: WORLD_HEIGHT_METERS,
      shelves: SHELVES,
      coolers: COOLERS,
      freezers: FREEZERS,
      scoreboard,
      characters: characters.map((c) => ({
        id: c.id,
        x: Number(c.x.toFixed(3)),
        z: Number(c.z.toFixed(3)),
        yaw: Number(c.yaw.toFixed(3)),
        pitch: Number((c.pitch || 0).toFixed(3)),
        controllerType: c.controllerType,
        cooldownMsRemaining: Math.max(0, ATTACK_COOLDOWN_MS - (now - c.lastAttackAt)),
        attackFlashMsRemaining: Math.max(0, ATTACK_FLASH_MS - (now - c.lastAttackAt)),
        downedMsRemaining: Math.max(0, c.downedUntil - now),
        downedDurationMs: NPC_DOWNED_RESPAWN_MS,
        fallAwayX: Number((c.fallAwayX || 0).toFixed(3)),
        fallAwayZ: Number((c.fallAwayZ || 1).toFixed(3))
      }))
    };

    for (const [sessionId, ws] of sockets.entries()) {
      const session = sessions.get(sessionId);
      const playerCharacter =
        session && session.characterId != null ? characters[session.characterId] : null;
      const spectatorTargetSession =
        session?.spectatingSessionId != null ? sessions.get(session.spectatingSessionId) : null;
      const spectatorTargetName = spectatorTargetSession?.name || null;
      send(ws, "world", {
        ...worldState,
        match,
        session: session
          ? {
              state: session.state,
              authenticated: session.authenticated,
              name: session.name,
              characterId: session.characterId,
              ready: Boolean(session.ready || session.state === "countdown"),
              countdownMsRemaining: countdownMsRemaining(now),
              activePlayers: alivePlayers,
              minPlayersToStart: MIN_PLAYERS_TO_START,
              maxPlayers: MAX_PLAYERS,
              returnToLobbyMsRemaining:
                session.state === "won" || session.state === "downed" || session.state === "spectating"
                  ? Math.max(0, (session.returnToLobbyAt || 0) - now)
                  : 0,
              eliminatedByName: session.state === "downed" ? session.eliminatedByName || null : null,
              spectatorTargetCharacterId:
                session.state === "spectating" ? session.spectatingCharacterId ?? null : null,
              spectatorTargetName: session.state === "spectating" ? spectatorTargetName : null,
              spectatorCandidates:
                session.state === "spectating"
                  ? spectatorCandidates.map((candidate) => ({
                      name: candidate.name,
                      characterId: candidate.characterId
                    }))
                  : [],
              attackCooldownMsRemaining: playerCharacter
                ? Math.max(0, ATTACK_COOLDOWN_MS - (now - playerCharacter.lastAttackAt))
                : 0
            }
          : null
      });
    }
  }, TICK_MS);

  const wss = new WebSocketServer({ noServer: true });
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.isAlive === false) {
        const staleSessionId = ws.sessionId || null;
        logEvent("heartbeat_timeout", {
          sessionId: shortSessionId(staleSessionId)
        });
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  tickInterval.unref?.();
  heartbeatInterval.unref?.();

  wss.on("error", (err) => {
    console.error(`[ws-server-error] ${err?.message || err}`);
  });

  logEvent("runtime_started", {
    worldSizeMeters: WORLD_SIZE_METERS,
    worldWidthMeters: WORLD_WIDTH_METERS,
    worldHeightMeters: WORLD_HEIGHT_METERS,
    maxPlayers: MAX_PLAYERS,
    totalCharacters: TOTAL_CHARACTERS
  });
  emitStatsEvent("runtime_started");

  wss.on("connection", (ws, req) => {
    const sessionId = randomUUID();
    const now = Date.now();
    ws.isAlive = true;
    ws.sessionId = sessionId;
    let cleanedUp = false;

    const cleanupSession = (reason, details = {}) => {
      if (cleanedUp) return;
      cleanedUp = true;

      const closingSession = sessions.get(sessionId);
      if (closingSession?.characterId != null) {
        releaseOwnedCharacter(sessionId);
      }
      if (lobbyCountdown && closingSession?.state === "countdown" && closingSession?.name) {
        countdownReadyNames.add(String(closingSession.name).toLowerCase());
        markCountdownReconnectGrace(closingSession.name);
      }

      if (closingSession?.authenticated && closingSession.name) {
        appendSystemChat([
          { type: "player", name: closingSession.name },
          { type: "text", text: " lämnade spelet" }
        ]);
      }

      sessions.delete(sessionId);
      sockets.delete(sessionId);
      if (lobbyCountdown) {
        if (countdownPlayerCount() < MIN_PLAYERS_TO_START) {
          cancelLobbyCountdown();
        }
      } else {
        maybeStartLobbyCountdown(Date.now());
      }
      logEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        name: closingSession?.name || null,
        reason,
        ...details
      });
      emitStatsEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        name: closingSession?.name || null,
        reason
      });
      if (isPrivate && sessions.size === 0 && typeof onRoomEmpty === "function") {
        onRoomEmpty({ roomId, roomCode });
      }
    };

    const session = createSession(sessionId, now);

    sessions.set(sessionId, session);
    sockets.set(sessionId, ws);
    logEvent("session_connected", {
      sessionId: shortSessionId(sessionId),
      origin: req.headers.origin || "<missing>",
      ip: req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null
    });
    emitStatsEvent("session_connected", {
      sessionId: shortSessionId(sessionId)
    });
    send(ws, "welcome", {
      sessionId,
      maxPlayers: MAX_PLAYERS,
      roomCode: roomCode || null,
      isPrivate
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      const result = processClientMessage(sessionId, raw);
      if (result === "abuse") {
        const activeSession = sessions.get(sessionId);
        const reason = activeSession?.net.lastDropReason || "unknown";
        const dropped = activeSession?.net.droppedMessages ?? 0;
        logWarn(
          "ratelimit",
          `abuse-kick sid=${shortSessionId(sessionId)} origin=${req?.headers?.origin || "-"} reason=${reason} dropped=${dropped}`
        );
        cleanupSession("abuse_kick", { dropReason: reason, droppedMessages: dropped });
        try {
          ws.close(1008, "rate limit");
        } catch {
          ws.terminate();
        }
      }
    });

    ws.on("error", (err) => {
      console.error(`[ws-client-error:${sessionId}] ${err?.message || err}`);
      cleanupSession("socket_error", { error: err?.message || String(err) });
      try {
        ws.terminate();
      } catch {
        // no-op
      }
    });

    ws.on("close", (code, closeReasonBuffer) => {
      const closeReason = closeReasonBuffer && closeReasonBuffer.length > 0 ? closeReasonBuffer.toString() : "";
      cleanupSession("socket_close", { code, closeReason });
    });
  });

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
      authenticatedNames: authenticatedSessions()
        .map((session) => session.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "sv"))
    })
  };
}

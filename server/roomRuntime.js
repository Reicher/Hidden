import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  ROOM_HALF_SIZE,
  MAX_PLAYERS,
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
  KNOCKDOWN_DURATION_MS,
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

const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 20;
const CHAT_MAX_LEN = 220;
const CHAT_HISTORY_LIMIT = 80;
const ROUND_COUNTDOWN_SECONDS = 10;
const PERMANENT_DOWNED_UNTIL = Number.MAX_SAFE_INTEGER;
const MAX_LOOK_PITCH_RAD = 1.2;

export function createRoomRuntime({ roomId, roomCode, isPrivate, onRoomEmpty = null, onStatsEvent = null }) {
  const sessions = new Map();
  const sockets = new Map();
  const characters = [];
  const chatHistory = [];
  const invariantLastLogAt = new Map();
  let cachedScoreboard = [];
  let nextScoreboardRefreshAt = 0;
  let lobbyCountdown = null;
  const countdownReadyNames = new Set();
  let activeMatchStartedAt = 0;
  const roomTag = isPrivate ? `privat:${roomCode}` : "publik";
  let closed = false;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  const SPAWN_OBSTACLES = [...SHELVES, ...COOLERS, ...FREEZERS];

  function spawnObstacleHalfExtents(obstacle) {
    const width = typeof obstacle.width === "number" ? obstacle.width : 1;
    const depth = typeof obstacle.depth === "number" ? obstacle.depth : 1;
    const yaw = typeof obstacle.yaw === "number" ? obstacle.yaw : 0;
    const quarterTurns = Math.round(yaw / (Math.PI / 2));
    const isSwapped = Math.abs(quarterTurns) % 2 === 1;
    return {
      halfW: (isSwapped ? depth : width) * 0.5,
      halfD: (isSwapped ? width : depth) * 0.5
    };
  }

  function isSpawnBlocked(x, z, margin = CHARACTER_RADIUS + 0.14) {
    for (const obstacle of SPAWN_OBSTACLES) {
      const { halfW, halfD } = spawnObstacleHalfExtents(obstacle);
      const minX = obstacle.x - halfW - margin;
      const maxX = obstacle.x + halfW + margin;
      const minZ = obstacle.z - halfD - margin;
      const maxZ = obstacle.z + halfD + margin;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
    }
    return false;
  }

  function randomSpawn() {
    const min = -ROOM_HALF_SIZE + 1;
    const max = ROOM_HALF_SIZE - 1;
    for (let i = 0; i < 180; i += 1) {
      const x = rand(min, max);
      const z = rand(min, max);
      if (isSpawnBlocked(x, z)) continue;
      return { x, z, yaw: rand(-Math.PI, Math.PI) };
    }

    const step = Math.max(0.6, CHARACTER_RADIUS * 2.4);
    for (let x = min; x <= max; x += step) {
      for (let z = min; z <= max; z += step) {
        if (isSpawnBlocked(x, z)) continue;
        return { x, z, yaw: rand(-Math.PI, Math.PI) };
      }
    }

    return { x: 0, z: 0, yaw: rand(-Math.PI, Math.PI) };
  }

  function createCharacter(id) {
    const p = randomSpawn();
    return {
      id,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      pitch: 0,
      controllerType: "AI",
      ownerSessionId: null,
      lastAttackAt: 0,
      downedUntil: 0,
      fallAwayX: 0,
      fallAwayZ: 1,
      ai: {
        mode: "move",
        desiredYaw: p.yaw,
        nextDecisionAt: Date.now() + rand(AI_DECISION_MS_MIN, AI_DECISION_MS_MAX),
        desiredPitch: rand(-0.28, 0.28),
        nextPitchDecisionAt: Date.now() + rand(320, 980)
      }
    };
  }

  function clampPitch(value) {
    return Math.max(-MAX_LOOK_PITCH_RAD, Math.min(MAX_LOOK_PITCH_RAD, value));
  }

  for (let i = 0; i < TOTAL_CHARACTERS; i += 1) characters.push(createCharacter(i));

  function isCharacterDowned(character, now) {
    return Boolean(character) && now < (character.downedUntil || 0);
  }

  function normalizeHorizontalVector(x, z, fallbackX = 0, fallbackZ = 1) {
    const len = Math.hypot(x, z);
    if (len < 0.0001) return { x: fallbackX, z: fallbackZ };
    return { x: x / len, z: z / len };
  }

  function computeFallAwayVector(attacker, victim) {
    if (attacker && victim) {
      const rawAwayX = victim.x - attacker.x;
      const rawAwayZ = victim.z - attacker.z;
      const normalized = normalizeHorizontalVector(
        rawAwayX,
        rawAwayZ,
        Math.sin(victim.yaw),
        Math.cos(victim.yaw)
      );
      return normalized;
    }
    return normalizeHorizontalVector(Math.sin(victim?.yaw || 0), Math.cos(victim?.yaw || 0), 0, 1);
  }

  function downCharacter(victim, now, fallAwayX, fallAwayZ) {
    victim.downedUntil = activeMatchStartedAt > 0 ? PERMANENT_DOWNED_UNTIL : now + KNOCKDOWN_DURATION_MS;
    victim.fallAwayX = fallAwayX;
    victim.fallAwayZ = fallAwayZ;
    victim.lastAttackAt = now;
    victim.ai.mode = "stop";
    victim.ai.desiredYaw = victim.yaw;
    victim.ai.nextDecisionAt = victim.downedUntil + rand(120, 360);
  }

  function clearDownedState(character) {
    character.downedUntil = 0;
    character.fallAwayX = 0;
    character.fallAwayZ = 1;
  }

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

  function nowTime() {
    return new Date().toISOString().slice(11, 19);
  }

  function logInfo(topic, message) {
    console.log(`[${nowTime()}] [${topic}] [${roomTag}] ${message}`);
  }

  function logWarn(topic, message) {
    console.warn(`[${nowTime()}] [${topic}] [${roomTag}] ${message}`);
  }

  function logEvent(event, details = {}) {
    const sid = details.sessionId || "-";
    if (event === "runtime_started") {
      logInfo("runtime", `start roomHalf=${details.roomHalfSize} maxPlayers=${details.maxPlayers} chars=${details.totalCharacters}`);
      return;
    }
    if (event === "session_connected") {
      const ua = details.userAgent ? String(details.userAgent).slice(0, 68) : "-";
      logInfo("anslutning", `ny session sid=${sid} ip=${details.ip || "-"} origin=${details.origin || "-"} ua="${ua}" ${stateSummary()}`);
      return;
    }
    if (event === "session_disconnected") {
      const code = details.code == null ? "-" : String(details.code);
      const name = details.name || "-";
      logInfo(
        "anslutning",
        `frankoppling sid=${sid} namn=${name} reason=${details.reason || "-"} code=${code} ${stateSummary()}`
      );
      return;
    }
    if (event === "session_login") {
      logInfo("spelare", `${details.name} loggade in sid=${sid} ${stateSummary()}`);
      return;
    }
    if (event === "countdown_start") {
      logInfo("spel", `nedrakning start sid=${sid} sek=${details.seconds ?? "-"}`);
      return;
    }
    if (event === "session_possess") {
      logInfo(
        "spel",
        `${details.name || "-"} tog karaktar ${details.characterId} sid=${sid} pos=(${details.x},${details.z}) yaw=${details.yaw}`
      );
      return;
    }
    if (event === "attack") {
      const victimList =
        Array.isArray(details.victimCharacterIds) && details.victimCharacterIds.length > 0
          ? details.victimCharacterIds.join(",")
          : "-";
      logInfo(
        "strid",
        `attack sid=${sid} char=${details.attackerCharacterId} traffar=${details.victims ?? 0} victimIds=${victimList}`
      );
      return;
    }
    if (event === "player_eliminated") {
      logInfo("strid", `${details.name || "-"} dog (char=${details.characterId}, sid=${sid})`);
      return;
    }
    if (event === "character_respawn") {
      logInfo("world", `respawn char=${details.characterId} pos=(${details.x},${details.z}) yaw=${details.yaw}`);
      return;
    }
    if (event === "chat") {
      logInfo("chat", `${details.name || "-"}: ${details.text || ""}`);
      return;
    }
    if (event === "heartbeat_timeout") {
      logWarn("anslutning", `heartbeat timeout sid=${sid}`);
      return;
    }
    if (event === "message_drop") {
      logWarn(
        "ratelimit",
        `drop sid=${sid} reason=${details.reason || "-"} total=${details.droppedTotal ?? 0} window=${details.droppedInWindow ?? 0}`
      );
      return;
    }
    logInfo("game", `${event} ${stateSummary()}`);
  }

  function warnInvariant(key, now, details) {
    const last = invariantLastLogAt.get(key) ?? 0;
    if (now - last < INVARIANT_LOG_COOLDOWN_MS) return;
    invariantLastLogAt.set(key, now);
    logWarn(`invariant:${key}`, details);
  }

  function checkInvariants(now) {
    if (characters.length !== TOTAL_CHARACTERS) {
      warnInvariant(
        "character_count",
        now,
        `Expected ${TOTAL_CHARACTERS} characters, got ${characters.length}.`
      );
    }

    const alivePlayers = activePlayerCount();
    if (alivePlayers > MAX_PLAYERS) {
      warnInvariant(
        "max_players",
        now,
        `Expected at most ${MAX_PLAYERS} alive players, got ${alivePlayers}.`
      );
    }

    const ownerToChars = new Map();
    for (const c of characters) {
      if (!c.ownerSessionId) continue;
      const owned = ownerToChars.get(c.ownerSessionId) || [];
      owned.push(c.id);
      ownerToChars.set(c.ownerSessionId, owned);
      if (c.controllerType !== "PLAYER") {
        warnInvariant(
          "owner_controller_mismatch",
          now,
          `Character ${c.id} has owner ${c.ownerSessionId} but controllerType=${c.controllerType}.`
        );
      }
    }

    for (const [sessionId, ownedCharIds] of ownerToChars.entries()) {
      if (ownedCharIds.length > 1) {
        warnInvariant(
          "multi_char_owner",
          now,
          `Session ${sessionId} owns multiple characters: ${ownedCharIds.join(", ")}.`
        );
      }

      const session = sessions.get(sessionId);
      if (!session || session.state !== "alive" || session.characterId == null) {
        warnInvariant(
          "owner_without_alive_session",
          now,
          `Character owner ${sessionId} missing valid alive session.`
        );
        continue;
      }

      if (!ownedCharIds.includes(session.characterId)) {
        warnInvariant(
          "session_character_mismatch",
          now,
          `Session ${sessionId} points to character ${session.characterId} but owns [${ownedCharIds.join(", ")}].`
        );
      }
    }
  }

  function normalizePlayerName(raw) {
    const trimmed = String(raw || "").trim().replace(/\s+/g, " ");
    return trimmed.slice(0, NAME_MAX_LEN);
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

  function statusLabel(session) {
    if (!session?.authenticated) return "disconnected";
    if (session.state === "alive") return "spelar";
    if (session.state === "countdown") return "nedräkning";
    if (session.state === "lobby") return session.ready ? "redo" : "väntar";
    return "disconnected";
  }

  function scoreboardSnapshot() {
    return authenticatedSessions()
      .map((s) => ({
        name: s.name,
        wins: s.stats.wins,
        kills: s.stats.kills,
        deaths: s.stats.deaths,
        innocents: s.stats.innocents,
        status: statusLabel(s),
        ready: Boolean(s.ready || s.state === "countdown")
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.kills !== a.kills) return b.kills - a.kills;
        if (a.deaths !== b.deaths) return a.deaths - b.deaths;
        return a.name.localeCompare(b.name, "sv");
      });
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
      session.state = "lobby";
      session.readyAt = 0;
    }
    lobbyCountdown = null;
    countdownReadyNames.clear();
    appendSystemChat([{ type: "text", text: "Nedräkning avbruten" }]);
  }

  function startLobbyCountdown(now, seconds = ROUND_COUNTDOWN_SECONDS) {
    const endsAt = now + seconds * 1000;
    countdownReadyNames.clear();
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
    const lobbyPlayers = authenticatedSessions().filter((session) => session.state === "lobby");
    if (lobbyPlayers.length <= 1) return;
    if (lobbyPlayers.some((session) => !session.ready)) return;
    startLobbyCountdown(now);
  }

  function finalizeLobbyCountdown(now) {
    if (!lobbyCountdown) return;
    const participants = authenticatedSessions()
      .filter((session) => session.state === "countdown" && session.ready)
      .map((session) => session.id);
    lobbyCountdown = null;
    countdownReadyNames.clear();
    appendSystemChat([{ type: "text", text: "Spel startat" }]);
    for (const sessionId of participants) assignCharacterToSession(sessionId, now);
  }

  function releaseOwnedCharacter(sessionId) {
    if (!sessionId) return;
    for (const c of characters) {
      if (c.ownerSessionId !== sessionId) continue;
      c.controllerType = "AI";
      c.ownerSessionId = null;
    }
  }

  function resetArenaForNextRound(now) {
    for (const c of characters) {
      const spawn = randomSpawn();
      c.x = spawn.x;
      c.z = spawn.z;
      c.yaw = spawn.yaw;
      c.pitch = 0;
      c.controllerType = "AI";
      c.ownerSessionId = null;
      c.lastAttackAt = 0;
      clearDownedState(c);
      c.ai.mode = "move";
      c.ai.desiredYaw = spawn.yaw;
      c.ai.nextDecisionAt = now + rand(AI_DECISION_MS_MIN, AI_DECISION_MS_MAX);
      c.ai.desiredPitch = rand(-0.3, 0.3);
      c.ai.nextPitchDecisionAt = now + rand(320, 980);
    }
  }

  function endCurrentMatch(now, winnerSession = null) {
    if (winnerSession?.authenticated && winnerSession.name) {
      winnerSession.stats.wins += 1;
      appendSystemChat([
        { type: "player", name: winnerSession.name },
        { type: "text", text: " vann Battle Royale!" }
      ]);
    }

    for (const session of sessions.values()) {
      if (!session.authenticated) continue;
      if (session.state === "alive") returnToLobby(session, "round_ended");
      if (session.state === "countdown") {
        session.state = "lobby";
        session.readyAt = 0;
      }
      session.ready = false;
    }

    lobbyCountdown = null;
    countdownReadyNames.clear();
    activeMatchStartedAt = 0;
    resetArenaForNextRound(now);
  }

  function assignCharacterToSession(sessionId, now) {
    const session = sessions.get(sessionId);
    if (!session || !session.authenticated) return;
    if (session.state === "alive") return;

    const standingAvailable = characters.find(
      (c) => c.controllerType === "AI" && c.ownerSessionId == null && !isCharacterDowned(c, now)
    );
    const available =
      standingAvailable || characters.find((c) => c.controllerType === "AI" && c.ownerSessionId == null);
    if (!available) {
      returnToLobby(session, "no_character_available");
      sendToSession(sessionId, "action_error", { message: "Ingen ledig karaktär just nu." });
      return;
    }
    clearDownedState(available);

    available.controllerType = "PLAYER";
    available.ownerSessionId = sessionId;

    session.state = "alive";
    session.ready = false;
    session.characterId = available.id;
    session.readyAt = now;
    session.input.yaw = available.yaw;
    session.input.pitch = available.pitch;
    session.input.attackRequested = false;

    logEvent("session_possess", {
      sessionId: shortSessionId(sessionId),
      name: session.name,
      characterId: available.id,
      x: Number(available.x.toFixed(2)),
      z: Number(available.z.toFixed(2)),
      yaw: Number(available.yaw.toFixed(2))
    });
    emitStatsEvent("session_alive", {
      sessionId: shortSessionId(sessionId),
      name: session.name
    });
    sendToSession(sessionId, "possess", { characterId: available.id });
  }

  function returnToLobby(session, reason = "return_to_lobby") {
    if (!session) return;
    const previousState = session.state;
    session.state = "lobby";
    session.ready = false;
    session.characterId = null;
    session.readyAt = 0;
    session.input.attackRequested = false;
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
    const fallAway = computeFallAwayVector(attacker, c);
    const owner = c.ownerSessionId;

    if (owner) {
      const ownerSession = sessions.get(owner);
      if (ownerSession) {
        ownerSession.stats.deaths += 1;
        logEvent("player_eliminated", {
          sessionId: shortSessionId(owner),
          name: ownerSession.name,
          characterId: charId
        });
        returnToLobby(ownerSession, "eliminated");
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
          attackerSession.stats.kills += 1;
          if (victimSession?.authenticated && victimSession.name) {
            appendSystemChat([
              { type: "player", name: attackerSession.name },
              { type: "text", text: " dödade " },
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

  const ROOM_BOUNDARY_MIN = -ROOM_HALF_SIZE + 0.5;
  const ROOM_BOUNDARY_MAX = ROOM_HALF_SIZE - 0.5;
  const WALL_AVOIDANCE_MARGIN = 1.5;
  const SHELF_AVOIDANCE_MARGIN = 1.1;
  const STATIC_OBSTACLES = [...SHELVES, ...COOLERS, ...FREEZERS];

  function obstacleHalfExtents(obstacle) {
    const width = typeof obstacle.width === "number" ? obstacle.width : 1;
    const depth = typeof obstacle.depth === "number" ? obstacle.depth : 1;
    const yaw = typeof obstacle.yaw === "number" ? obstacle.yaw : 0;
    const quarterTurns = Math.round(yaw / (Math.PI / 2));
    const isSwapped = Math.abs(quarterTurns) % 2 === 1;
    return {
      halfW: (isSwapped ? depth : width) * 0.5,
      halfD: (isSwapped ? width : depth) * 0.5
    };
  }

  function clampInsideRoom(character, { steerOnClamp = false } = {}) {
    let hitMinX = false;
    let hitMaxX = false;
    let hitMinZ = false;
    let hitMaxZ = false;

    if (character.x < ROOM_BOUNDARY_MIN) {
      character.x = ROOM_BOUNDARY_MIN;
      hitMinX = true;
    }
    if (character.x > ROOM_BOUNDARY_MAX) {
      character.x = ROOM_BOUNDARY_MAX;
      hitMaxX = true;
    }
    if (character.z < ROOM_BOUNDARY_MIN) {
      character.z = ROOM_BOUNDARY_MIN;
      hitMinZ = true;
    }
    if (character.z > ROOM_BOUNDARY_MAX) {
      character.z = ROOM_BOUNDARY_MAX;
      hitMaxZ = true;
    }

    if (!steerOnClamp || (!hitMinX && !hitMaxX && !hitMinZ && !hitMaxZ)) return;

    const forwardX = Math.sin(character.yaw);
    const forwardZ = Math.cos(character.yaw);
    const pushingOutward =
      (hitMinX && forwardX < -0.02) ||
      (hitMaxX && forwardX > 0.02) ||
      (hitMinZ && forwardZ < -0.02) ||
      (hitMaxZ && forwardZ > 0.02);
    if (!pushingOutward) return;

    const towardCenterX = -character.x;
    const towardCenterZ = -character.z;
    character.yaw = normalizeAngle(Math.atan2(towardCenterX, towardCenterZ));
  }

  function wallAvoidance(character) {
    let ax = 0;
    let az = 0;
    if (character.x < ROOM_BOUNDARY_MIN + WALL_AVOIDANCE_MARGIN) {
      ax += (ROOM_BOUNDARY_MIN + WALL_AVOIDANCE_MARGIN - character.x) / WALL_AVOIDANCE_MARGIN;
    }
    if (character.x > ROOM_BOUNDARY_MAX - WALL_AVOIDANCE_MARGIN) {
      ax -= (character.x - (ROOM_BOUNDARY_MAX - WALL_AVOIDANCE_MARGIN)) / WALL_AVOIDANCE_MARGIN;
    }
    if (character.z < ROOM_BOUNDARY_MIN + WALL_AVOIDANCE_MARGIN) {
      az += (ROOM_BOUNDARY_MIN + WALL_AVOIDANCE_MARGIN - character.z) / WALL_AVOIDANCE_MARGIN;
    }
    if (character.z > ROOM_BOUNDARY_MAX - WALL_AVOIDANCE_MARGIN) {
      az -= (character.z - (ROOM_BOUNDARY_MAX - WALL_AVOIDANCE_MARGIN)) / WALL_AVOIDANCE_MARGIN;
    }

    const len = Math.hypot(ax, az);
    if (len < 0.001) return null;
    return {
      x: ax / len,
      z: az / len,
      strength: Math.min(1, len)
    };
  }

  function shelfAvoidance(character) {
    let ax = 0;
    let az = 0;

    for (const obstacle of STATIC_OBSTACLES) {
      const { halfW, halfD } = obstacleHalfExtents(obstacle);
      const minX = obstacle.x - halfW;
      const maxX = obstacle.x + halfW;
      const minZ = obstacle.z - halfD;
      const maxZ = obstacle.z + halfD;

      const nearestX = Math.max(minX, Math.min(maxX, character.x));
      const nearestZ = Math.max(minZ, Math.min(maxZ, character.z));
      const dx = character.x - nearestX;
      const dz = character.z - nearestZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.001 || dist >= SHELF_AVOIDANCE_MARGIN) continue;

      const falloff = 1 - dist / SHELF_AVOIDANCE_MARGIN;
      ax += (dx / dist) * falloff;
      az += (dz / dist) * falloff;
    }

    const len = Math.hypot(ax, az);
    if (len < 0.001) return null;
    return {
      x: ax / len,
      z: az / len,
      strength: Math.min(1, len)
    };
  }

  function resolveShelfCollisions(character, maxIterations = 3) {
    let hit = false;
    let pushX = 0;
    let pushZ = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let hitThisIteration = false;

      for (const obstacle of STATIC_OBSTACLES) {
        const { halfW, halfD } = obstacleHalfExtents(obstacle);
        const minX = obstacle.x - halfW - CHARACTER_RADIUS;
        const maxX = obstacle.x + halfW + CHARACTER_RADIUS;
        const minZ = obstacle.z - halfD - CHARACTER_RADIUS;
        const maxZ = obstacle.z + halfD + CHARACTER_RADIUS;

        if (character.x < minX || character.x > maxX || character.z < minZ || character.z > maxZ) continue;

        hit = true;
        hitThisIteration = true;
        const toMinX = Math.abs(character.x - minX);
        const toMaxX = Math.abs(maxX - character.x);
        const toMinZ = Math.abs(character.z - minZ);
        const toMaxZ = Math.abs(maxZ - character.z);
        const smallest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);

        if (smallest === toMinX) {
          character.x = minX;
          pushX -= 1;
        } else if (smallest === toMaxX) {
          character.x = maxX;
          pushX += 1;
        } else if (smallest === toMinZ) {
          character.z = minZ;
          pushZ -= 1;
        } else {
          character.z = maxZ;
          pushZ += 1;
        }
      }

      if (!hitThisIteration) break;
    }

    if (!hit) return null;
    const len = Math.hypot(pushX, pushZ);
    if (len < 0.001) return { x: 0, z: 0 };
    return { x: pushX / len, z: pushZ / len };
  }

  function updateAI(c, dt, now) {
    if (now >= c.ai.nextDecisionAt) {
      c.ai.mode = Math.random() < 0.25 ? "stop" : "move";
      c.ai.desiredYaw = normalizeAngle(c.yaw + rand(-Math.PI / 2, Math.PI / 2));
      c.ai.nextDecisionAt = now + rand(AI_DECISION_MS_MIN, AI_DECISION_MS_MAX);
    }

    const wallPush = wallAvoidance(c);
    const shelfPush = shelfAvoidance(c);
    let avoidance = null;
    if (wallPush || shelfPush) {
      const ax = (wallPush?.x || 0) + (shelfPush?.x || 0);
      const az = (wallPush?.z || 0) + (shelfPush?.z || 0);
      const len = Math.hypot(ax, az);
      if (len > 0.001) {
        avoidance = {
          x: ax / len,
          z: az / len,
          strength: Math.min(1, len)
        };
      }
    }

    if (avoidance) {
      c.ai.mode = "move";
      c.ai.desiredYaw = normalizeAngle(Math.atan2(avoidance.x, avoidance.z));
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + 260);
    }

    const deltaYaw = normalizeAngle(c.ai.desiredYaw - c.yaw);
    const turnBoost = avoidance ? 1 + avoidance.strength * 0.8 : 1;
    const maxTurn = TURN_SPEED * dt * turnBoost;
    if (Math.abs(deltaYaw) <= maxTurn) c.yaw = c.ai.desiredYaw;
    else c.yaw = normalizeAngle(c.yaw + Math.sign(deltaYaw) * maxTurn);

    if (c.ai.mode === "move") {
      const speedScale = avoidance ? 1 - avoidance.strength * 0.3 : 1;
      const speed = MOVE_SPEED * Math.max(0.55, speedScale);
      c.x += Math.sin(c.yaw) * speed * dt;
      c.z += Math.cos(c.yaw) * speed * dt;
    }

    if (now >= c.ai.nextPitchDecisionAt) {
      c.ai.desiredPitch = rand(-0.3, 0.3);
      c.ai.nextPitchDecisionAt = now + rand(320, 980);
    }
    const pitchSmooth = 1 - Math.exp(-dt * 4.2);
    c.pitch = clampPitch(c.pitch + (c.ai.desiredPitch - c.pitch) * pitchSmooth);

    clampInsideRoom(c, { steerOnClamp: true });
    const shelfHitNormal = resolveShelfCollisions(c);
    if (shelfHitNormal) {
      c.ai.mode = "move";
      c.ai.desiredYaw = normalizeAngle(Math.atan2(shelfHitNormal.x, shelfHitNormal.z));
      c.yaw = c.ai.desiredYaw;
      c.ai.nextDecisionAt = now + rand(300, 700);
    }
  }

  function updatePlayer(c, session, dt) {
    const input = session.input;
    c.yaw = input.yaw;
    c.pitch = input.pitch;

    let localX = 0;
    let localZ = 0;
    if (input.forward) localZ += 1;
    if (input.backward) localZ -= 1;
    if (input.left) localX -= 1;
    if (input.right) localX += 1;

    const len = Math.hypot(localX, localZ);
    if (len > 0.001) {
      localX /= len;
      localZ /= len;

      const worldX = localX * Math.cos(c.yaw) - localZ * Math.sin(c.yaw);
      const worldZ = -localX * Math.sin(c.yaw) - localZ * Math.cos(c.yaw);

      const sprintScale = input.sprint ? PLAYER_SPRINT_MULTIPLIER : 1;
      const playerSpeed = MOVE_SPEED * sprintScale;
      c.x += worldX * playerSpeed * dt;
      c.z += worldZ * playerSpeed * dt;
    }

    clampInsideRoom(c);
    resolveShelfCollisions(c);
  }

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

    session.authenticated = true;
    session.name = normalizedName;
    session.state = "lobby";
    session.ready = false;
    session.readyAt = 0;
    if (lobbyCountdown && countdownReadyNames.has(normalizedName.toLowerCase())) {
      session.ready = true;
      toCountdownState(session, lobbyCountdown.endsAt);
    }

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

    if (msg.type === "ready" || msg.type === "play") {
      if (session.state === "alive") return "ok";
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
      }
      return "ok";
    }

    if (msg.type === "leave_match") {
      if (session.state === "alive") {
        releaseOwnedCharacter(sessionId);
        returnToLobby(session, "left_match");
        appendSystemChat([
          { type: "player", name: session.name },
          { type: "text", text: " återgick till lobbyn" }
        ]);
      }
      return "ok";
    }

    if (msg.type === "input") {
      if (at - session.net.lastInputAt < INPUT_UPDATE_MIN_MS) {
        return dropMessage(session, "rate_input") ? "abuse" : "dropped";
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
    disconnectIdleSessions(now);

    if (lobbyCountdown) {
      if (countdownPlayerCount() <= 1) {
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
        updateAI(c, dt, now);
        continue;
      }

      const ownerSession = c.ownerSessionId ? sessions.get(c.ownerSessionId) : null;
      if (!ownerSession || ownerSession.state !== "alive") {
        c.controllerType = "AI";
        c.ownerSessionId = null;
        continue;
      }

      updatePlayer(c, ownerSession, dt);

      if (ownerSession.input.attackRequested) {
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

    const worldState = {
      roomHalfSize: ROOM_HALF_SIZE,
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
        downedDurationMs: KNOCKDOWN_DURATION_MS,
        fallAwayX: Number((c.fallAwayX || 0).toFixed(3)),
        fallAwayZ: Number((c.fallAwayZ || 1).toFixed(3))
      }))
    };

    for (const [sessionId, ws] of sockets.entries()) {
      const session = sessions.get(sessionId);
      const playerCharacter =
        session && session.characterId != null ? characters[session.characterId] : null;
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
              maxPlayers: MAX_PLAYERS,
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
    roomHalfSize: ROOM_HALF_SIZE,
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
        if (countdownPlayerCount() <= 1) {
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

    const session = {
      id: sessionId,
      authenticated: false,
      name: null,
      state: "auth",
      ready: false,
      readyAt: 0,
      characterId: null,
      stats: {
        wins: 0,
        kills: 0,
        deaths: 0,
        innocents: 0
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

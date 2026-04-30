import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  ROOM_HALF_SIZE,
  MAX_PLAYERS,
  TOTAL_CHARACTERS,
  TICK_MS,
  MOVE_SPEED,
  TURN_SPEED,
  AI_DECISION_MS_MIN,
  AI_DECISION_MS_MAX,
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  ATTACK_HALF_ANGLE,
  ATTACK_FLASH_MS,
  CHARACTER_RADIUS,
  HEARTBEAT_INTERVAL_MS,
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
  SHELVES
} from "./config.js";
import { normalizeAngle, canAttack, markAttack, collectVictimIds } from "./runtime/combat.js";
import { rawSizeBytes, rawToText } from "./runtime/net.js";

const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 20;
const CHAT_MAX_LEN = 220;
const CHAT_HISTORY_LIMIT = 80;

export function attachGameRuntime({ server }) {
  const sessions = new Map();
  const sockets = new Map();
  const characters = [];
  const chatHistory = [];
  const invariantLastLogAt = new Map();

  for (let i = 0; i < TOTAL_CHARACTERS; i += 1) characters.push(createCharacter(i));

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomSpawn() {
    return {
      x: rand(-ROOM_HALF_SIZE + 1, ROOM_HALF_SIZE - 1),
      z: rand(-ROOM_HALF_SIZE + 1, ROOM_HALF_SIZE - 1),
      yaw: rand(-Math.PI, Math.PI)
    };
  }

  function createCharacter(id) {
    const p = randomSpawn();
    return {
      id,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      controllerType: "AI",
      ownerSessionId: null,
      lastAttackAt: 0,
      ai: {
        mode: "move",
        desiredYaw: p.yaw,
        nextDecisionAt: Date.now() + rand(AI_DECISION_MS_MIN, AI_DECISION_MS_MAX)
      }
    };
  }

  function respawnAsAI(charId) {
    const c = characters[charId];
    const p = randomSpawn();
    c.x = p.x;
    c.z = p.z;
    c.yaw = p.yaw;
    c.controllerType = "AI";
    c.ownerSessionId = null;
    c.lastAttackAt = 0;
    c.ai.mode = "move";
    c.ai.desiredYaw = p.yaw;
    c.ai.nextDecisionAt = Date.now() + rand(AI_DECISION_MS_MIN, AI_DECISION_MS_MAX);
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
    return `connected=${sockets.size} loggedIn=${authenticatedCount()} alive=${activePlayerCount()} countdown=${countdownPlayerCount()}`;
  }

  function logEvent(event, details = {}) {
    const sid = details.sessionId || "-";
    if (event === "runtime_started") {
      console.log(
        `[game] runtime started roomHalf=${details.roomHalfSize} maxPlayers=${details.maxPlayers} chars=${details.totalCharacters}`
      );
      return;
    }
    if (event === "session_connected") {
      console.log(
        `[game] connect sid=${sid} ip=${details.ip || "-"} origin=${details.origin || "-"} ${stateSummary()}`
      );
      return;
    }
    if (event === "session_disconnected") {
      const code = details.code == null ? "-" : String(details.code);
      console.log(
        `[game] disconnect sid=${sid} reason=${details.reason || "-"} code=${code} ${stateSummary()}`
      );
      return;
    }
    if (event === "session_login") {
      console.log(`[game] login sid=${sid} name=${details.name} ${stateSummary()}`);
      return;
    }
    if (event === "countdown_start") {
      console.log(`[game] countdown sid=${sid} seconds=${details.seconds ?? "-"}`);
      return;
    }
    if (event === "session_possess") {
      console.log(
        `[game] possess sid=${sid} name=${details.name || "-"} char=${details.characterId} at=(${details.x},${details.z}) yaw=${details.yaw}`
      );
      return;
    }
    if (event === "attack") {
      const victimList =
        Array.isArray(details.victimCharacterIds) && details.victimCharacterIds.length > 0
          ? details.victimCharacterIds.join(",")
          : "-";
      console.log(
        `[game] attack sid=${sid} char=${details.attackerCharacterId} victims=${details.victims ?? 0} ids=${victimList}`
      );
      return;
    }
    if (event === "player_eliminated") {
      console.log(`[game] eliminated sid=${sid} name=${details.name || "-"} char=${details.characterId}`);
      return;
    }
    if (event === "character_respawn") {
      console.log(
        `[game] respawn char=${details.characterId} at=(${details.x},${details.z}) yaw=${details.yaw}`
      );
      return;
    }
    if (event === "chat") {
      console.log(`[game] chat sid=${sid} name=${details.name || "-"} msg=${details.text || ""}`);
      return;
    }
    if (event === "heartbeat_timeout") {
      console.log(`[game] heartbeat-timeout sid=${sid}`);
      return;
    }
    if (event === "message_drop") {
      console.log(
        `[game] drop sid=${sid} reason=${details.reason || "-"} total=${details.droppedTotal ?? 0} window=${details.droppedInWindow ?? 0}`
      );
      return;
    }
    console.log(`[game] ${event} ${stateSummary()}`);
  }

  function warnInvariant(key, now, details) {
    const last = invariantLastLogAt.get(key) ?? 0;
    if (now - last < INVARIANT_LOG_COOLDOWN_MS) return;
    invariantLastLogAt.set(key, now);
    console.warn(`[invariant:${key}] ${details}`);
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
    if (session.state === "alive" || session.state === "countdown") return "spelar";
    if (session.state === "lobby") return "lobby";
    return "disconnected";
  }

  function scoreboardSnapshot() {
    return authenticatedSessions()
      .map((s) => ({
        name: s.name,
        kills: s.stats.kills,
        deaths: s.stats.deaths,
        innocents: s.stats.innocents,
        status: statusLabel(s)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));
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

  function assignCharacterToSession(sessionId, now) {
    const session = sessions.get(sessionId);
    if (!session || !session.authenticated) return;
    if (session.state === "alive") return;

    const available = characters.find((c) => c.controllerType === "AI" && c.ownerSessionId == null);
    if (!available) {
      session.state = "lobby";
      sendToSession(sessionId, "action_error", { message: "Ingen ledig karaktär just nu." });
      return;
    }

    available.controllerType = "PLAYER";
    available.ownerSessionId = sessionId;

    session.state = "alive";
    session.characterId = available.id;
    session.readyAt = now;
    session.input.yaw = available.yaw;
    session.input.attackRequested = false;

    logEvent("session_possess", {
      sessionId: shortSessionId(sessionId),
      name: session.name,
      characterId: available.id,
      x: Number(available.x.toFixed(2)),
      z: Number(available.z.toFixed(2)),
      yaw: Number(available.yaw.toFixed(2))
    });
    sendToSession(sessionId, "possess", { characterId: available.id });
  }

  function scheduleCountdown(sessionId, seconds, now) {
    const s = sessions.get(sessionId);
    if (!s || !s.authenticated) return;
    if (s.state !== "lobby") return;
    s.state = "countdown";
    s.readyAt = now + seconds * 1000;
    s.input.attackRequested = false;
    logEvent("countdown_start", {
      sessionId: shortSessionId(sessionId),
      seconds
    });
    sendToSession(sessionId, "countdown", { seconds });
  }

  function returnToLobby(session) {
    if (!session) return;
    session.state = "lobby";
    session.characterId = null;
    session.readyAt = 0;
    session.input.attackRequested = false;
  }

  function handleCharacterEliminated(charId, now) {
    const c = characters[charId];
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
        returnToLobby(ownerSession);
      }
    }

    respawnAsAI(charId);
    const respawned = characters[charId];
    logEvent("character_respawn", {
      characterId: charId,
      x: Number(respawned.x.toFixed(2)),
      z: Number(respawned.z.toFixed(2)),
      yaw: Number(respawned.yaw.toFixed(2))
    });
  }

  function handleAttack(attackerId, now) {
    const attacker = characters[attackerId];
    if (!attacker) return;
    if (!canAttack({ attacker, now, cooldownMs: ATTACK_COOLDOWN_MS })) return;
    markAttack(attacker, now);

    const victims = collectVictimIds({
      characters,
      attackerId,
      attackRange: ATTACK_RANGE,
      attackHalfAngle: ATTACK_HALF_ANGLE
    });

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
      handleCharacterEliminated(victimId, now);
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
  const SHELF_AVOIDANCE_MARGIN = 0.8;

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

    for (const shelf of SHELVES) {
      const halfW = shelf.width * 0.5;
      const halfD = shelf.depth * 0.5;
      const minX = shelf.x - halfW;
      const maxX = shelf.x + halfW;
      const minZ = shelf.z - halfD;
      const maxZ = shelf.z + halfD;

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

  function resolveShelfCollisions(character) {
    let hit = false;
    let pushX = 0;
    let pushZ = 0;

    for (const shelf of SHELVES) {
      const halfW = shelf.width * 0.5;
      const halfD = shelf.depth * 0.5;
      const minX = shelf.x - halfW - CHARACTER_RADIUS;
      const maxX = shelf.x + halfW + CHARACTER_RADIUS;
      const minZ = shelf.z - halfD - CHARACTER_RADIUS;
      const maxZ = shelf.z + halfD + CHARACTER_RADIUS;

      if (character.x < minX || character.x > maxX || character.z < minZ || character.z > maxZ) continue;

      hit = true;
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

      c.x += worldX * MOVE_SPEED * dt;
      c.z += worldZ * MOVE_SPEED * dt;
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
      sendToSession(sessionId, "login_error", { message: "Spelet är fullt." });
      return "ok";
    }

    if (findAuthenticatedByName(normalizedName)) {
      sendToSession(sessionId, "login_error", { message: "Namnet är upptaget." });
      return "ok";
    }

    session.authenticated = true;
    session.name = normalizedName;
    session.state = "lobby";
    session.readyAt = 0;

    logEvent("session_login", {
      sessionId: shortSessionId(sessionId),
      name: normalizedName
    });

    sendToSession(sessionId, "login_ok", {
      name: normalizedName,
      chatHistory,
      maxPlayers: MAX_PLAYERS
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

    if (msg.type === "play") {
      if (session.state === "lobby") scheduleCountdown(sessionId, 3, at);
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
      if (typeof input.yaw === "number" && Number.isFinite(input.yaw)) {
        session.input.yaw = normalizeAngle(input.yaw);
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

  let lastTickAt = Date.now();
  const tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTickAt) / 1000);
    lastTickAt = now;
    checkInvariants(now);

    for (const [sessionId, session] of sessions.entries()) {
      if (!session.authenticated) continue;
      if (session.state === "countdown" && now >= session.readyAt) assignCharacterToSession(sessionId, now);
    }

    for (const c of characters) {
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

    const alivePlayers = activePlayerCount();
    const scoreboard = scoreboardSnapshot();

    const worldState = {
      roomHalfSize: ROOM_HALF_SIZE,
      shelves: SHELVES,
      scoreboard,
      characters: characters.map((c) => ({
        id: c.id,
        x: Number(c.x.toFixed(3)),
        z: Number(c.z.toFixed(3)),
        yaw: Number(c.yaw.toFixed(3)),
        cooldownMsRemaining: Math.max(0, ATTACK_COOLDOWN_MS - (now - c.lastAttackAt)),
        attackFlashMsRemaining: Math.max(0, ATTACK_FLASH_MS - (now - c.lastAttackAt))
      }))
    };

    for (const [sessionId, ws] of sockets.entries()) {
      const session = sessions.get(sessionId);
      const playerCharacter =
        session && session.characterId != null ? characters[session.characterId] : null;
      send(ws, "world", {
        ...worldState,
        session: session
          ? {
              state: session.state,
              authenticated: session.authenticated,
              name: session.name,
              characterId: session.characterId,
              countdownMsRemaining: session.state === "countdown" ? Math.max(0, session.readyAt - now) : 0,
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
        const staleSessionId = [...sockets.entries()].find(([, socket]) => socket === ws)?.[0] || null;
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

  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      console.warn(`[ws-origin-block] Rejected origin: ${origin || "<missing>"}`);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const sessionId = randomUUID();
    const now = Date.now();
    ws.isAlive = true;
    let cleanedUp = false;

    const cleanupSession = (reason, details = {}) => {
      if (cleanedUp) return;
      cleanedUp = true;

      const closingSession = sessions.get(sessionId);
      if (closingSession?.characterId != null) {
        const c = characters[closingSession.characterId];
        if (c && c.ownerSessionId === sessionId) {
          c.controllerType = "AI";
          c.ownerSessionId = null;
        }
      }

      if (closingSession?.authenticated && closingSession.name) {
        appendSystemChat([
          { type: "player", name: closingSession.name },
          { type: "text", text: " lämnade spelet" }
        ]);
      }

      sessions.delete(sessionId);
      sockets.delete(sessionId);
      logEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        reason,
        ...details
      });
    };

    const session = {
      id: sessionId,
      authenticated: false,
      name: null,
      state: "auth",
      readyAt: 0,
      characterId: null,
      stats: {
        kills: 0,
        deaths: 0,
        innocents: 0
      },
      input: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        yaw: 0,
        attackRequested: false
      },
      net: {
        lastInputAt: 0,
        lastAttackRequestAt: 0,
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
    send(ws, "welcome", { sessionId, maxPlayers: MAX_PLAYERS });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      const result = processClientMessage(sessionId, raw);
      if (result === "abuse") {
        const activeSession = sessions.get(sessionId);
        const reason = activeSession?.net.lastDropReason || "unknown";
        const dropped = activeSession?.net.droppedMessages ?? 0;
        console.warn(
          `[game] abuse-kick sid=${shortSessionId(sessionId)} origin=${req?.headers?.origin || "-"} reason=${reason} dropped=${dropped}`
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

  server.on("close", () => {
    clearInterval(tickInterval);
    clearInterval(heartbeatInterval);
    wss.close();
  });
}

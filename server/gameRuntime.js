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
import { createQueueController } from "./runtime/queue.js";
import { normalizeAngle, canAttack, markAttack, collectVictimIds } from "./runtime/combat.js";
import { rawSizeBytes, rawToText } from "./runtime/net.js";

export function attachGameRuntime({ server }) {
  const sessions = new Map();
  const sockets = new Map();
  const characters = [];
  const waitingQueue = [];
  const invariantLastLogAt = new Map();

  for (let i = 0; i < TOTAL_CHARACTERS; i += 1) {
    characters.push(createCharacter(i));
  }

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

  function activePlayerCount() {
    let count = 0;
    for (const s of sessions.values()) {
      if (s.state === "alive" && s.characterId != null) count += 1;
    }
    return count;
  }

  function countdownPlayerCount() {
    let count = 0;
    for (const s of sessions.values()) {
      if (s.state === "countdown") count += 1;
    }
    return count;
  }

  function shortSessionId(sessionId) {
    return sessionId ? String(sessionId).slice(0, 8) : null;
  }

  function logEvent(event, details = {}) {
    const payload = {
      ts: new Date().toISOString(),
      event,
      sessions: sessions.size,
      alive: activePlayerCount(),
      countdown: countdownPlayerCount(),
      queue: waitingQueue.length,
      ...details
    };
    console.log(`[game] ${JSON.stringify(payload)}`);
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

  function send(ws, type, payload = {}) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function sendToSession(sessionId, type, payload = {}) {
    const ws = sockets.get(sessionId);
    if (!ws) return;
    send(ws, type, payload);
  }

  const queue = createQueueController({ sessions, waitingQueue, sendToSession });

  function removeFromQueueWithLog(sessionId, reason) {
    const wasQueued = waitingQueue.includes(sessionId);
    queue.removeFromQueue(sessionId);
    if (!wasQueued) return;
    logEvent("queue_remove", {
      sessionId: shortSessionId(sessionId),
      reason
    });
  }

  function enqueueSessionWithLog(sessionId, reason) {
    queue.enqueueSession(sessionId);
    const session = sessions.get(sessionId);
    logEvent("queue_enqueue", {
      sessionId: shortSessionId(sessionId),
      reason,
      queuePosition: session?.queuePosition ?? null
    });
  }

  function dequeueNextWithLog(reason) {
    const sessionId = queue.dequeueNext();
    if (!sessionId) return null;
    logEvent("queue_dequeue", {
      sessionId: shortSessionId(sessionId),
      reason
    });
    return sessionId;
  }

  function assignCharacterToSession(sessionId, now) {
    const session = sessions.get(sessionId);
    if (!session) return;
    removeFromQueueWithLog(sessionId, "assign_character");

    if (activePlayerCount() >= MAX_PLAYERS) {
      enqueueSessionWithLog(sessionId, "assign_denied_full");
      return;
    }

    const available = characters.find((c) => c.controllerType === "AI" && c.ownerSessionId == null);
    if (!available) {
      enqueueSessionWithLog(sessionId, "assign_denied_no_ai");
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
      characterId: available.id,
      x: Number(available.x.toFixed(2)),
      z: Number(available.z.toFixed(2)),
      yaw: Number(available.yaw.toFixed(2))
    });
    sendToSession(sessionId, "possess", { characterId: available.id });
  }

  function scheduleCountdown(sessionId, seconds, now) {
    const s = sessions.get(sessionId);
    if (!s) return;
    removeFromQueueWithLog(sessionId, "countdown_start");
    s.state = "countdown";
    s.readyAt = now + seconds * 1000;
    s.input.attackRequested = false;
    logEvent("countdown_start", {
      sessionId: shortSessionId(sessionId),
      seconds
    });
    sendToSession(sessionId, "countdown", { seconds });
  }

  function handleCharacterEliminated(charId, now) {
    const c = characters[charId];
    const owner = c.ownerSessionId;

    if (owner) {
      const ownerSession = sessions.get(owner);
      if (ownerSession) {
        logEvent("player_eliminated", {
          sessionId: shortSessionId(owner),
          characterId: charId
        });
        ownerSession.characterId = null;
        scheduleCountdown(owner, 3, now);
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

    logEvent("attack", {
      attackerSessionId: shortSessionId(attacker.ownerSessionId),
      attackerCharacterId: attackerId,
      victims: victims.length,
      victimCharacterIds: victims
    });

    for (const victimId of victims) {
      handleCharacterEliminated(victimId, now);
    }
  }

  const ROOM_BOUNDARY_MIN = -ROOM_HALF_SIZE + 0.5;
  const ROOM_BOUNDARY_MAX = ROOM_HALF_SIZE - 0.5;
  const WALL_AVOIDANCE_MARGIN = 1.5;
  const SHELF_AVOIDANCE_MARGIN = 1.1;

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

      if (character.x < minX || character.x > maxX || character.z < minZ || character.z > maxZ) {
        continue;
      }

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

      const worldX = localX * Math.cos(c.yaw) + localZ * Math.sin(c.yaw);
      const worldZ = -localX * Math.sin(c.yaw) + localZ * Math.cos(c.yaw);

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
      if (session.state === "countdown" && now >= session.readyAt) {
        assignCharacterToSession(sessionId, now);
      }
    }

    const alivePlayers = activePlayerCount();
    const countdownPlayers = countdownPlayerCount();
    let availablePlayerSlots = Math.max(0, MAX_PLAYERS - (alivePlayers + countdownPlayers));

    while (availablePlayerSlots > 0 && waitingQueue.length > 0) {
      const queuedSessionId = dequeueNextWithLog("slot_opened");
      if (!queuedSessionId) continue;
      const queuedSession = sessions.get(queuedSessionId);
      if (!queuedSession) continue;
      if (queuedSession.state !== "full") continue;
      scheduleCountdown(queuedSessionId, 3, now);
      availablePlayerSlots -= 1;
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

    const worldState = {
      roomHalfSize: ROOM_HALF_SIZE,
      shelves: SHELVES,
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
              characterId: session.characterId,
              countdownMsRemaining:
                session.state === "countdown" ? Math.max(0, session.readyAt - now) : 0,
              activePlayers: alivePlayers,
              maxPlayers: MAX_PLAYERS,
              queuePosition: session.inQueue ? session.queuePosition : null,
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
      removeFromQueueWithLog(sessionId, `cleanup:${reason}`);
      const releasedCharacterId = closingSession?.characterId ?? null;
      if (closingSession?.characterId != null) {
        const c = characters[closingSession.characterId];
        if (c && c.ownerSessionId === sessionId) {
          c.controllerType = "AI";
          c.ownerSessionId = null;
        }
      }

      sessions.delete(sessionId);
      sockets.delete(sessionId);
      logEvent("session_disconnected", {
        sessionId: shortSessionId(sessionId),
        reason,
        releasedCharacterId,
        ...details
      });
    };

    const session = {
      id: sessionId,
      state: "countdown",
      inQueue: false,
      queuePosition: null,
      readyAt: now + 3000,
      characterId: null,
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
    send(ws, "welcome", { sessionId });

    const hasQueue = waitingQueue.length > 0;
    const slotsTaken = activePlayerCount() + countdownPlayerCount();
    if (hasQueue || slotsTaken >= MAX_PLAYERS) enqueueSessionWithLog(sessionId, "connect_full_or_queue");
    else scheduleCountdown(sessionId, 3, now);

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
          `[ws-abuse-kick:${sessionId}] origin=${req?.headers?.origin || "<missing>"} reason=${reason} dropped=${dropped}`
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
      const closeReason =
        closeReasonBuffer && closeReasonBuffer.length > 0 ? closeReasonBuffer.toString() : "";
      cleanupSession("socket_close", { code, closeReason });
    });
  });

  server.on("close", () => {
    clearInterval(tickInterval);
    clearInterval(heartbeatInterval);
    wss.close();
  });
}

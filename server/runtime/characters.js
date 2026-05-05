import { obstacleHalfExtents } from "./physics.js";

/**
 * Create the character management system for a room.
 *
 * @param {{
 *   totalCharacters: number,
 *   worldWidthMeters: number,
 *   worldHeightMeters: number,
 *   obstacles: object[],
 *   characterRadius: number,
 *   aiDecisionMsMin: number,
 *   aiDecisionMsMax: number,
 *   npcDownedRespawnMs: number,
 *   permanentDownedUntil: number,
 *   maxLookPitchRad: number,
 *   getActiveMatchStartedAt: () => number,
 *   rand: (min: number, max: number) => number,
 * }} deps
 */
export function createCharacterSystem({
  totalCharacters,
  worldWidthMeters,
  worldHeightMeters,
  obstacles,
  characterRadius,
  aiDecisionMsMin,
  aiDecisionMsMax,
  npcDownedRespawnMs,
  permanentDownedUntil,
  maxLookPitchRad,
  getActiveMatchStartedAt,
  rand
}) {
  // ─── Spawn ────────────────────────────────────────────────────────────────

  function isSpawnBlocked(x, z, margin = characterRadius + 0.14) {
    for (const obstacle of obstacles) {
      const { halfW, halfD } = obstacleHalfExtents(obstacle);
      const minX = obstacle.x - halfW - margin;
      const maxX = obstacle.x + halfW + margin;
      const minZ = obstacle.z - halfD - margin;
      const maxZ = obstacle.z + halfD + margin;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
    }
    return false;
  }

  function randomSpawn() {
    const minX = -worldWidthMeters * 0.5 + 0.5;
    const maxX = worldWidthMeters * 0.5 - 0.5;
    const minZ = -worldHeightMeters * 0.5 + 0.5;
    const maxZ = worldHeightMeters * 0.5 - 0.5;
    for (let i = 0; i < 180; i += 1) {
      const x = rand(minX, maxX);
      const z = rand(minZ, maxZ);
      if (isSpawnBlocked(x, z)) continue;
      return { x, z, yaw: rand(-Math.PI, Math.PI) };
    }
    const step = Math.max(0.6, characterRadius * 2.4);
    for (let x = minX; x <= maxX; x += step) {
      for (let z = minZ; z <= maxZ; z += step) {
        if (isSpawnBlocked(x, z)) continue;
        return { x, z, yaw: rand(-Math.PI, Math.PI) };
      }
    }
    return { x: 0, z: 0, yaw: rand(-Math.PI, Math.PI) };
  }

  // ─── Character lifecycle ──────────────────────────────────────────────────

  function clampPitch(value) {
    return Math.max(-maxLookPitchRad, Math.min(maxLookPitchRad, value));
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
      everPlayerControlled: false,
      lastAttackAt: 0,
      downedUntil: 0,
      fallAwayX: 0,
      fallAwayZ: 1,
      ai: {
        mode: "move",
        desiredYaw: p.yaw,
        nextDecisionAt: Date.now() + rand(aiDecisionMsMin, aiDecisionMsMax),
        desiredPitch: rand(-0.28, 0.28),
        nextPitchDecisionAt: Date.now() + rand(320, 980)
      }
    };
  }

  const characters = [];
  for (let i = 0; i < totalCharacters; i += 1) characters.push(createCharacter(i));

  // ─── State helpers ────────────────────────────────────────────────────────

  function isCharacterDowned(character, now) {
    return Boolean(character) && now < (character.downedUntil || 0);
  }

  function clearDownedState(character) {
    character.downedUntil = 0;
    character.fallAwayX = 0;
    character.fallAwayZ = 1;
  }

  function normalizeHorizontalVector(x, z, fallbackX = 0, fallbackZ = 1) {
    const len = Math.hypot(x, z);
    if (len < 0.0001) return { x: fallbackX, z: fallbackZ };
    return { x: x / len, z: z / len };
  }

  function computeFallAwayVector(attacker, victim) {
    if (attacker && victim) {
      return normalizeHorizontalVector(
        victim.x - attacker.x,
        victim.z - attacker.z,
        Math.sin(victim.yaw),
        Math.cos(victim.yaw)
      );
    }
    return normalizeHorizontalVector(Math.sin(victim?.yaw || 0), Math.cos(victim?.yaw || 0), 0, 1);
  }

  function downCharacter(victim, now, fallAwayX, fallAwayZ) {
    const stayDownPermanently = getActiveMatchStartedAt() > 0 && victim.everPlayerControlled;
    victim.downedUntil = stayDownPermanently ? permanentDownedUntil : now + npcDownedRespawnMs;
    victim.fallAwayX = fallAwayX;
    victim.fallAwayZ = fallAwayZ;
    victim.lastAttackAt = now;
    victim.ai.mode = "stop";
    victim.ai.desiredYaw = victim.yaw;
    victim.ai.nextDecisionAt = victim.downedUntil + rand(120, 360);
  }

  // ─── Arena management ─────────────────────────────────────────────────────

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
      c.everPlayerControlled = false;
      c.lastAttackAt = 0;
      clearDownedState(c);
      c.ai.mode = "move";
      c.ai.desiredYaw = spawn.yaw;
      c.ai.nextDecisionAt = now + rand(aiDecisionMsMin, aiDecisionMsMax);
      c.ai.desiredPitch = rand(-0.3, 0.3);
      c.ai.nextPitchDecisionAt = now + rand(320, 980);
    }
  }

  return {
    characters,
    clampPitch,
    randomSpawn,
    isCharacterDowned,
    clearDownedState,
    computeFallAwayVector,
    downCharacter,
    releaseOwnedCharacter,
    resetArenaForNextRound
  };
}

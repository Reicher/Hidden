import { normalizeAngle } from "./combat.js";
import { clampInsideRoom, wallAvoidance, shelfAvoidance, resolveShelfCollisions } from "./physics.js";

const DEFAULT_INSPECT_DOWNED_CHANCE = 0.75;
const DEFAULT_INSPECT_DOWNED_NEARBY_RADIUS = 8.5;
const INSPECT_DOWNED_MIN_MS = 1800;
const INSPECT_DOWNED_MAX_MS = 4800;
const INSPECT_DOWNED_RECHECK_MIN_MS = 540;
const INSPECT_DOWNED_RECHECK_MAX_MS = 980;
const INSPECT_DOWNED_ARRIVE_DISTANCE = 0.24;
const INSPECT_DOWNED_HEAD_OFFSET_METERS = 0.58;
const INSPECT_DOWNED_LOOK_PITCH = -0.42;
const INSPECT_PITCH_HOLD_MS = 260;
const INSPECT_WANDER_HOLD_MS = 220;
const SOCIAL_SEPARATION_RADIUS = 2.4;
const DEFAULT_SOCIAL_SEPARATION_WEIGHT = 0.18;
const DEFAULT_STOP_CHANCE = 0.25;
const DEFAULT_MOVE_DECISION_INTERVAL_MIN_MS = 600;
const DEFAULT_MOVE_DECISION_INTERVAL_MAX_MS = 1800;
const DEFAULT_STOP_DURATION_MIN_MS = 600;
const DEFAULT_STOP_DURATION_MAX_MS = 1800;

function inspectSlotFor(c, target) {
  const seed = (c.id * 73856093 + target.id * 19349663) >>> 0;
  const angle = ((seed % 6283) / 1000) % (Math.PI * 2);
  const radius = 0.88 + (((seed >>> 8) % 1000) / 1000) * 0.52;
  return { angle, radius };
}

function ensureAIState(c) {
  if (!c.ai || typeof c.ai !== "object") c.ai = {};
  if (!Number.isFinite(c.ai.avoidanceX)) c.ai.avoidanceX = 0;
  if (!Number.isFinite(c.ai.avoidanceZ)) c.ai.avoidanceZ = 0;
  if (!Number.isFinite(c.ai.nextAvoidanceRetargetAt)) c.ai.nextAvoidanceRetargetAt = 0;
  if (!Number.isFinite(c.ai.nextInspectDecisionAt)) c.ai.nextInspectDecisionAt = 0;
  if (!Number.isFinite(c.ai.inspectDownedUntil)) c.ai.inspectDownedUntil = 0;
  if (!Number.isFinite(c.ai.inspectDownedAngle)) c.ai.inspectDownedAngle = 0;
  if (!Number.isFinite(c.ai.inspectDownedRadius)) c.ai.inspectDownedRadius = 1.05;
  if (!Number.isFinite(c.ai.inspectDownedTargetId)) c.ai.inspectDownedTargetId = -1;
  if (!Number.isFinite(c.ai.stopUntil)) c.ai.stopUntil = 0;
}

function findCharacterById(characters, id) {
  if (!Array.isArray(characters) || !Number.isFinite(id) || id < 0) return null;
  const byIndex = characters[id];
  if (byIndex?.id === id) return byIndex;
  return characters.find((character) => character?.id === id) || null;
}

function socialSeparation(c, characters, { skipCharacterId = -1, isCharacterDowned = null, now = 0 } = {}) {
  let ax = 0;
  let az = 0;
  for (const other of characters) {
    if (!other || other.id === c.id || other.id === skipCharacterId) continue;
    if (typeof isCharacterDowned === "function" && isCharacterDowned(other, now)) continue;
    const dx = c.x - other.x;
    const dz = c.z - other.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001 || dist >= SOCIAL_SEPARATION_RADIUS) continue;
    const falloff = 1 - dist / SOCIAL_SEPARATION_RADIUS;
    ax += (dx / dist) * falloff;
    az += (dz / dist) * falloff;
  }
  const len = Math.hypot(ax, az);
  if (len < 0.001) return null;
  return { x: ax / len, z: az / len, strength: Math.min(1, len) };
}

function downedHeadPoint(target) {
  const rawX = Number(target?.fallAwayX);
  const rawZ = Number(target?.fallAwayZ);
  let dirX = Number.isFinite(rawX) ? rawX : 0;
  let dirZ = Number.isFinite(rawZ) ? rawZ : 1;
  const len = Math.hypot(dirX, dirZ);
  if (len > 0.001) {
    dirX /= len;
    dirZ /= len;
  } else {
    dirX = Math.sin(Number(target?.yaw || 0));
    dirZ = Math.cos(Number(target?.yaw || 0));
    const fallbackLen = Math.hypot(dirX, dirZ);
    if (fallbackLen > 0.001) {
      dirX /= fallbackLen;
      dirZ /= fallbackLen;
    } else {
      dirX = 0;
      dirZ = 1;
    }
  }
  return {
    x: Number(target?.x || 0) + dirX * INSPECT_DOWNED_HEAD_OFFSET_METERS,
    z: Number(target?.z || 0) + dirZ * INSPECT_DOWNED_HEAD_OFFSET_METERS
  };
}

/**
 * Create AI and player movement functions bound to a fixed set of world
 * parameters. Call once per room at initialisation time.
 *
 * @param {{
 *   boundaries: { minX: number, maxX: number, minZ: number, maxZ: number },
 *   obstacles: object[],
 *   wallMargin: number,
 *   shelfMargin: number,
 *   characterRadius: number,
 *   aiDecisionMsMin: number,
 *   aiDecisionMsMax: number,
 *   moveSpeed: number,
 *   sprintMultiplier: number,
 *   turnSpeed: number,
 *   inspectDownedChance?: number,
 *   inspectDownedNearbyRadius?: number,
 *   socialSeparationWeight?: number,
 *   stopChance?: number,
 *   moveDecisionIntervalMinMs?: number,
 *   moveDecisionIntervalMaxMs?: number,
 *   stopDurationMinMs?: number,
 *   stopDurationMaxMs?: number,
 *   rand: (min: number, max: number) => number,
 *   clampPitch: (value: number) => number,
 * }} deps
 * @returns {{ updateAI: Function, updatePlayer: Function }}
 */
export function createMovementSystem({
  boundaries,
  obstacles,
  wallMargin,
  shelfMargin,
  characterRadius,
  aiDecisionMsMin,
  aiDecisionMsMax,
  moveSpeed,
  sprintMultiplier,
  turnSpeed,
  inspectDownedChance = DEFAULT_INSPECT_DOWNED_CHANCE,
  inspectDownedNearbyRadius = DEFAULT_INSPECT_DOWNED_NEARBY_RADIUS,
  socialSeparationWeight = DEFAULT_SOCIAL_SEPARATION_WEIGHT,
  stopChance = DEFAULT_STOP_CHANCE,
  moveDecisionIntervalMinMs = DEFAULT_MOVE_DECISION_INTERVAL_MIN_MS,
  moveDecisionIntervalMaxMs = DEFAULT_MOVE_DECISION_INTERVAL_MAX_MS,
  stopDurationMinMs = DEFAULT_STOP_DURATION_MIN_MS,
  stopDurationMaxMs = DEFAULT_STOP_DURATION_MAX_MS,
  rand,
  clampPitch
}) {
  const safeInspectDownedChance = Math.max(0, Math.min(1, Number(inspectDownedChance) || 0));
  const safeInspectDownedNearbyRadius = Math.max(1, Number(inspectDownedNearbyRadius) || DEFAULT_INSPECT_DOWNED_NEARBY_RADIUS);
  const safeSocialSeparationWeight = Math.max(0, Number(socialSeparationWeight) || 0);
  const safeStopChance = Math.max(0, Math.min(1, Number(stopChance) || 0));
  const safeMoveDecisionIntervalMinMs = Math.max(200, Number(moveDecisionIntervalMinMs) || DEFAULT_MOVE_DECISION_INTERVAL_MIN_MS);
  const safeMoveDecisionIntervalMaxMs = Math.max(
    safeMoveDecisionIntervalMinMs,
    Number(moveDecisionIntervalMaxMs) || DEFAULT_MOVE_DECISION_INTERVAL_MAX_MS
  );
  const safeStopDurationMinMs = Math.max(200, Number(stopDurationMinMs) || DEFAULT_STOP_DURATION_MIN_MS);
  const safeStopDurationMaxMs = Math.max(
    safeStopDurationMinMs,
    Number(stopDurationMaxMs) || DEFAULT_STOP_DURATION_MAX_MS
  );

  function nextDecisionDelay() {
    return rand(safeMoveDecisionIntervalMinMs, safeMoveDecisionIntervalMaxMs);
  }

  function nextStopDuration() {
    return rand(safeStopDurationMinMs, safeStopDurationMaxMs);
  }

  /**
   * Advance an AI-controlled character by one tick.
   *
   * @param {object} c    - mutable character state
   * @param {number} dt   - elapsed seconds since last tick
   * @param {number} now  - current timestamp (ms)
   */
  function updateAI(c, dt, now, context = null) {
    ensureAIState(c);

    const characters = Array.isArray(context?.characters) ? context.characters : null;
    const isCharacterDowned =
      typeof context?.isCharacterDowned === "function" ? context.isCharacterDowned : null;

    let inspectTarget = null;
    if (characters && isCharacterDowned && c.ai.inspectDownedTargetId >= 0) {
      const candidate = findCharacterById(characters, c.ai.inspectDownedTargetId);
      if (candidate && !candidate.everPlayerControlled && isCharacterDowned(candidate, now)) {
        inspectTarget = candidate;
      } else {
        c.ai.inspectDownedTargetId = -1;
        c.ai.inspectDownedUntil = 0;
      }
    }

    if (!inspectTarget && characters && isCharacterDowned && now >= c.ai.nextInspectDecisionAt) {
      let nearest = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (const candidate of characters) {
        if (!candidate || candidate.id === c.id) continue;
        if (candidate.everPlayerControlled) continue;
        if (!isCharacterDowned(candidate, now)) continue;
        const dist = Math.hypot(candidate.x - c.x, candidate.z - c.z);
        if (dist > safeInspectDownedNearbyRadius) continue;
        if (dist < nearestDist) {
          nearest = candidate;
          nearestDist = dist;
        }
      }

      if (nearest && Math.random() < safeInspectDownedChance) {
        const slot = inspectSlotFor(c, nearest);
        c.ai.inspectDownedTargetId = nearest.id;
        c.ai.inspectDownedUntil = now + rand(INSPECT_DOWNED_MIN_MS, INSPECT_DOWNED_MAX_MS);
        c.ai.inspectDownedAngle = slot.angle;
        c.ai.inspectDownedRadius = slot.radius;
        inspectTarget = nearest;
      }
      c.ai.nextInspectDecisionAt = now + rand(INSPECT_DOWNED_RECHECK_MIN_MS, INSPECT_DOWNED_RECHECK_MAX_MS);
    }

    const inspectActive =
      inspectTarget &&
      now < c.ai.inspectDownedUntil &&
      c.ai.inspectDownedTargetId === inspectTarget.id;

    if (inspectActive) {
      const slotX = inspectTarget.x + Math.sin(c.ai.inspectDownedAngle) * c.ai.inspectDownedRadius;
      const slotZ = inspectTarget.z + Math.cos(c.ai.inspectDownedAngle) * c.ai.inspectDownedRadius;
      const toSlotX = slotX - c.x;
      const toSlotZ = slotZ - c.z;
      const toSlotDist = Math.hypot(toSlotX, toSlotZ);
      const headPoint = downedHeadPoint(inspectTarget);
      const faceTargetYaw = normalizeAngle(Math.atan2(headPoint.x - c.x, headPoint.z - c.z));
      c.ai.desiredPitch = INSPECT_DOWNED_LOOK_PITCH;
      c.ai.nextPitchDecisionAt = Math.max(c.ai.nextPitchDecisionAt, now + INSPECT_PITCH_HOLD_MS);
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + INSPECT_WANDER_HOLD_MS);
      if (toSlotDist > INSPECT_DOWNED_ARRIVE_DISTANCE) {
        c.ai.mode = "move";
        c.ai.desiredYaw = normalizeAngle(Math.atan2(toSlotX, toSlotZ));
      } else {
        c.ai.mode = "stop";
        c.ai.desiredYaw = faceTargetYaw;
        c.yaw = faceTargetYaw;
      }
    } else if (c.ai.inspectDownedTargetId >= 0 && now >= c.ai.inspectDownedUntil) {
      c.ai.inspectDownedTargetId = -1;
      c.ai.inspectDownedUntil = 0;
    }

    if (!inspectActive && c.ai.mode === "stop" && now >= c.ai.stopUntil) {
      c.ai.mode = "move";
      c.ai.stopUntil = 0;
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + nextDecisionDelay());
    }

    if (!inspectActive && now >= c.ai.nextDecisionAt) {
      if (Math.random() < safeStopChance) {
        c.ai.mode = "stop";
        c.ai.stopUntil = now + nextStopDuration();
        c.ai.nextDecisionAt = c.ai.stopUntil;
        c.ai.desiredYaw = c.yaw;
      } else {
        c.ai.mode = "move";
        c.ai.desiredYaw = normalizeAngle(c.yaw + rand(-Math.PI / 2, Math.PI / 2));
        c.ai.nextDecisionAt = now + nextDecisionDelay();
      }
    }

    const wallPush = wallAvoidance(c, boundaries, wallMargin);
    const shelfPush = shelfAvoidance(c, obstacles, shelfMargin);
    const socialPush = !inspectActive && characters
      ? socialSeparation(c, characters, {
          skipCharacterId: inspectActive ? c.ai.inspectDownedTargetId : -1,
          isCharacterDowned,
          now
        })
      : null;
    let avoidance = null;
    if (wallPush || shelfPush || socialPush) {
      const ax =
        (wallPush?.x || 0) +
        (shelfPush?.x || 0) +
        (socialPush ? socialPush.x * socialPush.strength * safeSocialSeparationWeight : 0);
      const az =
        (wallPush?.z || 0) +
        (shelfPush?.z || 0) +
        (socialPush ? socialPush.z * socialPush.strength * safeSocialSeparationWeight : 0);
      const len = Math.hypot(ax, az);
      if (len > 0.001) {
        avoidance = { x: ax / len, z: az / len, strength: Math.min(1, len) };
      }
    }

    if (avoidance) {
      const avoidSmooth = 1 - Math.exp(-dt * 10);
      c.ai.avoidanceX += (avoidance.x - c.ai.avoidanceX) * avoidSmooth;
      c.ai.avoidanceZ += (avoidance.z - c.ai.avoidanceZ) * avoidSmooth;
      const smoothedLen = Math.hypot(c.ai.avoidanceX, c.ai.avoidanceZ);
      const smoothedAvoidance =
        smoothedLen > 0.001
          ? { x: c.ai.avoidanceX / smoothedLen, z: c.ai.avoidanceZ / smoothedLen }
          : { x: avoidance.x, z: avoidance.z };

      c.ai.mode = "move";
      const shouldRetarget =
        now >= c.ai.nextAvoidanceRetargetAt || avoidance.strength >= 0.85;
      if (shouldRetarget) {
        c.ai.desiredYaw = normalizeAngle(Math.atan2(smoothedAvoidance.x, smoothedAvoidance.z));
        c.ai.nextAvoidanceRetargetAt = now + 160;
      }
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + 260);
    } else {
      const avoidDecay = Math.max(0, 1 - dt * 6);
      c.ai.avoidanceX *= avoidDecay;
      c.ai.avoidanceZ *= avoidDecay;
    }

    const deltaYaw = normalizeAngle(c.ai.desiredYaw - c.yaw);
    const turnBoost = avoidance ? 1 + avoidance.strength * 0.8 : 1;
    const maxTurn = turnSpeed * dt * turnBoost;
    if (Math.abs(deltaYaw) <= maxTurn) c.yaw = c.ai.desiredYaw;
    else c.yaw = normalizeAngle(c.yaw + Math.sign(deltaYaw) * maxTurn);

    if (c.ai.mode === "move") {
      const speed = moveSpeed;
      c.x += Math.sin(c.yaw) * speed * dt;
      c.z += Math.cos(c.yaw) * speed * dt;
    }

    if (now >= c.ai.nextPitchDecisionAt) {
      c.ai.desiredPitch = rand(-0.3, 0.3);
      c.ai.nextPitchDecisionAt = now + rand(320, 980);
    }
    const pitchSmooth = 1 - Math.exp(-dt * 4.2);
    c.pitch = clampPitch(c.pitch + (c.ai.desiredPitch - c.pitch) * pitchSmooth);

    clampInsideRoom(c, boundaries, { steerOnClamp: true });
    const shelfHitNormal = resolveShelfCollisions(c, obstacles, characterRadius);
    if (shelfHitNormal) {
      c.ai.mode = "move";
      c.ai.desiredYaw = normalizeAngle(Math.atan2(shelfHitNormal.x, shelfHitNormal.z));
      c.yaw = c.ai.desiredYaw;
      c.ai.avoidanceX = shelfHitNormal.x;
      c.ai.avoidanceZ = shelfHitNormal.z;
      c.ai.nextAvoidanceRetargetAt = now + 220;
      c.ai.nextDecisionAt = now + rand(300, 700);
    }
  }

  /**
   * Advance a player-controlled character by one tick based on session input.
   *
   * @param {object} c       - mutable character state
   * @param {object} session - session containing `input` state
   * @param {number} dt      - elapsed seconds since last tick
   */
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

      const sprintScale = input.sprint ? sprintMultiplier : 1;
      const playerSpeed = moveSpeed * sprintScale;
      c.x += worldX * playerSpeed * dt;
      c.z += worldZ * playerSpeed * dt;
    }

    clampInsideRoom(c, boundaries);
    resolveShelfCollisions(c, obstacles, characterRadius);
  }

  return { updateAI, updatePlayer };
}

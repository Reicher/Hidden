import { normalizeAngle } from "./combat.js";
import { clampInsideRoom, wallAvoidance, shelfAvoidance, resolveShelfCollisions } from "./physics.js";

const INSPECT_DOWNED_CHANCE = 0.75;
const INSPECT_DOWNED_NEARBY_RADIUS = 8.5;
const INSPECT_DOWNED_MIN_MS = 1800;
const INSPECT_DOWNED_MAX_MS = 4800;
const INSPECT_DOWNED_ARRIVE_DISTANCE = 0.24;
const INSPECT_DOWNED_LOOK_PITCH = -0.42;
const SOCIAL_SEPARATION_RADIUS = 2.4;
const SOCIAL_SEPARATION_WEIGHT = 0.18;
const SOCIAL_SEPARATION_INSPECT_WEIGHT = 0.07;

function inspectSlotFor(c, target) {
  const seed = (c.id * 73856093 + target.id * 19349663) >>> 0;
  const angle = ((seed % 6283) / 1000) % (Math.PI * 2);
  const radius = 0.88 + (((seed >>> 8) % 1000) / 1000) * 0.52;
  return { angle, radius };
}

function socialSeparation(c, characters, skipCharacterId = -1) {
  let ax = 0;
  let az = 0;
  for (const other of characters) {
    if (!other || other.id === c.id || other.id === skipCharacterId) continue;
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
  rand,
  clampPitch
}) {
  /**
   * Advance an AI-controlled character by one tick.
   *
   * @param {object} c    - mutable character state
   * @param {number} dt   - elapsed seconds since last tick
   * @param {number} now  - current timestamp (ms)
   */
  function updateAI(c, dt, now, context = null) {
    if (!Number.isFinite(c.ai.avoidanceX)) c.ai.avoidanceX = 0;
    if (!Number.isFinite(c.ai.avoidanceZ)) c.ai.avoidanceZ = 0;
    if (!Number.isFinite(c.ai.nextAvoidanceRetargetAt)) c.ai.nextAvoidanceRetargetAt = 0;
    if (!Number.isFinite(c.ai.nextInspectDecisionAt)) c.ai.nextInspectDecisionAt = 0;
    if (!Number.isFinite(c.ai.inspectDownedUntil)) c.ai.inspectDownedUntil = 0;
    if (!Number.isFinite(c.ai.inspectDownedAngle)) c.ai.inspectDownedAngle = 0;
    if (!Number.isFinite(c.ai.inspectDownedRadius)) c.ai.inspectDownedRadius = 1.05;
    if (!Number.isFinite(c.ai.inspectDownedTargetId)) c.ai.inspectDownedTargetId = -1;

    const characters = Array.isArray(context?.characters) ? context.characters : null;
    const isCharacterDowned =
      typeof context?.isCharacterDowned === "function" ? context.isCharacterDowned : null;

    let inspectTarget = null;
    if (characters && isCharacterDowned && c.ai.inspectDownedTargetId >= 0) {
      const candidate = characters[c.ai.inspectDownedTargetId];
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
        if (dist > INSPECT_DOWNED_NEARBY_RADIUS) continue;
        if (dist < nearestDist) {
          nearest = candidate;
          nearestDist = dist;
        }
      }

      if (nearest && Math.random() < INSPECT_DOWNED_CHANCE) {
        const slot = inspectSlotFor(c, nearest);
        c.ai.inspectDownedTargetId = nearest.id;
        c.ai.inspectDownedUntil = now + rand(INSPECT_DOWNED_MIN_MS, INSPECT_DOWNED_MAX_MS);
        c.ai.inspectDownedAngle = slot.angle;
        c.ai.inspectDownedRadius = slot.radius;
        inspectTarget = nearest;
      }
      c.ai.nextInspectDecisionAt = now + rand(540, 980);
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
      const faceTargetYaw = normalizeAngle(Math.atan2(inspectTarget.x - c.x, inspectTarget.z - c.z));
      c.ai.desiredPitch = INSPECT_DOWNED_LOOK_PITCH;
      c.ai.nextPitchDecisionAt = Math.max(c.ai.nextPitchDecisionAt, now + 260);
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + 220);
      if (toSlotDist > INSPECT_DOWNED_ARRIVE_DISTANCE) {
        c.ai.mode = "move";
        c.ai.desiredYaw = normalizeAngle(Math.atan2(toSlotX, toSlotZ));
      } else {
        c.ai.mode = "stop";
        c.ai.desiredYaw = faceTargetYaw;
      }
    } else if (c.ai.inspectDownedTargetId >= 0 && now >= c.ai.inspectDownedUntil) {
      c.ai.inspectDownedTargetId = -1;
      c.ai.inspectDownedUntil = 0;
    }

    if (!inspectActive && now >= c.ai.nextDecisionAt) {
      c.ai.mode = Math.random() < 0.25 ? "stop" : "move";
      c.ai.desiredYaw = normalizeAngle(c.yaw + rand(-Math.PI / 2, Math.PI / 2));
      c.ai.nextDecisionAt = now + rand(aiDecisionMsMin, aiDecisionMsMax);
    }

    const wallPush = wallAvoidance(c, boundaries, wallMargin);
    const shelfPush = shelfAvoidance(c, obstacles, shelfMargin);
    const socialPush = characters
      ? socialSeparation(c, characters, inspectActive ? c.ai.inspectDownedTargetId : -1)
      : null;
    let avoidance = null;
    if (wallPush || shelfPush || socialPush) {
      const socialWeight = inspectActive ? SOCIAL_SEPARATION_INSPECT_WEIGHT : SOCIAL_SEPARATION_WEIGHT;
      const ax =
        (wallPush?.x || 0) +
        (shelfPush?.x || 0) +
        (socialPush ? socialPush.x * socialPush.strength * socialWeight : 0);
      const az =
        (wallPush?.z || 0) +
        (shelfPush?.z || 0) +
        (socialPush ? socialPush.z * socialPush.strength * socialWeight : 0);
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

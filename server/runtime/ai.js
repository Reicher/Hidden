import { normalizeAngle } from "./combat.js";
import { clampInsideRoom, wallAvoidance, shelfAvoidance, resolveShelfCollisions } from "./physics.js";

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
  function updateAI(c, dt, now) {
    if (now >= c.ai.nextDecisionAt) {
      c.ai.mode = Math.random() < 0.25 ? "stop" : "move";
      c.ai.desiredYaw = normalizeAngle(c.yaw + rand(-Math.PI / 2, Math.PI / 2));
      c.ai.nextDecisionAt = now + rand(aiDecisionMsMin, aiDecisionMsMax);
    }

    const wallPush = wallAvoidance(c, boundaries, wallMargin);
    const shelfPush = shelfAvoidance(c, obstacles, shelfMargin);
    let avoidance = null;
    if (wallPush || shelfPush) {
      const ax = (wallPush?.x || 0) + (shelfPush?.x || 0);
      const az = (wallPush?.z || 0) + (shelfPush?.z || 0);
      const len = Math.hypot(ax, az);
      if (len > 0.001) {
        avoidance = { x: ax / len, z: az / len, strength: Math.min(1, len) };
      }
    }

    if (avoidance) {
      c.ai.mode = "move";
      c.ai.desiredYaw = normalizeAngle(Math.atan2(avoidance.x, avoidance.z));
      c.ai.nextDecisionAt = Math.max(c.ai.nextDecisionAt, now + 260);
    }

    const deltaYaw = normalizeAngle(c.ai.desiredYaw - c.yaw);
    const turnBoost = avoidance ? 1 + avoidance.strength * 0.8 : 1;
    const maxTurn = turnSpeed * dt * turnBoost;
    if (Math.abs(deltaYaw) <= maxTurn) c.yaw = c.ai.desiredYaw;
    else c.yaw = normalizeAngle(c.yaw + Math.sign(deltaYaw) * maxTurn);

    if (c.ai.mode === "move") {
      const speedScale = avoidance ? 1 - avoidance.strength * 0.3 : 1;
      const speed = moveSpeed * Math.max(0.55, speedScale);
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

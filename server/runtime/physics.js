import { normalizeAngle } from "./combat.js";

const SHELF_COLLISION_THICKNESS = 0.62;

/**
 * Compute the half-extents of an obstacle, swapping width/depth for
 * quarter-turn yaw rotations.
 *
 * @param {{ width?: number, depth?: number, yaw?: number }} obstacle
 * @returns {{ halfW: number, halfD: number }}
 */
export function obstacleHalfExtents(obstacle) {
  let width = typeof obstacle.width === "number" ? obstacle.width : 1;
  const depth = typeof obstacle.depth === "number" ? obstacle.depth : 1;
  if (obstacle?.kind === "shelf") {
    width = Math.min(width, SHELF_COLLISION_THICKNESS);
  }
  const yaw = typeof obstacle.yaw === "number" ? obstacle.yaw : 0;
  const quarterTurns = Math.round(yaw / (Math.PI / 2));
  const isSwapped = Math.abs(quarterTurns) % 2 === 1;
  return {
    halfW: (isSwapped ? depth : width) * 0.5,
    halfD: (isSwapped ? width : depth) * 0.5
  };
}

/**
 * Clamp a character inside room boundaries, mutating character.x / character.z.
 * When steerOnClamp is true, the character's yaw is redirected toward the
 * room centre if they are actively moving into a wall.
 *
 * @param {{ x: number, z: number, yaw: number }} character
 * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} boundaries
 * @param {{ steerOnClamp?: boolean }} [opts]
 */
export function clampInsideRoom(character, boundaries, { steerOnClamp = false } = {}) {
  const { minX, maxX, minZ, maxZ } = boundaries;
  let hitMinX = false;
  let hitMaxX = false;
  let hitMinZ = false;
  let hitMaxZ = false;

  if (character.x < minX) { character.x = minX; hitMinX = true; }
  if (character.x > maxX) { character.x = maxX; hitMaxX = true; }
  if (character.z < minZ) { character.z = minZ; hitMinZ = true; }
  if (character.z > maxZ) { character.z = maxZ; hitMaxZ = true; }

  if (!steerOnClamp || (!hitMinX && !hitMaxX && !hitMinZ && !hitMaxZ)) return;

  const forwardX = Math.sin(character.yaw);
  const forwardZ = Math.cos(character.yaw);
  const pushingOutward =
    (hitMinX && forwardX < -0.02) ||
    (hitMaxX && forwardX > 0.02) ||
    (hitMinZ && forwardZ < -0.02) ||
    (hitMaxZ && forwardZ > 0.02);
  if (!pushingOutward) return;

  character.yaw = normalizeAngle(Math.atan2(-character.x, -character.z));
}

/**
 * Compute a steering force pushing the character away from room walls.
 * Returns null when no wall is within the margin.
 *
 * @param {{ x: number, z: number }} character
 * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} boundaries
 * @param {number} wallMargin
 * @returns {{ x: number, z: number, strength: number } | null}
 */
export function wallAvoidance(character, boundaries, wallMargin) {
  const { minX, maxX, minZ, maxZ } = boundaries;
  let ax = 0;
  let az = 0;
  if (character.x < minX + wallMargin) ax += (minX + wallMargin - character.x) / wallMargin;
  if (character.x > maxX - wallMargin) ax -= (character.x - (maxX - wallMargin)) / wallMargin;
  if (character.z < minZ + wallMargin) az += (minZ + wallMargin - character.z) / wallMargin;
  if (character.z > maxZ - wallMargin) az -= (character.z - (maxZ - wallMargin)) / wallMargin;
  const len = Math.hypot(ax, az);
  if (len < 0.001) return null;
  return { x: ax / len, z: az / len, strength: Math.min(1, len) };
}

/**
 * Compute a steering force pushing the character away from nearby obstacles.
 * Returns null when no obstacle is within the margin.
 *
 * @param {{ x: number, z: number }} character
 * @param {object[]} obstacles
 * @param {number} shelfMargin
 * @returns {{ x: number, z: number, strength: number } | null}
 */
export function shelfAvoidance(character, obstacles, shelfMargin) {
  let ax = 0;
  let az = 0;
  for (const obstacle of obstacles) {
    const { halfW, halfD } = obstacleHalfExtents(obstacle);
    const nearestX = Math.max(obstacle.x - halfW, Math.min(obstacle.x + halfW, character.x));
    const nearestZ = Math.max(obstacle.z - halfD, Math.min(obstacle.z + halfD, character.z));
    const dx = character.x - nearestX;
    const dz = character.z - nearestZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001 || dist >= shelfMargin) continue;
    const falloff = 1 - dist / shelfMargin;
    ax += (dx / dist) * falloff;
    az += (dz / dist) * falloff;
  }
  const len = Math.hypot(ax, az);
  if (len < 0.001) return null;
  return { x: ax / len, z: az / len, strength: Math.min(1, len) };
}

/**
 * Push a character out of overlapping obstacles via iterative AABB resolution.
 * Returns the normalised direction of the aggregate push, or null on no hit.
 *
 * @param {{ x: number, z: number }} character  (mutated in place)
 * @param {object[]} obstacles
 * @param {number} characterRadius
 * @param {number} [maxIterations=3]
 * @returns {{ x: number, z: number } | null}
 */
export function resolveShelfCollisions(character, obstacles, characterRadius, maxIterations = 3) {
  let hit = false;
  let pushX = 0;
  let pushZ = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let hitThisIteration = false;

    for (const obstacle of obstacles) {
      const { halfW, halfD } = obstacleHalfExtents(obstacle);
      const minX = obstacle.x - halfW - characterRadius;
      const maxX = obstacle.x + halfW + characterRadius;
      const minZ = obstacle.z - halfD - characterRadius;
      const maxZ = obstacle.z + halfD + characterRadius;

      if (character.x < minX || character.x > maxX || character.z < minZ || character.z > maxZ) continue;

      hit = true;
      hitThisIteration = true;
      const toMinX = Math.abs(character.x - minX);
      const toMaxX = Math.abs(maxX - character.x);
      const toMinZ = Math.abs(character.z - minZ);
      const toMaxZ = Math.abs(maxZ - character.z);
      const smallest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);

      if (smallest === toMinX) { character.x = minX; pushX -= 1; }
      else if (smallest === toMaxX) { character.x = maxX; pushX += 1; }
      else if (smallest === toMinZ) { character.z = minZ; pushZ -= 1; }
      else { character.z = maxZ; pushZ += 1; }
    }

    if (!hitThisIteration) break;
  }

  if (!hit) return null;
  const len = Math.hypot(pushX, pushZ);
  if (len < 0.001) return { x: 0, z: 0 };
  return { x: pushX / len, z: pushZ / len };
}

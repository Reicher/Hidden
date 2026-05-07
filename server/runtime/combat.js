export function normalizeAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export function canAttack({ attacker, now, cooldownMs }) {
  return now - attacker.lastAttackAt >= cooldownMs;
}

export function markAttack(attacker, now) {
  attacker.lastAttackAt = now;
}

export function collectVictimIds({ characters, attackerId, attackRange, attackHalfAngle }) {
  const attacker = characters[attackerId];
  if (!attacker) return [];

  let nearestVictimId = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  const forwardX = -Math.sin(attacker.yaw);
  const forwardZ = -Math.cos(attacker.yaw);
  const minDot = Math.cos(attackHalfAngle);

  for (const target of characters) {
    if (target.id === attacker.id) continue;
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 1e-8) continue;
    if (distSq > attackRange * attackRange) continue;
    const dist = Math.sqrt(distSq);

    const dot = (dx * forwardX + dz * forwardZ) / dist;
    if (dot < minDot) continue;

    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestVictimId = target.id;
    }
  }

  return nearestVictimId == null ? [] : [nearestVictimId];
}

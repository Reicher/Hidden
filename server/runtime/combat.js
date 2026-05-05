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

  const victims = [];
  const forwardX = -Math.sin(attacker.yaw);
  const forwardZ = -Math.cos(attacker.yaw);
  const minDot = Math.cos(attackHalfAngle);

  for (const target of characters) {
    if (target.id === attacker.id) continue;
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dz);
    if (dist > attackRange || dist < 0.0001) continue;

    const dot = (dx * forwardX + dz * forwardZ) / dist;
    if (dot >= minDot) victims.push(target.id);
  }

  return victims;
}

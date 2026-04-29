export function normalizeAngle(a) {
  let out = a;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
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
  for (const target of characters) {
    if (target.id === attacker.id) continue;
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dz);
    if (dist > attackRange || dist < 0.0001) continue;

    const angleToTarget = Math.atan2(dx, dz);
    const delta = Math.abs(normalizeAngle(angleToTarget - attacker.yaw));
    if (delta <= attackHalfAngle) victims.push(target.id);
  }

  return victims;
}

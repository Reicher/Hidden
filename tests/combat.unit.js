import assert from "node:assert/strict";
import { canAttack, markAttack, collectVictimIds } from "../server/runtime/combat.js";

function character(id, x, z, yaw = 0) {
  return { id, x, z, yaw, lastAttackAt: 0 };
}

function testVictimCollection() {
  const attacker = character(0, 0, 0, 0);
  const inFront = character(1, 0, 2, 0);
  const side = character(2, 2, 0, 0);
  const behind = character(3, 0, -2, 0);

  const characters = [attacker, inFront, side, behind];
  const victims = collectVictimIds({
    characters,
    attackerId: 0,
    attackRange: 3,
    attackHalfAngle: Math.PI / 4
  });

  assert.deepEqual(victims, [1], `expected only front target, got ${JSON.stringify(victims)}`);
}

function testCooldown() {
  const attacker = character(0, 0, 0, 0);
  const cooldownMs = 1000;
  const now = 5000;

  assert.ok(canAttack({ attacker, now, cooldownMs }), "attacker should be able to attack first time");
  markAttack(attacker, now);
  assert.equal(attacker.lastAttackAt, now, "lastAttackAt should be updated");
  assert.equal(
    canAttack({ attacker, now: now + 300, cooldownMs }),
    false,
    "attacker should still be under cooldown"
  );
  assert.equal(
    canAttack({ attacker, now: now + 1000, cooldownMs }),
    true,
    "attacker should be ready after cooldown"
  );
}

testVictimCollection();
testCooldown();
console.log("Combat unit tests passed.");

import assert from "node:assert/strict";
import { obstacleHalfExtents } from "../server/runtime/physics.js";

function testShelfCollisionThicknessDefaultYaw() {
  const { halfW, halfD } = obstacleHalfExtents({
    kind: "shelf",
    width: 1.0,
    depth: 6.0,
    yaw: 0
  });

  assert.equal(halfW, 0.31, `expected shelf half width 0.31, got ${halfW}`);
  assert.equal(halfD, 3, `expected shelf half depth 3, got ${halfD}`);
}

function testShelfCollisionThicknessQuarterTurn() {
  const { halfW, halfD } = obstacleHalfExtents({
    kind: "shelf",
    width: 1.0,
    depth: 6.0,
    yaw: Math.PI / 2
  });

  assert.equal(halfW, 3, `expected rotated shelf half width 3, got ${halfW}`);
  assert.equal(halfD, 0.31, `expected rotated shelf half depth 0.31, got ${halfD}`);
}

function testNonShelfUnchanged() {
  const { halfW, halfD } = obstacleHalfExtents({
    kind: "cooler",
    width: 1.0,
    depth: 1.0,
    yaw: 0
  });

  assert.equal(halfW, 0.5, `expected cooler half width 0.5, got ${halfW}`);
  assert.equal(halfD, 0.5, `expected cooler half depth 0.5, got ${halfD}`);
}

testShelfCollisionThicknessDefaultYaw();
testShelfCollisionThicknessQuarterTurn();
testNonShelfUnchanged();
console.log("Physics unit tests passed.");

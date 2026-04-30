import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { clamp01, normalizeAngle, seededRandom } from "./utils.js";

const ATTACK_ANIM_MS = 140;
const RESPAWN_HIDE_MS = 110;
const RESPAWN_JUMP_DISTANCE = 4.2;
const MOVE_SPEED_REFERENCE = 3.5;
const CAMERA_HEIGHT = 1.6;
const POSITION_SMOOTH_RATE = 15;
const ROTATION_SMOOTH_RATE = 11;
const MAX_ROTATION_SPEED = 10;

export function createAvatarSystem({ scene, camera }) {
  const avatars = new Map();
  const firstPersonArmPivot = new THREE.Group();
  firstPersonArmPivot.position.set(0.22, -0.18, -0.38);
  firstPersonArmPivot.rotation.set(-0.08, -0.12, -0.12);
  const firstPersonArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.7, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0xb57b5f,
      roughness: 0.82,
      metalness: 0.02,
      depthTest: false,
      depthWrite: false
    })
  );
  firstPersonArm.position.set(0, -0.35, 0.02);
  firstPersonArm.renderOrder = 1000;
  firstPersonArm.frustumCulled = false;
  firstPersonArmPivot.add(firstPersonArm);
  firstPersonArmPivot.visible = false;
  camera.add(firstPersonArmPivot);
  let firstPersonAttackMs = 0;

  function buildCharacterColors(id) {
    const rng = seededRandom(id * 4093 + 17);
    const shirt = new THREE.Color();
    shirt.setHSL(rng(), 0.45 + rng() * 0.35, 0.38 + rng() * 0.22);
    const pants = new THREE.Color();
    pants.setHSL(rng(), 0.3 + rng() * 0.25, 0.2 + rng() * 0.18);
    return { shirt, pants };
  }

  function createAvatar(id) {
    const colors = buildCharacterColors(id);
    const skin = new THREE.Color(0xe9c8a3);
    const group = new THREE.Group();

    const torsoMaterial = new THREE.MeshStandardMaterial({ color: colors.shirt, roughness: 0.85 });
    const pantsMaterial = new THREE.MeshStandardMaterial({ color: colors.pants, roughness: 0.9 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.9, 0.36), torsoMaterial);
    torso.position.set(0, 1.35, 0);
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMaterial);
    head.position.set(0, 2.03, 0);
    group.add(head);

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.5, 1.72, 0);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.76, 0.2), torsoMaterial);
    leftArm.position.set(0, -0.38, 0);
    leftArmPivot.add(leftArm);
    group.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.5, 1.72, 0);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.76, 0.2), torsoMaterial);
    rightArm.position.set(0, -0.38, 0);
    rightArmPivot.add(rightArm);
    group.add(rightArmPivot);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.2, 0.92, 0);
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.84, 0.24), pantsMaterial);
    leftLeg.position.set(0, -0.42, 0);
    leftLegPivot.add(leftLeg);
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.2, 0.92, 0);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.84, 0.24), pantsMaterial);
    rightLeg.position.set(0, -0.42, 0);
    rightLegPivot.add(rightLeg);
    group.add(rightLegPivot);

    return {
      id,
      group,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      moveAmount: 0,
      walkPhase: Math.random() * Math.PI * 2,
      targetX: 0,
      targetZ: 0,
      targetYaw: 0,
      currentYaw: 0,
      initialized: false,
      attackFlashMsRemaining: 0,
      respawnHideMsRemaining: 0,
      lastServerX: null,
      lastServerZ: null,
      lastServerAt: 0,
      seenAtTick: false
    };
  }

  function updateFromServer(avatar, character, nowMs) {
    avatar.seenAtTick = true;
    avatar.targetYaw = character.yaw;
    avatar.attackFlashMsRemaining = character.attackFlashMsRemaining || 0;

    if (!avatar.initialized) {
      avatar.group.position.set(character.x, 0, character.z);
      avatar.currentYaw = character.yaw;
      avatar.group.rotation.y = character.yaw;
      avatar.initialized = true;
    }

    if (avatar.lastServerAt > 0 && avatar.lastServerX != null && avatar.lastServerZ != null) {
      const serverJump = Math.hypot(character.x - avatar.lastServerX, character.z - avatar.lastServerZ);
      if (serverJump >= RESPAWN_JUMP_DISTANCE) {
        avatar.respawnHideMsRemaining = RESPAWN_HIDE_MS;
        avatar.group.visible = false;
        avatar.group.position.set(character.x, 0, character.z);
        avatar.targetX = character.x;
        avatar.targetZ = character.z;
        avatar.moveAmount = 0;
      } else {
        avatar.targetX = character.x;
        avatar.targetZ = character.z;
      }

      const dt = Math.max(0.001, (nowMs - avatar.lastServerAt) / 1000);
      const dist = Math.hypot(character.x - avatar.lastServerX, character.z - avatar.lastServerZ);
      const speedRatio = clamp01((dist / dt) / MOVE_SPEED_REFERENCE);
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, speedRatio, 0.5);
    } else {
      avatar.targetX = character.x;
      avatar.targetZ = character.z;
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, 0, 0.3);
    }

    avatar.lastServerX = character.x;
    avatar.lastServerZ = character.z;
    avatar.lastServerAt = nowMs;
  }

  function animateAvatar(avatar, deltaSec) {
    if (!avatar.initialized) return;
    if (avatar.respawnHideMsRemaining > 0) {
      avatar.respawnHideMsRemaining = Math.max(0, avatar.respawnHideMsRemaining - deltaSec * 1000);
      if (avatar.respawnHideMsRemaining <= 0) avatar.group.visible = true;
      return;
    }
    avatar.attackFlashMsRemaining = Math.max(0, avatar.attackFlashMsRemaining - deltaSec * 1000);
    const posSmooth = 1 - Math.exp(-deltaSec * POSITION_SMOOTH_RATE);
    avatar.group.position.x = THREE.MathUtils.lerp(avatar.group.position.x, avatar.targetX, posSmooth);
    avatar.group.position.z = THREE.MathUtils.lerp(avatar.group.position.z, avatar.targetZ, posSmooth);

    const yawDelta = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    const rotSmooth = 1 - Math.exp(-deltaSec * ROTATION_SMOOTH_RATE);
    const desiredStep = yawDelta * rotSmooth;
    const maxStep = MAX_ROTATION_SPEED * deltaSec;
    const clampedStep = THREE.MathUtils.clamp(desiredStep, -maxStep, maxStep);
    avatar.currentYaw = normalizeAngle(avatar.currentYaw + clampedStep);
    avatar.group.rotation.y = avatar.currentYaw;

    avatar.walkPhase += deltaSec * (2.2 + avatar.moveAmount * 7.2);
    const stride = Math.sin(avatar.walkPhase) * 0.72 * avatar.moveAmount;
    const armBase = -stride * 0.82;

    avatar.leftLegPivot.rotation.x = stride;
    avatar.rightLegPivot.rotation.x = -stride;

    let punch = 0;
    if (avatar.attackFlashMsRemaining > 0) {
      const progress = 1 - clamp01(avatar.attackFlashMsRemaining / ATTACK_ANIM_MS);
      const extension = progress < 0.38 ? progress / 0.38 : 1 - (progress - 0.38) / 0.62;
      punch = clamp01(extension) * 1.9;
    }

    avatar.leftArmPivot.rotation.x = armBase;
    avatar.rightArmPivot.rotation.x = -armBase + punch;
  }

  function animateFirstPersonArm(deltaSec, hasControl) {
    if (!hasControl) {
      firstPersonArmPivot.visible = false;
      firstPersonAttackMs = 0;
      return;
    }
    firstPersonArmPivot.visible = true;
    firstPersonAttackMs = Math.max(0, firstPersonAttackMs - deltaSec * 1000);
    let punch = 0;
    if (firstPersonAttackMs > 0) {
      const progress = 1 - clamp01(firstPersonAttackMs / ATTACK_ANIM_MS);
      const extension = progress < 0.35 ? progress / 0.35 : 1 - (progress - 0.35) / 0.65;
      punch = clamp01(extension) * 2.2;
    }
    firstPersonArmPivot.rotation.x = -0.12 + punch;
    firstPersonArmPivot.rotation.y = -0.12 + punch * 0.16;
    firstPersonArmPivot.position.x = 0.22 - punch * 0.06;
    firstPersonArmPivot.position.z = -0.38 - punch * 0.12;
  }

  function applyWorldCharacters({ characters, myCharacterId, nowMs }) {
    let myYaw = null;
    for (const avatar of avatars.values()) avatar.seenAtTick = false;

    for (const character of characters) {
      let avatar = avatars.get(character.id);
      if (!avatar) {
        avatar = createAvatar(character.id);
        scene.add(avatar.group);
        avatars.set(character.id, avatar);
      }

      updateFromServer(avatar, character, nowMs);
      avatar.group.visible = character.id !== myCharacterId;

      if (character.id === myCharacterId) {
        myYaw = character.yaw;
      }
    }

    for (const [id, avatar] of avatars.entries()) {
      if (avatar.seenAtTick) continue;
      scene.remove(avatar.group);
      avatars.delete(id);
    }

    return myYaw;
  }

  function animate(deltaSec, myCharacterId) {
    let hasControl = myCharacterId != null;
    for (const [id, avatar] of avatars.entries()) {
      animateAvatar(avatar, deltaSec);
      if (id === myCharacterId) {
        hasControl = true;
        firstPersonAttackMs = Math.max(firstPersonAttackMs, avatar.attackFlashMsRemaining);
        camera.position.set(avatar.group.position.x, CAMERA_HEIGHT, avatar.group.position.z);
      }
    }
    animateFirstPersonArm(deltaSec, hasControl);
  }

  return {
    applyWorldCharacters,
    animate
  };
}

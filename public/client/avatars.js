import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { clamp01, normalizeAngle, seededRandom } from "./utils.js";

const ATTACK_ANIM_MS = 140;
const MOVE_SPEED_REFERENCE = 3.5;
const CAMERA_HEIGHT = 1.6;

export function createAvatarSystem({ scene, camera }) {
  const avatars = new Map();

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
      lastServerX: null,
      lastServerZ: null,
      lastServerAt: 0,
      seenAtTick: false
    };
  }

  function updateFromServer(avatar, character, nowMs) {
    avatar.seenAtTick = true;
    avatar.targetX = character.x;
    avatar.targetZ = character.z;
    avatar.targetYaw = character.yaw;
    avatar.attackFlashMsRemaining = character.attackFlashMsRemaining || 0;

    if (!avatar.initialized) {
      avatar.group.position.set(character.x, 0, character.z);
      avatar.currentYaw = character.yaw;
      avatar.group.rotation.y = character.yaw;
      avatar.initialized = true;
    }

    if (avatar.lastServerAt > 0 && avatar.lastServerX != null && avatar.lastServerZ != null) {
      const dt = Math.max(0.001, (nowMs - avatar.lastServerAt) / 1000);
      const dist = Math.hypot(character.x - avatar.lastServerX, character.z - avatar.lastServerZ);
      const speedRatio = clamp01((dist / dt) / MOVE_SPEED_REFERENCE);
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, speedRatio, 0.5);
    } else {
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, 0, 0.3);
    }

    avatar.lastServerX = character.x;
    avatar.lastServerZ = character.z;
    avatar.lastServerAt = nowMs;
  }

  function animateAvatar(avatar, deltaSec) {
    if (!avatar.initialized) return;
    avatar.attackFlashMsRemaining = Math.max(0, avatar.attackFlashMsRemaining - deltaSec * 1000);
    const posSmooth = 1 - Math.exp(-deltaSec * 15);
    avatar.group.position.x = THREE.MathUtils.lerp(avatar.group.position.x, avatar.targetX, posSmooth);
    avatar.group.position.z = THREE.MathUtils.lerp(avatar.group.position.z, avatar.targetZ, posSmooth);

    const yawDelta = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    avatar.currentYaw = normalizeAngle(avatar.currentYaw + yawDelta * posSmooth);
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
      punch = clamp01(extension) * 1.35;
    }

    avatar.leftArmPivot.rotation.x = armBase;
    avatar.rightArmPivot.rotation.x = -armBase - punch;
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
        camera.position.set(character.x, CAMERA_HEIGHT, character.z);
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

  function animate(deltaSec) {
    for (const avatar of avatars.values()) animateAvatar(avatar, deltaSec);
  }

  return {
    applyWorldCharacters,
    animate
  };
}

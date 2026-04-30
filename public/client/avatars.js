import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { clamp01, normalizeAngle, seededRandom } from "./utils.js";

const ATTACK_ANIM_MS = 140;
const RESPAWN_HIDE_MS = 110;
const RESPAWN_JUMP_DISTANCE = 4.2;
const MOVE_SPEED_REFERENCE = 3.5;
const POSITION_SMOOTH_RATE = 15;
const ROTATION_SMOOTH_RATE = 11;
const MAX_ROTATION_SPEED = 10;
const HEAD_TEX_SIZE = 256;
const FACE_U = 0.25;
const FACE_V = 0.5;
const EYE_U_OFFSET = 0.058;
const EYE_RADIUS_X_PX = 12;
const EYE_RADIUS_Y_PX = 15;
const PUPIL_RADIUS_PX = 5.2;
const PUPIL_RANGE_X_PX = 5.8;
const PUPIL_RANGE_Y_PX = 4.6;
const SKIN_TONE_HEX = [
  0xfad7c4, 0xf1c7a5, 0xe6b88a, 0xd8a676, 0xbf8a5d, 0xa9744d, 0x8c603f, 0x714c34, 0x573a2a, 0x3f2b1f
];

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

  function buildCharacterProfile(id) {
    const rng = seededRandom(id * 4093 + 17);

    const heightScale = 0.82 + rng() * 0.34;
    const legScale = 0.8 + rng() * 0.34;
    const torsoScale = 0.82 + rng() * 0.3;
    const armScale = 0.8 + rng() * 0.34;
    const headScale = 0.84 + rng() * 0.28;
    const fatness = rng();

    const skin = new THREE.Color(SKIN_TONE_HEX[Math.floor(rng() * SKIN_TONE_HEX.length)]);
    const shirt = new THREE.Color();
    shirt.setHSL(rng(), 0.4 + rng() * 0.3, 0.36 + rng() * 0.24);
    const pants = new THREE.Color();
    pants.setHSL(rng(), 0.18 + rng() * 0.24, 0.25 + rng() * 0.22);
    const shoe = new THREE.Color();
    shoe.setHSL(rng(), 0.08 + rng() * 0.12, 0.08 + rng() * 0.18);

    return {
      rng,
      heightScale,
      legScale,
      torsoScale,
      armScale,
      headScale,
      fatness,
      torsoWidthScale: 0.88 + fatness * 0.62,
      torsoDepthScale: 0.84 + fatness * 0.5,
      skin,
      shirt,
      pants,
      shoe
    };
  }

  function createHeadFaceTexture(skinColor) {
    const canvas = document.createElement("canvas");
    canvas.width = HEAD_TEX_SIZE;
    canvas.height = HEAD_TEX_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.image = canvas;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (texture.image) texture.needsUpdate = true;

    const skinStyle = skinColor.getStyle(THREE.SRGBColorSpace);
    const faceCx = FACE_U * HEAD_TEX_SIZE;
    const faceCy = FACE_V * HEAD_TEX_SIZE;
    const leftEyeCx = faceCx - EYE_U_OFFSET * HEAD_TEX_SIZE;
    const rightEyeCx = faceCx + EYE_U_OFFSET * HEAD_TEX_SIZE;

    function drawEyes(lookX, lookY) {
      const ox = THREE.MathUtils.clamp(lookX, -1, 1) * PUPIL_RANGE_X_PX;
      const oy = THREE.MathUtils.clamp(lookY, -1, 1) * PUPIL_RANGE_Y_PX;

      ctx.clearRect(0, 0, HEAD_TEX_SIZE, HEAD_TEX_SIZE);
      ctx.fillStyle = skinStyle;
      ctx.fillRect(0, 0, HEAD_TEX_SIZE, HEAD_TEX_SIZE);

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(leftEyeCx, faceCy, EYE_RADIUS_X_PX, EYE_RADIUS_Y_PX, 0, 0, Math.PI * 2);
      ctx.ellipse(rightEyeCx, faceCy, EYE_RADIUS_X_PX, EYE_RADIUS_Y_PX, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(leftEyeCx + ox, faceCy + oy, PUPIL_RADIUS_PX, 0, Math.PI * 2);
      ctx.arc(rightEyeCx + ox, faceCy + oy, PUPIL_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();

      if (texture.image) texture.needsUpdate = true;
    }

    drawEyes(0, 0);
    return { texture, drawEyes };
  }

  function createAvatar(id) {
    const profile = buildCharacterProfile(id);
    const group = new THREE.Group();

    const torsoMaterial = new THREE.MeshStandardMaterial({ color: profile.shirt, roughness: 0.85 });
    const pantsMaterial = new THREE.MeshStandardMaterial({ color: profile.pants, roughness: 0.9 });
    const skinMaterialPlain = new THREE.MeshStandardMaterial({ color: profile.skin, roughness: 0.8 });
    const shoeMaterial = new THREE.MeshStandardMaterial({ color: profile.shoe, roughness: 0.92 });
    const headFace = createHeadFaceTexture(profile.skin);
    const skinMaterial = headFace
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: headFace.texture, roughness: 0.8 })
      : new THREE.MeshStandardMaterial({ color: profile.skin, roughness: 0.8 });

    const shoeHeight = 0.11 * profile.heightScale;
    const shoeWidth = 0.2 * profile.heightScale * (0.92 + profile.fatness * 0.2);
    const shoeLength = 0.34 * profile.heightScale;

    const legRadius = 0.078 * profile.heightScale * profile.legScale;
    const legTotal = 0.84 * profile.heightScale * profile.legScale;
    const legCore = Math.max(0.05, legTotal - legRadius * 2);
    const hipY = shoeHeight + legTotal + 0.03 * profile.heightScale;
    const legGap = 0.17 * profile.heightScale * (0.95 + profile.fatness * 0.1);

    const torsoRadius = 0.14 * profile.heightScale * profile.torsoScale;
    const torsoTotal = 0.9 * profile.heightScale * profile.torsoScale;
    const torsoCore = Math.max(0.06, torsoTotal - torsoRadius * 2);
    const shoulderY = hipY + torsoTotal * 0.8;

    const armRadius = 0.066 * profile.heightScale * profile.armScale;
    const armTotal = 0.72 * profile.heightScale * profile.armScale;
    const armCore = Math.max(0.05, armTotal - armRadius * 2);
    const shoulderX = torsoRadius * profile.torsoWidthScale + armRadius * 0.58;
    const handRadius = armRadius * 0.74;

    const headRadius = 0.24 * profile.heightScale * profile.headScale;
    const headY = hipY + torsoTotal + headRadius * 0.84;
    const eyeHeight = headY + headRadius * 0.24;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(torsoRadius, torsoCore, 6, 14), torsoMaterial);
    torso.scale.set(profile.torsoWidthScale, 1, profile.torsoDepthScale);
    torso.position.set(0, hipY + torsoTotal * 0.5, 0);
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 24, 18), skinMaterial);
    head.scale.set(0.92, 1.06, 0.95);
    head.position.set(0, headY, 0);
    group.add(head);

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-shoulderX, shoulderY, 0);
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(armRadius, armCore, 5, 12), torsoMaterial);
    leftArm.position.set(0, -armTotal * 0.5, 0);
    leftArmPivot.add(leftArm);
    const leftHand = new THREE.Mesh(new THREE.SphereGeometry(handRadius, 12, 10), skinMaterialPlain);
    leftHand.position.set(0, -armTotal + handRadius * 0.55, 0);
    leftArmPivot.add(leftHand);
    group.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(shoulderX, shoulderY, 0);
    const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(armRadius, armCore, 5, 12), torsoMaterial);
    rightArm.position.set(0, -armTotal * 0.5, 0);
    rightArmPivot.add(rightArm);
    const rightHand = new THREE.Mesh(new THREE.SphereGeometry(handRadius, 12, 10), skinMaterialPlain);
    rightHand.position.set(0, -armTotal + handRadius * 0.55, 0);
    rightArmPivot.add(rightHand);
    group.add(rightArmPivot);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-legGap, hipY, 0);
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(legRadius, legCore, 5, 12), pantsMaterial);
    leftLeg.position.set(0, -legTotal * 0.5, 0);
    leftLegPivot.add(leftLeg);
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(shoeWidth, shoeHeight, shoeLength), shoeMaterial);
    leftShoe.position.set(0, -legTotal - shoeHeight * 0.35, shoeLength * 0.08);
    leftLegPivot.add(leftShoe);
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(legGap, hipY, 0);
    const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(legRadius, legCore, 5, 12), pantsMaterial);
    rightLeg.position.set(0, -legTotal * 0.5, 0);
    rightLegPivot.add(rightLeg);
    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(shoeWidth, shoeHeight, shoeLength), shoeMaterial);
    rightShoe.position.set(0, -legTotal - shoeHeight * 0.35, shoeLength * 0.08);
    rightLegPivot.add(rightShoe);
    group.add(rightLegPivot);

    return {
      id,
      group,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      moveAmount: 0,
      walkPhase: profile.rng() * Math.PI * 2,
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
      seenAtTick: false,
      controllerType: "AI",
      gazeTargetId: null,
      gazeRetargetAt: 0,
      eyeX: 0,
      eyeY: 0,
      eyeTargetX: 0,
      eyeTargetY: 0,
      lastDrawnEyeX: 999,
      lastDrawnEyeY: 999,
      headFace,
      eyeHeight,
      skinColor: profile.skin
    };
  }

  function updateFromServer(avatar, character, nowMs) {
    avatar.seenAtTick = true;
    avatar.targetYaw = character.yaw;
    avatar.attackFlashMsRemaining = character.attackFlashMsRemaining || 0;
    avatar.controllerType = character.controllerType || "AI";

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

  function setAvatarEyeTarget(avatar, x, y) {
    avatar.eyeTargetX = THREE.MathUtils.clamp(x, -1, 1);
    avatar.eyeTargetY = THREE.MathUtils.clamp(y, -1, 1);
  }

  function updateAIEyeTarget(avatar, charactersById, nowMs) {
    if (nowMs >= avatar.gazeRetargetAt) {
      avatar.gazeRetargetAt = nowMs + 480 + Math.random() * 1400;
      const candidates = [];
      for (const character of charactersById.values()) {
        if (character.id === avatar.id) continue;
        candidates.push(character.id);
      }
      if (candidates.length > 0 && Math.random() < 0.78) {
        avatar.gazeTargetId = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        avatar.gazeTargetId = null;
      }
    }

    if (avatar.gazeTargetId == null) {
      const driftX = Math.sin((nowMs + avatar.id * 97) * 0.0015) * 0.42;
      const driftY = Math.cos((nowMs + avatar.id * 67) * 0.0017) * 0.34;
      setAvatarEyeTarget(avatar, driftX, driftY);
      return;
    }

    const target = charactersById.get(avatar.gazeTargetId);
    if (!target) {
      avatar.gazeTargetId = null;
      setAvatarEyeTarget(avatar, 0, 0);
      return;
    }

    const dx = target.x - avatar.group.position.x;
    const dz = target.z - avatar.group.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) {
      setAvatarEyeTarget(avatar, 0, 0);
      return;
    }
    const dirX = dx / len;
    const dirZ = dz / len;
    const rightX = Math.cos(avatar.currentYaw);
    const rightZ = -Math.sin(avatar.currentYaw);
    const localX = rightX * dirX + rightZ * dirZ;

    const localY = Math.sin((nowMs + avatar.id * 53) * 0.002) * 0.22;
    setAvatarEyeTarget(avatar, localX * 1.6, localY);
  }

  function updatePlayerEyeTarget(avatar, nowMs) {
    const yawDrift = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    const lookX = THREE.MathUtils.clamp(yawDrift * 4.8 + Math.sin(nowMs * 0.0018 + avatar.id * 1.3) * 0.2, -1, 1);
    const lookY = -0.02 + Math.cos(nowMs * 0.0016 + avatar.id * 1.1) * 0.14 - avatar.moveAmount * 0.03;
    setAvatarEyeTarget(avatar, lookX, lookY);
  }

  function animateAvatar(avatar, deltaSec, charactersById, nowMs) {
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

    if (avatar.controllerType === "AI") updateAIEyeTarget(avatar, charactersById, nowMs);
    else updatePlayerEyeTarget(avatar, nowMs);

    const eyeSmooth = 1 - Math.exp(-deltaSec * 14);
    avatar.eyeX = THREE.MathUtils.lerp(avatar.eyeX, avatar.eyeTargetX, eyeSmooth);
    avatar.eyeY = THREE.MathUtils.lerp(avatar.eyeY, avatar.eyeTargetY, eyeSmooth);
    if (
      Math.abs(avatar.eyeX - avatar.lastDrawnEyeX) > 0.01 ||
      Math.abs(avatar.eyeY - avatar.lastDrawnEyeY) > 0.01
    ) {
      avatar.headFace?.drawEyes?.(avatar.eyeX, avatar.eyeY);
      avatar.lastDrawnEyeX = avatar.eyeX;
      avatar.lastDrawnEyeY = avatar.eyeY;
    }
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
    const charactersById = new Map();
    for (const [id, avatar] of avatars.entries()) {
      charactersById.set(id, {
        id,
        x: avatar.group.position.x,
        z: avatar.group.position.z
      });
    }
    const nowMs = performance.now();

    for (const [id, avatar] of avatars.entries()) {
      animateAvatar(avatar, deltaSec, charactersById, nowMs);
      if (id === myCharacterId) {
        hasControl = true;
        firstPersonAttackMs = Math.max(firstPersonAttackMs, avatar.attackFlashMsRemaining);
        const fpMat = firstPersonArm.material;
        if (fpMat && !Array.isArray(fpMat) && fpMat.color && avatar.skinColor) {
          fpMat.color.copy(avatar.skinColor);
        }
        camera.position.set(avatar.group.position.x, avatar.eyeHeight, avatar.group.position.z);
      }
    }
    animateFirstPersonArm(deltaSec, hasControl);
  }

  return {
    applyWorldCharacters,
    animate
  };
}

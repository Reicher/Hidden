import * as THREE from "/vendor/three.module.js";
import { clamp01, normalizeAngle, seededRandom } from "./utils.js";

const ATTACK_ANIM_MS = 140;
const RESPAWN_HIDE_MS = 110;
const RESPAWN_JUMP_DISTANCE = 4.2;
const MOVE_SPEED_REFERENCE = 3.5;
const POSITION_SMOOTH_RATE = 15;
const ROTATION_SMOOTH_RATE = 11;
const MAX_ROTATION_SPEED = 10;
const KNOCKDOWN_FALL_MS = 430;
const KNOCKDOWN_RISE_MS = 420;
const KNOCKDOWN_MAX_TILT_RAD = Math.PI * 0.5;
const KNOCKDOWN_STAR_COUNT = 3;
const KNOCKDOWN_STAR_ORBIT_RADIUS = 0.24;
const KNOCKDOWN_STAR_HEAD_OFFSET_Y = 0.3;
const KNOCKDOWN_STAR_UPDATE_MS = 50;
const EYE_DRAW_INTERVAL_NEAR_MS = 34;
const EYE_DRAW_INTERVAL_FAR_MS = 90;
const EYE_DRAW_FAR_DISTANCE_SQ = 100;
const HEAD_TEX_SIZE = 128;
const FACE_U = 0.25;
const FACE_V = 0.5;
const EYE_U_OFFSET = 0.058;
// All pixel constants are expressed as fractions of 256 so they scale
// correctly regardless of HEAD_TEX_SIZE.
const EYE_RADIUS_X_PX = HEAD_TEX_SIZE * (13 / 256); // ~6.5 at 128
const EYE_RADIUS_Y_PX = HEAD_TEX_SIZE * (16 / 256); // ~8   at 128
const PUPIL_RADIUS_PX = HEAD_TEX_SIZE * (5.2 / 256); // ~2.6 at 128
const PUPIL_RANGE_X_PX = HEAD_TEX_SIZE * (8.9 / 256); // ~4.5 at 128
const PUPIL_RANGE_Y_PX = HEAD_TEX_SIZE * (6.9 / 256); // ~3.5 at 128
const AVATAR_YAW_OFFSET = Math.PI;
const MAX_LOOK_PITCH_RAD = 1.2;
const INSPECT_EYE_DOWN_LOOK = 0.78;
const INSPECT_EYE_SIDE_FACTOR = 0.35;
const AIM_MAX_DISTANCE = 8;
const AIM_BODY_RADIUS = 0.44;
const AIM_HEAD_Y_OFFSET_RATIO = 0.9;
const AIM_CHEST_Y_OFFSET_RATIO = 0.58;
const SKIN_TONE_HEX = [
  0xfad7c4, 0xf1c7a5, 0xe6b88a, 0xd8a676, 0xbf8a5d, 0xa9744d, 0x8c603f,
  0x714c34, 0x573a2a, 0x3f2b1f,
];
const SHIRT_COLOR_HEX = [
  0x2f80ed, 0x24a148, 0xd64550, 0xf2a900, 0x8a5cf6, 0x00a6a6, 0xe05a9d,
  0x6f9e2f, 0x2c7be5, 0xe16f3d, 0x3b7f4f, 0xb84a62,
];
const PANTS_COLOR_HEX = [
  0x1f3a5f, 0x253858, 0x2f3e46, 0x4a5568, 0x5c4033, 0x6b4f8a, 0x2e6f73,
  0x8c5a2b, 0x503047, 0x3a5a40,
];
const SHOE_COLOR_HEX = [
  0x171717, 0xf4f1de, 0xc1121f, 0x1d4ed8, 0xf59e0b, 0x0f766e, 0x7c2d12,
  0x6d28d9, 0x2d3748,
];
const HAT_TYPES = ["Trollkarlshatt", "Sombrero", "Mössa"];
const HAT_STYLE_SLOTS = [...HAT_TYPES, "none"];
const HAT_COLOR_HEX_BY_TYPE = {
  Trollkarlshatt: [0x1f2b44, 0x2d3561, 0x4a2f44, 0x3f2f5f, 0x164e63],
  Sombrero: [0xd9c39a, 0xc5a77f, 0xe0b354, 0xad7f3a, 0x8f6f47],
  Mössa: [
    0xc0392b, 0x2471a3, 0x1e8449, 0x6c3483, 0xca6f1e, 0xe84393, 0x0f766e,
    0xf59e0b,
  ],
};
const SKIRT_CHANCE = 0.33;
const BACKPACK_CHANCE = 0.2;
const BACKPACK_COLOR_HEX = [0x4f2f24, 0x263f5f, 0x2f4c35, 0x4a3c28, 0x3d314f];
const MOUTH_TYPES = ["happy", "neutral", "surprised", "sad"];
const NOSE_TYPES = ["round", "cone"];

function chooseHatType(characterId, rng) {
  const randomIndex = Math.floor(rng() * HAT_STYLE_SLOTS.length);
  const numericId = Number(characterId);
  if (!Number.isFinite(numericId)) return HAT_STYLE_SLOTS[randomIndex];
  return HAT_STYLE_SLOTS[
    Math.abs(Math.trunc(numericId)) % HAT_STYLE_SLOTS.length
  ];
}

function noHatBodyHeight({ heightScale, legScale, torsoScale, headScale }) {
  const shoeHeight = 0.11 * heightScale;
  const legTotal = 0.84 * heightScale * legScale;
  const hipY = shoeHeight + legTotal + 0.03 * heightScale;
  const torsoTotal = 0.9 * heightScale * torsoScale;
  const headRadius = 0.24 * heightScale * headScale;
  const headY = hipY + torsoTotal + headRadius * 0.84;
  const topHead = headY + headRadius * 1.06;
  const bottomShoe = hipY - legTotal - shoeHeight * 0.85;
  return topHead - bottomShoe;
}

function hexToCss(hex) {
  const safe = Math.max(0, Math.min(0xffffff, Number(hex) || 0));
  return `#${safe.toString(16).padStart(6, "0")}`;
}

function previewStyleForCharacter(characterId) {
  const rng = seededRandom(Number(characterId || 0) * 4093 + 17);
  rng();
  rng();
  rng();
  rng();
  rng();
  rng();
  const skinHex = SKIN_TONE_HEX[Math.floor(rng() * SKIN_TONE_HEX.length)];
  const shirtHex = SHIRT_COLOR_HEX[Math.floor(rng() * SHIRT_COLOR_HEX.length)];
  rng();
  rng();
  const hatType = chooseHatType(characterId, rng);
  let hatHex = null;
  if (hatType !== "none") {
    const palette =
      HAT_COLOR_HEX_BY_TYPE[hatType] || HAT_COLOR_HEX_BY_TYPE.Trollkarlshatt;
    hatHex = palette[Math.floor(rng() * palette.length)];
  }
  const mouthType = MOUTH_TYPES[Math.floor(rng() * MOUTH_TYPES.length)];
  const hasSkirt = rng() < SKIRT_CHANCE;
  const hasBackpack = rng() < BACKPACK_CHANCE;
  const backpackHex =
    BACKPACK_COLOR_HEX[Math.floor(rng() * BACKPACK_COLOR_HEX.length)];
  const noseType = NOSE_TYPES[Math.floor(rng() * NOSE_TYPES.length)];
  const noseSizeScale =
    noseType === "round" ? 0.85 + rng() * 0.95 : 0.72 + rng() * 0.62;
  const noseDepthScale =
    noseType === "round" ? noseSizeScale : 0.9 + rng() * 1.25;
  return {
    skin: hexToCss(skinHex),
    shirt: hexToCss(shirtHex),
    hatType,
    hat: hatHex == null ? null : hexToCss(hatHex),
    mouthType,
    hasSkirt,
    hasBackpack,
    backpack: hexToCss(backpackHex),
    noseType,
    noseSizeScale,
    noseDepthScale,
  };
}

function fillRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(Number(r) || 0, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function traceHeadShapePath(ctx, cx, cy, headR) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - headR * 1.02);
  ctx.bezierCurveTo(
    cx + headR * 0.78,
    cy - headR * 0.96,
    cx + headR * 0.9,
    cy + headR * 0.1,
    cx + headR * 0.5,
    cy + headR * 0.9,
  );
  ctx.bezierCurveTo(
    cx + headR * 0.22,
    cy + headR * 1.15,
    cx - headR * 0.22,
    cy + headR * 1.15,
    cx - headR * 0.5,
    cy + headR * 0.9,
  );
  ctx.bezierCurveTo(
    cx - headR * 0.9,
    cy + headR * 0.1,
    cx - headR * 0.78,
    cy - headR * 0.96,
    cx,
    cy - headR * 1.02,
  );
  ctx.closePath();
}

function strokeSimpleMouth(ctx, cx, mouthY, size, mouthType) {
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#211915";
  ctx.beginPath();
  if (mouthType === "happy") {
    ctx.arc(cx, mouthY - size * 0.1, size, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }
  if (mouthType === "sad") {
    ctx.arc(cx, mouthY + size * 1.02, size, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();
    return;
  }
  if (mouthType === "surprised") {
    ctx.arc(cx, mouthY + size * 0.22, size * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.moveTo(cx - size * 0.92, mouthY + size * 0.28);
  ctx.lineTo(cx + size * 0.92, mouthY + size * 0.28);
  ctx.stroke();
}

function drawSimpleNose(ctx, cx, cy, size, noseType) {
  ctx.fillStyle = "rgba(92, 55, 38, 0.46)";
  ctx.strokeStyle = "rgba(50, 31, 24, 0.42)";
  ctx.lineWidth = Math.max(1, size * 0.12);
  if (noseType === "round") {
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.42, size * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.46);
  ctx.lineTo(cx - size * 0.34, cy + size * 0.32);
  ctx.lineTo(cx + size * 0.34, cy + size * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawCountdownCharacterPreview(canvas, characterId) {
  if (!canvas || characterId == null) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return false;
  const style = previewStyleForCharacter(characterId);
  const cx = width * 0.5;
  const headCy = height * 0.44;
  const headR = Math.min(width, height) * 0.23;
  const headTopY = headCy - headR * 1.02;
  const minHatTopY = headTopY - headR * 0.02;

  ctx.clearRect(0, 0, width, height);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#20273a");
  bgGrad.addColorStop(1, "#111722");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  if (style.hasBackpack) {
    ctx.fillStyle = style.backpack;
    fillRoundedRect(
      ctx,
      width * 0.17,
      height * 0.58,
      width * 0.18,
      height * 0.26,
      10,
    );
    fillRoundedRect(
      ctx,
      width * 0.65,
      height * 0.58,
      width * 0.18,
      height * 0.26,
      10,
    );
  }

  ctx.fillStyle = style.shirt;
  fillRoundedRect(
    ctx,
    width * 0.22,
    height * 0.56,
    width * 0.56,
    height * 0.34,
    16,
  );

  if (style.hasBackpack) {
    ctx.strokeStyle = "rgba(10, 12, 18, 0.46)";
    ctx.lineWidth = Math.max(4, width * 0.035);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(width * 0.34, height * 0.59);
    ctx.quadraticCurveTo(
      width * 0.4,
      height * 0.72,
      width * 0.42,
      height * 0.86,
    );
    ctx.moveTo(width * 0.66, height * 0.59);
    ctx.quadraticCurveTo(
      width * 0.6,
      height * 0.72,
      width * 0.58,
      height * 0.86,
    );
    ctx.stroke();
  }

  ctx.fillStyle = style.skin;
  fillRoundedRect(
    ctx,
    cx - headR * 0.24,
    headCy + headR * 0.84,
    headR * 0.48,
    headR * 0.44,
    8,
  );
  traceHeadShapePath(ctx, cx, headCy, headR);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(
    cx - headR * 0.35,
    headCy - headR * 0.05,
    headR * 0.21,
    headR * 0.26,
    0,
    0,
    Math.PI * 2,
  );
  ctx.ellipse(
    cx + headR * 0.35,
    headCy - headR * 0.05,
    headR * 0.21,
    headR * 0.26,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(
    cx - headR * 0.33,
    headCy - headR * 0.02,
    headR * 0.078,
    0,
    Math.PI * 2,
  );
  ctx.arc(
    cx + headR * 0.33,
    headCy - headR * 0.02,
    headR * 0.078,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  drawSimpleNose(
    ctx,
    cx,
    headCy + headR * 0.22,
    headR * 0.28 * style.noseSizeScale,
    style.noseType,
  );
  strokeSimpleMouth(
    ctx,
    cx,
    headCy + headR * 0.45,
    headR * 0.22,
    style.mouthType,
  );

  if (style.hat) {
    ctx.fillStyle = style.hat;
    if (style.hatType === "Trollkarlshatt") {
      const brimRy = headR * 0.15;
      const brimCy = Math.min(headCy - headR * 0.88, minHatTopY + brimRy);
      ctx.beginPath();
      ctx.moveTo(cx, brimCy - headR * 0.76);
      ctx.lineTo(cx - headR * 0.82, brimCy);
      ctx.lineTo(cx + headR * 0.82, brimCy);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, brimCy, headR * 0.88, brimRy, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style.hatType === "Sombrero") {
      const crownRy = headR * 0.24;
      const crownCy = Math.min(headCy - headR * 0.82, minHatTopY + crownRy);
      const brimCy = crownCy + headR * 0.1;
      ctx.beginPath();
      ctx.ellipse(cx, crownCy, headR * 0.62, crownRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, brimCy, headR * 1.08, headR * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style.hatType === "Mössa") {
      // Cuff band hugging the top of the head
      const cuffTop = headCy - headR * 0.72;
      fillRoundedRect(
        ctx,
        cx - headR * 0.82,
        cuffTop,
        headR * 1.64,
        headR * 0.22,
        6,
      );
      // Rounded dome above the cuff
      ctx.beginPath();
      ctx.ellipse(cx, cuffTop, headR * 0.82, headR * 0.65, 0, Math.PI, 0);
      ctx.fill();
      // Pom-pom on top
      const pomR = headR * 0.14;
      ctx.beginPath();
      ctx.arc(cx, cuffTop - headR * 0.62, pomR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return true;
}

export function createAvatarSystem({ scene, camera }) {
  const avatars = new Map();
  const UP_AXIS = new THREE.Vector3(0, 1, 0);
  const tmpFallAwayWorld = new THREE.Vector3();
  const tmpFallAwayLocal = new THREE.Vector3();
  const tmpFallAxis = new THREE.Vector3();
  const tmpFootPivot = new THREE.Vector3();
  const tmpRotatedFootPivot = new THREE.Vector3();
  const tmpFallQuat = new THREE.Quaternion();
  const tmpHeadWorld = new THREE.Vector3();
  const tmpHeadLocal = new THREE.Vector3();
  const tmpAimOrigin = new THREE.Vector3();
  const tmpAimDirection = new THREE.Vector3();
  const tmpAimTarget = new THREE.Vector3();
  const firstPersonArmPivot = new THREE.Group();
  const knockdownStarTexture = createKnockdownStarTexture();
  const knockdownStarMaterial = new THREE.SpriteMaterial({
    map: knockdownStarTexture,
    transparent: true,
    depthWrite: false,
  });
  firstPersonArmPivot.position.set(0.28, -0.42, -0.5);
  firstPersonArmPivot.rotation.set(-1.12, -0.1, -0.2);
  const firstPersonSkinMaterial = new THREE.MeshStandardMaterial({
    color: 0xb57b5f,
    roughness: 0.82,
    metalness: 0.02,
    depthTest: false,
    depthWrite: false,
  });
  const firstPersonArm = new THREE.Group();
  const firstPersonPalm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.085, 0.12, 6, 12),
    firstPersonSkinMaterial,
  );
  firstPersonPalm.rotation.z = Math.PI / 2;
  firstPersonPalm.position.set(0, 0.02, 0);
  const firstPersonFist = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 18, 14),
    firstPersonSkinMaterial,
  );
  firstPersonFist.scale.set(1.08, 0.82, 0.94);
  firstPersonFist.position.set(0.13, 0.02, 0.01);
  const firstPersonWrist = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, 0.16, 5, 10),
    firstPersonSkinMaterial,
  );
  firstPersonWrist.rotation.z = Math.PI / 2;
  firstPersonWrist.position.set(-0.12, 0, 0);
  for (const part of [firstPersonPalm, firstPersonFist, firstPersonWrist]) {
    part.renderOrder = 1000;
    part.frustumCulled = false;
    firstPersonArm.add(part);
  }
  firstPersonArmPivot.add(firstPersonArm);
  firstPersonArmPivot.visible = false;
  camera.add(firstPersonArmPivot);
  let firstPersonAttackMs = 0;

  function visualYaw(serverYaw, controllerType) {
    if (controllerType === "PLAYER")
      return normalizeAngle(serverYaw + AVATAR_YAW_OFFSET);
    return serverYaw;
  }

  function buildCharacterProfile(id) {
    const rng = seededRandom(id * 4093 + 17);
    const heightRng = seededRandom(id * 92821 + 73);

    const heightScale = 0.82 + rng() * 0.34;
    const legScale = 0.8 + rng() * 0.34;
    const torsoScale = 0.82 + rng() * 0.3;
    const armScale = 0.8 + rng() * 0.34;
    const headScale = 0.84 + rng() * 0.28;
    const fatness = rng();

    const skin = new THREE.Color(
      SKIN_TONE_HEX[Math.floor(rng() * SKIN_TONE_HEX.length)],
    );
    const shirt = new THREE.Color(
      SHIRT_COLOR_HEX[Math.floor(rng() * SHIRT_COLOR_HEX.length)],
    );
    const pants = new THREE.Color(
      PANTS_COLOR_HEX[Math.floor(rng() * PANTS_COLOR_HEX.length)],
    );
    const shoe = new THREE.Color(
      SHOE_COLOR_HEX[Math.floor(rng() * SHOE_COLOR_HEX.length)],
    );
    const hatType = chooseHatType(id, rng);
    let hat = null;
    if (hatType !== "none") {
      const palette =
        HAT_COLOR_HEX_BY_TYPE[hatType] || HAT_COLOR_HEX_BY_TYPE.Trollkarlshatt;
      hat = new THREE.Color(palette[Math.floor(rng() * palette.length)]);
    }
    const mouthType = MOUTH_TYPES[Math.floor(rng() * MOUTH_TYPES.length)];
    const hasSkirt = rng() < SKIRT_CHANCE;
    const hasBackpack = rng() < BACKPACK_CHANCE;
    const backpack = new THREE.Color(
      BACKPACK_COLOR_HEX[Math.floor(rng() * BACKPACK_COLOR_HEX.length)],
    );
    const noseType = NOSE_TYPES[Math.floor(rng() * NOSE_TYPES.length)];
    const noseSizeScale =
      noseType === "round" ? 0.85 + rng() * 0.95 : 0.72 + rng() * 0.62;
    const noseDepthScale =
      noseType === "round" ? noseSizeScale : 0.9 + rng() * 1.25;

    const baseHeightNoHat = noHatBodyHeight({
      heightScale,
      legScale,
      torsoScale,
      headScale,
    });
    const targetHeightNoHat = 1.5 + heightRng() * 0.5;
    const visualScale =
      baseHeightNoHat > 0.0001 ? targetHeightNoHat / baseHeightNoHat : 1;

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
      shoe,
      hat: hat || new THREE.Color(0x2a2a2a),
      hatType,
      mouthType,
      hasSkirt,
      hasBackpack,
      backpack,
      noseType,
      noseSizeScale,
      noseDepthScale,
      visualScale,
    };
  }

  function createHatMesh(profile, headRadius) {
    if (profile.hatType === "none") return null;
    const hatMaterial = new THREE.MeshStandardMaterial({
      color: profile.hat,
      roughness: 0.7,
      metalness: 0.06,
    });
    const hatGroup = new THREE.Group();

    // anchorOffset: how far above headY the hat group origin is placed.
    // y=0 inside the group = bottom of the hat's inner band/brim.
    // The hat is "pulled down" so the band wraps the upper skull.

    if (profile.hatType === "Trollkarlshatt") {
      // Wide brim rests on the very top of the skull (anchorOffset ≈ head top).
      const brimHeight = headRadius * 0.08;
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(
          headRadius * 1.02,
          headRadius * 1.02,
          brimHeight,
          22,
        ),
        hatMaterial,
      );
      brim.position.y = brimHeight * 0.5;
      hatGroup.add(brim);
      const coneHeight = headRadius * 1.5;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(headRadius * 0.72, coneHeight, 22),
        hatMaterial,
      );
      cone.position.y = brimHeight + coneHeight * 0.5;
      hatGroup.add(cone);
      return { group: hatGroup, anchorOffset: 0.76 };
    }

    if (profile.hatType === "Sombrero") {
      // Wide brim, rests near head top.
      const brimHeight = headRadius * 0.1;
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(
          headRadius * 1.36,
          headRadius * 1.46,
          brimHeight,
          28,
        ),
        hatMaterial,
      );
      brim.position.y = brimHeight * 0.5;
      hatGroup.add(brim);
      const crownHeight = headRadius * 0.72;
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(
          headRadius * 0.46,
          headRadius * 0.62,
          crownHeight,
          22,
        ),
        hatMaterial,
      );
      crown.position.y = brimHeight + crownHeight * 0.5;
      hatGroup.add(crown);
      return { group: hatGroup, anchorOffset: 0.8 };
    }

    if (profile.hatType === "Mössa") {
      // Cuff wraps around the upper skull. Low anchor so cuff covers
      // roughly the top third of the head.
      const cuffHeight = headRadius * 0.22;
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(
          headRadius * 0.84,
          headRadius * 0.84,
          cuffHeight,
          22,
        ),
        hatMaterial,
      );
      cuff.position.y = cuffHeight * 0.5;
      hatGroup.add(cuff);
      const domeRadius = headRadius * 0.82;
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(
          domeRadius,
          22,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.62,
        ),
        hatMaterial,
      );
      dome.position.y = cuffHeight;
      hatGroup.add(dome);
      const pomR = headRadius * 0.16;
      const pom = new THREE.Mesh(
        new THREE.SphereGeometry(pomR, 10, 8),
        hatMaterial,
      );
      pom.position.y = cuffHeight + domeRadius * 0.92;
      hatGroup.add(pom);
      return { group: hatGroup, anchorOffset: 0.52 };
    }

    return null;
  }

  // Shared unit head geometry – created once for the entire system.
  // Each head mesh is scaled by headRadius at instantiation time so we never
  // re-run the expensive vertex-manipulation loop per avatar.
  const sharedUnitHeadGeometry = (() => {
    const geometry = new THREE.SphereGeometry(1, 24, 18);
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i);
      const yNorm = THREE.MathUtils.clamp(vertex.y, -1, 1);
      const chin = THREE.MathUtils.clamp(-yNorm, 0, 1);
      const temple = THREE.MathUtils.clamp((yNorm + 0.1) / 1.1, 0, 1);
      vertex.x *= 1 - chin * 0.15 - temple * 0.05;
      vertex.z *= 1 - chin * 0.11 - temple * 0.03;
      if (yNorm < -0.5) vertex.y *= 0.92;
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  })();

  function createHeadFaceTexture(skinColor, mouthType = "neutral") {
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

    function drawEyes(lookX, lookY, closed = false) {
      const ox = THREE.MathUtils.clamp(lookX, -1, 1) * PUPIL_RANGE_X_PX;
      const oy = THREE.MathUtils.clamp(lookY, -1, 1) * PUPIL_RANGE_Y_PX;

      ctx.clearRect(0, 0, HEAD_TEX_SIZE, HEAD_TEX_SIZE);
      ctx.fillStyle = skinStyle;
      ctx.fillRect(0, 0, HEAD_TEX_SIZE, HEAD_TEX_SIZE);

      if (closed) {
        ctx.strokeStyle = "#2a1f1a";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(leftEyeCx - EYE_RADIUS_X_PX * 0.95, faceCy);
        ctx.lineTo(leftEyeCx + EYE_RADIUS_X_PX * 0.95, faceCy);
        ctx.moveTo(rightEyeCx - EYE_RADIUS_X_PX * 0.95, faceCy);
        ctx.lineTo(rightEyeCx + EYE_RADIUS_X_PX * 0.95, faceCy);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(
          leftEyeCx,
          faceCy,
          EYE_RADIUS_X_PX,
          EYE_RADIUS_Y_PX,
          0,
          0,
          Math.PI * 2,
        );
        ctx.ellipse(
          rightEyeCx,
          faceCy,
          EYE_RADIUS_X_PX,
          EYE_RADIUS_Y_PX,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();

        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.arc(leftEyeCx + ox, faceCy + oy, PUPIL_RADIUS_PX, 0, Math.PI * 2);
        ctx.arc(rightEyeCx + ox, faceCy + oy, PUPIL_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
      }

      const mouthY = faceCy + EYE_RADIUS_Y_PX * 2.25;
      strokeSimpleMouth(ctx, faceCx, mouthY, EYE_RADIUS_X_PX * 0.85, mouthType);

      if (texture.image) texture.needsUpdate = true;
    }

    drawEyes(0, 0);
    return { texture, drawEyes };
  }

  function createKnockdownStarTexture() {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const cx = size * 0.5;
    const cy = size * 0.5;
    const outer = size * 0.34;
    const inner = size * 0.15;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI * 0.5 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? outer : inner;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const fill = ctx.createRadialGradient(0, -6, 4, 0, 0, outer);
    fill.addColorStop(0, "rgba(255,255,200,1)");
    fill.addColorStop(0.45, "rgba(255,222,85,1)");
    fill.addColorStop(1, "rgba(240,160,20,0.96)");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = "rgba(255,245,190,0.95)";
    ctx.stroke();
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function createAvatar(id) {
    const profile = buildCharacterProfile(id);
    const group = new THREE.Group();
    const yawGroup = new THREE.Group();
    const poseRoot = new THREE.Group();
    group.add(yawGroup);
    yawGroup.add(poseRoot);

    const torsoMaterial = new THREE.MeshStandardMaterial({
      color: profile.shirt,
      roughness: 0.85,
    });
    const pantsMaterial = new THREE.MeshStandardMaterial({
      color: profile.pants,
      roughness: 0.9,
    });
    const skinMaterialPlain = new THREE.MeshStandardMaterial({
      color: profile.skin,
      roughness: 0.8,
    });
    const legMaterial = profile.hasSkirt ? skinMaterialPlain : pantsMaterial;
    const shoeMaterial = new THREE.MeshStandardMaterial({
      color: profile.shoe,
      roughness: 0.92,
    });
    const backpackMaterial = new THREE.MeshStandardMaterial({
      color: profile.backpack,
      roughness: 0.86,
    });
    const backpackStrapMaterial = new THREE.MeshStandardMaterial({
      color: 0x151820,
      roughness: 0.88,
    });
    const noseMaterial = new THREE.MeshStandardMaterial({
      color: profile.skin,
      roughness: 0.82,
    });
    const headFace = createHeadFaceTexture(profile.skin, profile.mouthType);
    const skinMaterial = headFace
      ? new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: headFace.texture,
          roughness: 0.8,
        })
      : new THREE.MeshStandardMaterial({ color: profile.skin, roughness: 0.8 });

    const shoeHeight = 0.11 * profile.heightScale;
    const shoeWidth =
      0.16 * profile.heightScale * (0.86 + profile.fatness * 0.14);
    const shoeLength = 0.26 * profile.heightScale;

    const legRadius = 0.078 * profile.heightScale * profile.legScale;
    const legTotal = 0.84 * profile.heightScale * profile.legScale;
    const legCore = Math.max(0.05, legTotal - legRadius * 2);
    const hipY = shoeHeight + legTotal + 0.03 * profile.heightScale;

    const torsoRadius = 0.14 * profile.heightScale * profile.torsoScale;
    const torsoTotal = 0.9 * profile.heightScale * profile.torsoScale;
    const torsoCore = Math.max(0.06, torsoTotal - torsoRadius * 2);
    const torsoHalfWidth = torsoRadius * profile.torsoWidthScale;
    const legGap = Math.max(
      legRadius * 0.72,
      torsoHalfWidth * 0.62 - legRadius * 0.06,
    );
    const shoulderY = hipY + torsoTotal * 0.8;

    const armRadius = 0.066 * profile.heightScale * profile.armScale;
    const armTotal = 0.64 * profile.heightScale * profile.armScale;
    const armCore = Math.max(0.05, armTotal - armRadius * 2);
    const shoulderX = torsoRadius * profile.torsoWidthScale + armRadius * 0.58;
    const handRadius = armRadius * 1.18;
    const handCore = handRadius * 0.95;
    const shoeOutset = shoeWidth * 0.14;

    const headRadius = 0.24 * profile.heightScale * profile.headScale;
    const headY = hipY + torsoTotal + headRadius * 0.84;
    const eyeHeight = headY + headRadius * 0.24;

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(torsoRadius, torsoCore, 6, 14),
      torsoMaterial,
    );
    torso.scale.set(profile.torsoWidthScale, 1, profile.torsoDepthScale);
    torso.position.set(0, hipY + torsoTotal * 0.48, 0);
    poseRoot.add(torso);

    if (profile.hasBackpack) {
      const backpackHeight = torsoTotal * 0.62;
      const backpackWidth = torsoRadius * profile.torsoWidthScale * 1.8;
      const backpackDepth = torsoRadius * 0.62;
      const backpack = new THREE.Mesh(
        new THREE.BoxGeometry(backpackWidth, backpackHeight, backpackDepth),
        backpackMaterial,
      );
      backpack.position.set(
        0,
        hipY + torsoTotal * 0.48,
        -torsoRadius * profile.torsoDepthScale - backpackDepth * 0.42,
      );
      poseRoot.add(backpack);

      const strapGeometry = new THREE.BoxGeometry(
        Math.max(armRadius * 0.32, 0.018),
        torsoTotal * 0.58,
        0.018,
      );
      const strapY = hipY + torsoTotal * 0.48;
      const strapZ = torsoRadius * profile.torsoDepthScale + 0.018;
      const leftStrap = new THREE.Mesh(strapGeometry, backpackStrapMaterial);
      leftStrap.position.set(-torsoHalfWidth * 0.44, strapY, strapZ);
      leftStrap.rotation.z = -0.14;
      poseRoot.add(leftStrap);
      const rightStrap = new THREE.Mesh(strapGeometry, backpackStrapMaterial);
      rightStrap.position.set(torsoHalfWidth * 0.44, strapY, strapZ);
      rightStrap.rotation.z = 0.14;
      poseRoot.add(rightStrap);
    }

    const pelvis = new THREE.Mesh(
      new THREE.SphereGeometry(
        Math.max(legRadius * 1.35, torsoRadius * 0.36),
        16,
        12,
      ),
      pantsMaterial,
    );
    pelvis.scale.set(1.42, 0.82, 1.06);
    pelvis.position.set(0, hipY - legRadius * 0.1, 0);
    poseRoot.add(pelvis);

    if (profile.hasSkirt) {
      const skirtHeight = 0.34 * profile.heightScale;
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(
          torsoRadius * 1.0,
          torsoRadius * 1.72,
          skirtHeight,
          18,
        ),
        pantsMaterial,
      );
      skirt.scale.set(
        profile.torsoWidthScale,
        1,
        profile.torsoDepthScale * 0.92,
      );
      skirt.position.set(0, hipY - skirtHeight * 0.12, 0);
      poseRoot.add(skirt);
    }

    const head = new THREE.Mesh(sharedUnitHeadGeometry, skinMaterial);
    head.scale.set(0.98 * headRadius, 1.02 * headRadius, 0.98 * headRadius);
    head.position.set(0, headY, 0);
    poseRoot.add(head);

    const noseSize = headRadius * 0.28 * profile.noseSizeScale;
    const noseDepth = headRadius * 0.34 * profile.noseDepthScale;
    const noseSurfaceZ = headRadius * 0.94;
    const noseY = headY - headRadius * 0.25;
    let nose;
    if (profile.noseType === "round") {
      nose = new THREE.Mesh(
        new THREE.SphereGeometry(noseSize * 0.55, 14, 10),
        noseMaterial,
      );
      nose.scale.set(0.9, 0.75, 1.25);
      nose.position.set(0, noseY, noseSurfaceZ + noseSize * 0.42);
    } else {
      nose = new THREE.Mesh(
        new THREE.ConeGeometry(noseSize * 0.5, noseDepth, 14),
        noseMaterial,
      );
      nose.rotation.x = Math.PI * 0.5;
      nose.position.set(0, noseY, noseSurfaceZ + noseDepth * 0.5);
    }
    poseRoot.add(nose);

    const hatResult = createHatMesh(profile, headRadius);
    if (hatResult) {
      hatResult.group.position.set(
        0,
        headY + headRadius * hatResult.anchorOffset,
        0,
      );
      poseRoot.add(hatResult.group);
    }
    const knockdownStarOrbit = new THREE.Group();
    knockdownStarOrbit.visible = false;
    group.add(knockdownStarOrbit);
    const knockdownStars = [];
    for (let i = 0; i < KNOCKDOWN_STAR_COUNT; i += 1) {
      const star = new THREE.Sprite(knockdownStarMaterial);
      star.scale.setScalar(0.2);
      star.userData.phase = (i * Math.PI * 2) / KNOCKDOWN_STAR_COUNT;
      knockdownStarOrbit.add(star);
      knockdownStars.push(star);
    }

    // Shared geometries: left and right counterparts are mirrors of each other
    // (same dimensions, just positioned differently), so they share one geometry.
    const armGeometry = new THREE.CapsuleGeometry(armRadius, armCore, 5, 12);
    const handGeometry = new THREE.CapsuleGeometry(
      handRadius * 0.9,
      handCore,
      4,
      8,
    );
    const legGeometry = new THREE.CapsuleGeometry(legRadius, legCore, 5, 12);
    const shoeGeometry = new THREE.BoxGeometry(
      shoeWidth,
      shoeHeight,
      shoeLength,
    );

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-shoulderX, shoulderY, 0);
    const leftArm = new THREE.Mesh(armGeometry, torsoMaterial);
    leftArm.position.set(0, -armTotal * 0.5, 0);
    leftArmPivot.add(leftArm);
    const leftHand = new THREE.Mesh(handGeometry, skinMaterialPlain);
    leftHand.position.set(0, -armTotal - handRadius * 1.05, 0);
    leftArmPivot.add(leftHand);
    poseRoot.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(shoulderX, shoulderY, 0);
    const rightArm = new THREE.Mesh(armGeometry, torsoMaterial);
    rightArm.position.set(0, -armTotal * 0.5, 0);
    rightArmPivot.add(rightArm);
    const rightHand = new THREE.Mesh(handGeometry, skinMaterialPlain);
    rightHand.position.set(0, -armTotal - handRadius * 1.05, 0);
    rightArmPivot.add(rightHand);
    poseRoot.add(rightArmPivot);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-legGap, hipY, 0);
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(0, -legTotal * 0.5, 0);
    leftLegPivot.add(leftLeg);
    const leftShoe = new THREE.Mesh(shoeGeometry, shoeMaterial);
    leftShoe.position.set(
      -shoeOutset,
      -legTotal - shoeHeight * 0.35,
      shoeLength * 0.08,
    );
    leftLegPivot.add(leftShoe);
    poseRoot.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(legGap, hipY, 0);
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0, -legTotal * 0.5, 0);
    rightLegPivot.add(rightLeg);
    const rightShoe = new THREE.Mesh(shoeGeometry, shoeMaterial);
    rightShoe.position.set(
      shoeOutset,
      -legTotal - shoeHeight * 0.35,
      shoeLength * 0.08,
    );
    rightLegPivot.add(rightShoe);
    poseRoot.add(rightLegPivot);
    group.scale.setScalar(profile.visualScale);

    return {
      id,
      group,
      yawGroup,
      poseRoot,
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
      downedMsRemaining: 0,
      downedTotalMs: 0,
      downedEnteredAt: 0,
      isDowned: false,
      isRisingFromDowned: false,
      riseStartedAt: 0,
      riseStartTiltRad: 0,
      currentTiltRad: 0,
      fallAwayX: 0,
      fallAwayZ: 1,
      footPivotX: legGap,
      footPivotY: 0,
      footPivotZ: shoeLength * 0.08,
      headMesh: head,
      knockdownStarOrbit,
      knockdownStars,
      gazeTargetId: null,
      gazeRetargetAt: 0,
      inspectDownedTargetId: -1,
      inspectDownedActive: false,
      eyeX: 0,
      eyeY: 0,
      eyeTargetX: 0,
      eyeTargetY: 0,
      lookPitch: 0,
      lastDrawnEyeX: 999,
      lastDrawnEyeY: 999,
      lastDrawnEyesClosed: null,
      lastEyeDrawAt: 0,
      headFace,
      eyeHeight: eyeHeight * profile.visualScale,
      skinColor: profile.skin,
      lastKnockdownStarUpdateAt: 0,
    };
  }

  function updateFromServer(avatar, character, nowMs) {
    const wasDowned = avatar.isDowned;
    avatar.seenAtTick = true;
    avatar.targetYaw = visualYaw(character.yaw, character.controllerType);
    avatar.lookPitch = THREE.MathUtils.clamp(
      Number(character.pitch || 0),
      -MAX_LOOK_PITCH_RAD,
      MAX_LOOK_PITCH_RAD,
    );
    avatar.inspectDownedTargetId = Number.isFinite(
      character.inspectDownedTargetId,
    )
      ? Number(character.inspectDownedTargetId)
      : -1;
    avatar.inspectDownedActive =
      Boolean(character.inspectDownedActive) &&
      avatar.inspectDownedTargetId >= 0;
    const prevAttackFlashMs = avatar.attackFlashMsRemaining;
    avatar.attackFlashMsRemaining = character.attackFlashMsRemaining || 0;
    const attackFlashStarted =
      avatar.attackFlashMsRemaining > prevAttackFlashMs + 50;
    avatar.controllerType = character.controllerType || "AI";
    const downedMsRemaining = Math.max(
      0,
      Number(character.downedMsRemaining || 0),
    );
    const downedDurationMs = Math.max(
      downedMsRemaining,
      Number(character.downedDurationMs || 0),
    );

    if (!avatar.initialized) {
      avatar.group.position.set(character.x, 0, character.z);
      avatar.currentYaw = avatar.targetYaw;
      avatar.yawGroup.rotation.y = avatar.targetYaw;
      avatar.initialized = true;
    }

    if (downedMsRemaining > 0) {
      const fallX = Number.isFinite(character.fallAwayX)
        ? Number(character.fallAwayX)
        : 0;
      const fallZ = Number.isFinite(character.fallAwayZ)
        ? Number(character.fallAwayZ)
        : 1;
      const fallLen = Math.hypot(fallX, fallZ);
      if (fallLen > 0.001) {
        avatar.fallAwayX = fallX / fallLen;
        avatar.fallAwayZ = fallZ / fallLen;
      } else {
        avatar.fallAwayX = 0;
        avatar.fallAwayZ = 1;
      }
      if (!avatar.isDowned) {
        avatar.downedEnteredAt = nowMs;
        avatar.downedTotalMs = Math.max(1, downedDurationMs);
        avatar.isRisingFromDowned = false;
      } else if (downedDurationMs > 0) {
        avatar.downedTotalMs = Math.max(avatar.downedTotalMs, downedDurationMs);
      }
      avatar.isDowned = true;
      avatar.downedMsRemaining = downedMsRemaining;
      avatar.knockdownStarOrbit.visible = true;
    } else {
      if (avatar.isDowned) {
        avatar.isRisingFromDowned = true;
        avatar.riseStartedAt = nowMs;
        avatar.riseStartTiltRad = avatar.currentTiltRad;
      }
      avatar.isDowned = false;
      avatar.downedMsRemaining = 0;
      avatar.knockdownStarOrbit.visible = false;
    }

    if (
      avatar.lastServerAt > 0 &&
      avatar.lastServerX != null &&
      avatar.lastServerZ != null
    ) {
      const serverJump = Math.hypot(
        character.x - avatar.lastServerX,
        character.z - avatar.lastServerZ,
      );
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
      const dist = Math.hypot(
        character.x - avatar.lastServerX,
        character.z - avatar.lastServerZ,
      );
      const speedRatio = clamp01(dist / dt / MOVE_SPEED_REFERENCE);
      const moveTarget = avatar.isDowned ? 0 : speedRatio;
      avatar.moveAmount = THREE.MathUtils.lerp(
        avatar.moveAmount,
        moveTarget,
        0.5,
      );
    } else {
      avatar.targetX = character.x;
      avatar.targetZ = character.z;
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, 0, 0.3);
    }

    avatar.lastServerX = character.x;
    avatar.lastServerZ = character.z;
    avatar.lastServerAt = nowMs;
    return { downedStarted: !wasDowned && avatar.isDowned, attackFlashStarted };
  }

  function setAvatarEyeTarget(avatar, x, y) {
    avatar.eyeTargetX = THREE.MathUtils.clamp(x, -1, 1);
    avatar.eyeTargetY = THREE.MathUtils.clamp(y, -1, 1);
  }

  function updateAIEyeTarget(avatar, avatarsById, nowMs) {
    if (avatar.inspectDownedActive && avatar.inspectDownedTargetId >= 0) {
      const target = avatarsById.get(avatar.inspectDownedTargetId);
      if (target) {
        const dx = target.group.position.x - avatar.group.position.x;
        const dz = target.group.position.z - avatar.group.position.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.001) {
          const dirX = dx / len;
          const dirZ = dz / len;
          const rightX = Math.cos(avatar.currentYaw);
          const rightZ = -Math.sin(avatar.currentYaw);
          const localX = rightX * dirX + rightZ * dirZ;
          setAvatarEyeTarget(
            avatar,
            localX * INSPECT_EYE_SIDE_FACTOR,
            INSPECT_EYE_DOWN_LOOK,
          );
          return;
        }
      }
      setAvatarEyeTarget(avatar, 0, INSPECT_EYE_DOWN_LOOK);
      return;
    }

    if (nowMs >= avatar.gazeRetargetAt) {
      avatar.gazeRetargetAt = nowMs + 480 + Math.random() * 1400;
      const candidates = [];
      for (const otherAvatar of avatarsById.values()) {
        if (otherAvatar.id === avatar.id) continue;
        candidates.push(otherAvatar.id);
      }
      if (candidates.length > 0 && Math.random() < 0.78) {
        avatar.gazeTargetId =
          candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        avatar.gazeTargetId = null;
      }
    }

    if (avatar.gazeTargetId == null) {
      const driftX = Math.sin((nowMs + avatar.id * 97) * 0.0015) * 0.62;
      const driftY = Math.cos((nowMs + avatar.id * 67) * 0.0017) * 0.52;
      setAvatarEyeTarget(avatar, driftX, driftY);
      return;
    }

    const target = avatarsById.get(avatar.gazeTargetId);
    if (!target) {
      avatar.gazeTargetId = null;
      setAvatarEyeTarget(avatar, 0, 0);
      return;
    }

    const dx = target.group.position.x - avatar.group.position.x;
    const dz = target.group.position.z - avatar.group.position.z;
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

    const targetPitchY = THREE.MathUtils.clamp(
      -Number(target.lookPitch || 0) / MAX_LOOK_PITCH_RAD,
      -1,
      1,
    );
    const driftY = Math.sin((nowMs + avatar.id * 53) * 0.002) * 0.24;
    const localY = THREE.MathUtils.clamp(targetPitchY * 0.88 + driftY, -1, 1);
    setAvatarEyeTarget(avatar, localX * 2.25, localY);
  }

  function updatePlayerEyeTarget(avatar, nowMs) {
    const yawDrift = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    const lookX = THREE.MathUtils.clamp(
      yawDrift * 6.1 + Math.sin(nowMs * 0.0018 + avatar.id * 1.3) * 0.32,
      -1,
      1,
    );
    const pitchLookY = THREE.MathUtils.clamp(
      -avatar.lookPitch / MAX_LOOK_PITCH_RAD,
      -1,
      1,
    );
    const lookY = THREE.MathUtils.clamp(
      pitchLookY * 0.95 + Math.cos(nowMs * 0.0016 + avatar.id * 1.1) * 0.15,
      -1,
      1,
    );
    setAvatarEyeTarget(avatar, lookX, lookY);
  }

  function applyDownedPose(avatar, tiltRad) {
    if (tiltRad <= 0.0001) {
      avatar.poseRoot.quaternion.identity();
      avatar.poseRoot.position.set(0, 0, 0);
      return;
    }
    tmpFallAwayWorld.set(avatar.fallAwayX, 0, avatar.fallAwayZ);
    if (tmpFallAwayWorld.lengthSq() < 0.000001) {
      tmpFallAwayWorld.set(0, 0, 1);
    } else {
      tmpFallAwayWorld.normalize();
    }
    tmpFallAwayLocal
      .copy(tmpFallAwayWorld)
      .applyAxisAngle(UP_AXIS, -avatar.currentYaw);
    tmpFallAwayLocal.y = 0;
    if (tmpFallAwayLocal.lengthSq() < 0.000001) {
      tmpFallAwayLocal.set(0, 0, 1);
    } else {
      tmpFallAwayLocal.normalize();
    }
    tmpFallAxis.set(tmpFallAwayLocal.z, 0, -tmpFallAwayLocal.x).normalize();
    tmpFallQuat.setFromAxisAngle(tmpFallAxis, tiltRad);

    const footX =
      tmpFallAwayLocal.x >= 0 ? avatar.footPivotX : -avatar.footPivotX;
    tmpFootPivot.set(footX, avatar.footPivotY, avatar.footPivotZ);
    tmpRotatedFootPivot.copy(tmpFootPivot).applyQuaternion(tmpFallQuat);

    avatar.poseRoot.quaternion.copy(tmpFallQuat);
    avatar.poseRoot.position.copy(tmpFootPivot).sub(tmpRotatedFootPivot);
  }

  function updateKnockdownStars(avatar, nowMs) {
    if (!avatar.knockdownStarOrbit.visible) return;
    if (nowMs - avatar.lastKnockdownStarUpdateAt < KNOCKDOWN_STAR_UPDATE_MS)
      return;
    avatar.lastKnockdownStarUpdateAt = nowMs;
    avatar.headMesh.getWorldPosition(tmpHeadWorld);
    tmpHeadLocal.copy(tmpHeadWorld);
    avatar.group.worldToLocal(tmpHeadLocal);
    avatar.knockdownStarOrbit.position.copy(tmpHeadLocal);
    avatar.knockdownStarOrbit.position.y += KNOCKDOWN_STAR_HEAD_OFFSET_Y;

    const spin = nowMs * 0.0034;
    for (const star of avatar.knockdownStars) {
      const phase = Number(star.userData.phase || 0);
      const angle = spin + phase;
      star.position.set(
        Math.cos(angle) * KNOCKDOWN_STAR_ORBIT_RADIUS,
        Math.sin(angle * 1.6 + phase) * 0.045,
        Math.sin(angle) * KNOCKDOWN_STAR_ORBIT_RADIUS,
      );
      const pulse = 0.88 + 0.22 * Math.sin(nowMs * 0.008 + phase * 2.1);
      star.scale.setScalar(0.18 * pulse);
    }
  }

  function animateAvatar(avatar, deltaSec, avatarsById, nowMs) {
    if (!avatar.initialized) return;
    if (avatar.respawnHideMsRemaining > 0) {
      avatar.respawnHideMsRemaining = Math.max(
        0,
        avatar.respawnHideMsRemaining - deltaSec * 1000,
      );
      if (avatar.respawnHideMsRemaining <= 0) avatar.group.visible = true;
      return;
    }
    avatar.attackFlashMsRemaining = Math.max(
      0,
      avatar.attackFlashMsRemaining - deltaSec * 1000,
    );
    const posSmooth = 1 - Math.exp(-deltaSec * POSITION_SMOOTH_RATE);
    avatar.group.position.x = THREE.MathUtils.lerp(
      avatar.group.position.x,
      avatar.targetX,
      posSmooth,
    );
    avatar.group.position.z = THREE.MathUtils.lerp(
      avatar.group.position.z,
      avatar.targetZ,
      posSmooth,
    );

    const yawDelta = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    const rotSmooth = 1 - Math.exp(-deltaSec * ROTATION_SMOOTH_RATE);
    const desiredStep = yawDelta * rotSmooth;
    const maxStep = MAX_ROTATION_SPEED * deltaSec;
    const clampedStep = THREE.MathUtils.clamp(desiredStep, -maxStep, maxStep);
    avatar.currentYaw = normalizeAngle(avatar.currentYaw + clampedStep);
    avatar.yawGroup.rotation.y = avatar.currentYaw;

    if (avatar.isDowned) {
      avatar.downedMsRemaining = Math.max(
        0,
        avatar.downedMsRemaining - deltaSec * 1000,
      );
    }

    let tiltRad = 0;
    if (avatar.isDowned) {
      const elapsedMs = Math.max(
        0,
        avatar.downedTotalMs - avatar.downedMsRemaining,
      );
      const fallT = clamp01(elapsedMs / KNOCKDOWN_FALL_MS);
      tiltRad = KNOCKDOWN_MAX_TILT_RAD * fallT;
    } else if (avatar.isRisingFromDowned) {
      const riseT = clamp01((nowMs - avatar.riseStartedAt) / KNOCKDOWN_RISE_MS);
      tiltRad = avatar.riseStartTiltRad * (1 - riseT);
      if (riseT >= 1) {
        avatar.isRisingFromDowned = false;
        tiltRad = 0;
      }
    }
    avatar.currentTiltRad = tiltRad;
    applyDownedPose(avatar, tiltRad);
    updateKnockdownStars(avatar, nowMs);

    const locomotion = tiltRad > 0.001 ? 0 : avatar.moveAmount;
    avatar.walkPhase += deltaSec * (2.2 + locomotion * 7.2);
    const stride = Math.sin(avatar.walkPhase) * 0.72 * locomotion;
    const armBase = -stride * 0.82;

    avatar.leftLegPivot.rotation.x = stride;
    avatar.rightLegPivot.rotation.x = -stride;

    let punch = 0;
    if (tiltRad <= 0.001 && avatar.attackFlashMsRemaining > 0) {
      const progress =
        1 - clamp01(avatar.attackFlashMsRemaining / ATTACK_ANIM_MS);
      const extension =
        progress < 0.38 ? progress / 0.38 : 1 - (progress - 0.38) / 0.62;
      punch = clamp01(extension) * 1.9;
    }

    avatar.leftArmPivot.rotation.x = armBase;
    avatar.rightArmPivot.rotation.x = -armBase + punch;

    if (avatar.controllerType === "AI")
      updateAIEyeTarget(avatar, avatarsById, nowMs);
    else updatePlayerEyeTarget(avatar, nowMs);

    const eyeSmooth = 1 - Math.exp(-deltaSec * 14);
    avatar.eyeX = THREE.MathUtils.lerp(
      avatar.eyeX,
      avatar.eyeTargetX,
      eyeSmooth,
    );
    avatar.eyeY = THREE.MathUtils.lerp(
      avatar.eyeY,
      avatar.eyeTargetY,
      eyeSmooth,
    );
    const eyesClosed = avatar.isDowned;
    const dxCam = camera.position.x - avatar.group.position.x;
    const dzCam = camera.position.z - avatar.group.position.z;
    const distToCameraSq = dxCam * dxCam + dzCam * dzCam;
    const farFromCamera = distToCameraSq > EYE_DRAW_FAR_DISTANCE_SQ;
    const drawIntervalMs = farFromCamera
      ? EYE_DRAW_INTERVAL_FAR_MS
      : EYE_DRAW_INTERVAL_NEAR_MS;
    const eyeThreshold = farFromCamera ? 0.03 : 0.01;
    if (
      eyesClosed !== avatar.lastDrawnEyesClosed ||
      (nowMs - avatar.lastEyeDrawAt >= drawIntervalMs &&
        (Math.abs(avatar.eyeX - avatar.lastDrawnEyeX) > eyeThreshold ||
          Math.abs(avatar.eyeY - avatar.lastDrawnEyeY) > eyeThreshold))
    ) {
      avatar.headFace?.drawEyes?.(avatar.eyeX, avatar.eyeY, eyesClosed);
      avatar.lastDrawnEyeX = avatar.eyeX;
      avatar.lastDrawnEyeY = avatar.eyeY;
      avatar.lastDrawnEyesClosed = eyesClosed;
      avatar.lastEyeDrawAt = nowMs;
    }
  }

  function animateFirstPersonArm(deltaSec, hasControl) {
    if (!hasControl) {
      firstPersonArmPivot.visible = false;
      firstPersonAttackMs = 0;
      return;
    }
    firstPersonAttackMs = Math.max(0, firstPersonAttackMs - deltaSec * 1000);
    firstPersonArmPivot.visible = firstPersonAttackMs > 0;
    let punch = 0;
    if (firstPersonAttackMs > 0) {
      const progress = 1 - clamp01(firstPersonAttackMs / ATTACK_ANIM_MS);
      const extension =
        progress < 0.35 ? progress / 0.35 : 1 - (progress - 0.35) / 0.65;
      punch = clamp01(extension) * 2.2;
    }
    firstPersonArmPivot.rotation.x = -1.12 + punch * 0.72;
    firstPersonArmPivot.rotation.y = -0.1 + punch * 0.18;
    firstPersonArmPivot.rotation.z = -0.2 - punch * 0.06;
    firstPersonArmPivot.position.x = 0.28 - punch * 0.045;
    firstPersonArmPivot.position.y = -0.42 + punch * 0.11;
    firstPersonArmPivot.position.z = -0.5 - punch * 0.09;
  }

  function applyWorldCharacters({
    characters,
    myCharacterId,
    nowMs,
    hideMyCharacter = true,
  }) {
    let myYaw = null;
    let myAttackFired = false;
    const downedHitEvents = [];
    for (const avatar of avatars.values()) avatar.seenAtTick = false;

    for (const character of characters) {
      let avatar = avatars.get(character.id);
      if (!avatar) {
        avatar = createAvatar(character.id);
        scene.add(avatar.group);
        avatars.set(character.id, avatar);
      }

      const transition = updateFromServer(avatar, character, nowMs);
      if (transition?.downedStarted) {
        downedHitEvents.push({
          characterId: character.id,
          x: Number(character.x) || 0,
          y: 0,
          z: Number(character.z) || 0,
        });
      }
      avatar.group.visible = !(
        hideMyCharacter && character.id === myCharacterId
      );

      if (character.id === myCharacterId) {
        myYaw = character.yaw;
        if (transition?.attackFlashStarted) myAttackFired = true;
      }
    }

    for (const [id, avatar] of avatars.entries()) {
      if (avatar.seenAtTick) continue;
      scene.remove(avatar.group);
      avatars.delete(id);
    }

    return { myYaw, downedHitEvents, myAttackFired };
  }

  function animate(deltaSec, myCharacterId) {
    let hasControl = myCharacterId != null;
    const nowMs = performance.now();

    for (const [id, avatar] of avatars.entries()) {
      animateAvatar(avatar, deltaSec, avatars, nowMs);
      if (id === myCharacterId) {
        hasControl = true;
        firstPersonAttackMs = Math.max(
          firstPersonAttackMs,
          avatar.attackFlashMsRemaining,
        );
        if (firstPersonSkinMaterial.color && avatar.skinColor) {
          firstPersonSkinMaterial.color.copy(avatar.skinColor);
        }
        camera.position.set(
          avatar.group.position.x,
          avatar.eyeHeight,
          avatar.group.position.z,
        );
      }
    }
    animateFirstPersonArm(deltaSec, hasControl);
  }

  function rayHitsSphere(origin, direction, target, radius, maxDistance) {
    const toX = target.x - origin.x;
    const toY = target.y - origin.y;
    const toZ = target.z - origin.z;
    const alongRay = toX * direction.x + toY * direction.y + toZ * direction.z;
    if (alongRay <= 0 || alongRay > maxDistance) return false;
    const closestX = origin.x + direction.x * alongRay;
    const closestY = origin.y + direction.y * alongRay;
    const closestZ = origin.z + direction.z * alongRay;
    const dx = target.x - closestX;
    const dy = target.y - closestY;
    const dz = target.z - closestZ;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  function isAimingAtCharacter({
    myCharacterId,
    maxDistance = AIM_MAX_DISTANCE,
  } = {}) {
    if (myCharacterId == null) return false;
    tmpAimOrigin.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(tmpAimDirection);
    const safeMaxDistance = Math.max(
      0.2,
      Number(maxDistance) || AIM_MAX_DISTANCE,
    );

    for (const [id, avatar] of avatars.entries()) {
      if (id === myCharacterId) continue;
      if (!avatar.group.visible || avatar.isDowned) continue;

      tmpAimTarget.copy(avatar.group.position);
      tmpAimTarget.y = Math.max(
        0.7,
        avatar.eyeHeight * AIM_HEAD_Y_OFFSET_RATIO,
      );
      if (
        rayHitsSphere(
          tmpAimOrigin,
          tmpAimDirection,
          tmpAimTarget,
          AIM_BODY_RADIUS,
          safeMaxDistance,
        )
      )
        return true;

      tmpAimTarget.y = Math.max(
        0.52,
        avatar.eyeHeight * AIM_CHEST_Y_OFFSET_RATIO,
      );
      if (
        rayHitsSphere(
          tmpAimOrigin,
          tmpAimDirection,
          tmpAimTarget,
          AIM_BODY_RADIUS,
          safeMaxDistance,
        )
      )
        return true;
    }
    return false;
  }

  function getCharacterPosition(characterId) {
    if (characterId == null) return null;
    const avatar = avatars.get(characterId);
    if (!avatar?.initialized) return null;
    return {
      x: avatar.group.position.x,
      y: avatar.group.position.y,
      z: avatar.group.position.z,
    };
  }

  function getCharacterCameraState(characterId) {
    if (characterId == null) return null;
    const avatar = avatars.get(characterId);
    if (!avatar?.initialized) return null;
    return {
      x: avatar.group.position.x,
      z: avatar.group.position.z,
      yaw: avatar.currentYaw,
      eyeHeight: avatar.eyeHeight,
    };
  }

  /**
   * Reset server-position tracking for all avatars so the next
   * applyWorldCharacters call snaps every character to their current
   * server position (no lerp artefacts). Large jumps trigger the
   * existing respawn-hide so characters don't visually teleport.
   */
  function resetAllAvatarTracking() {
    for (const avatar of avatars.values()) {
      avatar.lastServerAt = 0;
      avatar.lastServerX = null;
      avatar.lastServerZ = null;
      // Force a position snap on the next applyWorldCharacters call
      // (same path as a newly created avatar — group.position.set() is called)
      avatar.initialized = false;
    }
  }

  return {
    applyWorldCharacters,
    animate,
    isAimingAtCharacter,
    getCharacterPosition,
    getCharacterCameraState,
    resetAllAvatarTracking,
  };
}

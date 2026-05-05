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
const HEAD_TEX_SIZE = 256;
const FACE_U = 0.25;
const FACE_V = 0.5;
const EYE_U_OFFSET = 0.058;
const EYE_RADIUS_X_PX = 12;
const EYE_RADIUS_Y_PX = 15;
const PUPIL_RADIUS_PX = 5.2;
const PUPIL_RANGE_X_PX = 5.8;
const PUPIL_RANGE_Y_PX = 4.6;
const AVATAR_YAW_OFFSET = Math.PI;
const MAX_LOOK_PITCH_RAD = 1.2;
const AIM_MAX_DISTANCE = 8;
const AIM_BODY_RADIUS = 0.44;
const AIM_HEAD_Y_OFFSET_RATIO = 0.9;
const AIM_CHEST_Y_OFFSET_RATIO = 0.58;
const SKIN_TONE_HEX = [
  0xfad7c4, 0xf1c7a5, 0xe6b88a, 0xd8a676, 0xbf8a5d, 0xa9744d, 0x8c603f, 0x714c34, 0x573a2a, 0x3f2b1f
];
const HAT_TYPES = ["CylinderHatt", "Trollkarlshatt", "Sombrero"];
const HAT_COLOR_HEX_BY_TYPE = {
  CylinderHatt: [0x111111, 0x232323, 0x3a3a3a, 0x3f2f24],
  Trollkarlshatt: [0x1f2b44, 0x2d3561, 0x4a2f44, 0x2c2f36],
  Sombrero: [0xd9c39a, 0xc5a77f, 0xb89365, 0x9f7b54]
};
const MOUTH_TYPES = ["happy", "neutral", "surprised", "sad"];

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
  const shirtHue = Math.round(rng() * 360);
  const shirtSat = Math.round((0.4 + rng() * 0.3) * 100);
  const shirtLight = Math.round((0.36 + rng() * 0.24) * 100);
  rng();
  rng();
  rng();
  rng();
  rng();
  rng();
  const hatRoll = rng();
  let hatType = "none";
  let hatHex = null;
  if (hatRoll >= 0.28) {
    hatType = HAT_TYPES[Math.floor(rng() * HAT_TYPES.length)];
    const palette = HAT_COLOR_HEX_BY_TYPE[hatType] || HAT_COLOR_HEX_BY_TYPE.CylinderHatt;
    hatHex = palette[Math.floor(rng() * palette.length)];
  }
  const mouthType = MOUTH_TYPES[Math.floor(rng() * MOUTH_TYPES.length)];
  return {
    skin: hexToCss(skinHex),
    shirt: `hsl(${shirtHue} ${shirtSat}% ${shirtLight}%)`,
    hatType,
    hat: hatHex == null ? null : hexToCss(hatHex),
    mouthType
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
  ctx.bezierCurveTo(cx + headR * 0.78, cy - headR * 0.96, cx + headR * 0.9, cy + headR * 0.1, cx + headR * 0.5, cy + headR * 0.9);
  ctx.bezierCurveTo(cx + headR * 0.22, cy + headR * 1.15, cx - headR * 0.22, cy + headR * 1.15, cx - headR * 0.5, cy + headR * 0.9);
  ctx.bezierCurveTo(cx - headR * 0.9, cy + headR * 0.1, cx - headR * 0.78, cy - headR * 0.96, cx, cy - headR * 1.02);
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

  ctx.clearRect(0, 0, width, height);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#20273a");
  bgGrad.addColorStop(1, "#111722");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = style.shirt;
  fillRoundedRect(ctx, width * 0.22, height * 0.56, width * 0.56, height * 0.34, 16);

  ctx.fillStyle = style.skin;
  fillRoundedRect(ctx, cx - headR * 0.24, headCy + headR * 0.84, headR * 0.48, headR * 0.44, 8);
  traceHeadShapePath(ctx, cx, headCy, headR);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx - headR * 0.35, headCy - headR * 0.05, headR * 0.21, headR * 0.26, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + headR * 0.35, headCy - headR * 0.05, headR * 0.21, headR * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(cx - headR * 0.33, headCy - headR * 0.02, headR * 0.078, 0, Math.PI * 2);
  ctx.arc(cx + headR * 0.33, headCy - headR * 0.02, headR * 0.078, 0, Math.PI * 2);
  ctx.fill();
  strokeSimpleMouth(ctx, cx, headCy + headR * 0.45, headR * 0.22, style.mouthType);

  if (style.hat) {
    ctx.fillStyle = style.hat;
    if (style.hatType === "CylinderHatt") {
      fillRoundedRect(ctx, cx - headR * 0.58, headCy - headR * 1.25, headR * 1.16, headR * 0.6, 8);
      fillRoundedRect(ctx, cx - headR * 0.88, headCy - headR * 0.76, headR * 1.76, headR * 0.16, 6);
    } else if (style.hatType === "Trollkarlshatt") {
      ctx.beginPath();
      ctx.moveTo(cx, headCy - headR * 1.52);
      ctx.lineTo(cx - headR * 0.82, headCy - headR * 0.62);
      ctx.lineTo(cx + headR * 0.82, headCy - headR * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, headCy - headR * 0.62, headR * 0.88, headR * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, headCy - headR * 0.66, headR * 0.62, headR * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, headCy - headR * 0.56, headR * 1.08, headR * 0.18, 0, 0, Math.PI * 2);
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
    depthWrite: false
  });
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

  function visualYaw(serverYaw, controllerType) {
    if (controllerType === "PLAYER") return normalizeAngle(serverYaw + AVATAR_YAW_OFFSET);
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

    const skin = new THREE.Color(SKIN_TONE_HEX[Math.floor(rng() * SKIN_TONE_HEX.length)]);
    const shirt = new THREE.Color();
    shirt.setHSL(rng(), 0.4 + rng() * 0.3, 0.36 + rng() * 0.24);
    const pants = new THREE.Color();
    pants.setHSL(rng(), 0.18 + rng() * 0.24, 0.25 + rng() * 0.22);
    const shoe = new THREE.Color();
    shoe.setHSL(rng(), 0.08 + rng() * 0.12, 0.08 + rng() * 0.18);
    const hatRoll = rng();
    let hatType = "none";
    let hat = null;
    if (hatRoll >= 0.28) {
      hatType = HAT_TYPES[Math.floor(rng() * HAT_TYPES.length)];
      const palette = HAT_COLOR_HEX_BY_TYPE[hatType] || HAT_COLOR_HEX_BY_TYPE.CylinderHatt;
      hat = new THREE.Color(palette[Math.floor(rng() * palette.length)]);
    }
    const mouthType = MOUTH_TYPES[Math.floor(rng() * MOUTH_TYPES.length)];

    const baseHeightNoHat = noHatBodyHeight({ heightScale, legScale, torsoScale, headScale });
    const targetHeightNoHat = 1.5 + heightRng() * 0.5;
    const visualScale = baseHeightNoHat > 0.0001 ? targetHeightNoHat / baseHeightNoHat : 1;

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
      visualScale
    };
  }

  function createHatMesh(profile, headRadius) {
    if (profile.hatType === "none") return null;
    const hatMaterial = new THREE.MeshStandardMaterial({ color: profile.hat, roughness: 0.7, metalness: 0.06 });
    const hatGroup = new THREE.Group();

    if (profile.hatType === "CylinderHatt") {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(headRadius * 0.95, headRadius * 0.95, headRadius * 0.1, 20),
        hatMaterial
      );
      brim.position.y = headRadius * 0.02;
      hatGroup.add(brim);
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(headRadius * 0.58, headRadius * 0.64, headRadius * 1.05, 20),
        hatMaterial
      );
      crown.position.y = headRadius * 0.54;
      hatGroup.add(crown);
      return hatGroup;
    }

    if (profile.hatType === "Trollkarlshatt") {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(headRadius * 1.02, headRadius * 1.02, headRadius * 0.08, 20),
        hatMaterial
      );
      brim.position.y = headRadius * 0.02;
      hatGroup.add(brim);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(headRadius * 0.76, headRadius * 1.5, 20),
        hatMaterial
      );
      cone.position.y = headRadius * 0.78;
      hatGroup.add(cone);
      return hatGroup;
    }

    if (profile.hatType === "Sombrero") {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(headRadius * 1.34, headRadius * 1.44, headRadius * 0.1, 28),
        hatMaterial
      );
      brim.position.y = headRadius * 0.08;
      hatGroup.add(brim);
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(headRadius * 0.46, headRadius * 0.64, headRadius * 0.72, 22),
        hatMaterial
      );
      crown.position.y = headRadius * 0.44;
      hatGroup.add(crown);
      return hatGroup;
    }

    return null;
  }

  function createHeadGeometry(headRadius) {
    const geometry = new THREE.SphereGeometry(headRadius, 24, 18);
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i);
      const yNorm = THREE.MathUtils.clamp(vertex.y / headRadius, -1, 1);
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
  }

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
        ctx.ellipse(leftEyeCx, faceCy, EYE_RADIUS_X_PX, EYE_RADIUS_Y_PX, 0, 0, Math.PI * 2);
        ctx.ellipse(rightEyeCx, faceCy, EYE_RADIUS_X_PX, EYE_RADIUS_Y_PX, 0, 0, Math.PI * 2);
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

    const torsoMaterial = new THREE.MeshStandardMaterial({ color: profile.shirt, roughness: 0.85 });
    const pantsMaterial = new THREE.MeshStandardMaterial({ color: profile.pants, roughness: 0.9 });
    const skinMaterialPlain = new THREE.MeshStandardMaterial({ color: profile.skin, roughness: 0.8 });
    const shoeMaterial = new THREE.MeshStandardMaterial({ color: profile.shoe, roughness: 0.92 });
    const headFace = createHeadFaceTexture(profile.skin, profile.mouthType);
    const skinMaterial = headFace
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: headFace.texture, roughness: 0.8 })
      : new THREE.MeshStandardMaterial({ color: profile.skin, roughness: 0.8 });

    const shoeHeight = 0.11 * profile.heightScale;
    const shoeWidth = 0.16 * profile.heightScale * (0.86 + profile.fatness * 0.14);
    const shoeLength = 0.26 * profile.heightScale;

    const legRadius = 0.078 * profile.heightScale * profile.legScale;
    const legTotal = 0.84 * profile.heightScale * profile.legScale;
    const legCore = Math.max(0.05, legTotal - legRadius * 2);
    const hipY = shoeHeight + legTotal + 0.03 * profile.heightScale;

    const torsoRadius = 0.14 * profile.heightScale * profile.torsoScale;
    const torsoTotal = 0.9 * profile.heightScale * profile.torsoScale;
    const torsoCore = Math.max(0.06, torsoTotal - torsoRadius * 2);
    const torsoHalfWidth = torsoRadius * profile.torsoWidthScale;
    const legGap = Math.max(legRadius * 0.72, torsoHalfWidth * 0.62 - legRadius * 0.06);
    const shoulderY = hipY + torsoTotal * 0.8;

    const armRadius = 0.066 * profile.heightScale * profile.armScale;
    const armTotal = 0.64 * profile.heightScale * profile.armScale;
    const armCore = Math.max(0.05, armTotal - armRadius * 2);
    const shoulderX = torsoRadius * profile.torsoWidthScale + armRadius * 0.58;
    const handRadius = armRadius * 0.9;
    const handCore = handRadius * 0.9;
    const shoeOutset = shoeWidth * 0.14;

    const headRadius = 0.24 * profile.heightScale * profile.headScale;
    const headY = hipY + torsoTotal + headRadius * 0.84;
    const eyeHeight = headY + headRadius * 0.24;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(torsoRadius, torsoCore, 6, 14), torsoMaterial);
    torso.scale.set(profile.torsoWidthScale, 1, profile.torsoDepthScale);
    torso.position.set(0, hipY + torsoTotal * 0.48, 0);
    poseRoot.add(torso);

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(Math.max(legRadius * 1.35, torsoRadius * 0.36), 16, 12), pantsMaterial);
    pelvis.scale.set(1.42, 0.82, 1.06);
    pelvis.position.set(0, hipY - legRadius * 0.1, 0);
    poseRoot.add(pelvis);

    const head = new THREE.Mesh(createHeadGeometry(headRadius), skinMaterial);
    head.scale.set(0.98, 1.02, 0.98);
    head.position.set(0, headY, 0);
    poseRoot.add(head);
    const hat = createHatMesh(profile, headRadius);
    if (hat) {
      hat.position.set(0, headY + headRadius * 0.84, 0);
      poseRoot.add(hat);
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

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-shoulderX, shoulderY, 0);
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(armRadius, armCore, 5, 12), torsoMaterial);
    leftArm.position.set(0, -armTotal * 0.5, 0);
    leftArmPivot.add(leftArm);
    const leftHand = new THREE.Mesh(new THREE.CapsuleGeometry(handRadius * 0.72, handCore, 4, 8), skinMaterialPlain);
    leftHand.position.set(0, -armTotal + handRadius * 0.7, 0);
    leftArmPivot.add(leftHand);
    poseRoot.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(shoulderX, shoulderY, 0);
    const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(armRadius, armCore, 5, 12), torsoMaterial);
    rightArm.position.set(0, -armTotal * 0.5, 0);
    rightArmPivot.add(rightArm);
    const rightHand = new THREE.Mesh(new THREE.CapsuleGeometry(handRadius * 0.72, handCore, 4, 8), skinMaterialPlain);
    rightHand.position.set(0, -armTotal + handRadius * 0.7, 0);
    rightArmPivot.add(rightHand);
    poseRoot.add(rightArmPivot);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-legGap, hipY, 0);
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(legRadius, legCore, 5, 12), pantsMaterial);
    leftLeg.position.set(0, -legTotal * 0.5, 0);
    leftLegPivot.add(leftLeg);
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(shoeWidth, shoeHeight, shoeLength), shoeMaterial);
    leftShoe.position.set(-shoeOutset, -legTotal - shoeHeight * 0.35, shoeLength * 0.08);
    leftLegPivot.add(leftShoe);
    poseRoot.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(legGap, hipY, 0);
    const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(legRadius, legCore, 5, 12), pantsMaterial);
    rightLeg.position.set(0, -legTotal * 0.5, 0);
    rightLegPivot.add(rightLeg);
    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(shoeWidth, shoeHeight, shoeLength), shoeMaterial);
    rightShoe.position.set(shoeOutset, -legTotal - shoeHeight * 0.35, shoeLength * 0.08);
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
      eyeX: 0,
      eyeY: 0,
      eyeTargetX: 0,
      eyeTargetY: 0,
      lookPitch: 0,
      lastDrawnEyeX: 999,
      lastDrawnEyeY: 999,
      lastDrawnEyesClosed: null,
      headFace,
      eyeHeight: eyeHeight * profile.visualScale,
      skinColor: profile.skin
    };
  }

  function updateFromServer(avatar, character, nowMs) {
    avatar.seenAtTick = true;
    avatar.targetYaw = visualYaw(character.yaw, character.controllerType);
    avatar.lookPitch = THREE.MathUtils.clamp(Number(character.pitch || 0), -MAX_LOOK_PITCH_RAD, MAX_LOOK_PITCH_RAD);
    avatar.attackFlashMsRemaining = character.attackFlashMsRemaining || 0;
    avatar.controllerType = character.controllerType || "AI";
    const downedMsRemaining = Math.max(0, Number(character.downedMsRemaining || 0));
    const downedDurationMs = Math.max(downedMsRemaining, Number(character.downedDurationMs || 0));

    if (!avatar.initialized) {
      avatar.group.position.set(character.x, 0, character.z);
      avatar.currentYaw = avatar.targetYaw;
      avatar.yawGroup.rotation.y = avatar.targetYaw;
      avatar.initialized = true;
    }

    if (downedMsRemaining > 0) {
      const fallX = Number.isFinite(character.fallAwayX) ? Number(character.fallAwayX) : 0;
      const fallZ = Number.isFinite(character.fallAwayZ) ? Number(character.fallAwayZ) : 1;
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
      const moveTarget = avatar.isDowned ? 0 : speedRatio;
      avatar.moveAmount = THREE.MathUtils.lerp(avatar.moveAmount, moveTarget, 0.5);
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

    const targetPitchY = THREE.MathUtils.clamp(-Number(target.pitch || 0) / MAX_LOOK_PITCH_RAD, -1, 1);
    const driftY = Math.sin((nowMs + avatar.id * 53) * 0.002) * 0.16;
    const localY = THREE.MathUtils.clamp(targetPitchY * 0.8 + driftY, -1, 1);
    setAvatarEyeTarget(avatar, localX * 1.6, localY);
  }

  function updatePlayerEyeTarget(avatar, nowMs) {
    const yawDrift = normalizeAngle(avatar.targetYaw - avatar.currentYaw);
    const lookX = THREE.MathUtils.clamp(yawDrift * 4.8 + Math.sin(nowMs * 0.0018 + avatar.id * 1.3) * 0.2, -1, 1);
    const pitchLookY = THREE.MathUtils.clamp(-avatar.lookPitch / MAX_LOOK_PITCH_RAD, -1, 1);
    const lookY = THREE.MathUtils.clamp(pitchLookY * 0.9 + Math.cos(nowMs * 0.0016 + avatar.id * 1.1) * 0.08, -1, 1);
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
    tmpFallAwayLocal.copy(tmpFallAwayWorld).applyAxisAngle(UP_AXIS, -avatar.currentYaw);
    tmpFallAwayLocal.y = 0;
    if (tmpFallAwayLocal.lengthSq() < 0.000001) {
      tmpFallAwayLocal.set(0, 0, 1);
    } else {
      tmpFallAwayLocal.normalize();
    }
    tmpFallAxis.set(tmpFallAwayLocal.z, 0, -tmpFallAwayLocal.x).normalize();
    tmpFallQuat.setFromAxisAngle(tmpFallAxis, tiltRad);

    const footX = tmpFallAwayLocal.x >= 0 ? avatar.footPivotX : -avatar.footPivotX;
    tmpFootPivot.set(footX, avatar.footPivotY, avatar.footPivotZ);
    tmpRotatedFootPivot.copy(tmpFootPivot).applyQuaternion(tmpFallQuat);

    avatar.poseRoot.quaternion.copy(tmpFallQuat);
    avatar.poseRoot.position.copy(tmpFootPivot).sub(tmpRotatedFootPivot);
  }

  function updateKnockdownStars(avatar, nowMs) {
    if (!avatar.knockdownStarOrbit.visible) return;
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
        Math.sin(angle) * KNOCKDOWN_STAR_ORBIT_RADIUS
      );
      const pulse = 0.88 + 0.22 * Math.sin(nowMs * 0.008 + phase * 2.1);
      star.scale.setScalar(0.18 * pulse);
    }
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
    avatar.yawGroup.rotation.y = avatar.currentYaw;

    if (avatar.isDowned) {
      avatar.downedMsRemaining = Math.max(0, avatar.downedMsRemaining - deltaSec * 1000);
    }

    let tiltRad = 0;
    if (avatar.isDowned) {
      const elapsedMs = Math.max(0, avatar.downedTotalMs - avatar.downedMsRemaining);
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
    const eyesClosed = avatar.isDowned;
    if (
      eyesClosed !== avatar.lastDrawnEyesClosed ||
      Math.abs(avatar.eyeX - avatar.lastDrawnEyeX) > 0.01 ||
      Math.abs(avatar.eyeY - avatar.lastDrawnEyeY) > 0.01
    ) {
      avatar.headFace?.drawEyes?.(avatar.eyeX, avatar.eyeY, eyesClosed);
      avatar.lastDrawnEyeX = avatar.eyeX;
      avatar.lastDrawnEyeY = avatar.eyeY;
      avatar.lastDrawnEyesClosed = eyesClosed;
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

  function applyWorldCharacters({ characters, myCharacterId, nowMs, hideMyCharacter = true }) {
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
      avatar.group.visible = !(hideMyCharacter && character.id === myCharacterId);

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
        z: avatar.group.position.z,
        pitch: avatar.lookPitch
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

  function isAimingAtCharacter({ myCharacterId, maxDistance = AIM_MAX_DISTANCE } = {}) {
    if (myCharacterId == null) return false;
    tmpAimOrigin.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(tmpAimDirection);
    const safeMaxDistance = Math.max(0.2, Number(maxDistance) || AIM_MAX_DISTANCE);

    for (const [id, avatar] of avatars.entries()) {
      if (id === myCharacterId) continue;
      if (!avatar.group.visible || avatar.isDowned) continue;

      tmpAimTarget.copy(avatar.group.position);
      tmpAimTarget.y = Math.max(0.7, avatar.eyeHeight * AIM_HEAD_Y_OFFSET_RATIO);
      if (rayHitsSphere(tmpAimOrigin, tmpAimDirection, tmpAimTarget, AIM_BODY_RADIUS, safeMaxDistance)) return true;

      tmpAimTarget.y = Math.max(0.52, avatar.eyeHeight * AIM_CHEST_Y_OFFSET_RATIO);
      if (rayHitsSphere(tmpAimOrigin, tmpAimDirection, tmpAimTarget, AIM_BODY_RADIUS, safeMaxDistance)) return true;
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
      z: avatar.group.position.z
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
      eyeHeight: avatar.eyeHeight
    };
  }

  return {
    applyWorldCharacters,
    animate,
    isAimingAtCharacter,
    getCharacterPosition,
    getCharacterCameraState
  };
}

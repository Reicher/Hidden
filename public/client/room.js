import * as THREE from "/vendor/three.module.js";
import { seededRandom } from "./utils.js";

const WALL_HEIGHT = 5.0;
const DEFAULT_WORLD_SIZE_METERS = 50;
const SHELF_WIDTH = 1.0;
const SHELF_DEPTH = 6.0;
const SHELF_HEIGHT = 2.0;

const COOLER_WIDTH = 1.0;
const COOLER_DEPTH = 1.0;
const COOLER_HEIGHT = 2.0;

const FREEZER_WIDTH = 1.0;
const FREEZER_DEPTH = 1.0;
const FREEZER_HEIGHT = 1.0;
const DEFAULT_SHELVES = Object.freeze([]);
const DEFAULT_COOLERS = Object.freeze([]);
const DEFAULT_FREEZERS = Object.freeze([]);
const FLUORESCENT_ROWS = 4;
const FLUORESCENT_COLS = 4;
const FLUORESCENT_BLINK_INDEX = 5;
const FLOOR_TILE_METERS = 1;
const CEILING_TILE_METERS = 3;

const TEXTURE_SPECS = Object.freeze({
  floor: Object.freeze({
    url: "/assets/floor.png",
    baseWidth: 64,
    baseHeight: 64,
    fallbackColor: 0x4a505d
  }),
  ceiling: Object.freeze({
    url: "/assets/ceiling.png",
    baseWidth: 96,
    baseHeight: 96,
    fallbackColor: 0x515661
  }),
  wall: Object.freeze({
    url: "/assets/wall.png",
    baseWidth: 32,
    baseHeight: 160,
    fallbackColor: 0x6f7b8f
  }),
  shelf: Object.freeze({
    url: "/assets/shelf.png",
    baseWidth: 192,
    baseHeight: 64,
    fallbackColor: 0x9a856b
  }),
  cooler: Object.freeze({
    url: "/assets/cooler.png",
    baseWidth: 32,
    baseHeight: 64,
    fallbackColor: 0xf8fafc
  }),
  freezer: Object.freeze({
    url: "/assets/freezer.png",
    baseWidth: 32,
    baseHeight: 32,
    fallbackColor: 0xf7f9fc
  })
});

export function createRoomSystem({ scene, renderer }) {
  const textureLoader = new THREE.TextureLoader();
  const textureAnisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const roomRoot = new THREE.Group();
  scene.add(roomRoot);

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorMaterial);
  floor.rotation.x = -Math.PI / 2;

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.01,
    side: THREE.DoubleSide
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;

  const wallBaseMaterial = new THREE.MeshBasicMaterial({ color: 0x6f7b8f });
  const wallMaterials = [];
  const shelfSideMaterials = [];
  const coolerFrontMaterials = [];
  const freezerLidMaterials = [];
  const fluorescentUnits = [];
  let currentPlaneSizeMeters = 30;

  function hasImageData(texture) {
    const image = texture?.image;
    if (!image) return false;
    if (typeof image.videoWidth === "number") return image.videoWidth > 0 && image.videoHeight > 0;
    if (typeof image.width === "number") return image.width > 0 && image.height > 0;
    return true;
  }

  function applyPixelArtSampling(texture) {
    if (!texture) return;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
  }

  const wallRng = seededRandom(20260429);
  const shelfRng = seededRandom(20260430);
  const floorRng = seededRandom(20260431);
  const ceilingRng = seededRandom(20260502);
  const coolerRng = seededRandom(20260503);
  const freezerRng = seededRandom(20260504);
  const blinkRng = seededRandom(20260501);
  const textureStates = new Map();

  let builtWorldSizeMeters = null;
  let builtFixturesSignature = "";

  function createTextureState(spec) {
    return {
      spec,
      texture: null,
      available: false,
      cellWidth: spec.baseWidth,
      cellHeight: spec.baseHeight,
      variantsX: 1,
      variantsY: 1,
      variantCount: 1
    };
  }

  for (const key of Object.keys(TEXTURE_SPECS)) {
    textureStates.set(key, createTextureState(TEXTURE_SPECS[key]));
  }

  function replaceMaterialMap(material, map) {
    if (material.map && material.map !== map) material.map.dispose();
    material.map = map || null;
    material.needsUpdate = true;
  }

  function chooseVariantSeed(rng) {
    return Math.floor(rng() * 1_000_000);
  }

  function variantIndexFromSeed(seed, variantCount) {
    if (!Number.isFinite(variantCount) || variantCount < 2) return 0;
    const normalizedSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
    return normalizedSeed % variantCount;
  }

  function updateTextureVariantInfo(state) {
    const image = state.texture?.image;
    const imageWidth = Number(image?.videoWidth ?? image?.width ?? 0);
    const imageHeight = Number(image?.videoHeight ?? image?.height ?? 0);
    if (!Number.isFinite(imageWidth) || imageWidth < 1 || !Number.isFinite(imageHeight) || imageHeight < 1) {
      state.cellWidth = state.spec.baseWidth;
      state.cellHeight = state.spec.baseHeight;
      state.variantsX = 1;
      state.variantsY = 1;
      state.variantCount = 1;
      return;
    }

    const cellWidth = imageWidth < state.spec.baseWidth ? imageWidth : state.spec.baseWidth;
    const cellHeight = imageHeight < state.spec.baseHeight ? imageHeight : state.spec.baseHeight;
    const variantsX = Math.max(1, Math.floor(imageWidth / cellWidth));
    const variantsY = Math.max(1, Math.floor(imageHeight / cellHeight));
    state.cellWidth = cellWidth;
    state.cellHeight = cellHeight;
    state.variantsX = variantsX;
    state.variantsY = variantsY;
    state.variantCount = Math.max(1, variantsX * variantsY);
  }

  function createVariantMap(state, variantSeed) {
    if (!state.available || !hasImageData(state.texture)) return null;
    const variantIndex = variantIndexFromSeed(variantSeed, state.variantCount);
    const col = variantIndex % state.variantsX;
    const rowFromTop = Math.floor(variantIndex / state.variantsX);
    const map = state.texture.clone();
    map.source = state.texture.source;
    map.image = state.texture.image;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = textureAnisotropy;
    applyPixelArtSampling(map);
    map.repeat.set(1 / state.variantsX, 1 / state.variantsY);
    map.offset.set(col / state.variantsX, 1 - (rowFromTop + 1) / state.variantsY);
    if (hasImageData(map)) map.needsUpdate = true;
    return map;
  }

  function createVariantTileTexture(state, variantSeed) {
    if (!state.available || !hasImageData(state.texture) || typeof document === "undefined") return null;
    const image = state.texture?.image;
    if (!image) return null;
    const variantIndex = variantIndexFromSeed(variantSeed, state.variantCount);
    const col = variantIndex % state.variantsX;
    const rowFromTop = Math.floor(variantIndex / state.variantsX);
    const sx = col * state.cellWidth;
    const sy = rowFromTop * state.cellHeight;

    const canvas = document.createElement("canvas");
    canvas.width = state.cellWidth;
    canvas.height = state.cellHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, sx, sy, state.cellWidth, state.cellHeight, 0, 0, state.cellWidth, state.cellHeight);

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = textureAnisotropy;
    applyPixelArtSampling(map);
    map.needsUpdate = true;
    return map;
  }

  function createRepeatedWallMap(state, variantSeed, wallSpanMeters) {
    const map = createVariantTileTexture(state, variantSeed);
    if (!map) return null;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.repeat.set(Math.max(0.001, wallSpanMeters), 1);
    map.needsUpdate = true;
    return map;
  }

  function createRandomizedSurfaceMap({ state, planeSizeMeters, tileSizeMeters, rng }) {
    if (!state.available || !hasImageData(state.texture)) return null;
    const image = state.texture?.image;
    if (!image || typeof document === "undefined") return null;
    const tileCount = Math.max(1, Math.ceil(planeSizeMeters / tileSizeMeters));
    const canvas = document.createElement("canvas");
    canvas.width = state.cellWidth * tileCount;
    canvas.height = state.cellHeight * tileCount;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < tileCount; y += 1) {
      for (let x = 0; x < tileCount; x += 1) {
        const variantSeed = chooseVariantSeed(rng);
        const variantIndex = variantIndexFromSeed(variantSeed, state.variantCount);
        const col = variantIndex % state.variantsX;
        const rowFromTop = Math.floor(variantIndex / state.variantsX);
        const sx = col * state.cellWidth;
        const sy = rowFromTop * state.cellHeight;
        ctx.drawImage(
          image,
          sx,
          sy,
          state.cellWidth,
          state.cellHeight,
          x * state.cellWidth,
          y * state.cellHeight,
          state.cellWidth,
          state.cellHeight
        );
      }
    }

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = textureAnisotropy;
    applyPixelArtSampling(map);
    map.needsUpdate = true;
    return map;
  }

  function applyPlanarMaterialTexture({ key, material, fallbackColor, tileSizeMeters, rng }) {
    const state = textureStates.get(key);
    if (!state?.available) {
      replaceMaterialMap(material, null);
      material.color.setHex(fallbackColor);
      return;
    }

    const nextMap = createRandomizedSurfaceMap({
      state,
      planeSizeMeters: currentPlaneSizeMeters,
      tileSizeMeters,
      rng
    });
    if (nextMap) {
      material.color.setHex(0xffffff);
      replaceMaterialMap(material, nextMap);
      return;
    }

    replaceMaterialMap(material, null);
    material.color.setHex(fallbackColor);
  }

  function refreshFloorAndCeilingTextures() {
    applyPlanarMaterialTexture({
      key: "floor",
      material: floorMaterial,
      fallbackColor: TEXTURE_SPECS.floor.fallbackColor,
      tileSizeMeters: FLOOR_TILE_METERS,
      rng: floorRng
    });
    applyPlanarMaterialTexture({
      key: "ceiling",
      material: ceilingMaterial,
      fallbackColor: TEXTURE_SPECS.ceiling.fallbackColor,
      tileSizeMeters: CEILING_TILE_METERS,
      rng: ceilingRng
    });
  }

  function applyVariantMaterials(materials, key, fallbackColor) {
    const state = textureStates.get(key);
    for (const material of materials) {
      const variantSeed = Number(material.userData?.variantSeed ?? 0);
      if (!state?.available) {
        replaceMaterialMap(material, null);
        material.color.setHex(fallbackColor);
        continue;
      }
      const map = createVariantMap(state, variantSeed);
      if (map) {
        material.color.setHex(0xffffff);
        replaceMaterialMap(material, map);
        continue;
      }
      replaceMaterialMap(material, null);
      material.color.setHex(fallbackColor);
    }
  }

  function applyWallMaterials() {
    const state = textureStates.get("wall");
    for (const material of wallMaterials) {
      const variantSeed = Number(material.userData?.variantSeed ?? 0);
      const wallSpanMeters = Number(material.userData?.wallSpanMeters ?? 1);
      if (!state?.available) {
        replaceMaterialMap(material, null);
        material.color.setHex(TEXTURE_SPECS.wall.fallbackColor);
        continue;
      }
      const map = createRepeatedWallMap(state, variantSeed, wallSpanMeters);
      if (map) {
        material.color.setHex(0xffffff);
        replaceMaterialMap(material, map);
        continue;
      }
      replaceMaterialMap(material, null);
      material.color.setHex(TEXTURE_SPECS.wall.fallbackColor);
    }
  }

  function refreshAllTextureApplications() {
    refreshFloorAndCeilingTextures();
    applyWallMaterials();
    applyVariantMaterials(shelfSideMaterials, "shelf", TEXTURE_SPECS.shelf.fallbackColor);
    applyVariantMaterials(coolerFrontMaterials, "cooler", TEXTURE_SPECS.cooler.fallbackColor);
    applyVariantMaterials(freezerLidMaterials, "freezer", TEXTURE_SPECS.freezer.fallbackColor);
  }

  function onTextureLoaded(key, texture) {
    const state = textureStates.get(key);
    if (!state) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = textureAnisotropy;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    applyPixelArtSampling(texture);
    state.texture = texture;
    state.available = true;
    updateTextureVariantInfo(state);
    refreshAllTextureApplications();
  }

  function onTextureFailed(key) {
    const state = textureStates.get(key);
    if (!state) return;
    state.texture = null;
    state.available = false;
    state.variantsX = 1;
    state.variantsY = 1;
    state.variantCount = 1;
    refreshAllTextureApplications();
  }

  function loadTextureByKey(key) {
    const spec = TEXTURE_SPECS[key];
    textureLoader.load(
      spec.url,
      (texture) => onTextureLoaded(key, texture),
      undefined,
      () => onTextureFailed(key)
    );
  }

  for (const key of Object.keys(TEXTURE_SPECS)) {
    loadTextureByKey(key);
  }

  function createWallMaterial(variantSeed, wallSpanMeters) {
    const material = wallBaseMaterial.clone();
    material.userData.variantSeed = variantSeed;
    material.userData.wallSpanMeters = wallSpanMeters;
    wallMaterials.push(material);
    applyWallMaterials();
    return material;
  }

  function createShelfSideMaterial(variantSeed) {
    const material = new THREE.MeshBasicMaterial({
      color: TEXTURE_SPECS.shelf.fallbackColor,
      side: THREE.DoubleSide
    });
    material.userData.variantSeed = variantSeed;
    shelfSideMaterials.push(material);
    applyVariantMaterials([material], "shelf", TEXTURE_SPECS.shelf.fallbackColor);
    return material;
  }

  function createCoolerFrontMaterial(variantSeed) {
    const material = new THREE.MeshStandardMaterial({
      color: TEXTURE_SPECS.cooler.fallbackColor,
      roughness: 0.18,
      metalness: 0.04
    });
    material.userData.variantSeed = variantSeed;
    coolerFrontMaterials.push(material);
    applyVariantMaterials([material], "cooler", TEXTURE_SPECS.cooler.fallbackColor);
    return material;
  }

  function createFreezerLidMaterial(variantSeed) {
    const material = new THREE.MeshStandardMaterial({
      color: TEXTURE_SPECS.freezer.fallbackColor,
      roughness: 0.14,
      metalness: 0.02
    });
    material.userData.variantSeed = variantSeed;
    freezerLidMaterials.push(material);
    applyVariantMaterials([material], "freezer", TEXTURE_SPECS.freezer.fallbackColor);
    return material;
  }

  function disposeMaterial(material) {
    if (!material) return;
    if (material.map) {
      material.map.dispose();
      material.map = null;
    }
    material.dispose();
  }

  function disposeObjectResources(object3d) {
    for (const child of object3d.children || []) disposeObjectResources(child);
    if (!object3d.geometry && !object3d.material) return;
    if (object3d.geometry) object3d.geometry.dispose();
    if (!object3d.material) return;
    if (Array.isArray(object3d.material)) {
      const unique = new Set(object3d.material);
      for (const material of unique) disposeMaterial(material);
      return;
    }
    disposeMaterial(object3d.material);
  }

  function clearRoomRootGeometry() {
    for (const child of [...roomRoot.children]) {
      roomRoot.remove(child);
      if (child !== floor && child !== ceiling) disposeObjectResources(child);
    }
    wallMaterials.length = 0;
    shelfSideMaterials.length = 0;
    coolerFrontMaterials.length = 0;
    freezerLidMaterials.length = 0;
  }

  function createWall(x, z, sx, sz) {
    const wallSpanMeters = Math.max(sx, sz);
    const material = createWallMaterial(chooseVariantSeed(wallRng), wallSpanMeters);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), material);
    mesh.position.set(x, WALL_HEIGHT * 0.5, z);
    roomRoot.add(mesh);
  }

  function createShelf(shelf) {
    const width = typeof shelf.width === "number" ? shelf.width : 1.0;
    const depth = typeof shelf.depth === "number" ? shelf.depth : 6.0;
    const height = typeof shelf.height === "number" ? shelf.height : 2.0;
    const yaw = typeof shelf.yaw === "number" ? shelf.yaw : 0;
    const plain = new THREE.MeshStandardMaterial({ color: 0x8a7660, roughness: 0.9, metalness: 0.02 });

    const sideA = createShelfSideMaterial(chooseVariantSeed(shelfRng));
    const sideB = createShelfSideMaterial(chooseVariantSeed(shelfRng));
    const group = new THREE.Group();
    group.position.set(shelf.x, 0, shelf.z);
    group.rotation.y = yaw;
    group.userData.type = "shelf";
    roomRoot.add(group);

    const core = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), plain);
    core.position.set(0, height * 0.5, 0);
    group.add(core);

    // Put textured panels explicitly on the long sides to avoid BoxGeometry material-index ambiguity.
    const sideOffsetX = width * 0.5 + 0.004;
    const longSideA = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), sideA);
    longSideA.position.set(sideOffsetX, height * 0.5, 0);
    longSideA.rotation.y = Math.PI / 2;
    group.add(longSideA);

    const longSideB = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), sideB);
    longSideB.position.set(-sideOffsetX, height * 0.5, 0);
    longSideB.rotation.y = -Math.PI / 2;
    group.add(longSideB);
  }

  function createCooler(cooler) {
    const width = typeof cooler.width === "number" ? cooler.width : COOLER_WIDTH;
    const depth = typeof cooler.depth === "number" ? cooler.depth : COOLER_DEPTH;
    const height = typeof cooler.height === "number" ? cooler.height : COOLER_HEIGHT;
    const yaw = typeof cooler.yaw === "number" ? cooler.yaw : 0;

    const group = new THREE.Group();
    group.position.set(cooler.x, 0, cooler.z);
    group.rotation.y = yaw;
    group.userData.type = "cooler";
    group.userData.frontLocalAxis = "+Z";
    group.userData.frontFacingYaw = yaw;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xecf0f4, roughness: 0.28, metalness: 0.08 });
    const frontMaterial = createCoolerFrontMaterial(chooseVariantSeed(coolerRng));
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xd4dbe4, roughness: 0.34, metalness: 0.22 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial);
    body.position.y = height * 0.5;
    body.userData.frontLocalAxis = "+Z";
    group.add(body);

    const frontPanel = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.86, height * 0.92), frontMaterial);
    frontPanel.position.set(0, height * 0.5, depth * 0.5 + 0.004);
    frontPanel.userData.frontLocalAxis = "+Z";
    group.add(frontPanel);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(width * 0.04, height * 0.54, 0.02), trimMaterial);
    handle.position.set(width * 0.34, height * 0.5, depth * 0.5 + 0.018);
    handle.userData.frontLocalAxis = "+Z";
    group.add(handle);

    roomRoot.add(group);
  }

  function createFreezer(freezer) {
    const width = typeof freezer.width === "number" ? freezer.width : 1.0;
    const depth = typeof freezer.depth === "number" ? freezer.depth : 1.0;
    const height = typeof freezer.height === "number" ? freezer.height : 1.0;
    const yaw = typeof freezer.yaw === "number" ? freezer.yaw : 0;

    const group = new THREE.Group();
    group.position.set(freezer.x, 0, freezer.z);
    group.rotation.y = yaw;
    group.userData.type = "freezer";
    group.userData.opening = "top";

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.42, metalness: 0.06 });
    const lidMaterial = createFreezerLidMaterial(chooseVariantSeed(freezerRng));

    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial);
    body.position.y = height * 0.5;
    group.add(body);

    const lidThickness = 0.05;
    const lidInset = 0.02;
    const lidBase = new THREE.Mesh(
      new THREE.BoxGeometry(width - lidInset * 2, lidThickness, depth - lidInset * 2),
      new THREE.MeshStandardMaterial({ color: 0xf7f9fc, roughness: 0.22, metalness: 0.02 })
    );
    lidBase.position.set(0, height + lidThickness * 0.5 + 0.002, 0);
    group.add(lidBase);

    const lidTop = new THREE.Mesh(new THREE.PlaneGeometry(width - lidInset * 2, depth - lidInset * 2), lidMaterial);
    lidTop.rotation.x = -Math.PI / 2;
    lidTop.position.set(0, height + lidThickness + 0.003, 0);
    group.add(lidTop);

    roomRoot.add(group);
  }

  function createFluorescentGrid(halfWorldSize) {
    fluorescentUnits.length = 0;
    const ceilingY = WALL_HEIGHT - 0.2;
    const edgeMargin = Math.max(2.8, halfWorldSize * 0.15);
    const minCoord = -halfWorldSize + edgeMargin;
    const maxCoord = halfWorldSize - edgeMargin;
    const xStep = FLUORESCENT_COLS > 1 ? (maxCoord - minCoord) / (FLUORESCENT_COLS - 1) : 0;
    const zStep = FLUORESCENT_ROWS > 1 ? (maxCoord - minCoord) / (FLUORESCENT_ROWS - 1) : 0;
    const tubeLength = Math.max(3.6, Math.min(5.4, halfWorldSize * 0.24));

    for (let row = 0; row < FLUORESCENT_ROWS; row += 1) {
      for (let col = 0; col < FLUORESCENT_COLS; col += 1) {
        const index = row * FLUORESCENT_COLS + col;
        const x = minCoord + col * xStep;
        const z = minCoord + row * zStep;
        const isBlinker = index === FLUORESCENT_BLINK_INDEX;

        const fixture = new THREE.Group();
        fixture.position.set(x, ceilingY, z);
        fixture.userData.type = "fluorescent";

        const housing = new THREE.Mesh(
          new THREE.BoxGeometry(tubeLength, 0.14, 0.34),
          new THREE.MeshStandardMaterial({ color: 0x9ca7b6, roughness: 0.4, metalness: 0.24 })
        );
        fixture.add(housing);

        const diffuserMaterial = new THREE.MeshStandardMaterial({
          color: 0xf2f8ff,
          roughness: 0.2,
          metalness: 0.02,
          emissive: 0xdbeeff,
          emissiveIntensity: 1.35
        });
        const diffuser = new THREE.Mesh(new THREE.BoxGeometry(tubeLength * 0.9, 0.06, 0.2), diffuserMaterial);
        diffuser.position.y = -0.06;
        fixture.add(diffuser);

        const glow = new THREE.PointLight(0xeef7ff, 1.4, halfWorldSize * 1.06, 2);
        glow.position.y = -0.24;
        fixture.add(glow);

        roomRoot.add(fixture);
        fluorescentUnits.push({
          isBlinker,
          light: glow,
          diffuserMaterial,
          baseIntensity: 1.4,
          baseEmissiveIntensity: 1.35,
          blinkCooldownSec: 0.9 + blinkRng() * 1.8,
          blinkRemainingSec: 0
        });
      }
    }
  }

  function updateFluorescents(deltaSec) {
    if (!fluorescentUnits.length) return;
    for (const unit of fluorescentUnits) {
      if (!unit.isBlinker) continue;
      if (unit.blinkRemainingSec > 0) {
        unit.blinkRemainingSec = Math.max(0, unit.blinkRemainingSec - deltaSec);
      } else {
        unit.blinkCooldownSec -= deltaSec;
      }

      const shouldBlinkNow =
        unit.blinkRemainingSec > 0 ||
        (unit.blinkCooldownSec <= 0 && (() => {
          unit.blinkRemainingSec = 0.05 + blinkRng() * 0.07;
          unit.blinkCooldownSec = 0.8 + blinkRng() * 1.9;
          return true;
        })());

      if (shouldBlinkNow) {
        const pulse = 0.22 + blinkRng() * 0.18;
        unit.light.intensity = unit.baseIntensity * pulse;
        unit.diffuserMaterial.emissiveIntensity = unit.baseEmissiveIntensity * pulse;
      } else {
        unit.light.intensity = unit.baseIntensity;
        unit.diffuserMaterial.emissiveIntensity = unit.baseEmissiveIntensity;
      }
    }
  }

  function buildRoomGeometry(worldSizeMeters, shelves, coolers, freezers) {
    const halfWorldSize = worldSizeMeters * 0.5;
    const wallThickness = 1;
    const wallSegmentsPerSide = 4;
    const wallCenterOffset = halfWorldSize + wallThickness * 0.5;
    const wallSpan = worldSizeMeters + wallThickness;
    const wallSegmentSpan = wallSpan / wallSegmentsPerSide;
    const planeSize = wallSpan + 5;
    currentPlaneSizeMeters = planeSize;

    clearRoomRootGeometry();
    floor.geometry.dispose();
    ceiling.geometry.dispose();

    floor.geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    ceiling.geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    ceiling.position.y = WALL_HEIGHT;

    roomRoot.add(floor);
    roomRoot.add(ceiling);
    refreshFloorAndCeilingTextures();

    for (let i = 0; i < wallSegmentsPerSide; i += 1) {
      const offset = -wallSpan / 2 + wallSegmentSpan * (i + 0.5);
      createWall(offset, -wallCenterOffset, wallSegmentSpan, wallThickness);
      createWall(offset, wallCenterOffset, wallSegmentSpan, wallThickness);
      createWall(-wallCenterOffset, offset, wallThickness, wallSegmentSpan);
      createWall(wallCenterOffset, offset, wallThickness, wallSegmentSpan);
    }

    for (const shelf of shelves) createShelf(shelf);
    for (const cooler of coolers) createCooler(cooler);
    for (const freezer of freezers) createFreezer(freezer);
    createFluorescentGrid(halfWorldSize);
  }

  function normalizeFixtures(fixtures, fallback) {
    if (!Array.isArray(fixtures)) return fallback;
    const valid = fixtures.filter(
      (fixture) =>
        fixture &&
        typeof fixture.x === "number" &&
        Number.isFinite(fixture.x) &&
        typeof fixture.z === "number" &&
        Number.isFinite(fixture.z)
    );
    return valid.length > 0 ? valid : fallback;
  }

  function fixtureSignature(fixtures) {
    return fixtures
      .map((fixture) => [fixture.x, fixture.z, fixture.width, fixture.depth, fixture.height, fixture.yaw].join(","))
      .join("|");
  }

  function syncFromWorld({ worldSizeMeters, shelves, coolers, freezers }) {
    const normalizedWorldSize =
      typeof worldSizeMeters === "number" && Number.isFinite(worldSizeMeters)
        ? worldSizeMeters
        : DEFAULT_WORLD_SIZE_METERS;
    const normalizedShelves = normalizeFixtures(shelves, DEFAULT_SHELVES);
    const normalizedCoolers = normalizeFixtures(coolers, DEFAULT_COOLERS);
    const normalizedFreezers = normalizeFixtures(freezers, DEFAULT_FREEZERS);
    const nextSignature = [
      fixtureSignature(normalizedShelves),
      fixtureSignature(normalizedCoolers),
      fixtureSignature(normalizedFreezers)
    ].join("||");
    const shouldRebuild = builtWorldSizeMeters !== normalizedWorldSize || builtFixturesSignature !== nextSignature;
    if (!shouldRebuild) return;

    buildRoomGeometry(normalizedWorldSize, normalizedShelves, normalizedCoolers, normalizedFreezers);
    builtWorldSizeMeters = normalizedWorldSize;
    builtFixturesSignature = nextSignature;
  }

  syncFromWorld({
    worldSizeMeters: DEFAULT_WORLD_SIZE_METERS,
    shelves: DEFAULT_SHELVES,
    coolers: DEFAULT_COOLERS,
    freezers: DEFAULT_FREEZERS
  });

  return { syncFromWorld, update: updateFluorescents };
}

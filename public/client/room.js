import * as THREE from "/vendor/three.module.js";
import { seededRandom } from "./utils.js";

const WALL_HEIGHT = 5.0;
const DEFAULT_WORLD_SIZE_METERS = 50;
const DEFAULT_WORLD_WIDTH_METERS = DEFAULT_WORLD_SIZE_METERS;
const DEFAULT_WORLD_HEIGHT_METERS = DEFAULT_WORLD_SIZE_METERS;
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
const FLUORESCENT_UPDATE_STEP_SEC = 1 / 30;
const FLOOR_TILE_METERS = 1;
const CEILING_TILE_METERS = 3;
const PRODUCT_SPAWN_CHANCE = 0.8;
const PRODUCT_WIDTH_METERS = 0.8;
const PRODUCT_TILE_WIDTH = 32;
const PRODUCT_ATLAS_URLS = ["/assets/products.png"];
const PRODUCT_YAW_JITTER_RAD = Math.PI / 9; // +/- 20 deg
const PRODUCT_SIDE_JITTER_METERS = 0.2; // +/- 20 cm along shelf length
const PRODUCT_DEPTH_JITTER_METERS = 0.1; // +/- 10 cm toward/away from shelf front

const TEXTURE_SPECS = Object.freeze({
  floor: Object.freeze({
    urls: ["/assets/floor.png"],
    baseWidth: 64,
    baseHeight: 64,
    fallbackColor: 0x4a505d,
  }),
  ceiling: Object.freeze({
    urls: ["/assets/ceiling.png"],
    baseWidth: 96,
    baseHeight: 96,
    fallbackColor: 0x515661,
  }),
  wall: Object.freeze({
    urls: ["/assets/wall.png"],
    baseWidth: 32,
    baseHeight: 160,
    fallbackColor: 0x6f7b8f,
  }),
  shelf: Object.freeze({
    urls: ["/assets/shelf.png"],
    baseWidth: 192,
    baseHeight: 64,
    fallbackColor: 0x9a856b,
  }),
  cooler: Object.freeze({
    urls: ["/assets/cooler.png"],
    baseWidth: 32,
    baseHeight: 64,
    fallbackColor: 0xf8fafc,
  }),
  freezer: Object.freeze({
    urls: ["/assets/freezer.png"],
    baseWidth: 32,
    baseHeight: 32,
    fallbackColor: 0xf7f9fc,
  }),
});

function randomSeed32() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return bytes[0] >>> 0;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export function createRoomSystem({ scene, renderer }) {
  const textureLoader = new THREE.TextureLoader();
  const isLikelyTouchDevice = (() => {
    const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const hoverNone = window.matchMedia && window.matchMedia("(hover: none)").matches;
    const touchApi = "ontouchstart" in window;
    const touchPoints = (navigator.maxTouchPoints || 0) > 0;
    const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    return coarsePointer || hoverNone || touchApi || touchPoints || mobileUa;
  })();
  const textureAnisotropy = Math.min(
    isLikelyTouchDevice ? 2 : 4,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const roomRoot = new THREE.Group();
  scene.add(roomRoot);

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorMaterial);
  floor.rotation.x = -Math.PI / 2;

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.01,
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    ceilingMaterial,
  );
  ceiling.rotation.x = Math.PI / 2;

  const wallBaseMaterial = new THREE.MeshBasicMaterial({ color: 0x6f7b8f });
  const wallMaterials = [];
  const coolerFrontMaterials = [];
  const freezerLidMaterials = [];
  const fluorescentUnits = [];
  let fluorescentAccumSec = 0;
  const shelfBackInstances = [];
  const shelfBoardInstances = [];
  const productInstancesByVariant = new Map();
  const staticInstancedResources = [];
  const tempPos = new THREE.Vector3();
  const tempScale = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempEuler = new THREE.Euler(0, 0, 0, "XYZ");
  const tempMatrix = new THREE.Matrix4();
  let currentPlaneWidthMeters = 30;
  let currentPlaneHeightMeters = 30;
  let productAtlasTexture = null;
  let productAtlasAvailable = false;
  let productVariantCount = 1;
  const productRng = seededRandom(randomSeed32());
  let productVariantBag = [];

  function hasImageData(texture) {
    const image = texture?.image;
    if (!image) return false;
    if (typeof image.videoWidth === "number")
      return image.videoWidth > 0 && image.videoHeight > 0;
    if (typeof image.width === "number")
      return image.width > 0 && image.height > 0;
    return true;
  }

  function applyPixelArtSampling(texture) {
    if (!texture) return;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
  }

  const wallRng = seededRandom(randomSeed32());
  const floorRng = seededRandom(20260431);
  const ceilingRng = seededRandom(20260502);
  const coolerRng = seededRandom(20260503);
  const freezerRng = seededRandom(20260504);
  const blinkRng = seededRandom(20260501);
  const textureStates = new Map();

  let builtWorldWidthMeters = null;
  let builtWorldHeightMeters = null;
  let builtFixturesSignature = "";
  let lastSyncedWorldWidthMeters = DEFAULT_WORLD_WIDTH_METERS;
  let lastSyncedWorldHeightMeters = DEFAULT_WORLD_HEIGHT_METERS;
  let lastSyncedShelves = DEFAULT_SHELVES;
  let lastSyncedCoolers = DEFAULT_COOLERS;
  let lastSyncedFreezers = DEFAULT_FREEZERS;

  function createTextureState(spec) {
    return {
      spec,
      texture: null,
      available: false,
      cellWidth: spec.baseWidth,
      cellHeight: spec.baseHeight,
      variantsX: 1,
      variantsY: 1,
      variantCount: 1,
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
    const normalizedSeed = Number.isFinite(seed)
      ? Math.abs(Math.trunc(seed))
      : 0;
    return normalizedSeed % variantCount;
  }

  function updateTextureVariantInfo(state) {
    const image = state.texture?.image;
    const imageWidth = Number(image?.videoWidth ?? image?.width ?? 0);
    const imageHeight = Number(image?.videoHeight ?? image?.height ?? 0);
    if (
      !Number.isFinite(imageWidth) ||
      imageWidth < 1 ||
      !Number.isFinite(imageHeight) ||
      imageHeight < 1
    ) {
      state.cellWidth = state.spec.baseWidth;
      state.cellHeight = state.spec.baseHeight;
      state.variantsX = 1;
      state.variantsY = 1;
      state.variantCount = 1;
      return;
    }

    const cellWidth =
      imageWidth < state.spec.baseWidth ? imageWidth : state.spec.baseWidth;
    const cellHeight =
      imageHeight < state.spec.baseHeight ? imageHeight : state.spec.baseHeight;
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
    map.offset.set(
      col / state.variantsX,
      1 - (rowFromTop + 1) / state.variantsY,
    );
    if (hasImageData(map)) map.needsUpdate = true;
    return map;
  }

  function getProductAspectRatio() {
    const image = productAtlasTexture?.image;
    const imageWidth = Number(image?.videoWidth ?? image?.width ?? 0);
    const imageHeight = Number(image?.videoHeight ?? image?.height ?? 0);
    if (
      !Number.isFinite(imageWidth) ||
      imageWidth <= 0 ||
      !Number.isFinite(imageHeight) ||
      imageHeight <= 0
    )
      return 1;
    const variants = Math.max(1, productVariantCount);
    const cellWidth = imageWidth / variants;
    if (!Number.isFinite(cellWidth) || cellWidth <= 0) return 1;
    return imageHeight / cellWidth;
  }

  function createProductMap(productIndex) {
    if (!productAtlasAvailable || !hasImageData(productAtlasTexture))
      return null;
    const variants = Math.max(1, productVariantCount);
    const col = ((Math.trunc(productIndex) % variants) + variants) % variants;
    const map = productAtlasTexture.clone();
    map.source = productAtlasTexture.source;
    map.image = productAtlasTexture.image;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = textureAnisotropy;
    applyPixelArtSampling(map);
    map.repeat.set(1 / variants, 1);
    map.offset.set(col / variants, 0);
    if (hasImageData(map)) map.needsUpdate = true;
    return map;
  }

  function updateProductVariantCount(texture) {
    const image = texture?.image;
    const imageWidth = Number(image?.videoWidth ?? image?.width ?? 0);
    const imageHeight = Number(image?.videoHeight ?? image?.height ?? 0);
    if (
      !Number.isFinite(imageWidth) ||
      imageWidth < 1 ||
      !Number.isFinite(imageHeight) ||
      imageHeight < 1
    ) {
      productVariantCount = 1;
      return;
    }
    const cellWidth = imageWidth < PRODUCT_TILE_WIDTH ? imageWidth : PRODUCT_TILE_WIDTH;
    productVariantCount = Math.max(1, Math.floor(imageWidth / cellWidth));
  }

  function refillProductVariantBag() {
    const variants = Math.max(1, productVariantCount);
    const nextBag = [];
    for (let i = 0; i < variants; i += 1) nextBag.push(i);
    for (let i = nextBag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(productRng() * (i + 1));
      const temp = nextBag[i];
      nextBag[i] = nextBag[j];
      nextBag[j] = temp;
    }
    productVariantBag = nextBag;
  }

  function chooseProductVariantIndex() {
    if (productVariantBag.length <= 0) refillProductVariantBag();
    const next = productVariantBag.pop();
    return Number.isFinite(next) ? next : 0;
  }

  function createProductMaterial(productIndex) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    const map = createProductMap(productIndex);
    if (map) {
      material.map = map;
    } else {
      material.color.setHex(0xc88d5e);
    }
    return material;
  }

  function createVariantTileTexture(state, variantSeed) {
    if (
      !state.available ||
      !hasImageData(state.texture) ||
      typeof document === "undefined"
    )
      return null;
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
    ctx.drawImage(
      image,
      sx,
      sy,
      state.cellWidth,
      state.cellHeight,
      0,
      0,
      state.cellWidth,
      state.cellHeight,
    );

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

  function createRandomizedSurfaceMap({
    state,
    planeWidthMeters,
    planeHeightMeters,
    tileSizeMeters,
    rng,
  }) {
    if (!state.available || !hasImageData(state.texture)) return null;
    const image = state.texture?.image;
    if (!image || typeof document === "undefined") return null;
    const tileCountX = Math.max(
      1,
      Math.ceil(planeWidthMeters / tileSizeMeters),
    );
    const tileCountY = Math.max(
      1,
      Math.ceil(planeHeightMeters / tileSizeMeters),
    );
    const canvas = document.createElement("canvas");
    canvas.width = state.cellWidth * tileCountX;
    canvas.height = state.cellHeight * tileCountY;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < tileCountY; y += 1) {
      for (let x = 0; x < tileCountX; x += 1) {
        const variantSeed = chooseVariantSeed(rng);
        const variantIndex = variantIndexFromSeed(
          variantSeed,
          state.variantCount,
        );
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
          state.cellHeight,
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

  function applyPlanarMaterialTexture({
    key,
    material,
    fallbackColor,
    tileSizeMeters,
    rng,
  }) {
    const state = textureStates.get(key);
    if (!state?.available) {
      replaceMaterialMap(material, null);
      material.color.setHex(fallbackColor);
      return;
    }

    const nextMap = createRandomizedSurfaceMap({
      state,
      planeWidthMeters: currentPlaneWidthMeters,
      planeHeightMeters: currentPlaneHeightMeters,
      tileSizeMeters,
      rng,
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
      rng: floorRng,
    });
    applyPlanarMaterialTexture({
      key: "ceiling",
      material: ceilingMaterial,
      fallbackColor: TEXTURE_SPECS.ceiling.fallbackColor,
      tileSizeMeters: CEILING_TILE_METERS,
      rng: ceilingRng,
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
    applyVariantMaterials(
      coolerFrontMaterials,
      "cooler",
      TEXTURE_SPECS.cooler.fallbackColor,
    );
    applyVariantMaterials(
      freezerLidMaterials,
      "freezer",
      TEXTURE_SPECS.freezer.fallbackColor,
    );
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
    const url = Array.isArray(spec.urls) && spec.urls.length > 0 ? spec.urls[0] : null;
    if (!url) {
      onTextureFailed(key);
      return;
    }
    textureLoader.load(
      url,
      (texture) => onTextureLoaded(key, texture),
      undefined,
      () => onTextureFailed(key),
    );
  }

  for (const key of Object.keys(TEXTURE_SPECS)) {
    loadTextureByKey(key);
  }

  textureLoader.load(
    PRODUCT_ATLAS_URLS[0],
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = textureAnisotropy;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      applyPixelArtSampling(texture);
      productAtlasTexture = texture;
      productAtlasAvailable = true;

      updateProductVariantCount(texture);
      productVariantBag = [];

      builtWorldWidthMeters = null;
      builtWorldHeightMeters = null;
      builtFixturesSignature = "";
      syncFromWorld({
        worldWidthMeters: lastSyncedWorldWidthMeters,
        worldHeightMeters: lastSyncedWorldHeightMeters,
        shelves: lastSyncedShelves,
        coolers: lastSyncedCoolers,
        freezers: lastSyncedFreezers,
      });
    },
    undefined,
    undefined,
    () => {
      productAtlasTexture = null;
      productAtlasAvailable = false;
    },
  );

  function createWallMaterial(variantSeed, wallSpanMeters) {
    const material = wallBaseMaterial.clone();
    material.userData.variantSeed = variantSeed;
    material.userData.wallSpanMeters = wallSpanMeters;
    wallMaterials.push(material);
    applyWallMaterials();
    return material;
  }

  function createCoolerFrontMaterial(variantSeed) {
    const material = new THREE.MeshStandardMaterial({
      color: TEXTURE_SPECS.cooler.fallbackColor,
      roughness: 0.18,
      metalness: 0.04,
    });
    material.userData.variantSeed = variantSeed;
    coolerFrontMaterials.push(material);
    applyVariantMaterials(
      [material],
      "cooler",
      TEXTURE_SPECS.cooler.fallbackColor,
    );
    return material;
  }

  function createFreezerLidMaterial(variantSeed) {
    const material = new THREE.MeshStandardMaterial({
      color: TEXTURE_SPECS.freezer.fallbackColor,
      roughness: 0.14,
      metalness: 0.02,
    });
    material.userData.variantSeed = variantSeed;
    freezerLidMaterials.push(material);
    applyVariantMaterials(
      [material],
      "freezer",
      TEXTURE_SPECS.freezer.fallbackColor,
    );
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
    coolerFrontMaterials.length = 0;
    freezerLidMaterials.length = 0;
    shelfBackInstances.length = 0;
    shelfBoardInstances.length = 0;
    productInstancesByVariant.clear();
    staticInstancedResources.length = 0;
  }

  function pushInstance(target, x, y, z, sx, sy, sz, yaw = 0) {
    target.push({ x, y, z, sx, sy, sz, yaw });
  }

  function pushShelfLocalInstance(target, shelf, localX, localY, localZ, sx, sy, sz) {
    const yaw = Number(shelf?.yaw || 0);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const originX = Number(shelf?.x || 0);
    const originZ = Number(shelf?.z || 0);
    const worldX = originX + localX * cos + localZ * sin;
    const worldZ = originZ + -localX * sin + localZ * cos;
    pushInstance(target, worldX, localY, worldZ, sx, sy, sz, yaw);
  }

  function pushProductInstance(variantIndex, x, y, z, sx, sy, yaw) {
    const normalized = ((Math.trunc(variantIndex) % Math.max(1, productVariantCount)) + Math.max(1, productVariantCount)) % Math.max(1, productVariantCount);
    const bucket = productInstancesByVariant.get(normalized) || [];
    bucket.push({ x, y, z, sx, sy, yaw });
    if (!productInstancesByVariant.has(normalized)) {
      productInstancesByVariant.set(normalized, bucket);
    }
  }

  function buildInstancedMesh({ geometry, material, instances, flipX = false }) {
    if (!Array.isArray(instances) || instances.length <= 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < instances.length; i += 1) {
      const inst = instances[i];
      tempPos.set(inst.x, inst.y, inst.z);
      tempEuler.set(0, inst.yaw || 0, 0);
      tempQuat.setFromEuler(tempEuler);
      const scaleX = flipX ? -inst.sx : inst.sx;
      tempScale.set(scaleX, inst.sy, inst.sz || 1);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    roomRoot.add(mesh);
    staticInstancedResources.push(mesh);
    return mesh;
  }

  function buildStaticInstancedGeometry() {
    const shelfBackMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f4a2d,
      roughness: 0.92,
      metalness: 0.02,
    });
    const shelfBoardMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f4a2d,
      roughness: 0.92,
      metalness: 0.02,
    });
    const shelfBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
    buildInstancedMesh({
      geometry: shelfBoxGeometry,
      material: shelfBackMaterial,
      instances: shelfBackInstances
    });
    buildInstancedMesh({
      geometry: shelfBoxGeometry.clone(),
      material: shelfBoardMaterial,
      instances: shelfBoardInstances
    });
  }

  function buildProductInstancedMeshes() {
    if (!productAtlasAvailable || productVariantCount < 1) return;
    for (const [variantIndex, bucket] of productInstancesByVariant.entries()) {
      if (!bucket || bucket.length <= 0) continue;
      const material = createProductMaterial(variantIndex);
      const geometry = new THREE.PlaneGeometry(1, 1);
      buildInstancedMesh({
        geometry,
        material,
        instances: bucket,
        flipX: true
      });
    }
  }

  function createWall(x, z, sx, sz) {
    const wallSpanMeters = Math.max(sx, sz);
    const material = createWallMaterial(
      chooseVariantSeed(wallRng),
      wallSpanMeters,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, WALL_HEIGHT, sz),
      material,
    );
    mesh.position.set(x, WALL_HEIGHT * 0.5, z);
    roomRoot.add(mesh);
  }

  function createShelf(shelf) {
    const width = typeof shelf.width === "number" ? shelf.width : 1.0;
    const depth = typeof shelf.depth === "number" ? shelf.depth : 6.0;
    const height = typeof shelf.height === "number" ? shelf.height : 2.0;
    const yaw = typeof shelf.yaw === "number" ? shelf.yaw : 0;
    const panelLength = Math.max(width, depth);
    const panelHeight = Math.max(0.2, height);
    const panelThickness = 0.1;
    const shelfDepth = 0.5;
    const shelfThickness = 0.1;
    const shelfCount = 3;

    const backPanelX = width * 0.5 - panelThickness * 0.5;
    pushShelfLocalInstance(
      shelfBackInstances,
      shelf,
      backPanelX,
      panelHeight * 0.5,
      0,
      panelThickness,
      panelHeight,
      panelLength,
    );

    const shelfMinY = panelHeight * 0.2;
    const shelfMaxY = panelHeight * 0.8;
    const shelfYs = [];
    for (let i = 0; i < shelfCount; i += 1) {
      const t = shelfCount > 1 ? i / (shelfCount - 1) : 0;
      const shelfY = shelfMinY + (shelfMaxY - shelfMinY) * t;
      shelfYs.push(shelfY);
      pushShelfLocalInstance(
        shelfBoardInstances,
        shelf,
        backPanelX - panelThickness * 0.5 - shelfDepth * 0.5,
        shelfY,
        0,
        shelfDepth,
        shelfThickness,
        panelLength,
      );
    }

    if (!productAtlasAvailable || productVariantCount < 1) return;
    const meterCount = Math.max(1, Math.floor(panelLength));
    const centerX = backPanelX - panelThickness * 0.5 - shelfDepth * 0.5;
    const zStart = -panelLength * 0.5;
    const productAspect = getProductAspectRatio();
    const naturalProductHeight = PRODUCT_WIDTH_METERS * productAspect;
    for (let meter = 0; meter < meterCount; meter += 1) {
      const zCenter = zStart + meter + 0.5;
      for (let level = 0; level < shelfYs.length; level += 1) {
        if (Math.random() > PRODUCT_SPAWN_CHANCE) continue;
        const currentTopY = shelfYs[level] + shelfThickness * 0.5;
        const nextBottomY =
          level < shelfYs.length - 1
            ? shelfYs[level + 1] - shelfThickness * 0.5 - 0.02
            : panelHeight - 0.02;
        const availableHeight = Math.max(0, nextBottomY - currentTopY);
        const productHeight = Math.min(naturalProductHeight, availableHeight);
        if (!Number.isFinite(productHeight) || productHeight < 0.06) continue;

        const productIndex = chooseProductVariantIndex();
        const sideJitter = (Math.random() * 2 - 1) * PRODUCT_SIDE_JITTER_METERS;
        const depthJitter =
          (Math.random() * 2 - 1) * PRODUCT_DEPTH_JITTER_METERS;
        const yawJitter = (Math.random() * 2 - 1) * PRODUCT_YAW_JITTER_RAD;
        const localX = centerX + depthJitter;
        const localY = currentTopY + productHeight * 0.5;
        const localZ = zCenter + sideJitter;
        const worldX = shelf.x + localX * Math.cos(yaw) + localZ * Math.sin(yaw);
        const worldZ = shelf.z + -localX * Math.sin(yaw) + localZ * Math.cos(yaw);
        pushProductInstance(
          productIndex,
          worldX,
          localY,
          worldZ,
          PRODUCT_WIDTH_METERS,
          productHeight,
          yaw + (-Math.PI / 2 + yawJitter),
        );
      }
    }
  }

  function createCooler(cooler) {
    const width =
      typeof cooler.width === "number" ? cooler.width : COOLER_WIDTH;
    const depth =
      typeof cooler.depth === "number" ? cooler.depth : COOLER_DEPTH;
    const height =
      typeof cooler.height === "number" ? cooler.height : COOLER_HEIGHT;
    const yaw = typeof cooler.yaw === "number" ? cooler.yaw : 0;

    const group = new THREE.Group();
    group.position.set(cooler.x, 0, cooler.z);
    group.rotation.y = yaw;
    group.userData.type = "cooler";
    group.userData.frontLocalAxis = "+Z";
    group.userData.frontFacingYaw = yaw;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xecf0f4,
      roughness: 0.28,
      metalness: 0.08,
    });
    const frontMaterial = createCoolerFrontMaterial(
      chooseVariantSeed(coolerRng),
    );
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4dbe4,
      roughness: 0.34,
      metalness: 0.22,
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      bodyMaterial,
    );
    body.position.y = height * 0.5;
    body.userData.frontLocalAxis = "+Z";
    group.add(body);

    const frontPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.86, height * 0.92),
      frontMaterial,
    );
    frontPanel.position.set(0, height * 0.5, depth * 0.5 + 0.004);
    frontPanel.userData.frontLocalAxis = "+Z";
    group.add(frontPanel);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.04, height * 0.54, 0.02),
      trimMaterial,
    );
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

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9edf2,
      roughness: 0.42,
      metalness: 0.06,
    });
    const lidMaterial = createFreezerLidMaterial(chooseVariantSeed(freezerRng));

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      bodyMaterial,
    );
    body.position.y = height * 0.5;
    group.add(body);

    const lidThickness = 0.05;
    const lidInset = 0.02;
    const lidBase = new THREE.Mesh(
      new THREE.BoxGeometry(
        width - lidInset * 2,
        lidThickness,
        depth - lidInset * 2,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xf7f9fc,
        roughness: 0.22,
        metalness: 0.02,
      }),
    );
    lidBase.position.set(0, height + lidThickness * 0.5 + 0.002, 0);
    group.add(lidBase);

    const lidTop = new THREE.Mesh(
      new THREE.PlaneGeometry(width - lidInset * 2, depth - lidInset * 2),
      lidMaterial,
    );
    lidTop.rotation.x = -Math.PI / 2;
    lidTop.position.set(0, height + lidThickness + 0.003, 0);
    group.add(lidTop);

    roomRoot.add(group);
  }

  function createFluorescentGrid(halfWorldWidth, halfWorldHeight) {
    fluorescentUnits.length = 0;
    const ceilingY = WALL_HEIGHT - 0.2;
    const edgeMarginX = Math.max(2.2, halfWorldWidth * 0.12);
    const edgeMarginZ = Math.max(2.2, halfWorldHeight * 0.12);
    const minX = -halfWorldWidth + edgeMarginX;
    const maxX = halfWorldWidth - edgeMarginX;
    const minZ = -halfWorldHeight + edgeMarginZ;
    const maxZ = halfWorldHeight - edgeMarginZ;
    const xStep =
      FLUORESCENT_COLS > 1 ? (maxX - minX) / (FLUORESCENT_COLS - 1) : 0;
    const zStep =
      FLUORESCENT_ROWS > 1 ? (maxZ - minZ) / (FLUORESCENT_ROWS - 1) : 0;
    const tubeLength = Math.max(
      3.2,
      Math.min(5.4, Math.min(halfWorldWidth, halfWorldHeight) * 0.28),
    );
    for (let row = 0; row < FLUORESCENT_ROWS; row += 1) {
      for (let col = 0; col < FLUORESCENT_COLS; col += 1) {
        const index = row * FLUORESCENT_COLS + col;
        const x = minX + col * xStep;
        const z = minZ + row * zStep;
        const isBlinker = index === FLUORESCENT_BLINK_INDEX;

        const fixture = new THREE.Group();
        fixture.position.set(x, ceilingY, z);
        fixture.userData.type = "fluorescent";

        const housing = new THREE.Mesh(
          new THREE.BoxGeometry(tubeLength, 0.14, 0.34),
          new THREE.MeshStandardMaterial({
            color: 0x9ca7b6,
            roughness: 0.4,
            metalness: 0.24,
          }),
        );
        fixture.add(housing);

        const diffuserMaterial = new THREE.MeshStandardMaterial({
          color: 0xf2f8ff,
          roughness: 0.2,
          metalness: 0.02,
          emissive: 0xdbeeff,
          emissiveIntensity: 1.35,
        });
        const diffuser = new THREE.Mesh(
          new THREE.BoxGeometry(tubeLength * 0.9, 0.06, 0.2),
          diffuserMaterial,
        );
        diffuser.position.y = -0.06;
        fixture.add(diffuser);

        roomRoot.add(fixture);
        fluorescentUnits.push({
          isBlinker,
          diffuserMaterial,
          baseEmissiveIntensity: 1.35,
          blinkCooldownSec: 0.9 + blinkRng() * 1.8,
          blinkRemainingSec: 0,
        });
      }
    }
  }

  function updateFluorescents(deltaSec) {
    if (!fluorescentUnits.length) return;
    fluorescentAccumSec += Math.max(0, Number(deltaSec) || 0);
    if (fluorescentAccumSec < FLUORESCENT_UPDATE_STEP_SEC) return;
    const stepSec = fluorescentAccumSec;
    fluorescentAccumSec = 0;
    for (const unit of fluorescentUnits) {
      if (!unit.isBlinker) continue;
      if (unit.blinkRemainingSec > 0) {
        unit.blinkRemainingSec = Math.max(0, unit.blinkRemainingSec - stepSec);
      } else {
        unit.blinkCooldownSec -= stepSec;
      }

      const shouldBlinkNow =
        unit.blinkRemainingSec > 0 ||
        (unit.blinkCooldownSec <= 0 &&
          (() => {
            unit.blinkRemainingSec = 0.05 + blinkRng() * 0.07;
            unit.blinkCooldownSec = 0.8 + blinkRng() * 1.9;
            return true;
          })());

      if (shouldBlinkNow) {
        const pulse = 0.22 + blinkRng() * 0.18;
        unit.diffuserMaterial.emissiveIntensity =
          unit.baseEmissiveIntensity * pulse;
      } else {
        unit.diffuserMaterial.emissiveIntensity = unit.baseEmissiveIntensity;
      }
    }
  }

  function buildRoomGeometry(
    worldWidthMeters,
    worldHeightMeters,
    shelves,
    coolers,
    freezers,
  ) {
    const halfWorldWidth = worldWidthMeters * 0.5;
    const halfWorldHeight = worldHeightMeters * 0.5;
    const wallThickness = 1;
    const wallSegmentsPerSide = 4;
    const wallCenterOffsetX = halfWorldWidth + wallThickness * 0.5;
    const wallCenterOffsetZ = halfWorldHeight + wallThickness * 0.5;
    const wallSpanX = worldWidthMeters + wallThickness;
    const wallSpanZ = worldHeightMeters + wallThickness;
    const wallSegmentSpanX = wallSpanX / wallSegmentsPerSide;
    const wallSegmentSpanZ = wallSpanZ / wallSegmentsPerSide;
    const planeWidth = wallSpanX + 5;
    const planeHeight = wallSpanZ + 5;
    currentPlaneWidthMeters = planeWidth;
    currentPlaneHeightMeters = planeHeight;

    clearRoomRootGeometry();
    floor.geometry.dispose();
    ceiling.geometry.dispose();

    floor.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    ceiling.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    ceiling.position.y = WALL_HEIGHT;

    roomRoot.add(floor);
    roomRoot.add(ceiling);
    refreshFloorAndCeilingTextures();

    for (let i = 0; i < wallSegmentsPerSide; i += 1) {
      const xOffset = -wallSpanX / 2 + wallSegmentSpanX * (i + 0.5);
      const zOffset = -wallSpanZ / 2 + wallSegmentSpanZ * (i + 0.5);
      createWall(xOffset, -wallCenterOffsetZ, wallSegmentSpanX, wallThickness);
      createWall(xOffset, wallCenterOffsetZ, wallSegmentSpanX, wallThickness);
      createWall(-wallCenterOffsetX, zOffset, wallThickness, wallSegmentSpanZ);
      createWall(wallCenterOffsetX, zOffset, wallThickness, wallSegmentSpanZ);
    }

    for (const shelf of shelves) createShelf(shelf);
    for (const cooler of coolers) createCooler(cooler);
    for (const freezer of freezers) createFreezer(freezer);
    buildStaticInstancedGeometry();
    buildProductInstancedMeshes();
    createFluorescentGrid(halfWorldWidth, halfWorldHeight);
  }

  function normalizeFixtures(fixtures, fallback) {
    if (!Array.isArray(fixtures)) return fallback;
    const valid = fixtures.filter(
      (fixture) =>
        fixture &&
        typeof fixture.x === "number" &&
        Number.isFinite(fixture.x) &&
        typeof fixture.z === "number" &&
        Number.isFinite(fixture.z),
    );
    return valid.length > 0 ? valid : fallback;
  }

  function fixtureSignature(fixtures) {
    return fixtures
      .map((fixture) =>
        [
          fixture.x,
          fixture.z,
          fixture.width,
          fixture.depth,
          fixture.height,
          fixture.yaw,
        ].join(","),
      )
      .join("|");
  }

  function syncFromWorld({
    worldSizeMeters,
    worldWidthMeters,
    worldHeightMeters,
    shelves,
    coolers,
    freezers,
  }) {
    const legacyWorldSize =
      typeof worldSizeMeters === "number" && Number.isFinite(worldSizeMeters)
        ? worldSizeMeters
        : DEFAULT_WORLD_SIZE_METERS;
    const normalizedWorldWidth =
      typeof worldWidthMeters === "number" && Number.isFinite(worldWidthMeters)
        ? worldWidthMeters
        : legacyWorldSize;
    const normalizedWorldHeight =
      typeof worldHeightMeters === "number" &&
      Number.isFinite(worldHeightMeters)
        ? worldHeightMeters
        : legacyWorldSize;
    const normalizedShelves = normalizeFixtures(shelves, DEFAULT_SHELVES);
    const normalizedCoolers = normalizeFixtures(coolers, DEFAULT_COOLERS);
    const normalizedFreezers = normalizeFixtures(freezers, DEFAULT_FREEZERS);
    lastSyncedWorldWidthMeters = normalizedWorldWidth;
    lastSyncedWorldHeightMeters = normalizedWorldHeight;
    lastSyncedShelves = normalizedShelves;
    lastSyncedCoolers = normalizedCoolers;
    lastSyncedFreezers = normalizedFreezers;
    const nextSignature = [
      fixtureSignature(normalizedShelves),
      fixtureSignature(normalizedCoolers),
      fixtureSignature(normalizedFreezers),
    ].join("||");
    const shouldRebuild =
      builtWorldWidthMeters !== normalizedWorldWidth ||
      builtWorldHeightMeters !== normalizedWorldHeight ||
      builtFixturesSignature !== nextSignature;
    if (!shouldRebuild) return;

    buildRoomGeometry(
      normalizedWorldWidth,
      normalizedWorldHeight,
      normalizedShelves,
      normalizedCoolers,
      normalizedFreezers,
    );
    builtWorldWidthMeters = normalizedWorldWidth;
    builtWorldHeightMeters = normalizedWorldHeight;
    builtFixturesSignature = nextSignature;
  }

  syncFromWorld({
    worldSizeMeters: DEFAULT_WORLD_SIZE_METERS,
    worldWidthMeters: DEFAULT_WORLD_WIDTH_METERS,
    worldHeightMeters: DEFAULT_WORLD_HEIGHT_METERS,
    shelves: DEFAULT_SHELVES,
    coolers: DEFAULT_COOLERS,
    freezers: DEFAULT_FREEZERS,
  });

  return { syncFromWorld, update: updateFluorescents };
}

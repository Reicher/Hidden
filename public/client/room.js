import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { seededRandom } from "./utils.js";

const DEFAULT_ROOM_HALF = 24;
const WALL_HEIGHT = 5.2;
const DEFAULT_SHELVES = Object.freeze([
  Object.freeze({ x: -4.2, z: -8, width: 0.8, depth: 5.2, height: 2.9 }),
  Object.freeze({ x: 4.2, z: -8, width: 0.8, depth: 5.2, height: 2.9 }),
  Object.freeze({ x: -4.2, z: 0, width: 0.8, depth: 5.2, height: 2.9 }),
  Object.freeze({ x: 4.2, z: 0, width: 0.8, depth: 5.2, height: 2.9 }),
  Object.freeze({ x: -4.2, z: 8, width: 0.8, depth: 5.2, height: 2.9 }),
  Object.freeze({ x: 4.2, z: 8, width: 0.8, depth: 5.2, height: 2.9 })
]);
const DEFAULT_COOLERS = Object.freeze([
  Object.freeze({ x: -13.8, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: -12.52, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: -11.24, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: 11.24, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: 12.52, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: 13.8, z: -22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: 0 }),
  Object.freeze({ x: -13.8, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI }),
  Object.freeze({ x: -12.52, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI }),
  Object.freeze({ x: -11.24, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI }),
  Object.freeze({ x: 11.24, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI }),
  Object.freeze({ x: 12.52, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI }),
  Object.freeze({ x: 13.8, z: 22.85, width: 1.28, depth: 0.9, height: 3.52, yaw: Math.PI })
]);
const DEFAULT_FREEZERS = Object.freeze([
  Object.freeze({ x: -22.85, z: -14.15, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI / 2 }),
  Object.freeze({ x: -22.85, z: -12.25, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI / 2 }),
  Object.freeze({ x: -22.85, z: 12.25, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI / 2 }),
  Object.freeze({ x: -22.85, z: 14.15, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI / 2 }),
  Object.freeze({ x: 22.85, z: -14.15, width: 1.9, depth: 1.2, height: 1.02, yaw: -Math.PI / 2 }),
  Object.freeze({ x: 22.85, z: -12.25, width: 1.9, depth: 1.2, height: 1.02, yaw: -Math.PI / 2 }),
  Object.freeze({ x: 22.85, z: 12.25, width: 1.9, depth: 1.2, height: 1.02, yaw: -Math.PI / 2 }),
  Object.freeze({ x: 22.85, z: 14.15, width: 1.9, depth: 1.2, height: 1.02, yaw: -Math.PI / 2 }),
  Object.freeze({ x: -4.2, z: -11.35, width: 1.9, depth: 1.2, height: 1.02, yaw: 0 }),
  Object.freeze({ x: -4.2, z: -4.65, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI }),
  Object.freeze({ x: 4.2, z: 4.65, width: 1.9, depth: 1.2, height: 1.02, yaw: 0 }),
  Object.freeze({ x: 4.2, z: 11.35, width: 1.9, depth: 1.2, height: 1.02, yaw: Math.PI })
]);

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

  const wallBaseMaterial = new THREE.MeshStandardMaterial({ color: 0x6f7b8f, roughness: 0.95 });
  const wallMaterials = [];
  const shelfSideMaterials = [];

  function hasImageData(texture) {
    const image = texture?.image;
    if (!image) return false;
    if (typeof image.videoWidth === "number") return image.videoWidth > 0 && image.videoHeight > 0;
    if (typeof image.width === "number") return image.width > 0 && image.height > 0;
    return true;
  }

  const floorTexture = textureLoader.load(
    "/assets/floor_tile.png",
    () => {
      floorTexture.wrapS = THREE.RepeatWrapping;
      floorTexture.wrapT = THREE.RepeatWrapping;
      floorTexture.repeat.set(7, 7);
      floorTexture.colorSpace = THREE.SRGBColorSpace;
      floorTexture.anisotropy = textureAnisotropy;
      floorMaterial.map = floorTexture;
      floorMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      floorMaterial.map = null;
      floorMaterial.color.setHex(0x4a505d);
      floorMaterial.needsUpdate = true;
    }
  );

  const ceilingTexture = textureLoader.load(
    "/assets/ceiling_tile.png",
    () => {
      ceilingTexture.wrapS = THREE.RepeatWrapping;
      ceilingTexture.wrapT = THREE.RepeatWrapping;
      ceilingTexture.repeat.set(7, 7);
      ceilingTexture.colorSpace = THREE.SRGBColorSpace;
      ceilingTexture.anisotropy = textureAnisotropy;
      ceilingMaterial.map = ceilingTexture;
      ceilingMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      ceilingMaterial.map = null;
      ceilingMaterial.color.setHex(0x515661);
      ceilingMaterial.needsUpdate = true;
    }
  );

  const wallTexture = textureLoader.load(
    "/assets/wall_sheet.png",
    () => {
      wallTexture.wrapS = THREE.ClampToEdgeWrapping;
      wallTexture.wrapT = THREE.ClampToEdgeWrapping;
      wallTexture.colorSpace = THREE.SRGBColorSpace;
      wallTexture.anisotropy = textureAnisotropy;
      for (const material of wallMaterials) {
        const tileIndex = Number(material.userData?.tileIndex ?? 0);
        if (!material.map) material.map = createAtlasMap(wallTexture, tileIndex);
        if (material.map) material.map.needsUpdate = true;
        material.needsUpdate = true;
      }
    },
    undefined,
    () => {
      for (const material of wallMaterials) {
        material.map = null;
        material.color.setHex(0x6f7b8f);
        material.needsUpdate = true;
      }
    }
  );

  const shelfTexture = textureLoader.load(
    "/assets/shelf_sheet.png",
    () => {
      shelfTexture.wrapS = THREE.ClampToEdgeWrapping;
      shelfTexture.wrapT = THREE.ClampToEdgeWrapping;
      shelfTexture.colorSpace = THREE.SRGBColorSpace;
      shelfTexture.anisotropy = textureAnisotropy;
      for (const material of shelfSideMaterials) {
        const tileIndex = Number(material.userData?.tileIndex ?? 0);
        if (!material.map) material.map = createAtlasMap(shelfTexture, tileIndex);
        if (material.map) material.map.needsUpdate = true;
        material.needsUpdate = true;
      }
    },
    undefined,
    () => {
      for (const material of shelfSideMaterials) {
        material.map = null;
        material.color.setHex(0x7a6753);
        material.needsUpdate = true;
      }
    }
  );

  const wallRng = seededRandom(20260429);
  const shelfRng = seededRandom(20260430);

  let builtRoomHalf = null;
  let builtFixturesSignature = "";

  function createAtlasMap(texture, tileIndex) {
    const map = texture.clone();
    map.source = texture.source;
    map.image = texture.image;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = textureAnisotropy;

    const atlasSize = 3;
    const col = tileIndex % atlasSize;
    const rowFromTop = Math.floor(tileIndex / atlasSize);
    map.repeat.set(1 / atlasSize, 1 / atlasSize);
    map.offset.set(col / atlasSize, 1 - (rowFromTop + 1) / atlasSize);
    if (hasImageData(map)) map.needsUpdate = true;
    return map;
  }

  function randomWallTileIndex() {
    return Math.floor(wallRng() * 9);
  }

  function randomShelfTileIndex() {
    return Math.floor(shelfRng() * 9);
  }

  function createWallMaterial(tileIndex) {
    const material = wallBaseMaterial.clone();
    material.userData.tileIndex = tileIndex;
    if (hasImageData(wallTexture)) {
      material.color.setHex(0xffffff);
      material.map = createAtlasMap(wallTexture, tileIndex);
    } else {
      material.color.setHex(0x6f7b8f);
      material.map = null;
    }
    wallMaterials.push(material);
    return material;
  }

  function createShelfSideMaterial(tileIndex) {
    const material = new THREE.MeshStandardMaterial({
      color: hasImageData(shelfTexture) ? 0xffffff : 0x7a6753,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
    material.userData.tileIndex = tileIndex;
    material.map = hasImageData(shelfTexture) ? createAtlasMap(shelfTexture, tileIndex) : null;
    shelfSideMaterials.push(material);
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
  }

  function createWall(x, z, sx, sz, tileIndex) {
    const material = createWallMaterial(tileIndex);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), material);
    mesh.position.set(x, WALL_HEIGHT * 0.5, z);
    roomRoot.add(mesh);
  }

  function createShelf(shelf) {
    const width = typeof shelf.width === "number" ? shelf.width : 0.8;
    const depth = typeof shelf.depth === "number" ? shelf.depth : 5.2;
    const height = typeof shelf.height === "number" ? shelf.height : 2.9;
    const plain = new THREE.MeshStandardMaterial({ color: 0x8a7660, roughness: 0.9, metalness: 0.02 });

    const sideA = createShelfSideMaterial(randomShelfTileIndex());
    const sideB = createShelfSideMaterial(randomShelfTileIndex());
    const core = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), plain);
    core.position.set(shelf.x, height * 0.5, shelf.z);
    roomRoot.add(core);

    // Put textured panels explicitly on the long sides to avoid BoxGeometry material-index ambiguity.
    const sideOffsetX = width * 0.5 + 0.004;
    const longSideA = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), sideA);
    longSideA.position.set(shelf.x + sideOffsetX, height * 0.5, shelf.z);
    longSideA.rotation.y = Math.PI / 2;
    roomRoot.add(longSideA);

    const longSideB = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), sideB);
    longSideB.position.set(shelf.x - sideOffsetX, height * 0.5, shelf.z);
    longSideB.rotation.y = -Math.PI / 2;
    roomRoot.add(longSideB);
  }

  function createCooler(cooler) {
    const width = typeof cooler.width === "number" ? cooler.width : 1.28;
    const depth = typeof cooler.depth === "number" ? cooler.depth : 0.9;
    const height = typeof cooler.height === "number" ? cooler.height : 3.52;
    const yaw = typeof cooler.yaw === "number" ? cooler.yaw : 0;

    const group = new THREE.Group();
    group.position.set(cooler.x, 0, cooler.z);
    group.rotation.y = yaw;
    group.userData.type = "cooler";
    group.userData.frontLocalAxis = "+Z";
    group.userData.frontFacingYaw = yaw;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xdce1e7, roughness: 0.28, metalness: 0.08 });
    const frontMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.18, metalness: 0.04 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x9ea7b4, roughness: 0.34, metalness: 0.22 });

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
    const width = typeof freezer.width === "number" ? freezer.width : 1.9;
    const depth = typeof freezer.depth === "number" ? freezer.depth : 1.2;
    const height = typeof freezer.height === "number" ? freezer.height : 1.02;
    const yaw = typeof freezer.yaw === "number" ? freezer.yaw : 0;

    const group = new THREE.Group();
    group.position.set(freezer.x, 0, freezer.z);
    group.rotation.y = yaw;
    group.userData.type = "freezer";
    group.userData.opening = "top";

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xcbd3dd, roughness: 0.42, metalness: 0.06 });
    const lidMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5ebf2,
      roughness: 0.12,
      metalness: 0.02,
      transparent: true,
      opacity: 0.82
    });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x8f99a6, roughness: 0.36, metalness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial);
    body.position.y = height * 0.5;
    group.add(body);

    const splitGap = 0.05;
    const lidA = new THREE.Mesh(new THREE.BoxGeometry(width * 0.46, 0.05, depth * 0.94), lidMaterial);
    lidA.position.set(-width * 0.24 - splitGap, height - 0.026, 0);
    group.add(lidA);
    const lidB = new THREE.Mesh(new THREE.BoxGeometry(width * 0.46, 0.05, depth * 0.94), lidMaterial);
    lidB.position.set(width * 0.24 + splitGap, height - 0.026, 0);
    group.add(lidB);

    const topRail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, 0.04, 0.06), railMaterial);
    topRail.position.set(0, height - 0.022, 0);
    group.add(topRail);

    roomRoot.add(group);
  }

  function buildRoomGeometry(roomHalf, shelves, coolers, freezers) {
    const wallThickness = 1;
    const wallSegmentsPerSide = 4;
    const wallSpan = roomHalf * 2 + wallThickness;
    const wallSegmentSpan = wallSpan / wallSegmentsPerSide;
    const planeSize = wallSpan + 5;

    clearRoomRootGeometry();
    floor.geometry.dispose();
    ceiling.geometry.dispose();

    floor.geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    ceiling.geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    ceiling.position.y = WALL_HEIGHT;

    roomRoot.add(floor);
    roomRoot.add(ceiling);

    for (let i = 0; i < wallSegmentsPerSide; i += 1) {
      const offset = -wallSpan / 2 + wallSegmentSpan * (i + 0.5);
      createWall(offset, -roomHalf, wallSegmentSpan, wallThickness, randomWallTileIndex());
      createWall(offset, roomHalf, wallSegmentSpan, wallThickness, randomWallTileIndex());
      createWall(-roomHalf, offset, wallThickness, wallSegmentSpan, randomWallTileIndex());
      createWall(roomHalf, offset, wallThickness, wallSegmentSpan, randomWallTileIndex());
    }

    for (const shelf of shelves) createShelf(shelf);
    for (const cooler of coolers) createCooler(cooler);
    for (const freezer of freezers) createFreezer(freezer);
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

  function syncFromWorld({ roomHalfSize, shelves, coolers, freezers }) {
    const roomHalf =
      typeof roomHalfSize === "number" && Number.isFinite(roomHalfSize) ? roomHalfSize : DEFAULT_ROOM_HALF;
    const normalizedShelves = normalizeFixtures(shelves, DEFAULT_SHELVES);
    const normalizedCoolers = normalizeFixtures(coolers, DEFAULT_COOLERS);
    const normalizedFreezers = normalizeFixtures(freezers, DEFAULT_FREEZERS);
    const nextSignature = [
      fixtureSignature(normalizedShelves),
      fixtureSignature(normalizedCoolers),
      fixtureSignature(normalizedFreezers)
    ].join("||");
    const shouldRebuild = builtRoomHalf !== roomHalf || builtFixturesSignature !== nextSignature;
    if (!shouldRebuild) return;

    buildRoomGeometry(roomHalf, normalizedShelves, normalizedCoolers, normalizedFreezers);
    builtRoomHalf = roomHalf;
    builtFixturesSignature = nextSignature;
  }

  syncFromWorld({
    roomHalfSize: DEFAULT_ROOM_HALF,
    shelves: DEFAULT_SHELVES,
    coolers: DEFAULT_COOLERS,
    freezers: DEFAULT_FREEZERS
  });

  return { syncFromWorld };
}

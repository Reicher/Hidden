import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { seededRandom } from "./utils.js";

const WALL_HEIGHT = 5.2;
const DEFAULT_ROOM_HALF = 24;
const SHELF_WIDTH = 1.1;
const SHELF_DEPTH = 6.0;
const SHELF_HEIGHT = 2.9;

const COOLER_WIDTH = 1.2;
const COOLER_DEPTH = 0.91;
const COOLER_HEIGHT = 3.0;

const FREEZER_WIDTH = 1.2;
const FREEZER_DEPTH = 0.91;
const FREEZER_HEIGHT = 1.02;
const DEFAULT_SHELVES = Object.freeze([
  Object.freeze({ x: -8, z: -7, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT }),
  Object.freeze({ x: 8, z: -7, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT }),
  Object.freeze({ x: -8, z: 7, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT }),
  Object.freeze({ x: 8, z: 7, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT })
]);
const DEFAULT_COOLERS = Object.freeze([]);
const DEFAULT_FREEZERS = Object.freeze([]);
const FLUORESCENT_ROWS = 4;
const FLUORESCENT_COLS = 4;
const FLUORESCENT_BLINK_INDEX = 5;

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
  const fluorescentUnits = [];

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
  const blinkRng = seededRandom(20260501);

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
    const material = new THREE.MeshBasicMaterial({
      color: hasImageData(shelfTexture) ? 0xffffff : 0x9a856b,
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
    const height = typeof cooler.height === "number" ? cooler.height : 3.0;
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

  function createFluorescentGrid(roomHalf) {
    fluorescentUnits.length = 0;
    const ceilingY = WALL_HEIGHT - 0.2;
    const edgeMargin = Math.max(2.8, roomHalf * 0.15);
    const minCoord = -roomHalf + edgeMargin;
    const maxCoord = roomHalf - edgeMargin;
    const xStep = FLUORESCENT_COLS > 1 ? (maxCoord - minCoord) / (FLUORESCENT_COLS - 1) : 0;
    const zStep = FLUORESCENT_ROWS > 1 ? (maxCoord - minCoord) / (FLUORESCENT_ROWS - 1) : 0;
    const tubeLength = Math.max(3.6, Math.min(5.4, roomHalf * 0.24));

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

        const glow = new THREE.PointLight(0xeef7ff, 1.4, roomHalf * 1.06, 2);
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
    createFluorescentGrid(roomHalf);
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

  return { syncFromWorld, update: updateFluorescents };
}

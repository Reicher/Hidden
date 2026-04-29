import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { seededRandom } from "./utils.js";

const DEFAULT_ROOM_HALF = 12;
const DEFAULT_SHELVES = Object.freeze([
  Object.freeze({ x: -1.9, z: 0, width: 0.8, depth: 5.2, height: 1.52 }),
  Object.freeze({ x: 1.9, z: 0, width: 0.8, depth: 5.2, height: 1.52 })
]);

export function createRoomSystem({ scene, renderer }) {
  const textureLoader = new THREE.TextureLoader();
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

  const wallBaseMaterial = new THREE.MeshStandardMaterial({ color: 0x4e5868, roughness: 0.95 });
  const wallMaterials = [];
  const shelfSideMaterials = [];

  const floorTexture = textureLoader.load(
    "/assets/floor_tile.png",
    () => {
      floorTexture.wrapS = THREE.RepeatWrapping;
      floorTexture.wrapT = THREE.RepeatWrapping;
      floorTexture.repeat.set(7, 7);
      floorTexture.colorSpace = THREE.SRGBColorSpace;
      floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      floorMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      floorMaterial.map = null;
      floorMaterial.color.setHex(0x30353f);
      floorMaterial.needsUpdate = true;
    }
  );
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(7, 7);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorMaterial.map = floorTexture;

  const ceilingTexture = textureLoader.load(
    "/assets/ciel_tile.png",
    () => {
      ceilingTexture.wrapS = THREE.RepeatWrapping;
      ceilingTexture.wrapT = THREE.RepeatWrapping;
      ceilingTexture.repeat.set(7, 7);
      ceilingTexture.colorSpace = THREE.SRGBColorSpace;
      ceilingTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      ceilingMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      ceilingMaterial.map = null;
      ceilingMaterial.color.setHex(0x2e3138);
      ceilingMaterial.needsUpdate = true;
    }
  );
  ceilingTexture.wrapS = THREE.RepeatWrapping;
  ceilingTexture.wrapT = THREE.RepeatWrapping;
  ceilingTexture.repeat.set(7, 7);
  ceilingTexture.colorSpace = THREE.SRGBColorSpace;
  ceilingMaterial.map = ceilingTexture;

  const wallTexture = textureLoader.load(
    "/assets/wall_sheet.png",
    () => {
      wallTexture.wrapS = THREE.ClampToEdgeWrapping;
      wallTexture.wrapT = THREE.ClampToEdgeWrapping;
      wallTexture.colorSpace = THREE.SRGBColorSpace;
      wallTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      for (const material of wallMaterials) material.needsUpdate = true;
    },
    undefined,
    () => {
      for (const material of wallMaterials) {
        material.map = null;
        material.color.setHex(0x4e5868);
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
      shelfTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      for (const material of shelfSideMaterials) material.needsUpdate = true;
    },
    undefined,
    () => {
      for (const material of shelfSideMaterials) {
        material.map = null;
        material.color.setHex(0x5a4a3a);
        material.needsUpdate = true;
      }
    }
  );

  const wallRng = seededRandom(20260429);
  const shelfRng = seededRandom(20260430);

  let builtRoomHalf = null;
  let builtShelvesSignature = "";

  function createAtlasMap(texture, tileIndex) {
    const map = texture.clone();
    map.needsUpdate = true;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const atlasSize = 3;
    const col = tileIndex % atlasSize;
    const rowFromTop = Math.floor(tileIndex / atlasSize);
    map.repeat.set(1 / atlasSize, 1 / atlasSize);
    map.offset.set(col / atlasSize, 1 - (rowFromTop + 1) / atlasSize);
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
    material.color.setHex(0xffffff);
    material.map = createAtlasMap(wallTexture, tileIndex);
    wallMaterials.push(material);
    return material;
  }

  function createShelfSideMaterial(tileIndex) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02
    });
    material.map = createAtlasMap(shelfTexture, tileIndex);
    shelfSideMaterials.push(material);
    return material;
  }

  function clearRoomRootGeometry() {
    for (const child of [...roomRoot.children]) roomRoot.remove(child);
  }

  function createWall(x, z, sx, sz, tileIndex) {
    const material = createWallMaterial(tileIndex);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 2.5, sz), material);
    mesh.position.set(x, 1.25, z);
    roomRoot.add(mesh);
  }

  function createShelf(shelf) {
    const width = typeof shelf.width === "number" ? shelf.width : 0.8;
    const depth = typeof shelf.depth === "number" ? shelf.depth : 5.2;
    const height = typeof shelf.height === "number" ? shelf.height : 1.52;
    const plain = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9, metalness: 0.02 });

    const sideA = createShelfSideMaterial(randomShelfTileIndex());
    const sideB = createShelfSideMaterial(randomShelfTileIndex());
    const materials = [
      plain,
      plain,
      plain,
      plain,
      sideA,
      sideB
    ];

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials);
    mesh.position.set(shelf.x, height * 0.5, shelf.z);
    roomRoot.add(mesh);
  }

  function buildRoomGeometry(roomHalf, shelves) {
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
    ceiling.position.y = 2.5;

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
  }

  function normalizeShelves(shelves) {
    if (!Array.isArray(shelves)) return DEFAULT_SHELVES;
    const valid = shelves.filter(
      (s) =>
        s &&
        typeof s.x === "number" &&
        Number.isFinite(s.x) &&
        typeof s.z === "number" &&
        Number.isFinite(s.z)
    );
    return valid.length > 0 ? valid : DEFAULT_SHELVES;
  }

  function shelvesSignature(shelves) {
    return shelves
      .map((s) => [s.x, s.z, s.width, s.depth, s.height].join(","))
      .join("|");
  }

  function syncFromWorld({ roomHalfSize, shelves }) {
    const roomHalf =
      typeof roomHalfSize === "number" && Number.isFinite(roomHalfSize) ? roomHalfSize : DEFAULT_ROOM_HALF;
    const normalizedShelves = normalizeShelves(shelves);
    const nextSignature = shelvesSignature(normalizedShelves);
    const shouldRebuild = builtRoomHalf !== roomHalf || builtShelvesSignature !== nextSignature;
    if (!shouldRebuild) return;

    buildRoomGeometry(roomHalf, normalizedShelves);
    builtRoomHalf = roomHalf;
    builtShelvesSignature = nextSignature;
  }

  syncFromWorld({ roomHalfSize: DEFAULT_ROOM_HALF, shelves: DEFAULT_SHELVES });

  return { syncFromWorld };
}

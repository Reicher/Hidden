import * as THREE from "/vendor/three.module.js";

export function createSceneSystem(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x1f2530);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1f2530, 14, 52);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xc7defe, 0x465844, 1.35);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(7, 14, 6);
  scene.add(dir);

  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);

  function resolveCanvasSize() {
    const width = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight || 1));
    return { width, height };
  }

  function resize() {
    const { width, height } = resolveCanvasSize();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resize();

  return { THREE, renderer, scene, camera, resize };
}

import * as THREE from "/vendor/three.module.js";

export function createSceneSystem(canvas) {
  const isLikelyTouchDevice = (() => {
    const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const hoverNone = window.matchMedia && window.matchMedia("(hover: none)").matches;
    const touchApi = "ontouchstart" in window;
    const touchPoints = (navigator.maxTouchPoints || 0) > 0;
    const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    return coarsePointer || hoverNone || touchApi || touchPoints || mobileUa;
  })();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isLikelyTouchDevice,
    powerPreference: "high-performance"
  });
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
  let renderScale = 1;
  let lastAppliedPixelRatio = -1;

  function resolveCanvasSize() {
    const width = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight || 1));
    return { width, height };
  }

  function resize() {
    const { width, height } = resolveCanvasSize();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cappedDpr = isLikelyTouchDevice ? Math.min(dpr, 1.25) : Math.min(dpr, 1.5);
    const targetPixelRatio = Math.max(0.6, cappedDpr * renderScale);
    if (Math.abs(targetPixelRatio - lastAppliedPixelRatio) > 0.01) {
      renderer.setPixelRatio(targetPixelRatio);
      lastAppliedPixelRatio = targetPixelRatio;
    }
    renderer.setSize(width, height, false);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setRenderScale(nextScale) {
    const normalized = Math.max(0.6, Math.min(1, Number(nextScale) || 1));
    if (Math.abs(normalized - renderScale) < 0.01) return false;
    renderScale = normalized;
    resize();
    return true;
  }

  function getRenderScale() {
    return renderScale;
  }

  resize();

  return { THREE, renderer, scene, camera, resize, setRenderScale, getRenderScale };
}

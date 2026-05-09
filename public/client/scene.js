import * as THREE from "/vendor/three.module.js";

export function createSceneSystem(canvas) {
  const isLikelyTouchDevice = (() => {
    const coarsePointer =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const hoverNone =
      window.matchMedia && window.matchMedia("(hover: none)").matches;
    const touchApi = "ontouchstart" in window;
    const touchPoints = (navigator.maxTouchPoints || 0) > 0;
    const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(
      navigator.userAgent || "",
    );
    return coarsePointer || hoverNone || touchApi || touchPoints || mobileUa;
  })();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isLikelyTouchDevice,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x1f2530);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1f2530, 14, 52);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.02,
    100,
  );
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

  function resolveCanvasSize(preferWindow = false) {
    if (preferWindow) {
      return {
        width: Math.max(1, Math.floor(window.innerWidth || 1)),
        height: Math.max(1, Math.floor(window.innerHeight || 1)),
      };
    }
    const width = Math.max(
      1,
      Math.floor(canvas.clientWidth || window.innerWidth || 1),
    );
    const height = Math.max(
      1,
      Math.floor(canvas.clientHeight || window.innerHeight || 1),
    );
    return { width, height };
  }

  function resize(opts = {}) {
    const { width, height } = resolveCanvasSize(opts.preferWindow);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cappedDpr = isLikelyTouchDevice
      ? Math.min(dpr, 1.25)
      : Math.min(dpr, 1.5);
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

  // Initial sizing: use window dimensions to avoid forcing a layout reflow
  // during module evaluation (before stylesheets are guaranteed to be applied).
  // A proper CSS-based resize is scheduled for the next animation frame.
  resize({ preferWindow: true });
  requestAnimationFrame(() => resize());

  let _smoothFrameMs = 16.7;
  let _lastQualityAdjustAt = 0;

  /**
   * Dynamically adjust render scale on touch devices based on frame time.
   * Call once per frame with the current timestamp and frame duration.
   *
   * @param {number} nowMs
   * @param {number} frameMs
   * @param {{
   *   isTouchDevice: boolean,
   *   isPlaying: boolean,
   *   degradeThreshold: number,
   *   upgradeThreshold: number,
   *   scaleMin: number,
   *   scaleMax: number,
   *   stepDown: number,
   *   stepUp: number,
   *   cooldownMs: number,
   * }} opts
   */
  function adaptRenderScale(nowMs, frameMs, opts) {
    if (!opts.isTouchDevice || !opts.isPlaying) return;
    _smoothFrameMs += (frameMs - _smoothFrameMs) * 0.06;
    if (nowMs - _lastQualityAdjustAt < opts.cooldownMs) return;

    const currentScale = getRenderScale();
    if (
      _smoothFrameMs >= opts.degradeThreshold &&
      currentScale > opts.scaleMin
    ) {
      const next = Math.max(opts.scaleMin, currentScale - opts.stepDown);
      if (setRenderScale(next)) _lastQualityAdjustAt = nowMs;
      return;
    }
    if (
      _smoothFrameMs <= opts.upgradeThreshold &&
      currentScale < opts.scaleMax
    ) {
      const next = Math.min(opts.scaleMax, currentScale + opts.stepUp);
      if (setRenderScale(next)) _lastQualityAdjustAt = nowMs;
    }
  }

  return {
    THREE,
    renderer,
    scene,
    camera,
    resize,
    setRenderScale,
    getRenderScale,
    adaptRenderScale,
  };
}

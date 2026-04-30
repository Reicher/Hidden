import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

export function createSceneSystem(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x11131c);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x11131c, 10, 40);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x304020, 1.0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(7, 14, 6);
  scene.add(dir);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  return { THREE, renderer, scene, camera, resize };
}

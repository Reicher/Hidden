export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function normalizeAngle(angle) {
  return ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PLAYER_NAME_PALETTE = Object.freeze([
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
  "#5aa9e6",
  "#f7a072",
  "#9bde7e",
  "#c792ea",
  "#ffd166",
  "#06d6a0",
  "#7bdff2",
  "#ff9f1c",
  "#8ecae6",
  "#b8f2e6",
  "#ff8fab",
  "#adb5ff",
  "#95d5b2",
  "#ffadad",
  "#90dbf4",
  "#d0f4de",
  "#f4acb7",
  "#a0c4ff",
  "#caffbf",
  "#fdffb6",
  "#ffc6ff"
]);

export function colorForName(name) {
  const h = hashString(String(name || "").toLowerCase());
  return PLAYER_NAME_PALETTE[h % PLAYER_NAME_PALETTE.length];
}

export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

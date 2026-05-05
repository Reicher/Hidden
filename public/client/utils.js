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

export function colorForName(name) {
  const h = hashString(String(name || "").toLowerCase());
  const hue = h % 360;
  const sat = 60 + ((h >>> 9) % 20);
  const light = 62 + ((h >>> 16) % 10);
  return `hsl(${hue} ${sat}% ${light}%)`;
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

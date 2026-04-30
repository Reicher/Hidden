function envInt(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function envCsv(name, fallbackValues) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallbackValues;
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const DEFAULT_PORT = envInt("PORT", 3000);
const DEFAULT_ALLOWED_ORIGINS = [
  `http://127.0.0.1:${DEFAULT_PORT}`,
  `http://localhost:${DEFAULT_PORT}`,
  `https://127.0.0.1:${DEFAULT_PORT}`,
  `https://localhost:${DEFAULT_PORT}`
];

export const ROOM_HALF_SIZE = 24;
export const MAX_PLAYERS = 10;
export const TOTAL_CHARACTERS = 20;
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const MOVE_SPEED = 2.9;
export const PLAYER_SPRINT_MULTIPLIER = 1.45;
export const TURN_SPEED = 2.3;
export const AI_DECISION_MS_MIN = 600;
export const AI_DECISION_MS_MAX = 1800;
export const ATTACK_COOLDOWN_MS = 1000;
export const ATTACK_RANGE = 2.8;
export const ATTACK_HALF_ANGLE = Math.PI / 4;
export const ATTACK_FLASH_MS = 140;
export const CHARACTER_RADIUS = 0.34;

export const SHELF_WIDTH = 0.8;
export const SHELF_DEPTH = 5.2;
export const SHELF_HEIGHT = 1.78;
export const SHELVES = Object.freeze([
  Object.freeze({ x: -2.8, z: 0, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT }),
  Object.freeze({ x: 2.8, z: 0, width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT })
]);

export const HEARTBEAT_INTERVAL_MS = envInt("HEARTBEAT_INTERVAL_MS", 5000);
export const IDLE_SESSION_TIMEOUT_MS = envInt("IDLE_SESSION_TIMEOUT_MS", 30 * 60 * 1000);
export const MAX_MESSAGE_BYTES = envInt("MAX_MESSAGE_BYTES", 2048);
export const INPUT_UPDATE_MIN_MS = envInt("INPUT_UPDATE_MIN_MS", 20);
export const ATTACK_MESSAGE_MIN_MS = envInt("ATTACK_MESSAGE_MIN_MS", 60);
export const MESSAGE_WINDOW_MS = envInt("MESSAGE_WINDOW_MS", 1000);
export const MAX_MESSAGES_PER_WINDOW = envInt("MAX_MESSAGES_PER_WINDOW", 120);
export const SPAM_DROP_WINDOW_MS = envInt("SPAM_DROP_WINDOW_MS", 1000);
export const SPAM_MAX_DROPS_PER_WINDOW = envInt("SPAM_MAX_DROPS_PER_WINDOW", 40);
export const ALLOWED_ORIGINS = new Set(envCsv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS));
export const ALLOW_MISSING_ORIGIN = envBool("ALLOW_MISSING_ORIGIN", false);

export const INVARIANT_LOG_COOLDOWN_MS = envInt("INVARIANT_LOG_COOLDOWN_MS", 5000);

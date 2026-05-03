import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadLayoutFromPng } from "./layoutFromPng.js";

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

function envString(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return String(raw).trim();
}

const DEFAULT_PORT = envInt("PORT", 3000);
const DEFAULT_ALLOWED_ORIGINS = [
  `http://127.0.0.1:${DEFAULT_PORT}`,
  `http://localhost:${DEFAULT_PORT}`,
  `https://127.0.0.1:${DEFAULT_PORT}`,
  `https://localhost:${DEFAULT_PORT}`
];

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
export const KNOCKDOWN_DURATION_MS = 5000;
export const CHARACTER_RADIUS = 0.41;

function freezeFixture(fixture) {
  return Object.freeze(fixture);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = loadLayoutFromPng({
  filePath: resolve(HERE, "../public/assets/layout-50.png"),
  shelfWidth: 1.0,
  shelfDepth: 6.0,
  shelfHeight: 2.0,
  coolerWidth: 1.0,
  coolerDepth: 1.0,
  coolerHeight: 2.0,
  freezerWidth: 1.0,
  freezerDepth: 1.0,
  freezerHeight: 1.0
});

export const ROOM_HALF_SIZE = LAYOUT.roomHalfSize;
export const SHELF_WIDTH = 1.0;
export const SHELF_DEPTH = 6.0;
export const SHELF_HEIGHT = 2.0;
export const SHELVES = Object.freeze(
  LAYOUT.shelves.map((fixture) =>
    freezeFixture({
      x: fixture.x,
      z: fixture.z,
      width: SHELF_WIDTH,
      depth: SHELF_DEPTH,
      height: SHELF_HEIGHT,
      yaw: fixture.yaw
    })
  )
);

export const COOLER_WIDTH = 1.0;
export const COOLER_DEPTH = 1.0;
export const COOLER_HEIGHT = 2.0;
export const COOLERS = Object.freeze(
  LAYOUT.coolers.map((fixture) =>
    freezeFixture({
      x: fixture.x,
      z: fixture.z,
      width: COOLER_WIDTH,
      depth: COOLER_DEPTH,
      height: COOLER_HEIGHT,
      yaw: fixture.yaw
    })
  )
);

export const FREEZER_WIDTH = 1.0;
export const FREEZER_DEPTH = 1.0;
export const FREEZER_HEIGHT = 1.0;
export const FREEZERS = Object.freeze(
  LAYOUT.freezers.map((fixture) =>
    freezeFixture({
      x: fixture.x,
      z: fixture.z,
      width: FREEZER_WIDTH,
      depth: FREEZER_DEPTH,
      height: FREEZER_HEIGHT,
      yaw: fixture.yaw
    })
  )
);

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
export const DEBUG_VIEW_TOKEN = envString("DEBUG_VIEW_TOKEN", "");

export const INVARIANT_LOG_COOLDOWN_MS = envInt("INVARIANT_LOG_COOLDOWN_MS", 5000);

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

function envPositiveInt(name, fallback) {
  const parsed = envInt(name, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
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

const DEFAULT_TOTAL_CHARACTERS = 20;
const DEFAULT_MAX_PLAYERS = 10;
const DEFAULT_MIN_PLAYERS_TO_START = 2;
const DEFAULT_NPC_DOWNED_RESPAWN_SECONDS = 8;

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} måste vara ett heltal >= 1.`);
  }
  return parsed;
}

function normalizeGameplaySettings({ totalCharacters, maxPlayers, minPlayersToStart, npcDownedRespawnSeconds }) {
  const normalizedTotal = parsePositiveInt(totalCharacters, "totalCharacters");
  const normalizedMax = parsePositiveInt(maxPlayers, "maxPlayers");
  const normalizedMin = parsePositiveInt(minPlayersToStart, "minPlayersToStart");
  const normalizedNpcRespawnSeconds = parsePositiveInt(npcDownedRespawnSeconds, "npcDownedRespawnSeconds");

  if (normalizedMax >= normalizedTotal) {
    throw new Error("maxPlayers måste vara mindre än totalCharacters.");
  }
  if (normalizedMin < 2) {
    throw new Error("minPlayersToStart måste vara minst 2.");
  }
  if (normalizedMin > normalizedMax) {
    throw new Error("minPlayersToStart kan inte vara större än maxPlayers.");
  }

  return Object.freeze({
    totalCharacters: normalizedTotal,
    maxPlayers: normalizedMax,
    minPlayersToStart: normalizedMin,
    npcDownedRespawnSeconds: normalizedNpcRespawnSeconds
  });
}

let gameplaySettings = (() => {
  try {
    return normalizeGameplaySettings({
      totalCharacters: envInt("TOTAL_CHARACTERS", DEFAULT_TOTAL_CHARACTERS),
      maxPlayers: envInt("MAX_PLAYERS", DEFAULT_MAX_PLAYERS),
      minPlayersToStart: envInt("MIN_PLAYERS_TO_START", DEFAULT_MIN_PLAYERS_TO_START),
      npcDownedRespawnSeconds: envInt("NPC_DOWNED_RESPAWN_SECONDS", DEFAULT_NPC_DOWNED_RESPAWN_SECONDS)
    });
  } catch {
    return normalizeGameplaySettings({
      totalCharacters: DEFAULT_TOTAL_CHARACTERS,
      maxPlayers: DEFAULT_MAX_PLAYERS,
      minPlayersToStart: DEFAULT_MIN_PLAYERS_TO_START,
      npcDownedRespawnSeconds: DEFAULT_NPC_DOWNED_RESPAWN_SECONDS
    });
  }
})();

export let TOTAL_CHARACTERS = gameplaySettings.totalCharacters;
export let MAX_PLAYERS = gameplaySettings.maxPlayers;
export let MIN_PLAYERS_TO_START = gameplaySettings.minPlayersToStart;
export let NPC_DOWNED_RESPAWN_MS = gameplaySettings.npcDownedRespawnSeconds * 1000;

function applyGameplaySettings(nextSettings) {
  gameplaySettings = nextSettings;
  TOTAL_CHARACTERS = nextSettings.totalCharacters;
  MAX_PLAYERS = nextSettings.maxPlayers;
  MIN_PLAYERS_TO_START = nextSettings.minPlayersToStart;
  NPC_DOWNED_RESPAWN_MS = nextSettings.npcDownedRespawnSeconds * 1000;
}

export function setGameplaySettings({ totalCharacters, maxPlayers, minPlayersToStart, npcDownedRespawnSeconds }) {
  const nextSettings = normalizeGameplaySettings({
    totalCharacters,
    maxPlayers,
    minPlayersToStart,
    npcDownedRespawnSeconds
  });
  const changed =
    nextSettings.totalCharacters !== TOTAL_CHARACTERS ||
    nextSettings.maxPlayers !== MAX_PLAYERS ||
    nextSettings.minPlayersToStart !== MIN_PLAYERS_TO_START ||
    nextSettings.npcDownedRespawnSeconds * 1000 !== NPC_DOWNED_RESPAWN_MS;
  if (!changed) return false;
  applyGameplaySettings(nextSettings);
  return true;
}

export function getGameplaySettings() {
  return Object.freeze({
    totalCharacters: TOTAL_CHARACTERS,
    maxPlayers: MAX_PLAYERS,
    minPlayersToStart: MIN_PLAYERS_TO_START,
    npcDownedRespawnSeconds: Math.round(NPC_DOWNED_RESPAWN_MS / 1000)
  });
}

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
export const SHELF_WIDTH = 1.0;
export const SHELF_DEPTH = 6.0;
export const SHELF_HEIGHT = 2.0;

export const COOLER_WIDTH = 1.0;
export const COOLER_DEPTH = 1.0;
export const COOLER_HEIGHT = 2.0;

export const FREEZER_WIDTH = 1.0;
export const FREEZER_DEPTH = 1.0;
export const FREEZER_HEIGHT = 1.0;

const LAYOUT_PRESETS = Object.freeze([
  {
    id: "layout-30",
    fileName: "layout-30.png",
    label: "30x30 meter"
  },
  {
    id: "layout-50",
    fileName: "layout-50.png",
    label: "50x50 meter"
  }
]);

const LAYOUT_PRESET_BY_ID = new Map(LAYOUT_PRESETS.map((preset) => [preset.id, preset]));
const loadedLayouts = new Map();
const requestedLayoutId = envString("WORLD_LAYOUT_ID", "layout-50").toLowerCase();

function cloneFixtureSet(fixtures, { width, depth, height }) {
  return Object.freeze(
    fixtures.map((fixture) =>
      freezeFixture({
        x: fixture.x,
        z: fixture.z,
        width,
        depth,
        height,
        yaw: fixture.yaw
      })
    )
  );
}

function readLayoutById(layoutId) {
  if (loadedLayouts.has(layoutId)) return loadedLayouts.get(layoutId);
  const preset = LAYOUT_PRESET_BY_ID.get(layoutId);
  if (!preset) {
    const known = LAYOUT_PRESETS.map((entry) => entry.id).join(", ");
    throw new Error(`[layout] Unknown layout id "${layoutId}". Available: ${known}`);
  }
  const loaded = loadLayoutFromPng({
    filePath: resolve(HERE, "./layouts", preset.fileName),
    shelfWidth: SHELF_WIDTH,
    shelfDepth: SHELF_DEPTH,
    shelfHeight: SHELF_HEIGHT,
    coolerWidth: COOLER_WIDTH,
    coolerDepth: COOLER_DEPTH,
    coolerHeight: COOLER_HEIGHT,
    freezerWidth: FREEZER_WIDTH,
    freezerDepth: FREEZER_DEPTH,
    freezerHeight: FREEZER_HEIGHT
  });
  const layout = Object.freeze({
    id: preset.id,
    fileName: preset.fileName,
    label: preset.label,
    worldSizeMeters: loaded.worldSizeMeters,
    shelves: cloneFixtureSet(loaded.shelves, { width: SHELF_WIDTH, depth: SHELF_DEPTH, height: SHELF_HEIGHT }),
    coolers: cloneFixtureSet(loaded.coolers, { width: COOLER_WIDTH, depth: COOLER_DEPTH, height: COOLER_HEIGHT }),
    freezers: cloneFixtureSet(loaded.freezers, { width: FREEZER_WIDTH, depth: FREEZER_DEPTH, height: FREEZER_HEIGHT })
  });
  loadedLayouts.set(layoutId, layout);
  return layout;
}

let activeLayout = (() => {
  return readLayoutById(requestedLayoutId);
})();

export let ACTIVE_LAYOUT_ID = activeLayout.id;
export let WORLD_SIZE_METERS = activeLayout.worldSizeMeters;
export let SHELVES = activeLayout.shelves;
export let COOLERS = activeLayout.coolers;
export let FREEZERS = activeLayout.freezers;

function applyActiveLayout(layout) {
  activeLayout = layout;
  ACTIVE_LAYOUT_ID = layout.id;
  WORLD_SIZE_METERS = layout.worldSizeMeters;
  SHELVES = layout.shelves;
  COOLERS = layout.coolers;
  FREEZERS = layout.freezers;
}

export function setActiveLayout(layoutId) {
  const normalized = String(layoutId || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === ACTIVE_LAYOUT_ID) return false;
  const nextLayout = readLayoutById(normalized);
  applyActiveLayout(nextLayout);
  return true;
}

export function getActiveLayoutInfo() {
  return Object.freeze({
    id: activeLayout.id,
    fileName: activeLayout.fileName,
    label: activeLayout.label,
    worldSizeMeters: activeLayout.worldSizeMeters
  });
}

export function getAvailableLayouts() {
  return Object.freeze(
    LAYOUT_PRESETS.map((preset) => {
      const loaded = readLayoutById(preset.id);
      return Object.freeze({
        id: preset.id,
        fileName: preset.fileName,
        label: preset.label,
        worldSizeMeters: loaded.worldSizeMeters
      });
    })
  );
}

export const HEARTBEAT_INTERVAL_MS = envPositiveInt("HEARTBEAT_INTERVAL_MS", 5000);
export const IDLE_SESSION_TIMEOUT_MS = envPositiveInt("IDLE_SESSION_TIMEOUT_MS", 30 * 60 * 1000);
export const MAX_MESSAGE_BYTES = envPositiveInt("MAX_MESSAGE_BYTES", 2048);
export const INPUT_UPDATE_MIN_MS = envInt("INPUT_UPDATE_MIN_MS", 20);
export const ATTACK_MESSAGE_MIN_MS = envInt("ATTACK_MESSAGE_MIN_MS", 60);
export const MESSAGE_WINDOW_MS = envPositiveInt("MESSAGE_WINDOW_MS", 1000);
export const MAX_MESSAGES_PER_WINDOW = envPositiveInt("MAX_MESSAGES_PER_WINDOW", 120);
export const SPAM_DROP_WINDOW_MS = envPositiveInt("SPAM_DROP_WINDOW_MS", 1000);
export const SPAM_MAX_DROPS_PER_WINDOW = envPositiveInt("SPAM_MAX_DROPS_PER_WINDOW", 40);
export const ALLOWED_ORIGINS = new Set(envCsv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS));
export const ALLOW_MISSING_ORIGIN = envBool("ALLOW_MISSING_ORIGIN", false);
export const DEBUG_VIEW_TOKEN = envString("DEBUG_VIEW_TOKEN", "");

export const INVARIANT_LOG_COOLDOWN_MS = envPositiveInt("INVARIANT_LOG_COOLDOWN_MS", 5000);

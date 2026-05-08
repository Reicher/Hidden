import { readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayoutFromPng } from "./layoutFromPng.js";

function envInt(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function envNumber(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
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
const DEFAULT_PLAYER_ATTACK_COOLDOWN_SECONDS = 2;
const DEFAULT_MOVE_SPEED_METERS_PER_SECOND = 2.9;
const DEFAULT_PLAYER_SPRINT_MULTIPLIER = 1.45;
const DEFAULT_NPC_INSPECT_DOWNED_CHANCE_PERCENT = 75;
const DEFAULT_NPC_INSPECT_DOWNED_RADIUS_METERS = 8.5;
const DEFAULT_NPC_SOCIAL_SEPARATION_PERCENT = 45;
const DEFAULT_NPC_STOP_CHANCE_PERCENT = 25;
const DEFAULT_NPC_MOVE_DECISION_INTERVAL_MIN_MS = 600;
const DEFAULT_NPC_MOVE_DECISION_INTERVAL_MAX_MS = 1800;
const DEFAULT_NPC_STOP_DURATION_MIN_MS = 600;
const DEFAULT_NPC_STOP_DURATION_MAX_MS = 1800;

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} måste vara ett heltal >= 1.`);
  }
  return parsed;
}

function parseBoundedNumber(value, fieldName, { min, max, integer = false }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} måste vara ett giltigt tal.`);
  }
  if (integer && !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} måste vara ett heltal.`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} måste vara mellan ${min} och ${max}.`);
  }
  return parsed;
}

function normalizeGameplaySettings({
  totalCharacters,
  maxPlayers,
  minPlayersToStart,
  npcDownedRespawnSeconds,
  playerAttackCooldownSeconds,
  moveSpeedMetersPerSecond,
  playerSprintMultiplier
}) {
  const normalizedTotal = parsePositiveInt(totalCharacters, "totalCharacters");
  const normalizedMax = parsePositiveInt(maxPlayers, "maxPlayers");
  const normalizedMin = parsePositiveInt(minPlayersToStart, "minPlayersToStart");
  const normalizedNpcRespawnSeconds = parsePositiveInt(npcDownedRespawnSeconds, "npcDownedRespawnSeconds");
  const normalizedPlayerAttackCooldownSeconds = parsePositiveInt(
    playerAttackCooldownSeconds,
    "playerAttackCooldownSeconds"
  );
  const normalizedMoveSpeedMetersPerSecond = parseBoundedNumber(
    moveSpeedMetersPerSecond,
    "moveSpeedMetersPerSecond",
    { min: 0.5, max: 8 }
  );
  const normalizedPlayerSprintMultiplier = parseBoundedNumber(
    playerSprintMultiplier,
    "playerSprintMultiplier",
    { min: 1, max: 3 }
  );

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
    npcDownedRespawnSeconds: normalizedNpcRespawnSeconds,
    playerAttackCooldownSeconds: normalizedPlayerAttackCooldownSeconds,
    moveSpeedMetersPerSecond: Number(normalizedMoveSpeedMetersPerSecond.toFixed(2)),
    playerSprintMultiplier: Number(normalizedPlayerSprintMultiplier.toFixed(2))
  });
}

function normalizeAiBehaviorSettings({
  npcInspectDownedChancePercent,
  npcInspectDownedNearbyRadiusMeters,
  npcSocialSeparationPercent,
  npcStopChancePercent,
  npcMoveDecisionIntervalMinMs,
  npcMoveDecisionIntervalMaxMs,
  npcStopDurationMinMs,
  npcStopDurationMaxMs
}) {
  const normalizedInspectChance = parseBoundedNumber(
    npcInspectDownedChancePercent,
    "npcInspectDownedChancePercent",
    { min: 0, max: 100, integer: true }
  );
  const normalizedInspectRadius = parseBoundedNumber(
    npcInspectDownedNearbyRadiusMeters,
    "npcInspectDownedNearbyRadiusMeters",
    { min: 2, max: 20 }
  );
  const normalizedSocialSeparation = parseBoundedNumber(
    npcSocialSeparationPercent,
    "npcSocialSeparationPercent",
    { min: 0, max: 100, integer: true }
  );
  const normalizedStopChance = parseBoundedNumber(
    npcStopChancePercent,
    "npcStopChancePercent",
    { min: 0, max: 100, integer: true }
  );
  const normalizedMoveDecisionIntervalMinMs = parseBoundedNumber(
    npcMoveDecisionIntervalMinMs,
    "npcMoveDecisionIntervalMinMs",
    { min: 200, max: 4000, integer: true }
  );
  const normalizedMoveDecisionIntervalMaxMs = parseBoundedNumber(
    npcMoveDecisionIntervalMaxMs,
    "npcMoveDecisionIntervalMaxMs",
    { min: 250, max: 6000, integer: true }
  );
  const normalizedStopDurationMinMs = parseBoundedNumber(
    npcStopDurationMinMs,
    "npcStopDurationMinMs",
    { min: 200, max: 5000, integer: true }
  );
  const normalizedStopDurationMaxMs = parseBoundedNumber(
    npcStopDurationMaxMs,
    "npcStopDurationMaxMs",
    { min: 250, max: 7000, integer: true }
  );
  if (normalizedMoveDecisionIntervalMinMs > normalizedMoveDecisionIntervalMaxMs) {
    throw new Error("npcMoveDecisionIntervalMinMs kan inte vara större än npcMoveDecisionIntervalMaxMs.");
  }
  if (normalizedStopDurationMinMs > normalizedStopDurationMaxMs) {
    throw new Error("npcStopDurationMinMs kan inte vara större än npcStopDurationMaxMs.");
  }

  return Object.freeze({
    npcInspectDownedChancePercent: normalizedInspectChance,
    npcInspectDownedNearbyRadiusMeters: Number(normalizedInspectRadius.toFixed(1)),
    npcSocialSeparationPercent: normalizedSocialSeparation,
    npcStopChancePercent: normalizedStopChance,
    npcMoveDecisionIntervalMinMs: normalizedMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs: normalizedMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs: normalizedStopDurationMinMs,
    npcStopDurationMaxMs: normalizedStopDurationMaxMs
  });
}

let gameplaySettings = (() => {
  try {
    return normalizeGameplaySettings({
      totalCharacters: envInt("TOTAL_CHARACTERS", DEFAULT_TOTAL_CHARACTERS),
      maxPlayers: envInt("MAX_PLAYERS", DEFAULT_MAX_PLAYERS),
      minPlayersToStart: envInt("MIN_PLAYERS_TO_START", DEFAULT_MIN_PLAYERS_TO_START),
      npcDownedRespawnSeconds: envInt("NPC_DOWNED_RESPAWN_SECONDS", DEFAULT_NPC_DOWNED_RESPAWN_SECONDS),
      playerAttackCooldownSeconds: envInt(
        "PLAYER_ATTACK_COOLDOWN_SECONDS",
        DEFAULT_PLAYER_ATTACK_COOLDOWN_SECONDS
      ),
      moveSpeedMetersPerSecond: envNumber("MOVE_SPEED_METERS_PER_SECOND", DEFAULT_MOVE_SPEED_METERS_PER_SECOND),
      playerSprintMultiplier: envNumber("PLAYER_SPRINT_MULTIPLIER", DEFAULT_PLAYER_SPRINT_MULTIPLIER)
    });
  } catch {
    return normalizeGameplaySettings({
      totalCharacters: DEFAULT_TOTAL_CHARACTERS,
      maxPlayers: DEFAULT_MAX_PLAYERS,
      minPlayersToStart: DEFAULT_MIN_PLAYERS_TO_START,
      npcDownedRespawnSeconds: DEFAULT_NPC_DOWNED_RESPAWN_SECONDS,
      playerAttackCooldownSeconds: DEFAULT_PLAYER_ATTACK_COOLDOWN_SECONDS,
      moveSpeedMetersPerSecond: DEFAULT_MOVE_SPEED_METERS_PER_SECOND,
      playerSprintMultiplier: DEFAULT_PLAYER_SPRINT_MULTIPLIER
    });
  }
})();

let aiBehaviorSettings = (() => {
  try {
    return normalizeAiBehaviorSettings({
      npcInspectDownedChancePercent: envInt(
        "NPC_INSPECT_DOWNED_CHANCE_PERCENT",
        DEFAULT_NPC_INSPECT_DOWNED_CHANCE_PERCENT
      ),
      npcInspectDownedNearbyRadiusMeters: envNumber(
        "NPC_INSPECT_DOWNED_RADIUS_METERS",
        DEFAULT_NPC_INSPECT_DOWNED_RADIUS_METERS
      ),
      npcSocialSeparationPercent: envInt(
        "NPC_SOCIAL_SEPARATION_PERCENT",
        DEFAULT_NPC_SOCIAL_SEPARATION_PERCENT
      ),
      npcStopChancePercent: envInt("NPC_STOP_CHANCE_PERCENT", DEFAULT_NPC_STOP_CHANCE_PERCENT),
      npcMoveDecisionIntervalMinMs: envInt(
        "NPC_MOVE_DECISION_INTERVAL_MIN_MS",
        DEFAULT_NPC_MOVE_DECISION_INTERVAL_MIN_MS
      ),
      npcMoveDecisionIntervalMaxMs: envInt(
        "NPC_MOVE_DECISION_INTERVAL_MAX_MS",
        DEFAULT_NPC_MOVE_DECISION_INTERVAL_MAX_MS
      ),
      npcStopDurationMinMs: envInt(
        "NPC_STOP_DURATION_MIN_MS",
        DEFAULT_NPC_STOP_DURATION_MIN_MS
      ),
      npcStopDurationMaxMs: envInt(
        "NPC_STOP_DURATION_MAX_MS",
        DEFAULT_NPC_STOP_DURATION_MAX_MS
      )
    });
  } catch {
    return normalizeAiBehaviorSettings({
      npcInspectDownedChancePercent: DEFAULT_NPC_INSPECT_DOWNED_CHANCE_PERCENT,
      npcInspectDownedNearbyRadiusMeters: DEFAULT_NPC_INSPECT_DOWNED_RADIUS_METERS,
      npcSocialSeparationPercent: DEFAULT_NPC_SOCIAL_SEPARATION_PERCENT,
      npcStopChancePercent: DEFAULT_NPC_STOP_CHANCE_PERCENT,
      npcMoveDecisionIntervalMinMs: DEFAULT_NPC_MOVE_DECISION_INTERVAL_MIN_MS,
      npcMoveDecisionIntervalMaxMs: DEFAULT_NPC_MOVE_DECISION_INTERVAL_MAX_MS,
      npcStopDurationMinMs: DEFAULT_NPC_STOP_DURATION_MIN_MS,
      npcStopDurationMaxMs: DEFAULT_NPC_STOP_DURATION_MAX_MS
    });
  }
})();

export let TOTAL_CHARACTERS = gameplaySettings.totalCharacters;
export let MAX_PLAYERS = gameplaySettings.maxPlayers;
export let MIN_PLAYERS_TO_START = gameplaySettings.minPlayersToStart;
export let NPC_DOWNED_RESPAWN_MS = gameplaySettings.npcDownedRespawnSeconds * 1000;
export let ATTACK_COOLDOWN_MS = gameplaySettings.playerAttackCooldownSeconds * 1000;
export let MOVE_SPEED = gameplaySettings.moveSpeedMetersPerSecond;
export let PLAYER_SPRINT_MULTIPLIER = gameplaySettings.playerSprintMultiplier;
export let NPC_INSPECT_DOWNED_CHANCE = aiBehaviorSettings.npcInspectDownedChancePercent / 100;
export let NPC_INSPECT_DOWNED_RADIUS_METERS = aiBehaviorSettings.npcInspectDownedNearbyRadiusMeters;
export let NPC_SOCIAL_SEPARATION_WEIGHT = (aiBehaviorSettings.npcSocialSeparationPercent / 100) * 0.4;
export let NPC_STOP_CHANCE = aiBehaviorSettings.npcStopChancePercent / 100;
export let NPC_MOVE_DECISION_INTERVAL_MIN_MS = aiBehaviorSettings.npcMoveDecisionIntervalMinMs;
export let NPC_MOVE_DECISION_INTERVAL_MAX_MS = aiBehaviorSettings.npcMoveDecisionIntervalMaxMs;
export let NPC_STOP_DURATION_MIN_MS = aiBehaviorSettings.npcStopDurationMinMs;
export let NPC_STOP_DURATION_MAX_MS = aiBehaviorSettings.npcStopDurationMaxMs;

function applyGameplaySettings(nextSettings) {
  gameplaySettings = nextSettings;
  TOTAL_CHARACTERS = nextSettings.totalCharacters;
  MAX_PLAYERS = nextSettings.maxPlayers;
  MIN_PLAYERS_TO_START = nextSettings.minPlayersToStart;
  NPC_DOWNED_RESPAWN_MS = nextSettings.npcDownedRespawnSeconds * 1000;
  ATTACK_COOLDOWN_MS = nextSettings.playerAttackCooldownSeconds * 1000;
  MOVE_SPEED = nextSettings.moveSpeedMetersPerSecond;
  PLAYER_SPRINT_MULTIPLIER = nextSettings.playerSprintMultiplier;
}

function applyAiBehaviorSettings(nextSettings) {
  aiBehaviorSettings = nextSettings;
  NPC_INSPECT_DOWNED_CHANCE = nextSettings.npcInspectDownedChancePercent / 100;
  NPC_INSPECT_DOWNED_RADIUS_METERS = nextSettings.npcInspectDownedNearbyRadiusMeters;
  NPC_SOCIAL_SEPARATION_WEIGHT = (nextSettings.npcSocialSeparationPercent / 100) * 0.4;
  NPC_STOP_CHANCE = nextSettings.npcStopChancePercent / 100;
  NPC_MOVE_DECISION_INTERVAL_MIN_MS = nextSettings.npcMoveDecisionIntervalMinMs;
  NPC_MOVE_DECISION_INTERVAL_MAX_MS = nextSettings.npcMoveDecisionIntervalMaxMs;
  NPC_STOP_DURATION_MIN_MS = nextSettings.npcStopDurationMinMs;
  NPC_STOP_DURATION_MAX_MS = nextSettings.npcStopDurationMaxMs;
}

export function setGameplaySettings({
  totalCharacters,
  maxPlayers,
  minPlayersToStart,
  npcDownedRespawnSeconds,
  playerAttackCooldownSeconds,
  moveSpeedMetersPerSecond,
  playerSprintMultiplier
}) {
  const nextSettings = normalizeGameplaySettings({
    totalCharacters,
    maxPlayers,
    minPlayersToStart,
    npcDownedRespawnSeconds,
    playerAttackCooldownSeconds,
    moveSpeedMetersPerSecond,
    playerSprintMultiplier
  });
  const changed =
    nextSettings.totalCharacters !== TOTAL_CHARACTERS ||
    nextSettings.maxPlayers !== MAX_PLAYERS ||
    nextSettings.minPlayersToStart !== MIN_PLAYERS_TO_START ||
    nextSettings.npcDownedRespawnSeconds * 1000 !== NPC_DOWNED_RESPAWN_MS ||
    nextSettings.playerAttackCooldownSeconds * 1000 !== ATTACK_COOLDOWN_MS ||
    nextSettings.moveSpeedMetersPerSecond !== MOVE_SPEED ||
    nextSettings.playerSprintMultiplier !== PLAYER_SPRINT_MULTIPLIER;
  if (!changed) return false;
  applyGameplaySettings(nextSettings);
  return true;
}

export function getGameplaySettings() {
  return Object.freeze({
    totalCharacters: TOTAL_CHARACTERS,
    maxPlayers: MAX_PLAYERS,
    minPlayersToStart: MIN_PLAYERS_TO_START,
    npcDownedRespawnSeconds: Math.round(NPC_DOWNED_RESPAWN_MS / 1000),
    playerAttackCooldownSeconds: Math.round(ATTACK_COOLDOWN_MS / 1000),
    moveSpeedMetersPerSecond: Number(MOVE_SPEED.toFixed(2)),
    playerSprintMultiplier: Number(PLAYER_SPRINT_MULTIPLIER.toFixed(2))
  });
}

export function setAiBehaviorSettings({
  npcInspectDownedChancePercent,
  npcInspectDownedNearbyRadiusMeters,
  npcSocialSeparationPercent,
  npcStopChancePercent,
  npcMoveDecisionIntervalMinMs,
  npcMoveDecisionIntervalMaxMs,
  npcStopDurationMinMs,
  npcStopDurationMaxMs
}) {
  const nextSettings = normalizeAiBehaviorSettings({
    npcInspectDownedChancePercent,
    npcInspectDownedNearbyRadiusMeters,
    npcSocialSeparationPercent,
    npcStopChancePercent,
    npcMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs,
    npcStopDurationMaxMs
  });
  const changed =
    nextSettings.npcInspectDownedChancePercent !== aiBehaviorSettings.npcInspectDownedChancePercent ||
    nextSettings.npcInspectDownedNearbyRadiusMeters !== aiBehaviorSettings.npcInspectDownedNearbyRadiusMeters ||
    nextSettings.npcSocialSeparationPercent !== aiBehaviorSettings.npcSocialSeparationPercent ||
    nextSettings.npcStopChancePercent !== aiBehaviorSettings.npcStopChancePercent ||
    nextSettings.npcMoveDecisionIntervalMinMs !== aiBehaviorSettings.npcMoveDecisionIntervalMinMs ||
    nextSettings.npcMoveDecisionIntervalMaxMs !== aiBehaviorSettings.npcMoveDecisionIntervalMaxMs ||
    nextSettings.npcStopDurationMinMs !== aiBehaviorSettings.npcStopDurationMinMs ||
    nextSettings.npcStopDurationMaxMs !== aiBehaviorSettings.npcStopDurationMaxMs;
  if (!changed) return false;
  applyAiBehaviorSettings(nextSettings);
  return true;
}

export function getAiBehaviorSettings() {
  return Object.freeze({
    npcInspectDownedChancePercent: aiBehaviorSettings.npcInspectDownedChancePercent,
    npcInspectDownedNearbyRadiusMeters: aiBehaviorSettings.npcInspectDownedNearbyRadiusMeters,
    npcSocialSeparationPercent: aiBehaviorSettings.npcSocialSeparationPercent,
    npcStopChancePercent: aiBehaviorSettings.npcStopChancePercent,
    npcMoveDecisionIntervalMinMs: aiBehaviorSettings.npcMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs: aiBehaviorSettings.npcMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs: aiBehaviorSettings.npcStopDurationMinMs,
    npcStopDurationMaxMs: aiBehaviorSettings.npcStopDurationMaxMs
  });
}

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TURN_SPEED = 2.3;
export const AI_DECISION_MS_MIN = 600;
export const AI_DECISION_MS_MAX = 1800;
export const ATTACK_RANGE = 2.8;
export const ATTACK_HALF_ANGLE = Math.PI / 18;
export const ATTACK_FLASH_MS = 140;
export const CHARACTER_RADIUS = 0.41;

function freezeFixture(fixture) {
  return Object.freeze(fixture);
}

const HERE = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
export const SHELF_WIDTH = 1.0;
export const SHELF_DEPTH = 6.0;
export const SHELF_HEIGHT = 2.0;

export const COOLER_WIDTH = 1.0;
export const COOLER_DEPTH = 1.0;
export const COOLER_HEIGHT = 2.0;

export const FREEZER_WIDTH = 1.0;
export const FREEZER_DEPTH = 1.0;
export const FREEZER_HEIGHT = 1.0;

function discoverLayoutPresets() {
  const layoutsDir = resolve(HERE, "./layouts");
  const pngFiles = readdirSync(layoutsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "sv", { sensitivity: "base", numeric: true }));

  if (pngFiles.length === 0) {
    throw new Error(`[layout] Inga PNG-filer hittades i ${layoutsDir}.`);
  }

  return Object.freeze(
    pngFiles.map((fileName) =>
      Object.freeze({
        id: fileName.replace(/\.png$/i, "").toLowerCase(),
        fileName,
        label: fileName
      })
    )
  );
}

const LAYOUT_PRESETS = discoverLayoutPresets();

const LAYOUT_PRESET_BY_ID = new Map(LAYOUT_PRESETS.map((preset) => [preset.id, preset]));
const loadedLayouts = new Map();
const requestedLayoutId = envString("WORLD_LAYOUT_ID", "layout-50").toLowerCase();

function cloneFixtureSet(fixtures, { kind, width, depth, height, keepSourceDimensions = false }) {
  return Object.freeze(
    fixtures.map((fixture) =>
      freezeFixture({
        kind,
        x: fixture.x,
        z: fixture.z,
        width: keepSourceDimensions && typeof fixture.width === "number" ? fixture.width : width,
        depth: keepSourceDimensions && typeof fixture.depth === "number" ? fixture.depth : depth,
        height: keepSourceDimensions && typeof fixture.height === "number" ? fixture.height : height,
        yaw: fixture.yaw
      })
    )
  );
}

function readLayoutById(layoutId) {
  const preset = LAYOUT_PRESET_BY_ID.get(layoutId);
  if (!preset) {
    const known = LAYOUT_PRESETS.map((entry) => entry.id).join(", ");
    throw new Error(`[layout] Unknown layout id "${layoutId}". Available: ${known}`);
  }
  const filePath = resolve(HERE, "./layouts", preset.fileName);
  const mtimeMs = statSync(filePath).mtimeMs;
  const cached = loadedLayouts.get(layoutId);
  if (cached && cached.mtimeMs === mtimeMs) return cached.layout;

  const loaded = loadLayoutFromPng({
    filePath,
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
    worldWidthMeters: loaded.worldWidthMeters,
    worldHeightMeters: loaded.worldHeightMeters,
    warnings: Object.freeze(Array.isArray(loaded.warnings) ? loaded.warnings : []),
    shelves: cloneFixtureSet(loaded.shelves, {
      kind: "shelf",
      width: SHELF_WIDTH,
      depth: SHELF_DEPTH,
      height: SHELF_HEIGHT,
      keepSourceDimensions: true
    }),
    coolers: cloneFixtureSet(loaded.coolers, {
      kind: "cooler",
      width: COOLER_WIDTH,
      depth: COOLER_DEPTH,
      height: COOLER_HEIGHT
    }),
    freezers: cloneFixtureSet(loaded.freezers, {
      kind: "freezer",
      width: FREEZER_WIDTH,
      depth: FREEZER_DEPTH,
      height: FREEZER_HEIGHT
    })
  });
  if (layout.warnings.length > 0) {
    for (const warning of layout.warnings) {
      const text = String(warning?.message || "okänd layoutvarning");
      console.warn(text);
      if (warning?.details) {
        console.warn(`[layout] ${preset.fileName}: ${warning.details}`);
      }
    }
  }
  loadedLayouts.set(layoutId, { mtimeMs, layout });
  return layout;
}

let activeLayout = (() => {
  return readLayoutById(requestedLayoutId);
})();

export let ACTIVE_LAYOUT_ID = activeLayout.id;
export let WORLD_SIZE_METERS = activeLayout.worldSizeMeters;
export let WORLD_WIDTH_METERS = activeLayout.worldWidthMeters;
export let WORLD_HEIGHT_METERS = activeLayout.worldHeightMeters;
export let SHELVES = activeLayout.shelves;
export let COOLERS = activeLayout.coolers;
export let FREEZERS = activeLayout.freezers;

function applyActiveLayout(layout) {
  activeLayout = layout;
  ACTIVE_LAYOUT_ID = layout.id;
  WORLD_SIZE_METERS = layout.worldSizeMeters;
  WORLD_WIDTH_METERS = layout.worldWidthMeters;
  WORLD_HEIGHT_METERS = layout.worldHeightMeters;
  SHELVES = layout.shelves;
  COOLERS = layout.coolers;
  FREEZERS = layout.freezers;
}

export function setActiveLayout(layoutId) {
  const normalized = String(layoutId || "").trim().toLowerCase();
  if (!normalized) return false;
  const nextLayout = readLayoutById(normalized);
  if (normalized === ACTIVE_LAYOUT_ID && nextLayout === activeLayout) return false;
  applyActiveLayout(nextLayout);
  return true;
}

export function getActiveLayoutInfo() {
  const latest = readLayoutById(activeLayout.id);
  return Object.freeze({
    id: latest.id,
    fileName: latest.fileName,
    label: latest.label,
    worldSizeMeters: latest.worldSizeMeters,
    worldWidthMeters: latest.worldWidthMeters,
    worldHeightMeters: latest.worldHeightMeters,
    warnings: latest.warnings
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
        worldSizeMeters: loaded.worldSizeMeters,
        worldWidthMeters: loaded.worldWidthMeters,
        worldHeightMeters: loaded.worldHeightMeters,
        warnings: loaded.warnings
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

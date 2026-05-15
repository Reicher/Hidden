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
  `https://localhost:${DEFAULT_PORT}`,
];

export const GAMEPLAY_SETTINGS_SCHEMA = Object.freeze({
  totalCharacters: Object.freeze({
    env: "TOTAL_CHARACTERS",
    defaultValue: 20,
    envType: "int",
  }),
  maxPlayers: Object.freeze({
    env: "MAX_PLAYERS",
    defaultValue: 10,
    envType: "int",
  }),
  minPlayersToStart: Object.freeze({
    env: "MIN_PLAYERS_TO_START",
    defaultValue: 2,
    envType: "int",
  }),
  npcDownedRespawnSeconds: Object.freeze({
    env: "NPC_DOWNED_RESPAWN_SECONDS",
    defaultValue: 8,
    envType: "int",
  }),
  playerAttackCooldownSeconds: Object.freeze({
    env: "PLAYER_ATTACK_COOLDOWN_SECONDS",
    defaultValue: 2,
    envType: "int",
  }),
  attackHalfAngleDegrees: Object.freeze({
    env: "ATTACK_HALF_ANGLE_DEGREES",
    defaultValue: 18,
    envType: "number",
  }),
  moveSpeedMetersPerSecond: Object.freeze({
    env: "MOVE_SPEED_METERS_PER_SECOND",
    defaultValue: 2.9,
    envType: "number",
  }),
  playerSprintMultiplier: Object.freeze({
    env: "PLAYER_SPRINT_MULTIPLIER",
    defaultValue: 1.45,
    envType: "number",
  }),
});

export const AI_BEHAVIOR_SETTINGS_SCHEMA = Object.freeze({
  npcInspectDownedChancePercent: Object.freeze({
    env: "NPC_INSPECT_DOWNED_CHANCE_PERCENT",
    defaultValue: 75,
    envType: "int",
  }),
  npcInspectDownedNearbyRadiusMeters: Object.freeze({
    env: "NPC_INSPECT_DOWNED_RADIUS_METERS",
    defaultValue: 8.5,
    envType: "number",
  }),
  npcSocialSeparationPercent: Object.freeze({
    env: "NPC_SOCIAL_SEPARATION_PERCENT",
    defaultValue: 45,
    envType: "int",
  }),
  npcStopChancePercent: Object.freeze({
    env: "NPC_STOP_CHANCE_PERCENT",
    defaultValue: 25,
    envType: "int",
  }),
  npcMoveDecisionIntervalMinMs: Object.freeze({
    env: "NPC_MOVE_DECISION_INTERVAL_MIN_MS",
    defaultValue: 600,
    envType: "int",
  }),
  npcMoveDecisionIntervalMaxMs: Object.freeze({
    env: "NPC_MOVE_DECISION_INTERVAL_MAX_MS",
    defaultValue: 1800,
    envType: "int",
  }),
  npcStopDurationMinMs: Object.freeze({
    env: "NPC_STOP_DURATION_MIN_MS",
    defaultValue: 600,
    envType: "int",
  }),
  npcStopDurationMaxMs: Object.freeze({
    env: "NPC_STOP_DURATION_MAX_MS",
    defaultValue: 1800,
    envType: "int",
  }),
});

function settingsDefaults(schema) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(schema).map(([key, field]) => [key, field.defaultValue]),
    ),
  );
}

function readSettingsFromEnv(schema) {
  return Object.fromEntries(
    Object.entries(schema).map(([key, field]) => [
      key,
      field.envType === "number"
        ? envNumber(field.env, field.defaultValue)
        : envInt(field.env, field.defaultValue),
    ]),
  );
}

function settingsKeys(schema) {
  return Object.keys(schema);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function hasSettingsPatch(source, schema) {
  return settingsKeys(schema).some((key) => hasOwn(source, key));
}

function mergeSettingsPatch(source, fallback, schema) {
  return Object.freeze(
    Object.fromEntries(
      settingsKeys(schema).map((key) => [
        key,
        hasOwn(source, key) ? source[key] : fallback[key],
      ]),
    ),
  );
}

const DEFAULT_GAMEPLAY_SETTINGS = settingsDefaults(GAMEPLAY_SETTINGS_SCHEMA);
const DEFAULT_AI_BEHAVIOR_SETTINGS = settingsDefaults(
  AI_BEHAVIOR_SETTINGS_SCHEMA,
);

export function hasGameplaySettingsPatch(source) {
  return hasSettingsPatch(source, GAMEPLAY_SETTINGS_SCHEMA);
}

export function hasAiBehaviorSettingsPatch(source) {
  return hasSettingsPatch(source, AI_BEHAVIOR_SETTINGS_SCHEMA);
}

export function mergeGameplaySettingsPatch(
  source,
  fallback = getGameplaySettings(),
) {
  return mergeSettingsPatch(source, fallback, GAMEPLAY_SETTINGS_SCHEMA);
}

export function mergeAiBehaviorSettingsPatch(
  source,
  fallback = getAiBehaviorSettings(),
) {
  return mergeSettingsPatch(source, fallback, AI_BEHAVIOR_SETTINGS_SCHEMA);
}

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
  attackHalfAngleDegrees,
  moveSpeedMetersPerSecond,
  playerSprintMultiplier,
}) {
  const normalizedTotal = parsePositiveInt(totalCharacters, "totalCharacters");
  const normalizedMax = parsePositiveInt(maxPlayers, "maxPlayers");
  const normalizedMin = parsePositiveInt(
    minPlayersToStart,
    "minPlayersToStart",
  );
  const normalizedNpcRespawnSeconds = parsePositiveInt(
    npcDownedRespawnSeconds,
    "npcDownedRespawnSeconds",
  );
  const normalizedPlayerAttackCooldownSeconds = parsePositiveInt(
    playerAttackCooldownSeconds,
    "playerAttackCooldownSeconds",
  );
  const normalizedAttackHalfAngleDegrees = parseBoundedNumber(
    attackHalfAngleDegrees,
    "attackHalfAngleDegrees",
    { min: 2, max: 60 },
  );
  const normalizedMoveSpeedMetersPerSecond = parseBoundedNumber(
    moveSpeedMetersPerSecond,
    "moveSpeedMetersPerSecond",
    { min: 0.5, max: 8 },
  );
  const normalizedPlayerSprintMultiplier = parseBoundedNumber(
    playerSprintMultiplier,
    "playerSprintMultiplier",
    { min: 1, max: 3 },
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
    attackHalfAngleDegrees: Number(normalizedAttackHalfAngleDegrees.toFixed(1)),
    moveSpeedMetersPerSecond: Number(
      normalizedMoveSpeedMetersPerSecond.toFixed(2),
    ),
    playerSprintMultiplier: Number(normalizedPlayerSprintMultiplier.toFixed(2)),
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
  npcStopDurationMaxMs,
}) {
  const normalizedInspectChance = parseBoundedNumber(
    npcInspectDownedChancePercent,
    "npcInspectDownedChancePercent",
    { min: 0, max: 100, integer: true },
  );
  const normalizedInspectRadius = parseBoundedNumber(
    npcInspectDownedNearbyRadiusMeters,
    "npcInspectDownedNearbyRadiusMeters",
    { min: 2, max: 20 },
  );
  const normalizedSocialSeparation = parseBoundedNumber(
    npcSocialSeparationPercent,
    "npcSocialSeparationPercent",
    { min: 0, max: 100, integer: true },
  );
  const normalizedStopChance = parseBoundedNumber(
    npcStopChancePercent,
    "npcStopChancePercent",
    { min: 0, max: 100, integer: true },
  );
  const normalizedMoveDecisionIntervalMinMs = parseBoundedNumber(
    npcMoveDecisionIntervalMinMs,
    "npcMoveDecisionIntervalMinMs",
    { min: 200, max: 4000, integer: true },
  );
  const normalizedMoveDecisionIntervalMaxMs = parseBoundedNumber(
    npcMoveDecisionIntervalMaxMs,
    "npcMoveDecisionIntervalMaxMs",
    { min: 250, max: 6000, integer: true },
  );
  const normalizedStopDurationMinMs = parseBoundedNumber(
    npcStopDurationMinMs,
    "npcStopDurationMinMs",
    { min: 200, max: 5000, integer: true },
  );
  const normalizedStopDurationMaxMs = parseBoundedNumber(
    npcStopDurationMaxMs,
    "npcStopDurationMaxMs",
    { min: 250, max: 7000, integer: true },
  );
  if (
    normalizedMoveDecisionIntervalMinMs > normalizedMoveDecisionIntervalMaxMs
  ) {
    throw new Error(
      "npcMoveDecisionIntervalMinMs kan inte vara större än npcMoveDecisionIntervalMaxMs.",
    );
  }
  if (normalizedStopDurationMinMs > normalizedStopDurationMaxMs) {
    throw new Error(
      "npcStopDurationMinMs kan inte vara större än npcStopDurationMaxMs.",
    );
  }

  return Object.freeze({
    npcInspectDownedChancePercent: normalizedInspectChance,
    npcInspectDownedNearbyRadiusMeters: Number(
      normalizedInspectRadius.toFixed(1),
    ),
    npcSocialSeparationPercent: normalizedSocialSeparation,
    npcStopChancePercent: normalizedStopChance,
    npcMoveDecisionIntervalMinMs: normalizedMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs: normalizedMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs: normalizedStopDurationMinMs,
    npcStopDurationMaxMs: normalizedStopDurationMaxMs,
  });
}

let gameplaySettings = (() => {
  try {
    return normalizeGameplaySettings(
      readSettingsFromEnv(GAMEPLAY_SETTINGS_SCHEMA),
    );
  } catch {
    return normalizeGameplaySettings(DEFAULT_GAMEPLAY_SETTINGS);
  }
})();

let aiBehaviorSettings = (() => {
  try {
    return normalizeAiBehaviorSettings(
      readSettingsFromEnv(AI_BEHAVIOR_SETTINGS_SCHEMA),
    );
  } catch {
    return normalizeAiBehaviorSettings(DEFAULT_AI_BEHAVIOR_SETTINGS);
  }
})();

export let TOTAL_CHARACTERS = gameplaySettings.totalCharacters;
export let MAX_PLAYERS = gameplaySettings.maxPlayers;
export let MIN_PLAYERS_TO_START = gameplaySettings.minPlayersToStart;
export let NPC_DOWNED_RESPAWN_MS =
  gameplaySettings.npcDownedRespawnSeconds * 1000;
export let ATTACK_COOLDOWN_MS =
  gameplaySettings.playerAttackCooldownSeconds * 1000;
export let ATTACK_HALF_ANGLE =
  (gameplaySettings.attackHalfAngleDegrees * Math.PI) / 180;
export let MOVE_SPEED = gameplaySettings.moveSpeedMetersPerSecond;
export let PLAYER_SPRINT_MULTIPLIER = gameplaySettings.playerSprintMultiplier;
export let NPC_INSPECT_DOWNED_CHANCE =
  aiBehaviorSettings.npcInspectDownedChancePercent / 100;
export let NPC_INSPECT_DOWNED_RADIUS_METERS =
  aiBehaviorSettings.npcInspectDownedNearbyRadiusMeters;
export let NPC_SOCIAL_SEPARATION_WEIGHT =
  (aiBehaviorSettings.npcSocialSeparationPercent / 100) * 0.4;
export let NPC_STOP_CHANCE = aiBehaviorSettings.npcStopChancePercent / 100;
export let NPC_MOVE_DECISION_INTERVAL_MIN_MS =
  aiBehaviorSettings.npcMoveDecisionIntervalMinMs;
export let NPC_MOVE_DECISION_INTERVAL_MAX_MS =
  aiBehaviorSettings.npcMoveDecisionIntervalMaxMs;
export let NPC_STOP_DURATION_MIN_MS = aiBehaviorSettings.npcStopDurationMinMs;
export let NPC_STOP_DURATION_MAX_MS = aiBehaviorSettings.npcStopDurationMaxMs;

function applyGameplaySettings(nextSettings) {
  gameplaySettings = nextSettings;
  TOTAL_CHARACTERS = nextSettings.totalCharacters;
  MAX_PLAYERS = nextSettings.maxPlayers;
  MIN_PLAYERS_TO_START = nextSettings.minPlayersToStart;
  NPC_DOWNED_RESPAWN_MS = nextSettings.npcDownedRespawnSeconds * 1000;
  ATTACK_COOLDOWN_MS = nextSettings.playerAttackCooldownSeconds * 1000;
  ATTACK_HALF_ANGLE = (nextSettings.attackHalfAngleDegrees * Math.PI) / 180;
  MOVE_SPEED = nextSettings.moveSpeedMetersPerSecond;
  PLAYER_SPRINT_MULTIPLIER = nextSettings.playerSprintMultiplier;
}

function applyAiBehaviorSettings(nextSettings) {
  aiBehaviorSettings = nextSettings;
  NPC_INSPECT_DOWNED_CHANCE = nextSettings.npcInspectDownedChancePercent / 100;
  NPC_INSPECT_DOWNED_RADIUS_METERS =
    nextSettings.npcInspectDownedNearbyRadiusMeters;
  NPC_SOCIAL_SEPARATION_WEIGHT =
    (nextSettings.npcSocialSeparationPercent / 100) * 0.4;
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
  attackHalfAngleDegrees,
  moveSpeedMetersPerSecond,
  playerSprintMultiplier,
}) {
  const nextSettings = normalizeGameplaySettings({
    totalCharacters,
    maxPlayers,
    minPlayersToStart,
    npcDownedRespawnSeconds,
    playerAttackCooldownSeconds,
    attackHalfAngleDegrees,
    moveSpeedMetersPerSecond,
    playerSprintMultiplier,
  });
  const changed = Object.keys(GAMEPLAY_SETTINGS_SCHEMA).some(
    (k) => nextSettings[k] !== gameplaySettings[k],
  );
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
    attackHalfAngleDegrees: Number(
      ((ATTACK_HALF_ANGLE * 180) / Math.PI).toFixed(1),
    ),
    moveSpeedMetersPerSecond: Number(MOVE_SPEED.toFixed(2)),
    playerSprintMultiplier: Number(PLAYER_SPRINT_MULTIPLIER.toFixed(2)),
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
  npcStopDurationMaxMs,
}) {
  const nextSettings = normalizeAiBehaviorSettings({
    npcInspectDownedChancePercent,
    npcInspectDownedNearbyRadiusMeters,
    npcSocialSeparationPercent,
    npcStopChancePercent,
    npcMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs,
    npcStopDurationMaxMs,
  });
  const changed = Object.keys(AI_BEHAVIOR_SETTINGS_SCHEMA).some(
    (k) => nextSettings[k] !== aiBehaviorSettings[k],
  );
  if (!changed) return false;
  applyAiBehaviorSettings(nextSettings);
  return true;
}

export function getAiBehaviorSettings() {
  return Object.freeze({
    npcInspectDownedChancePercent:
      aiBehaviorSettings.npcInspectDownedChancePercent,
    npcInspectDownedNearbyRadiusMeters:
      aiBehaviorSettings.npcInspectDownedNearbyRadiusMeters,
    npcSocialSeparationPercent: aiBehaviorSettings.npcSocialSeparationPercent,
    npcStopChancePercent: aiBehaviorSettings.npcStopChancePercent,
    npcMoveDecisionIntervalMinMs:
      aiBehaviorSettings.npcMoveDecisionIntervalMinMs,
    npcMoveDecisionIntervalMaxMs:
      aiBehaviorSettings.npcMoveDecisionIntervalMaxMs,
    npcStopDurationMinMs: aiBehaviorSettings.npcStopDurationMinMs,
    npcStopDurationMaxMs: aiBehaviorSettings.npcStopDurationMaxMs,
  });
}

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TURN_SPEED = 2.3;
export const AI_DECISION_MS_MIN = 600;
export const AI_DECISION_MS_MAX = 1800;
export const ATTACK_RANGE = 2.8;
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
    .sort((a, b) =>
      a.localeCompare(b, "sv", { sensitivity: "base", numeric: true }),
    );

  if (pngFiles.length === 0) {
    throw new Error(`[layout] Inga PNG-filer hittades i ${layoutsDir}.`);
  }

  return Object.freeze(
    pngFiles.map((fileName) =>
      Object.freeze({
        id: fileName.replace(/\.png$/i, "").toLowerCase(),
        fileName,
        label: fileName,
      }),
    ),
  );
}

const LAYOUT_PRESETS = discoverLayoutPresets();

const LAYOUT_PRESET_BY_ID = new Map(
  LAYOUT_PRESETS.map((preset) => [preset.id, preset]),
);
const loadedLayouts = new Map();
const requestedLayoutId = envString(
  "WORLD_LAYOUT_ID",
  "layout-50",
).toLowerCase();

function cloneFixtureSet(
  fixtures,
  { kind, width, depth, height, keepSourceDimensions = false },
) {
  return Object.freeze(
    fixtures.map((fixture) =>
      freezeFixture({
        kind,
        x: fixture.x,
        z: fixture.z,
        width:
          keepSourceDimensions && typeof fixture.width === "number"
            ? fixture.width
            : width,
        depth:
          keepSourceDimensions && typeof fixture.depth === "number"
            ? fixture.depth
            : depth,
        height:
          keepSourceDimensions && typeof fixture.height === "number"
            ? fixture.height
            : height,
        yaw: fixture.yaw,
      }),
    ),
  );
}

function readLayoutById(layoutId) {
  const preset = LAYOUT_PRESET_BY_ID.get(layoutId);
  if (!preset) {
    const known = LAYOUT_PRESETS.map((entry) => entry.id).join(", ");
    throw new Error(
      `[layout] Unknown layout id "${layoutId}". Available: ${known}`,
    );
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
    freezerHeight: FREEZER_HEIGHT,
  });
  const layout = Object.freeze({
    id: preset.id,
    fileName: preset.fileName,
    label: preset.label,
    worldSizeMeters: loaded.worldSizeMeters,
    worldWidthMeters: loaded.worldWidthMeters,
    worldHeightMeters: loaded.worldHeightMeters,
    warnings: Object.freeze(
      Array.isArray(loaded.warnings) ? loaded.warnings : [],
    ),
    shelves: cloneFixtureSet(loaded.shelves, {
      kind: "shelf",
      width: SHELF_WIDTH,
      depth: SHELF_DEPTH,
      height: SHELF_HEIGHT,
      keepSourceDimensions: true,
    }),
    coolers: cloneFixtureSet(loaded.coolers, {
      kind: "cooler",
      width: COOLER_WIDTH,
      depth: COOLER_DEPTH,
      height: COOLER_HEIGHT,
    }),
    freezers: cloneFixtureSet(loaded.freezers, {
      kind: "freezer",
      width: FREEZER_WIDTH,
      depth: FREEZER_DEPTH,
      height: FREEZER_HEIGHT,
    }),
  });
  if (layout.warnings.length > 0) {
    console.warn(
      `⚠ Layout "${preset.fileName}" laddades med ${layout.warnings.length} varning${layout.warnings.length !== 1 ? "ar" : ""}:`,
    );
    for (const warning of layout.warnings) {
      const text = String(warning?.message || "okänd layoutvarning");
      console.warn(`  • ${text}`);
      if (warning?.details) {
        console.warn(`    ${warning.details}`);
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
  const normalized = String(layoutId || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const nextLayout = readLayoutById(normalized);
  if (normalized === ACTIVE_LAYOUT_ID && nextLayout === activeLayout)
    return false;
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
    warnings: latest.warnings,
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
        warnings: loaded.warnings,
      });
    }),
  );
}

export const HEARTBEAT_INTERVAL_MS = envPositiveInt(
  "HEARTBEAT_INTERVAL_MS",
  5000,
);
export const IDLE_SESSION_TIMEOUT_MS = envPositiveInt(
  "IDLE_SESSION_TIMEOUT_MS",
  30 * 60 * 1000,
);
export const LOBBY_IDLE_TIMEOUT_MS = envPositiveInt(
  "LOBBY_IDLE_TIMEOUT_MS",
  10 * 60 * 1000, // 10 minutes for unauthenticated / lobby / spectating sessions
);
export const MAX_MESSAGE_BYTES = envPositiveInt("MAX_MESSAGE_BYTES", 2048);
export const INPUT_UPDATE_MIN_MS = envInt("INPUT_UPDATE_MIN_MS", 20);
export const ATTACK_MESSAGE_MIN_MS = envInt("ATTACK_MESSAGE_MIN_MS", 60);
export const MESSAGE_WINDOW_MS = envPositiveInt("MESSAGE_WINDOW_MS", 1000);
export const MAX_MESSAGES_PER_WINDOW = envPositiveInt(
  "MAX_MESSAGES_PER_WINDOW",
  120,
);
export const SPAM_DROP_WINDOW_MS = envPositiveInt("SPAM_DROP_WINDOW_MS", 1000);
export const SPAM_MAX_DROPS_PER_WINDOW = envPositiveInt(
  "SPAM_MAX_DROPS_PER_WINDOW",
  40,
);
export const ALLOWED_ORIGINS = new Set(
  envCsv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS),
);
export const ALLOW_MISSING_ORIGIN = envBool("ALLOW_MISSING_ORIGIN", false);
export const DEBUG_VIEW_TOKEN = envString("DEBUG_VIEW_TOKEN", "");

export const INVARIANT_LOG_COOLDOWN_MS = envPositiveInt(
  "INVARIANT_LOG_COOLDOWN_MS",
  5000,
);

// ── Namespace exports (deep-module API) ────────────────────────────────────
// These group the functional API into three cohesive namespaces so callers
// only need to import one name per concern instead of 4–5 individual exports.

/** Layout: read/set the active world layout and enumerate available ones. */
export const layout = Object.freeze({
  getActive: getActiveLayoutInfo,
  getAll: getAvailableLayouts,
  setActive: setActiveLayout,
});

/** Gameplay settings: player/NPC tuning values that can be patched at runtime. */
export const gameplay = Object.freeze({
  schema: GAMEPLAY_SETTINGS_SCHEMA,
  get: getGameplaySettings,
  set: setGameplaySettings,
  merge: mergeGameplaySettingsPatch,
  hasOverride: hasGameplaySettingsPatch,
});

/** AI behaviour settings: NPC decision-making tuning values. */
export const aiSettings = Object.freeze({
  schema: AI_BEHAVIOR_SETTINGS_SCHEMA,
  get: getAiBehaviorSettings,
  set: setAiBehaviorSettings,
  merge: mergeAiBehaviorSettingsPatch,
  hasOverride: hasAiBehaviorSettingsPatch,
});

const LOOK_SETTINGS_KEY = "hidden_look_settings";

const DEFAULT_LOOK_SETTINGS = Object.freeze({
  sensitivity: 100,
  smoothingEnabled: true
});

function clampSensitivity(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(50, Math.min(220, Math.round(n)));
}

export function normalizeLookSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  let smoothingEnabled = DEFAULT_LOOK_SETTINGS.smoothingEnabled;
  if (typeof src.smoothingEnabled === "boolean") {
    smoothingEnabled = src.smoothingEnabled;
  } else if (Number.isFinite(Number(src.smoothing))) {
    // Migrate older numeric smoothing settings: 0 = off, >0 = on.
    smoothingEnabled = Number(src.smoothing) > 0;
  }
  return {
    sensitivity: clampSensitivity(src.sensitivity, DEFAULT_LOOK_SETTINGS.sensitivity),
    smoothingEnabled
  };
}

export function loadLookSettings() {
  try {
    const raw = localStorage.getItem(LOOK_SETTINGS_KEY);
    if (!raw) return normalizeLookSettings(null);
    return normalizeLookSettings(JSON.parse(raw));
  } catch {
    return normalizeLookSettings(null);
  }
}

export function persistLookSettings(settings) {
  try {
    localStorage.setItem(LOOK_SETTINGS_KEY, JSON.stringify(normalizeLookSettings(settings)));
  } catch {
    // ignore storage write errors; gameplay settings still apply in memory
  }
}

export function lookSensitivityMultiplier(settings) {
  return Math.max(0.1, (Number(settings?.sensitivity) || DEFAULT_LOOK_SETTINGS.sensitivity) / 100);
}

export function lookSmoothingRate(settings) {
  return settings?.smoothingEnabled ? 30 : 0;
}

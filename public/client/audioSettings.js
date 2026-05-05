const AUDIO_SETTINGS_KEY = "hidden_audio_settings";

export function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeAudioSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    musicVolume: clampVolume(src.musicVolume ?? 80),
    musicMuted: Boolean(src.musicMuted),
    sfxVolume: clampVolume(src.sfxVolume ?? 90),
    sfxMuted: Boolean(src.sfxMuted)
  };
}

export function loadAudioSettings() {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return normalizeAudioSettings(null);
    return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    return normalizeAudioSettings(null);
  }
}

/** Persist an audio settings object to localStorage. */
export function persistAudioSettings(settings) {
  localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
}

import { t } from "./i18n.js";

// ── Audio settings ────────────────────────────────────────────────────────
const AUDIO_SETTINGS_KEY = "hidden_audio_settings";

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeAudioSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    musicVolume: clampVolume(src.musicVolume ?? 80),
    musicMuted: Boolean(src.musicMuted),
    sfxVolume: clampVolume(src.sfxVolume ?? 90),
    sfxMuted: Boolean(src.sfxMuted),
  };
}

function loadAudioSettings() {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return normalizeAudioSettings(null);
    return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    return normalizeAudioSettings(null);
  }
}

function persistAudioSettings(settings) {
  localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
}

// ── Look settings ─────────────────────────────────────────────────────────
const LOOK_SETTINGS_KEY = "hidden_look_settings";

const DEFAULT_LOOK_SETTINGS = Object.freeze({
  sensitivity: 100,
  smoothingEnabled: true,
});

function clampSensitivity(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(50, Math.min(220, Math.round(n)));
}

function normalizeLookSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  let smoothingEnabled = DEFAULT_LOOK_SETTINGS.smoothingEnabled;
  if (typeof src.smoothingEnabled === "boolean") {
    smoothingEnabled = src.smoothingEnabled;
  } else if (Number.isFinite(Number(src.smoothing))) {
    smoothingEnabled = Number(src.smoothing) > 0;
  }
  return {
    sensitivity: clampSensitivity(
      src.sensitivity,
      DEFAULT_LOOK_SETTINGS.sensitivity,
    ),
    smoothingEnabled,
  };
}

function loadLookSettings() {
  try {
    const raw = localStorage.getItem(LOOK_SETTINGS_KEY);
    if (!raw) return normalizeLookSettings(null);
    return normalizeLookSettings(JSON.parse(raw));
  } catch {
    return normalizeLookSettings(null);
  }
}

function persistLookSettings(settings) {
  try {
    localStorage.setItem(
      LOOK_SETTINGS_KEY,
      JSON.stringify(normalizeLookSettings(settings)),
    );
  } catch {
    // ignore storage write errors; settings still apply in memory
  }
}

function lookSensitivityMultiplier(settings) {
  return Math.max(
    0.1,
    (Number(settings?.sensitivity) || DEFAULT_LOOK_SETTINGS.sensitivity) / 100,
  );
}

function lookSmoothingRate(settings) {
  return settings?.smoothingEnabled ? 30 : 0;
}

const HIT_SFX_MIN_DISTANCE = 0.8;
const HIT_SFX_MAX_DISTANCE = 13;
const HIT_SFX_BASE_GAIN = 0.95;

export function createSettingsController({
  elements,
  camera,
  getAppMode,
  getMobileControlsPreference,
  isTouchDevice,
  mobileControlsLabel,
}) {
  const {
    fullscreenModeCheckboxEl,
    lookSensitivityInputEl,
    lookSensitivityValueEl,
    lookSmoothingToggleBtnEl,
    musicMuteBtnEl,
    musicVolumeInputEl,
    settingsFullscreenHelpEl,
    sfxMuteBtnEl,
    sfxVolumeInputEl,
    startFullscreenCheckboxEl,
  } = elements;

  let audioSettings = loadAudioSettings();
  let lookSettings = loadLookSettings();

  // Browsers block Audio.play() until the user has interacted with the page.
  // Track this so we never call play() prematurely and trigger a console warning.
  let userHasInteracted = false;
  function onFirstInteraction() {
    if (userHasInteracted) return;
    userHasInteracted = true;
    document.removeEventListener("pointerdown", onFirstInteraction, true);
    document.removeEventListener("keydown", onFirstInteraction, true);
    document.removeEventListener("touchstart", onFirstInteraction, true);
    // Now that interaction is confirmed, try to start the music loop if needed.
    syncMusicLoop();
  }
  document.addEventListener("pointerdown", onFirstInteraction, true);
  document.addEventListener("keydown", onFirstInteraction, true);
  document.addEventListener("touchstart", onFirstInteraction, true);

  const musicLoopEl = new Audio("/assets/sounds/music.wav");
  const uiBlipSfxTemplateEl = new Audio("/assets/sounds/blipSelect.wav");
  const hitHurtSfxTemplateEl = new Audio("/assets/sounds/hitHurt.wav");
  const hitMissSfxTemplateEl = new Audio("/assets/sounds/hitMiss.wav");
  uiBlipSfxTemplateEl.preload = "auto";
  hitHurtSfxTemplateEl.preload = "auto";
  hitMissSfxTemplateEl.preload = "auto";
  musicLoopEl.loop = true;
  musicLoopEl.preload = "auto";

  function getFullscreenElement() {
    return (
      document.fullscreenElement || document.webkitFullscreenElement || null
    );
  }

  function isFullscreenSupported() {
    return Boolean(
      document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      typeof document.documentElement?.requestFullscreen === "function" ||
      typeof document.documentElement?.webkitRequestFullscreen === "function",
    );
  }

  function isFullscreenActive() {
    return Boolean(getFullscreenElement());
  }

  function setFullscreenHelpText() {
    if (!settingsFullscreenHelpEl) return;
    if (isFullscreenSupported()) {
      settingsFullscreenHelpEl.textContent = isFullscreenActive()
        ? t("settings.fullscreenHelp.active")
        : t("settings.fullscreenHelp.inactive");
      return;
    }
    settingsFullscreenHelpEl.textContent = isTouchDevice
      ? t("settings.fullscreenHelp.unsupportedTouch")
      : t("settings.fullscreenHelp.unsupported");
  }

  function syncMusicLoop() {
    musicLoopEl.volume = Math.max(
      0,
      Math.min(1, audioSettings.musicVolume / 100),
    );
    const shouldPlay =
      getAppMode() === "playing" &&
      !audioSettings.musicMuted &&
      musicLoopEl.volume > 0;
    if (shouldPlay) {
      if (!userHasInteracted) return;
      const playPromise = musicLoopEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
      return;
    }
    musicLoopEl.pause();
    musicLoopEl.currentTime = 0;
  }

  function refreshSettingsUi() {
    const fullscreenSupported = isFullscreenSupported();
    const fullscreenActive = fullscreenSupported && isFullscreenActive();
    if (startFullscreenCheckboxEl) {
      startFullscreenCheckboxEl.disabled = !fullscreenSupported;
      if (!fullscreenSupported || fullscreenActive) {
        startFullscreenCheckboxEl.checked = fullscreenActive;
      }
    }
    if (elements.mobileControlsModeBtnEl) {
      elements.mobileControlsModeBtnEl.textContent = mobileControlsLabel(
        getMobileControlsPreference(),
      );
    }
    if (fullscreenModeCheckboxEl) {
      fullscreenModeCheckboxEl.disabled = !fullscreenSupported;
      fullscreenModeCheckboxEl.checked = fullscreenActive;
    }
    setFullscreenHelpText();
    if (lookSensitivityInputEl) {
      lookSensitivityInputEl.value = String(lookSettings.sensitivity);
    }
    if (lookSensitivityValueEl) {
      lookSensitivityValueEl.textContent = `${lookSettings.sensitivity}%`;
    }
    if (lookSmoothingToggleBtnEl) {
      lookSmoothingToggleBtnEl.textContent = lookSettings.smoothingEnabled
        ? t("settings.on")
        : t("settings.off");
    }
    if (musicVolumeInputEl)
      musicVolumeInputEl.value = String(audioSettings.musicVolume);
    if (sfxVolumeInputEl)
      sfxVolumeInputEl.value = String(audioSettings.sfxVolume);
    if (musicMuteBtnEl)
      musicMuteBtnEl.textContent = audioSettings.musicMuted
        ? t("settings.unmute")
        : t("settings.mute");
    if (sfxMuteBtnEl)
      sfxMuteBtnEl.textContent = audioSettings.sfxMuted
        ? t("settings.unmute")
        : t("settings.mute");
    syncMusicLoop();
  }

  async function setFullscreenEnabled(enabled) {
    const wantsFullscreen = Boolean(enabled);
    if (!isFullscreenSupported()) {
      refreshSettingsUi();
      return false;
    }
    try {
      if (wantsFullscreen && !isFullscreenActive()) {
        const targetEl = document.documentElement;
        if (typeof targetEl?.requestFullscreen === "function") {
          const maybePromise = targetEl.requestFullscreen();
          if (maybePromise && typeof maybePromise.catch === "function") {
            await maybePromise.catch(() => {});
          }
        } else if (typeof targetEl?.webkitRequestFullscreen === "function") {
          targetEl.webkitRequestFullscreen();
        }
      } else if (!wantsFullscreen && isFullscreenActive()) {
        if (typeof document.exitFullscreen === "function") {
          const maybePromise = document.exitFullscreen();
          if (maybePromise && typeof maybePromise.catch === "function") {
            await maybePromise.catch(() => {});
          }
        } else if (typeof document.webkitExitFullscreen === "function") {
          document.webkitExitFullscreen();
        }
      }
    } catch {
      // Settings UI is resynced from the actual fullscreen state below.
    }
    const applied = wantsFullscreen
      ? isFullscreenActive()
      : !isFullscreenActive();
    refreshSettingsUi();
    return applied;
  }

  function sfxVolumeMultiplier() {
    if (audioSettings.sfxMuted) return 0;
    return Math.max(0, Math.min(1, Number(audioSettings.sfxVolume || 0) / 100));
  }

  function playSfx(templateEl, gain = 1) {
    const master = sfxVolumeMultiplier();
    if (master <= 0) return;
    const safeGain = Math.max(0, Math.min(1, Number(gain) || 0));
    const volume = Math.max(0, Math.min(1, master * safeGain));
    if (volume <= 0.001) return;
    if (!userHasInteracted) return;
    const instance = templateEl.cloneNode();
    instance.volume = volume;
    const playPromise = instance.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }

  function playUiBlipSfx() {
    playSfx(uiBlipSfxTemplateEl, 0.92);
  }

  function playHitMissSfx() {
    if (getAppMode() !== "playing") return;
    playSfx(hitMissSfxTemplateEl, 0.75);
  }

  function hitSfxGainByDistance(distanceMeters) {
    const distance = Math.max(0, Number(distanceMeters) || 0);
    if (distance <= HIT_SFX_MIN_DISTANCE) return HIT_SFX_BASE_GAIN;
    if (distance >= HIT_SFX_MAX_DISTANCE) return 0;
    const t =
      (distance - HIT_SFX_MIN_DISTANCE) /
      (HIT_SFX_MAX_DISTANCE - HIT_SFX_MIN_DISTANCE);
    return HIT_SFX_BASE_GAIN * Math.pow(1 - t, 1.3);
  }

  function playHitHurtAtPosition(position) {
    if (!position || getAppMode() !== "playing") return;
    const x = Number(position.x);
    const y = Number(position.y || 0);
    const z = Number(position.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dx = x - camera.position.x;
    const dy = y - camera.position.y;
    const dz = z - camera.position.z;
    const distance = Math.hypot(dx, dy, dz);
    playSfx(hitHurtSfxTemplateEl, hitSfxGainByDistance(distance));
  }

  function bindFullscreenListeners() {
    document.addEventListener("fullscreenchange", refreshSettingsUi);
    document.addEventListener("webkitfullscreenchange", refreshSettingsUi);
    document.addEventListener("languagechange", refreshSettingsUi);
  }

  return {
    bindFullscreenListeners,
    clampVolume,
    getAudioSettings: () => audioSettings,
    getLookSensitivityMultiplier: () => lookSensitivityMultiplier(lookSettings),
    getLookSmoothingRate: () => lookSmoothingRate(lookSettings),
    getLookSettings: () => lookSettings,
    persistAudioSettings,
    persistLookSettings,
    playHitHurtAtPosition,
    playHitMissSfx,
    playUiBlipSfx,
    refreshSettingsUi,
    setFullscreenEnabled,
    setLookSettings: (next) => {
      lookSettings = next;
    },
    syncMusicLoop,
  };
}

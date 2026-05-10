import { loadAudioSettings } from "./audioSettings.js";
import {
  loadLookSettings,
  lookSensitivityMultiplier,
  lookSmoothingRate,
} from "./lookSettings.js";

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
        ? "Helskärm är aktivt. Avmarkera rutan för att lämna."
        : "";
      return;
    }
    settingsFullscreenHelpEl.textContent = isTouchDevice
      ? "Helskärm stöds inte här (vanligt på iPhone/iPad Safari)."
      : "Helskärm stöds inte i den här webbläsaren.";
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
        ? "På"
        : "Av";
    }
    if (musicVolumeInputEl)
      musicVolumeInputEl.value = String(audioSettings.musicVolume);
    if (sfxVolumeInputEl)
      sfxVolumeInputEl.value = String(audioSettings.sfxVolume);
    if (musicMuteBtnEl)
      musicMuteBtnEl.textContent = audioSettings.musicMuted ? "Avmuta" : "Muta";
    if (sfxMuteBtnEl)
      sfxMuteBtnEl.textContent = audioSettings.sfxMuted ? "Avmuta" : "Muta";
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
  }

  return {
    bindFullscreenListeners,
    getAudioSettings: () => audioSettings,
    getLookSensitivityMultiplier: () => lookSensitivityMultiplier(lookSettings),
    getLookSmoothingRate: () => lookSmoothingRate(lookSettings),
    getLookSettings: () => lookSettings,
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

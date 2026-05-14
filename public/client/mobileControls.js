import { t } from "./i18n.js";

/**
 * Mobile controls preference + visibility logic.
 *
 * createMobileControls(elements, deps) → {
 *   persistMobileControlsPreference,
 *   mobileControlsEnabledByPreference,
 *   controlsTextForCurrentMode,
 *   updateMobileControlsVisibility,
 * }
 */

const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";

/**
 * @param {{
 *   mobileControlsEl: Element|null,
 *   mobileLandscapePromptEl: Element|null,
 *   lobbyDialogBackdropEl: Element|null,
 * }} elements
 * @param {{
 *   isTouchDevice: boolean,
 *   initialPreference: string,
 *   normalizePreference: (value: string) => string,
 *   gameplaySummaryText: string,
 *   desktopControlsText: string,
 *   mobileControlsText: string,
 *   getAppMode: () => string,
 *   getSessionState: () => string,
 *   getGameChatOpen: () => boolean,
 *   getGameMenuOpen: () => boolean,
 *   resetJoystickState: () => void,
 * }} deps
 */
export function createMobileControls(
  { mobileControlsEl, mobileLandscapePromptEl, lobbyDialogBackdropEl },
  {
    isTouchDevice,
    initialPreference,
    normalizePreference,
    getAppMode,
    getSessionState,
    getGameChatOpen,
    getGameMenuOpen,
    resetJoystickState,
  },
) {
  let preference = initialPreference;

  function persistMobileControlsPreference(value) {
    preference = normalizePreference(value);
    localStorage.setItem(MOBILE_CONTROLS_PREF_KEY, preference);
  }

  function mobileControlsEnabledByPreference() {
    if (preference === "on") return true;
    if (preference === "off") return false;
    return isTouchDevice;
  }

  function controlsTextForCurrentMode() {
    return `${t("gameplay.summary")}\n${
      mobileControlsEnabledByPreference()
        ? t("gameplay.mobileControls")
        : t("gameplay.desktopControls")
    }`;
  }

  function updateMobileControlsVisibility() {
    if (!mobileControlsEl) return;
    const isPortrait =
      (window.matchMedia &&
        window.matchMedia("(orientation: portrait)").matches) ||
      window.innerHeight > window.innerWidth;
    const showLandscapePrompt =
      isTouchDevice && getAppMode() === "playing" && isPortrait;
    const wasShown = !mobileControlsEl.classList.contains("hidden");
    const lobbyDialogOpen =
      getAppMode() === "playing" &&
      lobbyDialogBackdropEl &&
      !lobbyDialogBackdropEl.classList.contains("hidden");
    const show =
      mobileControlsEnabledByPreference() &&
      getAppMode() === "playing" &&
      (getSessionState() === "alive" || getSessionState() === "won") &&
      !getGameChatOpen() &&
      !getGameMenuOpen() &&
      !lobbyDialogOpen &&
      !showLandscapePrompt;
    mobileControlsEl.classList.toggle("hidden", !show);
    document.body.classList.toggle("mobile-controls-enabled", show);
    mobileLandscapePromptEl?.classList.toggle("hidden", !showLandscapePrompt);
    if (mobileLandscapePromptEl)
      mobileLandscapePromptEl.setAttribute(
        "aria-hidden",
        showLandscapePrompt ? "false" : "true",
      );
    if (wasShown && !show) resetJoystickState();
  }

  return {
    controlsTextForCurrentMode,
    getMobileControlsPreference: () => preference,
    mobileControlsEnabledByPreference,
    persistMobileControlsPreference,
    updateMobileControlsVisibility,
  };
}

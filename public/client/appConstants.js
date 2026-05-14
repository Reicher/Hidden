/**
 * Client-side application constants.
 * Extracted from app.js so the bootstrap file stays thin and constants
 * can be imported directly by any module that needs them.
 *
 * NOTE: IS_TOUCH_DEVICE / FORCE_MOBILE_UI read browser globals at module
 * load time – this file is intentionally browser-only (lives under public/).
 */

// ── localStorage keys ──────────────────────────────────────────────────────
export const PLAYER_NAME_KEY = "hidden_player_name";
export const MOBILE_CONTROLS_PREF_KEY = "hidden_mobile_controls_pref";

// ── Input ──────────────────────────────────────────────────────────────────
export const INPUT_SEND_INTERVAL_MS = 33;
export const INPUT_HEARTBEAT_MS = 120;
export const LOOK_TOUCH_SENSITIVITY_X = 0.0052;
export const LOOK_TOUCH_SENSITIVITY_Y = 0.0045;
export const JOYSTICK_DEADZONE = 0.16;

// ── Crosshair / HUD ────────────────────────────────────────────────────────
export const CROSSHAIR_COOLDOWN_MIN_VISIBLE_MS = 8;
export const CROSSHAIR_DEFAULT_COOLDOWN_MS = 1000;
export const CROSSHAIR_RING_CIRCUMFERENCE = Math.PI * 26;
export const CROSSHAIR_HIT_DISTANCE_METERS = 2.8;
export const CROSSHAIR_AIM_CHECK_MS = 66;
export const HUD_OVERLAY_REFRESH_MS = 120;

// ── Chat / overlay shortcuts ───────────────────────────────────────────────
export const GAME_CHAT_MAX_LINES = 5;
export const GAME_CHAT_OPEN_SHORTCUT = "KeyC";
export const DEBUG_OVERLAY_TOGGLE_SHORTCUT = "KeyP";
export const DEBUG_OVERLAY_TOUCH_HOLD_MS = 900;
export const DEBUG_OVERLAY_UNLOCK_TOUCH_HOLD_MS = 2600;

// ── Timers visible to the player ───────────────────────────────────────────
export const DOWNED_MESSAGE_VISIBLE_MS = 2800;
export const WIN_MESSAGE_VISIBLE_MS = 2000;
export const KNOCKDOWN_TOAST_MS = 5000;

// ── Camera constants ───────────────────────────────────────────────────────
export const DOWNED_CAMERA_HEIGHT = 4.6;
export const DOWNED_CAMERA_POS_SMOOTH_RATE = 9;
export const SPECTATOR_CAMERA_DISTANCE = 1.42;
export const SPECTATOR_CAMERA_HEIGHT_OFFSET = 0.28;
export const SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET = 0.12;
export const SPECTATOR_CAMERA_POS_SMOOTH_RATE = 12;

// ── Mobile render scaling ──────────────────────────────────────────────────
export const MOBILE_FRAME_MS_DEGRADE_THRESHOLD = 24;
export const MOBILE_FRAME_MS_UPGRADE_THRESHOLD = 19;
export const MOBILE_RENDER_SCALE_MIN = 0.72;
export const MOBILE_RENDER_SCALE_MAX = 1;
export const MOBILE_RENDER_SCALE_STEP_DOWN = 0.07;
export const MOBILE_RENDER_SCALE_STEP_UP = 0.04;
export const MOBILE_RENDER_SCALE_ADJUST_COOLDOWN_MS = 1500;

// ── UI copy / controls texts ───────────────────────────────────────────────
// (strings are now managed through public/client/i18n.js and the lang/ files)

// ── Device detection (evaluated once at module load) ──────────────────────
export const FORCE_MOBILE_UI =
  new URLSearchParams(location.search).get("mobileUi") === "1";

export const IS_TOUCH_DEVICE = (() => {
  const coarsePointer =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const hoverNone =
    window.matchMedia && window.matchMedia("(hover: none)").matches;
  const touchApi = "ontouchstart" in window;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(
    navigator.userAgent || "",
  );
  return (
    coarsePointer ||
    hoverNone ||
    touchApi ||
    touchPoints ||
    mobileUa ||
    FORCE_MOBILE_UI
  );
})();

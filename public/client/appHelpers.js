import { t } from "./i18n.js";

const RESERVED_PATH_CODES = new Set(["debug"]);
const PRIVATE_ROOM_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const MOBILE_CONTROLS_PREFS = Object.freeze(["auto", "on", "off"]);

export function wsScheme(protocol = location.protocol) {
  return protocol === "https:" ? "wss" : "ws";
}

export function activeRoomCodeFromPath(pathname = location.pathname) {
  const segments = String(pathname || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length !== 1) return null;
  try {
    const roomCode = decodeURIComponent(segments[0]);
    if (!roomCode) return null;
    if (RESERVED_PATH_CODES.has(roomCode.toLowerCase())) return null;
    return roomCode;
  } catch {
    return null;
  }
}

export function activeRoomPath(pathname = location.pathname) {
  const code = activeRoomCodeFromPath(pathname);
  if (!code) return "/";
  return `/${encodeURIComponent(code)}`;
}

export function randomPrivateRoomCode(randomValuesSource = crypto) {
  const bytes = new Uint8Array(8);
  randomValuesSource.getRandomValues(bytes);
  let out = "";
  for (const value of bytes)
    out +=
      PRIVATE_ROOM_CODE_ALPHABET[value % PRIVATE_ROOM_CODE_ALPHABET.length];
  return out;
}

export function normalizeMobileControlsPreference(value) {
  if (value === "on" || value === "off" || value === "auto") return value;
  return "auto";
}

export function mobileControlsLabel(pref) {
  if (pref === "on") return t("settings.on");
  if (pref === "off") return t("settings.off");
  return t("settings.mobileControlsAuto");
}

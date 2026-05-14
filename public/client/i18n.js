/**
 * i18n – lightweight internationalisation module.
 *
 * Usage:
 *   import { t, setLanguage, initI18n } from './i18n.js';
 *
 *   initI18n();          // call once at app start
 *   t('connect.connectBtn');           // → "Anslut" / "Connect"
 *   t('lobby.players', {count:3,max:10}); // → "3/10 spelare"
 *   setLanguage('en');   // switch language, fires 'languagechange' event
 */

import sv from "./lang/sv.js";
import en from "./lang/en.js";

const LANG_KEY = "hidden_language";
const DICTS = { sv, en };

let _lang = "sv";

// ── Core ────────────────────────────────────────────────────────────────────

/**
 * Translate a key, optionally replacing {placeholder} tokens.
 * Falls back to Swedish, then to the key itself.
 * @param {string} key
 * @param {Record<string,string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const dict = DICTS[_lang] ?? DICTS.sv;
  let str = dict[key] ?? DICTS.sv[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function getCurrentLanguage() {
  return _lang;
}

// ── Language switching ───────────────────────────────────────────────────────

export function setLanguage(lang) {
  if (lang !== "sv" && lang !== "en") return;
  _lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage disabled */
  }
  document.documentElement.lang = lang === "sv" ? "sv" : "en";
  applyStaticTranslations();
  document.dispatchEvent(
    new CustomEvent("languagechange", { detail: { lang } }),
  );
}

// ── Static DOM translation ───────────────────────────────────────────────────

/**
 * Walk all [data-i18n] elements and update text / attributes.
 * Also updates flag button active state.
 */
export function applyStaticTranslations() {
  // textContent
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  // placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  // aria-label
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  // flag buttons
  document.querySelectorAll(".lang-flag-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === _lang);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initI18n() {
  let stored = "sv";
  try {
    stored = localStorage.getItem(LANG_KEY) || "sv";
  } catch {
    /* */
  }
  _lang = stored === "en" || stored === "sv" ? stored : "sv";
  document.documentElement.lang = _lang === "sv" ? "sv" : "en";
  applyStaticTranslations();

  // Bind flag buttons (works for buttons added before this call)
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".lang-flag-btn");
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (lang) setLanguage(lang);
  });
}

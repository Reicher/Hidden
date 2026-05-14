import { t, getCurrentLanguage } from "./i18n.js";

/**
 * Pure UI updater for the countdown overlay.
 *
 * Returns the characterId that was last rendered (so the caller can track
 * lastCountdownPreviewCharacterId without storing state here).
 *
 * @param {{
 *   countdownTextEl: Element|null,
 *   countdownOverlayEl: Element|null,
 *   countdownControlsTextEl: Element|null,
 *   countdownCharacterCanvasEl: HTMLCanvasElement|null,
 *   countdownJoinBtnEl: Element|null,
 *   countdownMsRemaining: number,
 *   sessionState: string,
 *   authenticated: boolean,
 *   characterId: number|null,
 *   lastCountdownPreviewCharacterId: number|null,
 *   isTouchDevice: boolean,
 *   drawCharacterPreview: (canvas: HTMLCanvasElement, characterId: number) => void,
 * }} opts
 * @returns {{ lastCountdownPreviewCharacterId: number|null }}
 */

function buildDesktopControlsHtml() {
  return `
    <div class="ctrl-grid">
      <div class="ctrl-item">
        <div class="ctrl-keys">
          <div class="ctrl-key-row"><kbd class="key">W</kbd></div>
          <div class="ctrl-key-row"><kbd class="key">A</kbd><kbd class="key">S</kbd><kbd class="key">D</kbd></div>
        </div>
        <span class="ctrl-label">${t("countdown.ctrl.movement")}</span>
      </div>
      <div class="ctrl-item">
        <kbd class="key key-wide">⇧ Shift</kbd>
        <span class="ctrl-label">${t("countdown.ctrl.sprint")}</span>
      </div>
      <div class="ctrl-item">
        <span class="ctrl-mouse"><svg viewBox="0 0 20 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1" y="1" width="18" height="26" rx="9" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="1" x2="10" y2="14" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="19" r="1.5" fill="currentColor"/><rect x="1" y="1" width="8.2" height="13" rx="4" fill="currentColor" fill-opacity="0.25"/></svg></span>
        <span class="ctrl-label">${t("countdown.ctrl.attack")}</span>
      </div>
      <div class="ctrl-item">
        <span class="ctrl-mouse ctrl-mouse-drag"><svg viewBox="0 0 20 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1" y="1" width="18" height="26" rx="9" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="1" x2="10" y2="14" stroke="currentColor" stroke-width="1.6"/><path d="M10 22 L7 25 M10 22 L13 25 M10 22 L10 26" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>
        <span class="ctrl-label">${t("countdown.ctrl.look")}</span>
      </div>
    </div>
  `;
}

function buildMobileControlsHtml() {
  return `
    <p class="ctrl-mobile-hint">${t("countdown.ctrl.mobileHint")}</p>
  `;
}

export function updateCountdownOverlay({
  countdownTextEl,
  countdownOverlayEl,
  countdownControlsTextEl,
  countdownCharacterCanvasEl,
  countdownJoinBtnEl,
  countdownMsRemaining,
  sessionState,
  authenticated,
  characterId,
  lastCountdownPreviewCharacterId,
  isTouchDevice,
  drawCharacterPreview,
}) {
  if (!countdownTextEl || !countdownOverlayEl) {
    return { lastCountdownPreviewCharacterId };
  }

  if (countdownControlsTextEl) {
    const rendered = countdownControlsTextEl.dataset.renderedFor;
    const mode = `${isTouchDevice ? "mobile" : "desktop"}-${getCurrentLanguage()}`;
    if (rendered !== mode) {
      countdownControlsTextEl.innerHTML = isTouchDevice
        ? buildMobileControlsHtml()
        : buildDesktopControlsHtml();
      countdownControlsTextEl.dataset.renderedFor = mode;
    }
  }

  // Show join button when the player is in lobby (watching countdown) but not
  // yet participating in it.
  const canJoin =
    countdownMsRemaining > 0 &&
    sessionState === "lobby" &&
    Boolean(authenticated);
  countdownJoinBtnEl?.classList.toggle("hidden", !canJoin);

  if (countdownMsRemaining > 0) {
    const sec = Math.max(1, Math.ceil(countdownMsRemaining / 1000));
    countdownTextEl.textContent = String(sec);

    let nextPreviewCharacterId = lastCountdownPreviewCharacterId;
    if (countdownCharacterCanvasEl && characterId != null) {
      if (characterId !== lastCountdownPreviewCharacterId) {
        drawCharacterPreview(countdownCharacterCanvasEl, characterId);
        nextPreviewCharacterId = characterId;
      }
    } else {
      nextPreviewCharacterId = null;
    }

    countdownOverlayEl.classList.remove("hidden");
    return { lastCountdownPreviewCharacterId: nextPreviewCharacterId };
  }

  countdownTextEl.textContent = "";
  countdownOverlayEl.classList.add("hidden");
  return { lastCountdownPreviewCharacterId: null };
}

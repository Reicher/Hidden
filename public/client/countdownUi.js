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
 *   controlsText: string,
 *   drawCharacterPreview: (canvas: HTMLCanvasElement, characterId: number) => void,
 * }} opts
 * @returns {{ lastCountdownPreviewCharacterId: number|null }}
 */
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
  controlsText,
  drawCharacterPreview,
}) {
  if (!countdownTextEl || !countdownOverlayEl) {
    return { lastCountdownPreviewCharacterId };
  }

  if (countdownControlsTextEl) {
    countdownControlsTextEl.textContent = controlsText;
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

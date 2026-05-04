export function updateInGameHud({ aliveOthersTextEl, gameChatNoticeEl, activePlayersInGame, sessionState }) {
  if (!aliveOthersTextEl) return;
  const others = Math.max(0, activePlayersInGame - (sessionState === "alive" ? 1 : 0));
  const noun = others === 1 ? "annan" : "andra";
  aliveOthersTextEl.textContent = `${others} ${noun} spelar just nu`;
  if (gameChatNoticeEl) {
    gameChatNoticeEl.textContent = sessionState === "won" ? "Chatt" : "Systemhändelser";
  }
}

export function updateDownedOverlay({
  downedOverlayEl,
  downedByTextEl,
  downedCountdownTextEl,
  gameMenuBtnEl,
  appMode,
  sessionState,
  downedByName
}) {
  if (!downedOverlayEl || !downedByTextEl || !downedCountdownTextEl) return;
  const downed = appMode === "playing" && sessionState === "downed";
  downedOverlayEl.classList.toggle("hidden", !downed);
  gameMenuBtnEl?.classList.toggle("hidden", downed);
  if (!downed) return;

  const killer = downedByName ? String(downedByName) : "okänd spelare";
  downedByTextEl.textContent = `Du blev nedslagen av ${killer}`;
  downedCountdownTextEl.textContent = "Tryck på knappen för att återgå till lobbyn.";
}

export function updateWinOverlay({
  winOverlayEl,
  winTitleEl,
  winCountdownTextEl,
  gameMenuBtnEl,
  appMode,
  sessionState,
  winReturnToLobbyMsRemaining
}) {
  if (!winOverlayEl || !winTitleEl || !winCountdownTextEl) return;
  const won = appMode === "playing" && sessionState === "won";
  winOverlayEl.classList.toggle("hidden", !won);
  gameMenuBtnEl?.classList.toggle("hidden", won);
  if (!won) return;
  winTitleEl.textContent = "Du vann!";
  const sec = Math.max(0, Math.ceil(winReturnToLobbyMsRemaining / 1000));
  winCountdownTextEl.textContent = `Återgå till lobbyn om ${sec}`;
}

export function updateKnockdownToast({
  knockdownToastEl,
  appMode,
  sessionState,
  knockdownToastMsRemaining,
  knockdownToastText
}) {
  if (!knockdownToastEl) return;
  const visible =
    appMode === "playing" && sessionState !== "won" && knockdownToastMsRemaining > 0 && Boolean(knockdownToastText);
  knockdownToastEl.classList.toggle("hidden", !visible);
  if (visible) knockdownToastEl.textContent = knockdownToastText;
}

export function updateCrosshairHud({
  crosshairHudEl,
  crosshairCooldownArcEl,
  appMode,
  sessionState,
  myCharacterId,
  attackCooldownMsRemaining,
  attackCooldownVisualMaxMs,
  deltaSec,
  crosshairCooldownMinVisibleMs,
  crosshairDefaultCooldownMs,
  crosshairRingCircumference,
  crosshairHitDistanceMeters,
  camera,
  avatarSystem
}) {
  if (!crosshairHudEl || !crosshairCooldownArcEl) {
    return { attackCooldownMsRemaining, attackCooldownVisualMaxMs };
  }

  const inActiveGameplay = appMode === "playing" && sessionState === "alive" && myCharacterId != null;
  crosshairHudEl.classList.toggle("hidden", !inActiveGameplay);
  if (!inActiveGameplay) return { attackCooldownMsRemaining, attackCooldownVisualMaxMs };

  const cooldownMsRemaining = Math.max(0, attackCooldownMsRemaining - Math.max(0, deltaSec) * 1000);
  const onCooldown = cooldownMsRemaining > crosshairCooldownMinVisibleMs;
  crosshairHudEl.classList.toggle("cooldown", onCooldown);

  if (onCooldown) {
    const visualMax = Math.max(120, attackCooldownVisualMaxMs || crosshairDefaultCooldownMs);
    const cooldownRatio = Math.max(0, Math.min(1, cooldownMsRemaining / visualMax));
    const dashOffset = crosshairRingCircumference * (1 - cooldownRatio);
    crosshairCooldownArcEl.style.strokeDashoffset = dashOffset.toFixed(3);
    crosshairHudEl.classList.remove("targeting");
    return {
      attackCooldownMsRemaining: cooldownMsRemaining,
      attackCooldownVisualMaxMs: visualMax
    };
  }

  crosshairCooldownArcEl.style.strokeDashoffset = crosshairRingCircumference.toFixed(3);
  camera.updateMatrixWorld(true);
  const aimingAtCharacter = avatarSystem.isAimingAtCharacter({
    myCharacterId,
    maxDistance: crosshairHitDistanceMeters
  });
  crosshairHudEl.classList.toggle("targeting", aimingAtCharacter);
  return {
    attackCooldownMsRemaining: cooldownMsRemaining,
    attackCooldownVisualMaxMs
  };
}

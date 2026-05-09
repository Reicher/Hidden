export function updateInGameHud({
  aliveOthersTextEl,
  gameChatNoticeEl,
  activePlayersInGame,
  sessionState,
}) {
  if (!aliveOthersTextEl) return;
  const others = Math.max(
    0,
    activePlayersInGame - (sessionState === "alive" ? 1 : 0),
  );
  const noun = others === 1 ? "annan" : "andra";
  aliveOthersTextEl.textContent = `${others} ${noun} spelar just nu`;
  if (gameChatNoticeEl) {
    gameChatNoticeEl.textContent =
      sessionState === "won" ? "Chatt" : "Systemhändelser";
  }
}

export function updateDownedOverlay({
  downedOverlayEl,
  downedByTextEl,
  downedCountdownTextEl,
  gameMenuBtnEl,
  appMode,
  sessionState,
  downedByName,
  showDownedMessage,
  returnToLobbyMsRemaining,
}) {
  if (!downedOverlayEl || !downedByTextEl || !downedCountdownTextEl) return;
  const downed =
    appMode === "playing" &&
    (sessionState === "downed" ||
      (sessionState === "spectating" && Boolean(downedByName))) &&
    !(returnToLobbyMsRemaining > 0);
  downedOverlayEl.classList.toggle("hidden", !downed);
  gameMenuBtnEl?.classList.toggle("hidden", downed);
  if (!downed) return;

  const killer = downedByName ? String(downedByName) : "okänd spelare";
  downedByTextEl.textContent = `Du blev nedslagen av ${killer}`;
  downedByTextEl.classList.toggle("hidden", !showDownedMessage);
  const sec = Math.max(
    0,
    Math.ceil(Number(returnToLobbyMsRemaining || 0) / 1000),
  );
  downedCountdownTextEl.classList.toggle("hidden", sec <= 0);
  downedCountdownTextEl.textContent =
    sec > 0 ? `Du återgår automatiskt till lobbyn om ${sec}` : "";
}

export function updateWinOverlay({
  winOverlayEl,
  winTitleEl,
  winCountdownTextEl,
  gameMenuBtnEl,
  appMode,
  sessionState,
  winReturnToLobbyMsRemaining,
  showWinTitle,
}) {
  if (!winOverlayEl || !winTitleEl || !winCountdownTextEl) return;
  const won = appMode === "playing" && sessionState === "won";
  const matchEnd =
    appMode === "playing" &&
    (sessionState === "spectating" || sessionState === "downed") &&
    winReturnToLobbyMsRemaining > 0;
  const visible = won || matchEnd;
  winOverlayEl.classList.toggle("hidden", !visible);
  gameMenuBtnEl?.classList.toggle("hidden", won || matchEnd);
  if (!visible) return;
  winTitleEl.textContent = won ? "Du vann!" : "Matchen avslutas";
  winTitleEl.classList.toggle("hidden", won && !showWinTitle);
  const sec = Math.max(0, Math.ceil(winReturnToLobbyMsRemaining / 1000));
  winCountdownTextEl.textContent = `Automatisk återgång till lobbyn om ${sec}`;
}

export function updateKnockdownToast({
  knockdownToastEl,
  appMode,
  sessionState,
  knockdownToastMsRemaining,
  knockdownToastText,
}) {
  if (!knockdownToastEl) return;
  const visible =
    appMode === "playing" &&
    sessionState !== "won" &&
    knockdownToastMsRemaining > 0 &&
    Boolean(knockdownToastText);
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
  avatarSystem,
  aimingAtCharacter = null,
}) {
  if (!crosshairHudEl || !crosshairCooldownArcEl) {
    return { attackCooldownMsRemaining, attackCooldownVisualMaxMs };
  }

  const inActiveGameplay =
    appMode === "playing" && sessionState === "alive" && myCharacterId != null;
  crosshairHudEl.classList.toggle("hidden", !inActiveGameplay);
  if (!inActiveGameplay)
    return { attackCooldownMsRemaining, attackCooldownVisualMaxMs };

  const cooldownMsRemaining = Math.max(
    0,
    attackCooldownMsRemaining - Math.max(0, deltaSec) * 1000,
  );
  const onCooldown = cooldownMsRemaining > crosshairCooldownMinVisibleMs;
  crosshairHudEl.classList.toggle("cooldown", onCooldown);

  if (onCooldown) {
    const visualMax = Math.max(
      120,
      attackCooldownVisualMaxMs || crosshairDefaultCooldownMs,
    );
    const cooldownRatio = Math.max(
      0,
      Math.min(1, cooldownMsRemaining / visualMax),
    );
    const dashOffset = crosshairRingCircumference * (1 - cooldownRatio);
    crosshairCooldownArcEl.style.strokeDashoffset = dashOffset.toFixed(3);
    crosshairHudEl.classList.remove("targeting");
    return {
      attackCooldownMsRemaining: cooldownMsRemaining,
      attackCooldownVisualMaxMs: visualMax,
    };
  }

  crosshairCooldownArcEl.style.strokeDashoffset =
    crosshairRingCircumference.toFixed(3);
  const isTargeting =
    typeof aimingAtCharacter === "boolean"
      ? aimingAtCharacter
      : (() => {
          camera.updateMatrixWorld(true);
          return avatarSystem.isAimingAtCharacter({
            myCharacterId,
            maxDistance: crosshairHitDistanceMeters,
          });
        })();
  crosshairHudEl.classList.toggle("targeting", isTargeting);
  return {
    attackCooldownMsRemaining: cooldownMsRemaining,
    attackCooldownVisualMaxMs,
  };
}

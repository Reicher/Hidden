export function createInputController({
  canvas,
  mobile: {
    joystickBaseEl: mobileJoystickBaseEl,
    joystickKnobEl: mobileJoystickKnobEl,
    lookPadEl: mobileLookPadEl,
    sprintBtnEl: mobileSprintBtnEl,
    attackBtnEl: mobileAttackBtnEl,
  },
  config: {
    isTouchDevice,
    inputSendIntervalMs,
    inputHeartbeatMs,
    lookTouchSensitivityX,
    lookTouchSensitivityY,
    getLookSensitivityMultiplier,
    joystickDeadzone,
    clampPitch,
  },
  app: {
    getSocket,
    getAppMode,
    getSessionState,
    getGameMenuOpen,
    getGameChatOpen,
    isGameChatFocused,
    requestPointerLock,
  },
}) {
  const input = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    yaw: 0,
    pitch: 0,
  };

  let yaw = 0;
  let pitch = 0;
  let inputDirty = true;
  let lastInputSentAt = 0;
  let mobileLookPointerId = null;
  let mobileLookLastX = 0;
  let mobileLookLastY = 0;
  let mobileMovePointerId = null;
  let joystickCurrentX = 0;
  let joystickCurrentY = 0;
  let joystickCenterX = 0;
  let joystickCenterY = 0;
  let joystickMaxRadius = 1;

  function canUseMovementInput() {
    if (getAppMode() !== "playing") return false;
    const state = getSessionState();
    if (state !== "alive" && state !== "won") return false;
    if (getGameMenuOpen()) return false;
    if (getGameChatOpen() || isGameChatFocused()) return false;
    return true;
  }

  function sendInput() {
    if (getAppMode() !== "playing") return;
    const state = getSessionState();
    if (state !== "alive" && state !== "won") return;
    const now = performance.now();
    const heartbeatDue = now - lastInputSentAt >= inputHeartbeatMs;
    if (!inputDirty && !heartbeatDue) return;
    const socket = getSocket();
    if (!socket || !socket.sendJson({ type: "input", input })) return;
    inputDirty = false;
    lastInputSentAt = now;
  }

  function setMoveInputState(field, active) {
    if (!(field in input)) return;
    if (input[field] === active) return;
    input[field] = active;
    inputDirty = true;
  }

  function resetMoveDirectionalInput() {
    setMoveInputState("forward", false);
    setMoveInputState("backward", false);
    setMoveInputState("left", false);
    setMoveInputState("right", false);
  }

  function updateJoystickVisual() {
    if (!mobileJoystickKnobEl || !mobileJoystickBaseEl) return;
    const radius = mobileJoystickBaseEl.clientWidth * 0.5;
    const travel = Math.max(
      0,
      radius - mobileJoystickKnobEl.clientWidth * 0.5 - 4,
    );
    mobileJoystickKnobEl.style.transform = `translate(calc(-50% + ${joystickCurrentX * travel}px), calc(-50% + ${joystickCurrentY * travel}px))`;
  }

  function applyMovementFromJoystick(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < joystickDeadzone) {
      resetMoveDirectionalInput();
      return;
    }

    setMoveInputState("forward", y < -joystickDeadzone * 0.75);
    setMoveInputState("backward", y > joystickDeadzone * 0.75);
    setMoveInputState("left", x < -joystickDeadzone * 0.75);
    setMoveInputState("right", x > joystickDeadzone * 0.75);
  }

  function resetJoystickState() {
    joystickCurrentX = 0;
    joystickCurrentY = 0;
    updateJoystickVisual();
    resetMoveDirectionalInput();
  }

  function resetInputState() {
    input.forward = false;
    input.backward = false;
    input.left = false;
    input.right = false;
    input.sprint = false;
    input.yaw = yaw;
    input.pitch = pitch;
    inputDirty = true;
    resetJoystickState();
  }

  function setYaw(nextYaw) {
    if (!Number.isFinite(nextYaw)) return;
    yaw = nextYaw;
    input.yaw = yaw;
    input.pitch = pitch;
    inputDirty = true;
  }

  function bindHoldButton(el, onStart, onStop) {
    if (!el) return;

    const stop = (event) => {
      if (
        event &&
        event.pointerId != null &&
        el.hasPointerCapture?.(event.pointerId)
      ) {
        el.releasePointerCapture(event.pointerId);
      }
      onStop();
    };

    el.addEventListener("pointerdown", (event) => {
      if (!isTouchDevice) return;
      event.preventDefault();
      el.setPointerCapture?.(event.pointerId);
      onStart();
    });
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("lostpointercapture", onStop);
  }

  function bindMobileControls() {
    if (!isTouchDevice) return;
    updateJoystickVisual();

    bindHoldButton(
      mobileSprintBtnEl,
      () => setMoveInputState("sprint", true),
      () => setMoveInputState("sprint", false),
    );

    if (mobileAttackBtnEl) {
      mobileAttackBtnEl.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (!canUseMovementInput()) return;
        if (getSessionState() !== "alive") return;
        getSocket()?.sendJson({ type: "attack" });
      });
    }

    if (mobileJoystickBaseEl) {
      const refreshJoystickBounds = () => {
        const rect = mobileJoystickBaseEl.getBoundingClientRect();
        joystickCenterX = rect.left + rect.width * 0.5;
        joystickCenterY = rect.top + rect.height * 0.5;
        joystickMaxRadius = Math.max(1, rect.width * 0.5);
      };

      const updateFromPointer = (event) => {
        const dx = (event.clientX - joystickCenterX) / joystickMaxRadius;
        const dy = (event.clientY - joystickCenterY) / joystickMaxRadius;
        const mag = Math.hypot(dx, dy);
        const scale = mag > 1 ? 1 / mag : 1;
        joystickCurrentX = dx * scale;
        joystickCurrentY = dy * scale;
        updateJoystickVisual();
        applyMovementFromJoystick(joystickCurrentX, joystickCurrentY);
      };

      mobileJoystickBaseEl.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (getGameMenuOpen()) return;
        if (mobileMovePointerId != null) return;
        mobileMovePointerId = event.pointerId;
        refreshJoystickBounds();
        mobileJoystickBaseEl.setPointerCapture?.(event.pointerId);
        updateFromPointer(event);
      });

      mobileJoystickBaseEl.addEventListener("pointermove", (event) => {
        if (event.pointerId !== mobileMovePointerId) return;
        if (!canUseMovementInput()) return;
        event.preventDefault();
        updateFromPointer(event);
        const now = performance.now();
        if (now - lastInputSentAt >= inputSendIntervalMs) sendInput();
      });

      const stopMovePointer = (event) => {
        if (event.pointerId !== mobileMovePointerId) return;
        if (mobileJoystickBaseEl.hasPointerCapture?.(event.pointerId)) {
          mobileJoystickBaseEl.releasePointerCapture(event.pointerId);
        }
        mobileMovePointerId = null;
        resetJoystickState();
      };

      mobileJoystickBaseEl.addEventListener("pointerup", stopMovePointer);
      mobileJoystickBaseEl.addEventListener("pointercancel", stopMovePointer);
      mobileJoystickBaseEl.addEventListener("lostpointercapture", () => {
        mobileMovePointerId = null;
        resetJoystickState();
      });
    }

    if (!mobileLookPadEl) return;
    mobileLookPadEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (getGameMenuOpen()) return;
      if (mobileLookPointerId != null) return;
      mobileLookPointerId = event.pointerId;
      mobileLookLastX = event.clientX;
      mobileLookLastY = event.clientY;
      mobileLookPadEl.setPointerCapture?.(event.pointerId);
    });

    mobileLookPadEl.addEventListener("pointermove", (event) => {
      if (event.pointerId !== mobileLookPointerId) return;
      if (!canUseMovementInput()) return;

      event.preventDefault();
      const dx = event.clientX - mobileLookLastX;
      const dy = event.clientY - mobileLookLastY;
      mobileLookLastX = event.clientX;
      mobileLookLastY = event.clientY;

      const sensitivity = Math.max(
        0.1,
        Number(getLookSensitivityMultiplier?.() ?? 1),
      );
      yaw -= dx * lookTouchSensitivityX * sensitivity;
      pitch = clampPitch(pitch - dy * lookTouchSensitivityY * sensitivity);
      input.yaw = yaw;
      input.pitch = pitch;
      inputDirty = true;
      const now = performance.now();
      if (now - lastInputSentAt >= inputSendIntervalMs) sendInput();
    });

    const clearLookPointer = (event) => {
      if (event.pointerId !== mobileLookPointerId) return;
      if (mobileLookPadEl.hasPointerCapture?.(event.pointerId)) {
        mobileLookPadEl.releasePointerCapture(event.pointerId);
      }
      mobileLookPointerId = null;
    };

    mobileLookPadEl.addEventListener("pointerup", clearLookPointer);
    mobileLookPadEl.addEventListener("pointercancel", clearLookPointer);
    mobileLookPadEl.addEventListener("lostpointercapture", () => {
      mobileLookPointerId = null;
    });
  }

  function handleKeyDown(event) {
    if (!canUseMovementInput()) return;
    let changed = false;
    if (event.code === "KeyW" && !input.forward) {
      input.forward = true;
      changed = true;
    }
    if (event.code === "KeyS" && !input.backward) {
      input.backward = true;
      changed = true;
    }
    if (event.code === "KeyA" && !input.left) {
      input.left = true;
      changed = true;
    }
    if (event.code === "KeyD" && !input.right) {
      input.right = true;
      changed = true;
    }
    if (
      (event.code === "ShiftLeft" || event.code === "ShiftRight") &&
      !input.sprint
    ) {
      input.sprint = true;
      changed = true;
    }
    if (changed) inputDirty = true;
  }

  function handleKeyUp(event) {
    if (!canUseMovementInput()) return;
    let changed = false;
    if (event.code === "KeyW" && input.forward) {
      input.forward = false;
      changed = true;
    }
    if (event.code === "KeyS" && input.backward) {
      input.backward = false;
      changed = true;
    }
    if (event.code === "KeyA" && input.left) {
      input.left = false;
      changed = true;
    }
    if (event.code === "KeyD" && input.right) {
      input.right = false;
      changed = true;
    }
    if (
      (event.code === "ShiftLeft" || event.code === "ShiftRight") &&
      input.sprint
    ) {
      input.sprint = false;
      changed = true;
    }
    if (changed) inputDirty = true;
  }

  function handleCanvasClick() {
    if (getAppMode() !== "playing") return;
    const state = getSessionState();
    if (state !== "alive" && state !== "won") return;
    if (getGameMenuOpen()) return;
    if (getGameChatOpen()) return;
    if (!document.pointerLockElement) requestPointerLock(canvas);
  }

  function handleMouseMove(event) {
    if (!canUseMovementInput()) return;
    if (document.pointerLockElement !== canvas) return;
    const sensitivity = Math.max(
      0.1,
      Number(getLookSensitivityMultiplier?.() ?? 1),
    );
    yaw -= event.movementX * 0.0022 * sensitivity;
    pitch = clampPitch(pitch - event.movementY * 0.002 * sensitivity);
    input.yaw = yaw;
    input.pitch = pitch;
    inputDirty = true;
    const now = performance.now();
    if (now - lastInputSentAt >= inputSendIntervalMs) sendInput();
  }

  function handleMouseDown(event) {
    if (event.button !== 0) return;
    if (getAppMode() !== "playing" || getSessionState() !== "alive") return;
    if (getGameMenuOpen()) return;
    if (getGameChatOpen() || isGameChatFocused()) return;
    if (document.pointerLockElement !== canvas) return;
    getSocket()?.sendJson({ type: "attack" });
  }

  function bind() {
    bindMobileControls();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("click", handleCanvasClick);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    setInterval(sendInput, inputSendIntervalMs);
  }

  function getYaw() {
    return yaw;
  }

  function getPitch() {
    return pitch;
  }

  return {
    bind,
    resetInputState,
    resetJoystickState,
    sendInput,
    setYaw,
    getYaw,
    getPitch,
  };
}

/**
 * Camera movement logic for spectator and downed states.
 *
 * createCameraController({ camera, avatarSystem, constants })
 *   → { updateSpectatorCamera, updateDownedCamera }
 */

/**
 * @param {{
 *   camera: THREE.Camera,
 *   avatarSystem: object,
 *   constants: {
 *     SPECTATOR_CAMERA_DISTANCE: number,
 *     SPECTATOR_CAMERA_HEIGHT_OFFSET: number,
 *     SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET: number,
 *     SPECTATOR_CAMERA_POS_SMOOTH_RATE: number,
 *     DOWNED_CAMERA_HEIGHT: number,
 *     DOWNED_CAMERA_POS_SMOOTH_RATE: number,
 *   }
 * }} opts
 */
export function createCameraController({ camera, avatarSystem, constants }) {
  const {
    SPECTATOR_CAMERA_DISTANCE,
    SPECTATOR_CAMERA_HEIGHT_OFFSET,
    SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET,
    SPECTATOR_CAMERA_POS_SMOOTH_RATE,
    DOWNED_CAMERA_HEIGHT,
    DOWNED_CAMERA_POS_SMOOTH_RATE,
  } = constants;

  /**
   * Smoothly move the camera to follow the spectated character.
   * Handles both the regular spectator orbit and the "downed-looking-at-killer"
   * overhead view.
   *
   * @param {number} deltaSec
   * @param {{
   *   sessionState: string,
   *   spectatorTargetCharacterId: number|null,
   *   spectatorTargetName: string,
   *   downedByName: string,
   *   myName: string,
   * }} state
   */
  function updateSpectatorCamera(deltaSec, state) {
    if (state.sessionState !== "spectating") return;
    const target = avatarSystem.getCharacterCameraState(
      state.spectatorTargetCharacterId,
    );
    if (!target) return;

    if (
      state.downedByName &&
      state.spectatorTargetName &&
      state.spectatorTargetName === state.myName
    ) {
      const posSmooth = 1 - Math.exp(-deltaSec * DOWNED_CAMERA_POS_SMOOTH_RATE);
      camera.position.x += (target.x - camera.position.x) * posSmooth;
      camera.position.z += (target.z - camera.position.z) * posSmooth;
      camera.position.y +=
        (DOWNED_CAMERA_HEIGHT - camera.position.y) * posSmooth;
      camera.rotation.set(-Math.PI / 2 + 0.0001, 0, 0);
      return;
    }

    const desiredX =
      target.x - Math.sin(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
    const desiredZ =
      target.z - Math.cos(target.yaw) * SPECTATOR_CAMERA_DISTANCE;
    const desiredY = target.eyeHeight + SPECTATOR_CAMERA_HEIGHT_OFFSET;
    const posSmooth =
      1 - Math.exp(-deltaSec * SPECTATOR_CAMERA_POS_SMOOTH_RATE);
    camera.position.x += (desiredX - camera.position.x) * posSmooth;
    camera.position.z += (desiredZ - camera.position.z) * posSmooth;
    camera.position.y += (desiredY - camera.position.y) * posSmooth;

    camera.lookAt(
      target.x,
      target.eyeHeight + SPECTATOR_CAMERA_TARGET_HEIGHT_OFFSET,
      target.z,
    );
  }

  /**
   * Smoothly move the camera to the downed character's corpse position and
   * point it straight down.
   *
   * @param {number} deltaSec
   * @param {{ myCharacterId: number|null }} state
   */
  function updateDownedCamera(deltaSec, state) {
    const corpsePos = avatarSystem.getCharacterPosition(state.myCharacterId);
    if (!corpsePos) return;
    const posSmooth = 1 - Math.exp(-deltaSec * DOWNED_CAMERA_POS_SMOOTH_RATE);
    camera.position.x += (corpsePos.x - camera.position.x) * posSmooth;
    camera.position.z += (corpsePos.z - camera.position.z) * posSmooth;
    camera.position.y += (DOWNED_CAMERA_HEIGHT - camera.position.y) * posSmooth;
    camera.rotation.set(-Math.PI / 2 + 0.0001, 0, 0);
  }

  return { updateSpectatorCamera, updateDownedCamera };
}

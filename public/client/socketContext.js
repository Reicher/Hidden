export function createSocketMessageContext({
  state,
  constants,
  roomSystem,
  avatarSystem,
  inputController,
  getNowMs,
  actions,
}) {
  return {
    state,
    constants,
    roomSystem,
    avatarSystem,
    inputController,
    getNowMs,
    actions,
  };
}

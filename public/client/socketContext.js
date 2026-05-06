function createPropertyProxy(bindings) {
  const proxy = {};
  for (const [key, descriptor] of Object.entries(bindings)) {
    Object.defineProperty(proxy, key, {
      enumerable: true,
      configurable: false,
      get: descriptor.get,
      set: descriptor.set
    });
  }
  return proxy;
}

export function createSocketState(bindings) {
  return createPropertyProxy(bindings);
}

export function createSocketMessageContext({
  socketState,
  constants,
  roomSystem,
  avatarSystem,
  inputController,
  getNowMs,
  actions
}) {
  return {
    state: socketState,
    constants,
    roomSystem,
    avatarSystem,
    inputController,
    getNowMs,
    actions
  };
}

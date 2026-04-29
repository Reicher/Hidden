export function createQueueController({ sessions, waitingQueue, sendToSession }) {
  function syncQueuePositions() {
    for (let i = 0; i < waitingQueue.length; i += 1) {
      const sid = waitingQueue[i];
      const session = sessions.get(sid);
      if (session) session.queuePosition = i + 1;
    }
  }

  function removeFromQueue(sessionId) {
    const idx = waitingQueue.indexOf(sessionId);
    if (idx !== -1) {
      waitingQueue.splice(idx, 1);
      syncQueuePositions();
    }
    const session = sessions.get(sessionId);
    if (session) {
      session.inQueue = false;
      session.queuePosition = null;
    }
  }

  function enqueueSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (!session.inQueue) {
      waitingQueue.push(sessionId);
      session.inQueue = true;
      syncQueuePositions();
    }
    session.state = "full";
    sendToSession(sessionId, "full", {
      message: "Spelet är fullt.",
      queuePosition: session.queuePosition
    });
  }

  function dequeueNext() {
    const sessionId = waitingQueue.shift();
    if (!sessionId) return null;
    syncQueuePositions();
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.inQueue = false;
    session.queuePosition = null;
    return sessionId;
  }

  return {
    enqueueSession,
    removeFromQueue,
    dequeueNext,
    syncQueuePositions
  };
}

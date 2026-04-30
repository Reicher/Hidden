import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";

const DEFAULT_SAMPLE_INTERVAL_MS = 15_000;
const SAMPLE_RETENTION = 24 * 60 * 6; // 24h with 15-second sampling.
const RECENT_EVENT_LIMIT = 240;

function safeInt(value, fallback = 0) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.trunc(out);
}

function isoAt(at) {
  return new Date(at).toISOString();
}

function roomLabel(room) {
  if (!room) return "-";
  return room.isPrivate ? `privat:${room.roomCode || room.roomId}` : "publik";
}

function parseJsonLine(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createDebugStatsStore({ rootDir, sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS }) {
  const logsDir = path.resolve(path.join(rootDir, "logs"));
  const eventsLogPath = path.join(logsDir, "debug-events.log");
  const samplesLogPath = path.join(logsDir, "debug-samples.jsonl");

  const state = {
    startedAt: Date.now(),
    totals: {
      totalConnections: 0,
      totalLogins: 0
    },
    current: {
      connected: 0,
      authenticated: 0,
      active: 0,
      countdown: 0,
      lobby: 0,
      roomCountWithSessions: 0
    },
    peaks: {
      connected: 0,
      authenticated: 0,
      active: 0
    },
    rooms: new Map(),
    names: new Map(),
    recentEvents: [],
    samples: []
  };

  let closed = false;
  let writeQueue = Promise.resolve();

  async function loadSamplesFromDisk() {
    let text = "";
    try {
      text = await readFile(samplesLogPath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const retained = lines.slice(-SAMPLE_RETENTION);

    for (const line of retained) {
      const parsed = parseJsonLine(line);
      if (!parsed) continue;
      state.samples.push({
        at: safeInt(parsed.at, Date.now()),
        connected: safeInt(parsed.connected, 0),
        authenticated: safeInt(parsed.authenticated, 0),
        active: safeInt(parsed.active, 0),
        countdown: safeInt(parsed.countdown, 0),
        lobby: safeInt(parsed.lobby, 0),
        roomCountWithSessions: safeInt(parsed.roomCountWithSessions, 0),
        totalLogins: safeInt(parsed.totalLogins, 0),
        uniqueNames: safeInt(parsed.uniqueNames, 0)
      });
    }
  }

  const startupReady = (async () => {
    await mkdir(logsDir, { recursive: true });
    await loadSamplesFromDisk();
    const bootLine = `${isoAt(Date.now())} event=debug_runtime_started room=- connected=0 authenticated=0 active=0\n`;
    await appendFile(eventsLogPath, bootLine, "utf8");
  })().catch((error) => {
    console.warn(`[debug-stats] startup failed: ${error?.message || error}`);
  });

  function queueWrite(task) {
    writeQueue = writeQueue
      .then(async () => {
        await startupReady;
        if (closed) return;
        await task();
      })
      .catch((error) => {
        console.warn(`[debug-stats] write failed: ${error?.message || error}`);
      });
  }

  function ensureRoom({ roomId, roomCode, isPrivate }) {
    const existing = state.rooms.get(roomId);
    if (existing) return existing;
    const created = {
      roomId,
      roomCode: roomCode || null,
      isPrivate: Boolean(isPrivate),
      totalConnections: 0,
      totalLogins: 0,
      uniqueNames: new Set(),
      current: {
        connected: 0,
        authenticated: 0,
        active: 0,
        countdown: 0,
        lobby: 0
      },
      lastEventAt: 0
    };
    state.rooms.set(roomId, created);
    return created;
  }

  function recomputeCurrentTotals() {
    let connected = 0;
    let authenticated = 0;
    let active = 0;
    let countdown = 0;
    let lobby = 0;
    let roomCountWithSessions = 0;

    for (const room of state.rooms.values()) {
      connected += room.current.connected;
      authenticated += room.current.authenticated;
      active += room.current.active;
      countdown += room.current.countdown;
      lobby += room.current.lobby;
      if (room.current.connected > 0) roomCountWithSessions += 1;
    }

    state.current.connected = connected;
    state.current.authenticated = authenticated;
    state.current.active = active;
    state.current.countdown = countdown;
    state.current.lobby = lobby;
    state.current.roomCountWithSessions = roomCountWithSessions;
    state.peaks.connected = Math.max(state.peaks.connected, connected);
    state.peaks.authenticated = Math.max(state.peaks.authenticated, authenticated);
    state.peaks.active = Math.max(state.peaks.active, active);
  }

  function pushRecentEvent(eventRecord) {
    state.recentEvents.push(eventRecord);
    if (state.recentEvents.length > RECENT_EVENT_LIMIT) {
      state.recentEvents.splice(0, state.recentEvents.length - RECENT_EVENT_LIMIT);
    }
  }

  function appendEventLog(eventRecord) {
    const line = [
      isoAt(eventRecord.at),
      `event=${eventRecord.type}`,
      `room=${roomLabel(eventRecord)}`,
      `name=${eventRecord.name ? JSON.stringify(eventRecord.name) : "-"}`,
      `connected=${eventRecord.snapshot.connected}`,
      `authenticated=${eventRecord.snapshot.authenticated}`,
      `active=${eventRecord.snapshot.active}`
    ].join(" ");
    queueWrite(() => appendFile(eventsLogPath, `${line}\n`, "utf8"));
  }

  function pushSample(sample) {
    state.samples.push(sample);
    if (state.samples.length > SAMPLE_RETENTION) {
      state.samples.splice(0, state.samples.length - SAMPLE_RETENTION);
    }
    queueWrite(() => appendFile(samplesLogPath, `${JSON.stringify(sample)}\n`, "utf8"));
  }

  function captureSample(reason = "interval", at = Date.now()) {
    recomputeCurrentTotals();
    const sample = {
      at,
      reason,
      connected: state.current.connected,
      authenticated: state.current.authenticated,
      active: state.current.active,
      countdown: state.current.countdown,
      lobby: state.current.lobby,
      roomCountWithSessions: state.current.roomCountWithSessions,
      totalLogins: state.totals.totalLogins,
      uniqueNames: state.names.size
    };
    pushSample(sample);
    return sample;
  }

  const sampleTimer = setInterval(() => {
    captureSample("interval");
  }, sampleIntervalMs);
  sampleTimer.unref?.();

  captureSample("startup");

  function recordRoomEvent({
    type,
    roomId,
    roomCode = null,
    isPrivate = false,
    name = null,
    sessionId = null,
    snapshot = null,
    at = Date.now()
  }) {
    if (closed) return;
    if (!roomId || !type) return;
    const eventAt = safeInt(at, Date.now());
    const room = ensureRoom({ roomId, roomCode, isPrivate });
    room.lastEventAt = eventAt;

    if (type === "session_connected") {
      room.totalConnections += 1;
      state.totals.totalConnections += 1;
    }

    if (type === "session_login" && typeof name === "string" && name.trim()) {
      const normalizedName = name.trim();
      room.totalLogins += 1;
      room.uniqueNames.add(normalizedName);
      state.totals.totalLogins += 1;
      const existingName = state.names.get(normalizedName) || {
        logins: 0,
        lastSeenAt: 0,
        rooms: new Set()
      };
      existingName.logins += 1;
      existingName.lastSeenAt = eventAt;
      existingName.rooms.add(room.roomId);
      state.names.set(normalizedName, existingName);
    }

    if (snapshot && typeof snapshot === "object") {
      room.current.connected = Math.max(0, safeInt(snapshot.connected, room.current.connected));
      room.current.authenticated = Math.max(0, safeInt(snapshot.authenticated, room.current.authenticated));
      room.current.active = Math.max(0, safeInt(snapshot.active, room.current.active));
      room.current.countdown = Math.max(0, safeInt(snapshot.countdown, room.current.countdown));
      room.current.lobby = Math.max(0, safeInt(snapshot.lobby, room.current.lobby));
    }

    recomputeCurrentTotals();

    const eventRecord = {
      at: eventAt,
      type,
      roomId: room.roomId,
      roomCode: room.roomCode,
      isPrivate: room.isPrivate,
      name: typeof name === "string" ? name : null,
      sessionId: sessionId || null,
      snapshot: { ...room.current }
    };
    pushRecentEvent(eventRecord);
    appendEventLog(eventRecord);
  }

  function getSnapshot() {
    recomputeCurrentTotals();
    const rooms = [...state.rooms.values()]
      .map((room) => ({
        roomId: room.roomId,
        roomCode: room.roomCode,
        isPrivate: room.isPrivate,
        totalConnections: room.totalConnections,
        totalLogins: room.totalLogins,
        uniqueNamesCount: room.uniqueNames.size,
        uniqueNames: [...room.uniqueNames].sort((a, b) => a.localeCompare(b, "sv")),
        current: { ...room.current },
        lastEventAt: room.lastEventAt
      }))
      .sort((a, b) => {
        if (b.current.connected !== a.current.connected) return b.current.connected - a.current.connected;
        return String(a.roomId).localeCompare(String(b.roomId), "sv");
      });

    const players = [...state.names.entries()]
      .map(([name, value]) => ({
        name,
        logins: value.logins,
        lastSeenAt: value.lastSeenAt,
        rooms: [...value.rooms].sort((a, b) => a.localeCompare(b, "sv"))
      }))
      .sort((a, b) => {
        if (b.lastSeenAt !== a.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
        if (b.logins !== a.logins) return b.logins - a.logins;
        return a.name.localeCompare(b.name, "sv");
      });

    return {
      generatedAt: Date.now(),
      startedAt: state.startedAt,
      totals: { ...state.totals, uniqueNames: state.names.size },
      current: { ...state.current },
      peaks: { ...state.peaks },
      rooms,
      players,
      recentEvents: [...state.recentEvents],
      samples: [...state.samples]
    };
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(sampleTimer);
    await writeQueue;
  }

  return {
    recordRoomEvent,
    getSnapshot,
    close,
    logs: {
      logsDir,
      eventsLogPath,
      samplesLogPath
    }
  };
}

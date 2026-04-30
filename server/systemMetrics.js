import os from "node:os";
import { readFile } from "node:fs/promises";

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseProcStatCpuLine(text) {
  const line = text
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith("cpu "));
  if (!line) return null;
  const parts = line.split(/\s+/).slice(1).map((value) => Number(value));
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

async function readSystemCpuSnapshot() {
  try {
    const text = await readFile("/proc/stat", "utf8");
    return parseProcStatCpuLine(text);
  } catch {
    return null;
  }
}

async function readCpuTempCelsius() {
  try {
    const raw = await readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const value = Number(String(raw).trim());
    if (!Number.isFinite(value)) return null;
    // Linux thermal zone often reports millidegrees Celsius.
    return value > 1000 ? value / 1000 : value;
  } catch {
    return null;
  }
}

export function createSystemMetricsCollector() {
  let previousProcessCpu = process.cpuUsage();
  let previousProcessHr = process.hrtime.bigint();
  let previousSystemCpu = null;

  async function collect() {
    const now = Date.now();
    const cpuCount = Math.max(1, os.cpus()?.length || 1);

    const nowProcessCpu = process.cpuUsage();
    const nowProcessHr = process.hrtime.bigint();
    const elapsedMicros = Number(nowProcessHr - previousProcessHr) / 1000;
    const processDeltaMicros =
      nowProcessCpu.user - previousProcessCpu.user + (nowProcessCpu.system - previousProcessCpu.system);
    previousProcessCpu = nowProcessCpu;
    previousProcessHr = nowProcessHr;

    const processCpuPercentSingleCore = elapsedMicros > 0 ? (processDeltaMicros / elapsedMicros) * 100 : 0;
    const processCpuPercentHostShare = processCpuPercentSingleCore / cpuCount;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const memUsagePercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

    const processMem = process.memoryUsage();

    const currentSystemCpu = await readSystemCpuSnapshot();
    let systemCpuPercent = null;
    if (currentSystemCpu && previousSystemCpu) {
      const totalDelta = currentSystemCpu.total - previousSystemCpu.total;
      const idleDelta = currentSystemCpu.idle - previousSystemCpu.idle;
      if (totalDelta > 0) {
        systemCpuPercent = ((totalDelta - idleDelta) / totalDelta) * 100;
      }
    }
    if (currentSystemCpu) previousSystemCpu = currentSystemCpu;

    const loadAvg = os.loadavg();
    const cpuTempCelsiusRaw = await readCpuTempCelsius();

    return {
      capturedAt: now,
      host: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSec: Math.trunc(os.uptime()),
        cpuCores: cpuCount,
        cpuLoadPercent:
          systemCpuPercent == null || !Number.isFinite(systemCpuPercent) ? null : round(systemCpuPercent, 1),
        cpuTempCelsius: cpuTempCelsiusRaw == null || !Number.isFinite(cpuTempCelsiusRaw) ? null : round(cpuTempCelsiusRaw, 1),
        loadAverage1m: round(loadAvg[0] || 0, 2),
        loadAverage5m: round(loadAvg[1] || 0, 2),
        loadAverage15m: round(loadAvg[2] || 0, 2),
        totalMemoryBytes: totalMem,
        freeMemoryBytes: freeMem,
        usedMemoryBytes: usedMem,
        memoryUsagePercent: round(memUsagePercent, 1)
      },
      process: {
        pid: process.pid,
        uptimeSec: Math.trunc(process.uptime()),
        cpuPercentSingleCore: round(processCpuPercentSingleCore, 1),
        cpuPercentHostShare: round(processCpuPercentHostShare, 2),
        rssBytes: processMem.rss,
        heapUsedBytes: processMem.heapUsed,
        heapTotalBytes: processMem.heapTotal,
        externalBytes: processMem.external
      }
    };
  }

  return {
    collect
  };
}

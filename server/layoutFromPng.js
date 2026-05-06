import fs from "node:fs";
import { basename } from "node:path";
import { PNG } from "pngjs";

const EMPTY_RGB = [255, 255, 255];
const SHELF_COLORS = Object.freeze([
  [0, 0, 0]
]);
const COOLER_COLORS = Object.freeze([
  [0, 102, 255],
  [0, 0, 255],
  [0, 128, 255]
]);
const FREEZER_COLORS = Object.freeze([
  [0, 200, 120],
  [0, 255, 0],
  [0, 180, 0]
]);
const COLOR_TOLERANCE = 12;

const DIRS = Object.freeze([
  { dx: 0, dy: -1, yaw: 0 }, // +Z
  { dx: 1, dy: 0, yaw: Math.PI / 2 }, // +X
  { dx: 0, dy: 1, yaw: Math.PI }, // -Z
  { dx: -1, dy: 0, yaw: -Math.PI / 2 } // -X
]);

function keyFor(x, y) {
  return `${x},${y}`;
}

function toWorldX(px, width) {
  return px - (width / 2 - 0.5);
}

function toWorldZ(py, height) {
  return height / 2 - 0.5 - py;
}

function rgbAt(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

function isInside(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function channelClose(a, b) {
  return Math.abs(a - b) <= COLOR_TOLERANCE;
}

function matchesColor(rgb, paletteColor) {
  return channelClose(rgb[0], paletteColor[0]) && channelClose(rgb[1], paletteColor[1]) && channelClose(rgb[2], paletteColor[2]);
}

function matchesAny(rgb, palette) {
  for (const c of palette) {
    if (matchesColor(rgb, c)) return true;
  }
  return false;
}

function classifyPixel(pixel) {
  const [r, g, b, a] = pixel;
  if (a < 128) return "empty";
  const rgb = [r, g, b];
  if (matchesAny(rgb, SHELF_COLORS)) return "shelf";
  if (matchesAny(rgb, COOLER_COLORS)) return "cooler";
  if (matchesAny(rgb, FREEZER_COLORS)) return "freezer";
  if (matchesColor(rgb, EMPTY_RGB)) return "empty";
  return "unknown";
}

function findOpenYaw({ x, y, occupied, width, height }) {
  for (const dir of DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!isInside(nx, ny, width, height)) continue;
    if (occupied[ny][nx]) continue;
    return dir.yaw;
  }
  return null;
}

function collectShelfComponents(shelfCells, width, height) {
  const remaining = new Set(shelfCells);
  const components = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    remaining.delete(start);
    const queue = [start];
    const component = [];
    while (queue.length > 0) {
      const key = queue.pop();
      const [x, y] = key.split(",").map(Number);
      component.push([x, y]);
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (!isInside(nx, ny, width, height)) continue;
        const neighborKey = keyFor(nx, ny);
        if (!remaining.has(neighborKey)) continue;
        remaining.delete(neighborKey);
        queue.push(neighborKey);
      }
    }
    components.push(component);
  }
  return components;
}

function buildShelfSegments(shelfCells, width, height) {
  const components = collectShelfComponents(shelfCells, width, height);
  const segments = [];
  const fallbackCells = [];

  for (const component of components) {
    const xs = component.map((c) => c[0]);
    const ys = component.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;

    if (spanY === 1 && component.length === spanX) {
      const cells = [...component].sort((a, b) => a[0] - b[0]);
      segments.push({ cells, axis: "h" });
      continue;
    }
    if (spanX === 1 && component.length === spanY) {
      const cells = [...component].sort((a, b) => a[1] - b[1]);
      segments.push({ cells, axis: "v" });
      continue;
    }
    if (spanY === 2 && component.length === spanX * spanY) {
      const topY = minY;
      const bottomY = maxY;
      const topCells = [];
      const bottomCells = [];
      for (let x = minX; x <= maxX; x += 1) {
        topCells.push([x, topY]);
        bottomCells.push([x, bottomY]);
      }
      segments.push({ cells: topCells, axis: "h", forcedBack: { dx: 0, dy: 1 } });
      segments.push({ cells: bottomCells, axis: "h", forcedBack: { dx: 0, dy: -1 } });
      continue;
    }
    if (spanX === 2 && component.length === spanX * spanY) {
      const leftX = minX;
      const rightX = maxX;
      const leftCells = [];
      const rightCells = [];
      for (let y = minY; y <= maxY; y += 1) {
        leftCells.push([leftX, y]);
        rightCells.push([rightX, y]);
      }
      segments.push({ cells: leftCells, axis: "v", forcedBack: { dx: 1, dy: 0 } });
      segments.push({ cells: rightCells, axis: "v", forcedBack: { dx: -1, dy: 0 } });
      continue;
    }
    fallbackCells.push(...component);
  }

  for (const cell of fallbackCells) {
    segments.push({ cells: [cell], axis: "single" });
  }

  return { segments, fallbackCells };
}

function orientationCandidatesForAxis(axis) {
  if (axis === "h") {
    return [
      { yaw: Math.PI / 2, back: { dx: 0, dy: 1 }, front: { dx: 0, dy: -1 } },
      { yaw: -Math.PI / 2, back: { dx: 0, dy: -1 }, front: { dx: 0, dy: 1 } }
    ];
  }
  if (axis === "v") {
    return [
      { yaw: 0, back: { dx: 1, dy: 0 }, front: { dx: -1, dy: 0 } },
      { yaw: Math.PI, back: { dx: -1, dy: 0 }, front: { dx: 1, dy: 0 } }
    ];
  }
  return [
    { yaw: 0, back: { dx: 1, dy: 0 }, front: { dx: -1, dy: 0 } },
    { yaw: Math.PI / 2, back: { dx: 0, dy: 1 }, front: { dx: 0, dy: -1 } },
    { yaw: Math.PI, back: { dx: -1, dy: 0 }, front: { dx: 1, dy: 0 } },
    { yaw: -Math.PI / 2, back: { dx: 0, dy: -1 }, front: { dx: 0, dy: 1 } }
  ];
}

function isFrontFree(cellTypeGrid, width, height, x, y) {
  return isInside(x, y, width, height) && cellTypeGrid[y][x] === "empty";
}

function isBackSupported(cellTypeGrid, width, height, x, y) {
  if (!isInside(x, y, width, height)) return true; // world boundary wall
  return cellTypeGrid[y][x] !== "empty";
}

function chooseShelfOrientation(segment, cellTypeGrid, width, height) {
  let candidates = orientationCandidatesForAxis(segment.axis);
  if (segment.forcedBack) {
    candidates = candidates.filter(
      (candidate) => candidate.back.dx === segment.forcedBack.dx && candidate.back.dy === segment.forcedBack.dy
    );
  }
  candidates = candidates.map((candidate) => {
    let frontFreeCount = 0;
    let backSupportCount = 0;
    for (const [x, y] of segment.cells) {
      const fx = x + candidate.front.dx;
      const fy = y + candidate.front.dy;
      const bx = x + candidate.back.dx;
      const by = y + candidate.back.dy;
      if (isFrontFree(cellTypeGrid, width, height, fx, fy)) frontFreeCount += 1;
      if (isBackSupported(cellTypeGrid, width, height, bx, by)) backSupportCount += 1;
    }
    const len = segment.cells.length;
    return {
      ...candidate,
      len,
      frontFreeCount,
      backSupportCount,
      frontFullyFree: frontFreeCount === len,
      backFullySupported: backSupportCount === len
    };
  });

  const fullyValid = candidates.find((c) => c.frontFullyFree && c.backFullySupported);
  if (fullyValid) return fullyValid;

  const frontOnly = candidates
    .filter((c) => c.frontFullyFree)
    .sort((a, b) => b.backSupportCount - a.backSupportCount)[0];
  if (frontOnly) return frontOnly;

  const bestEffort = [...candidates].sort((a, b) => {
    if (b.frontFreeCount !== a.frontFreeCount) return b.frontFreeCount - a.frontFreeCount;
    return b.backSupportCount - a.backSupportCount;
  })[0];
  return bestEffort || candidates[0];
}

function buildShelvesFromPixels({ shelfCells, width, height, shelfWidth, shelfHeight, layoutName, cellTypeGrid }) {
  const { segments, fallbackCells } = buildShelfSegments(shelfCells, width, height);
  const shelves = [];
  const warnings = [];
  const frontBlockedExamples = [];

  for (const segment of segments) {
    const orientation = chooseShelfOrientation(segment, cellTypeGrid, width, height);
    const xs = segment.cells.map((c) => c[0]);
    const ys = segment.cells.map((c) => c[1]);
    const centerX = (Math.min(...xs) + Math.max(...xs)) * 0.5;
    const centerY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
    const lengthMeters = segment.cells.length * shelfWidth;
    shelves.push(
      Object.freeze({
        x: toWorldX(centerX, width),
        z: toWorldZ(centerY, height),
        width: shelfWidth,
        depth: lengthMeters,
        height: shelfHeight,
        yaw: orientation.yaw
      })
    );

    if (!orientation.frontFullyFree) {
      const first = segment.cells[0];
      if (frontBlockedExamples.length < 8) {
        frontBlockedExamples.push(`(${first[0]},${first[1]}) fri-fram ${orientation.frontFreeCount}/${orientation.len}`);
      }
    }
  }

  if (fallbackCells.length > 0) {
    const examples = fallbackCells.slice(0, 8).map(([x, y]) => `(${x},${y})`).join(", ");
    warnings.push(
      Object.freeze({
        code: "shelf_shape_fallback",
        severity: "warning",
        message:
          `[layout] ${layoutName}: vissa hyllpixlar var inte raka 1-cell-tjocka segment. ` +
          "Dessa har brutits ner till 1x1-hyllor.",
        details: `Exempel: ${examples}`
      })
    );
  }

  if (frontBlockedExamples.length > 0) {
    warnings.push(
      Object.freeze({
        code: "shelf_front_blocked",
        severity: "warning",
        message:
          `[layout] ${layoutName}: minst en hylla saknar fri yta framför långsidan. ` +
          "Justerad orientering användes, men kravet kunde inte uppfyllas fullt ut.",
        details: `Exempel: ${frontBlockedExamples.join(", ")}`
      })
    );
  }

  return {
    shelves: Object.freeze(shelves),
    warnings: Object.freeze(warnings)
  };
}

export function loadLayoutFromPng({
  filePath,
  shelfWidth = 1,
  shelfHeight = 2,
  coolerWidth = 1,
  coolerDepth = 1,
  coolerHeight = 2,
  freezerWidth = 1,
  freezerDepth = 1,
  freezerHeight = 1
}) {
  const buffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const layoutName = basename(filePath || "layout.png");

  const occupied = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  const cellTypeGrid = Array.from({ length: height }, () => Array.from({ length: width }, () => "empty"));
  const shelfCells = new Set();
  const coolerCells = [];
  const freezerCells = [];
  const unknownPixels = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = rgbAt(data, width, x, y);
      const type = classifyPixel(pixel);
      if (type === "shelf") {
        shelfCells.add(keyFor(x, y));
        occupied[y][x] = true;
        cellTypeGrid[y][x] = "shelf";
        continue;
      }
      if (type === "cooler") {
        coolerCells.push([x, y]);
        occupied[y][x] = true;
        cellTypeGrid[y][x] = "cooler";
        continue;
      }
      if (type === "freezer") {
        freezerCells.push([x, y]);
        occupied[y][x] = true;
        cellTypeGrid[y][x] = "freezer";
        continue;
      }
      if (type === "unknown") {
        unknownPixels.push({ x, y, rgb: [pixel[0], pixel[1], pixel[2]] });
      }
    }
  }

  if (unknownPixels.length > 0) {
    const examples = unknownPixels
      .slice(0, 8)
      .map((p) => `(${p.x},${p.y}) rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`)
      .join(", ");
    throw new Error(
      `[layout] Okända färger i ${layoutName} (${unknownPixels.length} px). Exempel: ${examples}`
    );
  }

  const shelfResult = buildShelvesFromPixels({
    shelfCells,
    width,
    height,
    shelfWidth,
    shelfHeight,
    layoutName,
    cellTypeGrid
  });
  const shelves = shelfResult.shelves;
  const warnings = [...shelfResult.warnings];

  const coolers = Object.freeze(
    coolerCells.map(([x, y]) => {
      const yaw = findOpenYaw({ x, y, occupied, width, height }) ?? 0;
      return Object.freeze({
        x: toWorldX(x, width),
        z: toWorldZ(y, height),
        width: coolerWidth,
        depth: coolerDepth,
        height: coolerHeight,
        yaw
      });
    })
  );

  const freezers = Object.freeze(
    freezerCells.map(([x, y]) =>
      Object.freeze({
        x: toWorldX(x, width),
        z: toWorldZ(y, height),
        width: freezerWidth,
        depth: freezerDepth,
        height: freezerHeight,
        yaw: 0
      })
    )
  );

  return Object.freeze({
    worldSizeMeters: Math.max(width, height),
    worldWidthMeters: width,
    worldHeightMeters: height,
    warnings: Object.freeze(warnings),
    shelves,
    coolers,
    freezers
  });
}

import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const SIZE = 50;
const COLORS = Object.freeze({
  empty: [0, 0, 0, 0],
  shelf: [0, 0, 0, 255],
  cooler: [0, 102, 255, 255],
  freezer: [0, 200, 120, 255]
});

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(HERE, "../public/assets/layout-50.png");

function setPixel(png, x, y, rgba) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  png.data[idx] = rgba[0];
  png.data[idx + 1] = rgba[1];
  png.data[idx + 2] = rgba[2];
  png.data[idx + 3] = rgba[3];
}

function drawShelfHorizontal(png, x0, y) {
  for (let dx = 0; dx < 6; dx += 1) setPixel(png, x0 + dx, y, COLORS.shelf);
}

function drawShelfVertical(png, x, y0) {
  for (let dy = 0; dy < 6; dy += 1) setPixel(png, x, y0 + dy, COLORS.shelf);
}

function main() {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) setPixel(png, x, y, COLORS.empty);
  }

  drawShelfHorizontal(png, 8, 10);
  drawShelfHorizontal(png, 8, 14);
  drawShelfHorizontal(png, 18, 26);
  drawShelfVertical(png, 31, 30);
  drawShelfVertical(png, 35, 30);

  for (const [x, y] of [
    [4, 4],
    [45, 4],
    [4, 45],
    [45, 45],
    [24, 8]
  ]) {
    setPixel(png, x, y, COLORS.cooler);
  }

  for (const [x, y] of [
    [24, 24],
    [40, 20],
    [10, 40],
    [28, 34],
    [42, 42]
  ]) {
    setPixel(png, x, y, COLORS.freezer);
  }

  fs.mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, PNG.sync.write(png));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log("Legend: shelf=black, cooler=blue, freezer=green, empty=transparent");
}

main();

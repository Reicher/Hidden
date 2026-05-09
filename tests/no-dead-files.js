import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const untrackedFiles = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const workspaceFiles = [...new Set([...trackedFiles, ...untrackedFiles])];

const sourceExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".txt"
]);

function extname(filePath) {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}

function basename(filePath) {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function hasTemporaryName(filePath) {
  const name = basename(filePath);
  return (
    name === ".DS_Store" ||
    name.startsWith(".tmp") ||
    name.endsWith(".tmp") ||
    name.endsWith(".bak")
  );
}

const errors = [];

for (const filePath of trackedFiles) {
  if (hasTemporaryName(filePath)) {
    errors.push(`Temporary/generated file is tracked: ${filePath}`);
  }
}

const searchableFiles = workspaceFiles.filter((filePath) =>
  sourceExtensions.has(extname(filePath))
);
const searchableText = searchableFiles
  .map((filePath) => readFileSync(filePath, "utf8"))
  .join("\n");

for (const assetPath of trackedFiles) {
  if (!assetPath.startsWith("public/assets/")) continue;
  if (assetPath.endsWith("/.gitkeep")) continue;

  const name = basename(assetPath);
  const publicUrl = `/${assetPath.replace(/^public\//, "")}`;
  const referenced =
    searchableText.includes(publicUrl) || searchableText.includes(name);

  if (!referenced) {
    errors.push(`Public asset appears unreferenced: ${assetPath}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Dead file check passed.");

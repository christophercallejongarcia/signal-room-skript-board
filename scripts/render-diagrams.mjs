import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(root, "docs", "diagrams", "sources");
const outputDirectory = join(root, "docs", "diagrams", "rendered");
const configFile = join(root, "docs", "diagrams", "mermaid-config.json");

const browserCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : null,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
].filter(Boolean);

const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
const puppeteerConfigFile = browserPath ? join(tmpdir(), "signal-room-puppeteer.json") : null;

if (puppeteerConfigFile) {
  writeFileSync(puppeteerConfigFile, JSON.stringify({ executablePath: browserPath, args: ["--no-sandbox"] }));
}

mkdirSync(outputDirectory, { recursive: true });

const sources = readdirSync(sourceDirectory)
  .filter((file) => extname(file) === ".mmd")
  .sort();

for (const source of sources) {
  const output = join(outputDirectory, source.replace(/\.mmd$/, ".png"));
  const argumentsList = [
      "--yes",
      "@mermaid-js/mermaid-cli@11.16.0",
      "--input",
      join(sourceDirectory, source),
      "--output",
      output,
      "--configFile",
      configFile,
      "--backgroundColor",
      "#f7f9f6",
      "--width",
      "1600",
      "--scale",
      "1.5",
      "--quiet",
    ];

  if (puppeteerConfigFile) {
    argumentsList.push("--puppeteerConfigFile", puppeteerConfigFile);
  }

  execFileSync(
    "npx",
    argumentsList,
    { cwd: root, stdio: "inherit" },
  );
}

if (puppeteerConfigFile && existsSync(puppeteerConfigFile)) {
  unlinkSync(puppeteerConfigFile);
}

console.log(`Rendered ${sources.length} diagrams to ${outputDirectory}`);

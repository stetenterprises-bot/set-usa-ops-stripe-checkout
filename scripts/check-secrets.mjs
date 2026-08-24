import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const projectRoot = process.cwd();
const excludedDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const scannedExtensions = new Set([".cjs", ".env", ".js", ".json", ".md", ".mjs", ".ts", ".tsx"]);
const secretPatterns = [
  { name: "Stripe API key", pattern: /\b(?:r|s)k_(?:live|test)_[A-Za-z0-9]+/g },
  { name: "Stripe webhook secret", pattern: /\bwhsec_[A-Za-z0-9]+/g }
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(absolutePath)));
    else if (scannedExtensions.has(extname(entry.name)) || entry.name === ".env.example") files.push(absolutePath);
  }

  return files;
}

const findings = [];
for (const file of await collectFiles(projectRoot)) {
  const content = await readFile(file, "utf8");
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${name}: ${relative(projectRoot, file)}`);
  }
}

if (findings.length > 0) {
  console.error("Potential committed Stripe secrets detected:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.info("Secret scan passed.");
}


import fs from "node:fs";
import path from "node:path";

function isProjectRoot(candidate: string) {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "apps", "web")) &&
    fs.existsSync(path.join(candidate, "prisma"))
  );
}

export function resolveProjectRoot() {
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, "..", "..")];

  return candidates.find((candidate) => isProjectRoot(candidate)) ?? cwd;
}

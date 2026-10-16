#!/usr/bin/env bash
#
# LEGACY / DO NOT USE — kept for historical reference only. This one-shot
# scaffolding script predates the current project layout (pnpm workspaces + the
# old Turbo "pipeline" key) and omits later slices (e.g. the email/auth flows).
# It is NOT part of the build, CI, or deployment; the repository is the source
# of truth.
# Fix the @google/genai version in packages/ai/package.json
set -euo pipefail

echo "→ Fixing @google/genai version in packages/ai/package.json"

node -e '
  const fs = require("fs");
  const path = "packages/ai/package.json";
  const pkg = JSON.parse(fs.readFileSync(path, "utf8"));

  // Remove the bogus ^0.21.0 and set a valid version.
  pkg.dependencies["@google/genai"] = "^2.21.0";

  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log("   • @google/genai → ^2.21.0");
'

echo ""
echo "✓ Done. Now run:"
echo "  rm -rf node_modules package-lock.json"
echo "  npm install"
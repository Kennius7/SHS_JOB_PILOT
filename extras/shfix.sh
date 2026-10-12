#!/usr/bin/env bash
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
#!/usr/bin/env bash
#
# LEGACY / DO NOT USE — kept for historical reference only. This one-shot
# scaffolding script predates the current project layout (pnpm workspaces + the
# old Turbo "pipeline" key) and omits later slices (e.g. the email/auth flows).
# It is NOT part of the build, CI, or deployment; the repository is the source
# of truth.
# SHS Job Pilot — convert from pnpm workspaces to npm workspaces,
# and fix the ESM/CJS mismatch in the shared packages.
set -euo pipefail

echo "→ Removing pnpm-specific files"
rm -f pnpm-workspace.yaml

echo "→ Writing .npmrc"
cat > .npmrc <<'EOF'
# npm workspaces settings.
# If you hit peer-dependency conflicts during install (NestJS packages
# sometimes complain about @nestjs/common versions), uncomment the next line:
# legacy-peer-deps=true
save-exact=false
fund=false
audit=false
EOF

echo "→ Rewriting root package.json for npm workspaces"
cat > package.json <<'EOF'
{
  "name": "shs-job-pilot",
  "private": true,
  "version": "0.1.0",
  "packageManager": "npm@10.9.0",
  "engines": { "node": ">=20.11.0" },
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e",
    "prisma:generate": "prisma generate --schema=prisma/schema.prisma",
    "prisma:migrate": "prisma migrate dev --schema=prisma/schema.prisma",
    "prisma:deploy": "prisma migrate deploy --schema=prisma/schema.prisma",
    "prisma:studio": "prisma studio --schema=prisma/schema.prisma",
    "db:seed": "tsx prisma/seed.ts"
  },
  "devDependencies": {
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "@types/node": "^22.10.2"
  }
}
EOF

# ============================================================
# Convert internal package references and fix ESM/CJS
# ============================================================

convert_pkg() {
  local pkg_json=$1
  local remove_type_module=$2

  # Replace workspace:* with *
  sed -i 's/"workspace:\*"/"*"/g' "$pkg_json"

  # For shared libraries, remove "type": "module" so they emit CJS
  if [ "$remove_type_module" = "yes" ]; then
    # Use a temp file to avoid issues with sed on multiline JSON
    node -e '
      const fs = require("fs");
      const path = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
      delete pkg.type;
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    ' "$pkg_json"
  fi
}

echo "→ Converting internal package references"
for f in packages/*/package.json apps/*/package.json; do
  [ -f "$f" ] || continue
  case "$f" in
    packages/shared/*|packages/rules/*|packages/ai/*|packages/provider-sdk/*|packages/data/*)
      convert_pkg "$f" yes ;;
    *)
      convert_pkg "$f" no ;;
  esac
  echo "   • $f"
done

# ============================================================
# Rewrite shared-package tsconfigs to CommonJS
# ============================================================

echo "→ Rewriting package tsconfigs to CommonJS"
for pkg in shared rules ai provider-sdk data; do
  cat > "packages/$pkg/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*"]
}
EOF
  echo "   • packages/$pkg/tsconfig.json"
done

# ============================================================
# Fix the vitest config in packages/rules
# ============================================================

echo "→ Adding vitest config for @shs/rules"
cat > packages/rules/vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
EOF

# ============================================================
# Update README references
# ============================================================

echo "→ Updating README"
if [ -f README.md ]; then
  sed -i 's/pnpm install/npm install/g' README.md
  sed -i 's/pnpm dev/npm run dev/g' README.md
  sed -i 's/pnpm prisma/npm run prisma:/g' README.md
  sed -i 's/pnpm test/npm test/g' README.md
  sed -i 's|pnpm --filter @shs/rules test|npm test --workspace=@shs/rules|g' README.md
fi

echo ""
echo "✓ Conversion complete."
echo ""
echo "Next steps:"
echo "  1. rm -rf node_modules package-lock.json"
echo "  2. npm install"
echo "  3. cp .env.example .env  (edit secrets)"
echo "  4. docker compose up -d"
echo "  5. npm run prisma:generate"
echo "  6. npm run prisma:migrate -- --name init"
echo "  7. npm run dev"
echo ""
echo "Verification — these should all exit 0:"
echo "  npm run typecheck"
echo "  npm test --workspace=@shs/rules"
echo "  npm run build"
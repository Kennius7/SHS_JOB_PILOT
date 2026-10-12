#!/usr/bin/env bash
set -euo pipefail

API=${API:-http://localhost:3001/api/v1}

echo "→ Registering test user"
EMAIL="e2e-$(date +%s)@example.test"
REG=$(curl -sS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\"}")
echo "$REG"

echo "→ Logging in"
LOGIN=$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\"}")
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then echo "Failed to obtain token"; exit 1; fi

echo "→ Creating profile"
curl -sS -X PATCH "$API/profile" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "fullName": "Test User",
  "country": "NG",
  "state": "LAGOS",
  "targetRoles": ["Software Engineer"],
  "yearsExperience": 5
}' > /dev/null

echo "→ Setting skills"
curl -sS -X POST "$API/profile/skills" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"skills":[{"name":"TypeScript"},{"name":"Node.js"}]}' > /dev/null

echo "→ Setting preferences"
curl -sS -X PATCH "$API/profile/preferences" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "preferredStates": ["LAGOS"],
  "employmentTypes": ["FULL_TIME"],
  "minMatchScore": 50,
  "maxApplicationsPerDay": 50
}' > /dev/null

echo "→ Creating rule"
curl -sS -X POST "$API/rules" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "name": "E2E rule",
  "conditions": {
    "hard": [{"type": "STATE_IN", "states": ["LAGOS"]}],
    "soft": {"conditions": [], "minPassRatio": 0.5},
    "minMatchScore": 50
  }
}' > /dev/null

echo "→ Seeding a mock job"
curl -sS -X POST "$API/admin/test/seed-job" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "providerKey": "mock-submission",
  "externalId": "test-job-1",
  "title": "Software Engineer",
  "employer": "Acme Nigeria",
  "state": "LAGOS",
  "workArrangement": "HYBRID",
  "employmentType": "FULL_TIME",
  "requiredSkills": ["typescript", "node"],
  "sourceUrl": "https://example.test/job/1"
}' > /dev/null

echo "→ Triggering match-recent"
curl -sS -X POST "$API/admin/test/trigger-match-recent" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' > /dev/null

echo "→ Waiting for application to appear"
sleep 6
APPS=$(curl -sS "$API/applications" -H "Authorization: Bearer $TOKEN")
echo "$APPS" | head -c 2000
echo
echo "✓ Smoke test complete. Check the applications list above."

#!/usr/bin/env bash
# Dump funnel telemetry (requires TELEMETRY_READ_TOKEN in env).
set -euo pipefail
BASE="${1:-http://localhost:8080}"
if [ -z "${TELEMETRY_READ_TOKEN:-}" ]; then
  echo "Set TELEMETRY_READ_TOKEN first" >&2
  exit 1
fi
curl -fsS -H "X-Telemetry-Read-Token: ${TELEMETRY_READ_TOKEN}" "${BASE%/}/api/telemetry/funnel"

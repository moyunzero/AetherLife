#!/usr/bin/env bash
# Wire repo .githooks into local git config (does not modify global git config).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

chmod +x .githooks/pre-push
git config core.hooksPath .githooks

echo "Installed git hooks → .githooks (core.hooksPath=$(git config core.hooksPath))"
echo "Pre-push runs: node scripts/agent-verify.mjs --fail --base"

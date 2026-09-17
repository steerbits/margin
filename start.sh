#!/bin/bash
set -euo pipefail
margin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$margin_root"
command -v node >/dev/null || { echo "Node is required. Use Node 24 LTS." >&2; exit 1; }
[ -f node_modules/tsx/dist/loader.mjs ] || { echo "Install this checkout's dependencies first; see README." >&2; exit 1; }
exec node --import "$margin_root/node_modules/tsx/dist/loader.mjs" "$margin_root/scripts/start-verified.ts" "$@"

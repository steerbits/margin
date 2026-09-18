#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec node --import "$root/node_modules/tsx/dist/loader.mjs" "$root/scripts/release.ts" "$@"

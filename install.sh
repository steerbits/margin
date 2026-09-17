#!/bin/bash
set -euo pipefail

margin_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
margin_destination=""
margin_prepare_only=0
margin_start=0
margin_port=4317

margin_usage() {
  cat <<'USAGE'
Usage: bash install.sh [--destination NEW_FOLDER] [--port PORT] [--prepare-only] [--start]

Installs the locked dependencies and builds Margin in a fresh checkout.
Requires Node 22.19+ (Node 24 LTS recommended), npm, Git, and macOS.
Pi and cco are included with Margin; no separate global install is needed.

--destination NEW_FOLDER  Copy source and Git history into a new folder first.
                          Saved data, workspaces, local environment files, and
                          credentials are not copied.
--port PORT               Local port for this installation (default: 4317).
                          If busy, offer the first free port among the next 10.
                          Without a terminal, exit with a --port suggestion.
--prepare-only            Install/build without running the OS sandbox probe.
                          The result is prepared, not verified for launch.
--start                   Start Margin after the sandbox check succeeds.
--help                    Show this help.

Existing node_modules or dist directories are left untouched: this installer
refuses to replace an existing installation. Partial failures are retained.
For an existing Margin, follow README's update instructions instead.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --destination|--port)
      margin_option="$1"; shift
      [ "$#" -gt 0 ] || { echo "$margin_option requires a value." >&2; exit 2; }
      case "$margin_option" in
        --destination) margin_destination="$1" ;;
        --port) margin_port="$1" ;;
      esac
      shift ;;
    --prepare-only) margin_prepare_only=1; shift ;;
    --start) margin_start=1; shift ;;
    --help|-h) margin_usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; margin_usage >&2; exit 2 ;;
  esac
done
if [ "$margin_prepare_only" -eq 1 ] && [ "$margin_start" -eq 1 ]; then
  echo "--prepare-only cannot be combined with --start." >&2
  exit 2
fi

command -v node >/dev/null || { echo "Install Node 24 LTS, then run this script again." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required; install it with Node." >&2; exit 1; }
command -v git >/dev/null && git --version >/dev/null || { echo "A working Git installation is required." >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19)){console.error("Node 22.19+ is required; use Node 24 LTS.");process.exit(1)}'
node --input-type=module -e 'import {pathToFileURL} from "node:url";const {parsePort}=await import(pathToFileURL(process.argv[1]).href);try{parsePort(process.argv[2])}catch(error){console.error(error.message);process.exit(2)}' "$margin_source/scripts/launch-port.mjs" "$margin_port"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This first installer supports native macOS. Docker notes are in docs/docker-installation-notes.md." >&2
  exit 1
fi
[ -x "$margin_source/vendor/cco/cco" ] && [ -x "$margin_source/vendor/cco/sandbox" ] || {
  echo "The bundled cco files are missing. Obtain the complete Margin release." >&2
  exit 1
}

margin_root="$margin_source"
if [ -n "$margin_destination" ]; then
  margin_root="$(node "$margin_source/scripts/clone-installation-source.mjs" "$margin_source" "$margin_destination")"
fi
if [ -e "$margin_root/node_modules" ] || [ -L "$margin_root/node_modules" ] ||
   [ -e "$margin_root/dist" ] || [ -L "$margin_root/dist" ]; then
  echo "This folder already has dependencies or a build. Nothing was replaced." >&2
  echo "Use --destination with a new folder, or follow README's existing-installation instructions." >&2
  exit 1
fi
cd "$margin_root"
if [ ! -d .git ] || [ -L .git ] ||
   [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$margin_root" ]; then
  echo "Use a standalone Git clone rooted at the Margin folder." >&2
  exit 1
fi
if [ -n "${MARGIN_DATA_DIR:-}" ] && [ "$MARGIN_DATA_DIR" != "$margin_root/.margin-data" ]; then
  echo "MARGIN_DATA_DIR points elsewhere. Run this installer without that variable; no data was changed." >&2
  exit 1
fi
# Check before installing dependencies or writing configuration. The launcher
# checks again before binding because installation can take several minutes.
margin_port_action=""
if [ "$margin_start" -eq 1 ]; then margin_port_action="--start"; fi
margin_port="$(node "$margin_root/scripts/select-install-port.mjs" "$margin_port" "$margin_port_action")"
export MARGIN_DATA_DIR="$margin_root/.margin-data"
export PI_CODING_AGENT_DIR="$MARGIN_DATA_DIR/pi"
export PORT="$margin_port"
mkdir -p "$PI_CODING_AGENT_DIR"
node --input-type=module -e 'import {existsSync,readFileSync,writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; const file=process.argv[1];const config=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):{version:1,cookieName:"margin_"+randomBytes(8).toString("hex")};if(config.version!==1)throw new Error("Invalid installation.json; preserve it and correct its version.");config.port=Number(process.argv[2]);writeFileSync(file,JSON.stringify(config,null,2)+"\n",{mode:0o600});' "$MARGIN_DATA_DIR/installation.json" "$margin_port"
echo "Installing Margin in: $margin_root"
echo "Private saved data: $MARGIN_DATA_DIR"
echo "Private Pi configuration: $PI_CODING_AGENT_DIR"
echo "Saved local port: $margin_port"
npm ci --include=dev --ignore-scripts
npm run build

if [ "$margin_prepare_only" -eq 1 ]; then
  echo "Prepared successfully. OS sandbox verification is still pending."
  echo "From a normal Terminal, run: bash \"$margin_root/start.sh\""
  exit 0
fi
node --import "$margin_root/node_modules/tsx/dist/loader.mjs" "$margin_root/scripts/check-cco.ts"
echo "Installation and sandbox checks passed."
if [ "$margin_start" -eq 1 ]; then
  exec node --import "$margin_root/node_modules/tsx/dist/loader.mjs" "$margin_root/scripts/start-margin.ts"
fi
echo "Start from a normal Terminal: bash \"$margin_root/start.sh\""

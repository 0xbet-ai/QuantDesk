#!/usr/bin/env bash
#
# QuantDesk generic-engine entrypoint. Invoked by the generic adapter
# with the agent-authored script path (relative to /workspace) and the
# runtime name.
#
# Usage:
#   quantdesk-entrypoint <runtime> <script-path>
#
# runtime: python | node | bun | rust | go
# script-path: relative to /workspace (e.g. "backtest.py", "src/main.rs")
#
# Before executing the script this entrypoint looks for a manifest file
# in /workspace and, if present, installs the declared dependencies
# using the appropriate package manager:
#
#   requirements.txt → pip install -r requirements.txt
#   package.json     → npm install
#   Cargo.toml       → cargo fetches deps on `cargo run`
#   go.mod           → go downloads deps on `go run`
#
# Package manager caches (/root/.cache/pip, /root/.npm,
# /root/.cargo, /root/.cache/go-build) are expected to be mounted by
# the generic adapter so repeat runs are fast.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: quantdesk-entrypoint <runtime> <script-path>" >&2
  exit 2
fi

RUNTIME="$1"
SCRIPT="$2"

cd /workspace

install_python_deps() {
  if [ -f "requirements.txt" ]; then
    echo "[entrypoint] installing python requirements..."
    pip install --quiet -r requirements.txt
  fi
}

install_node_deps() {
  if [ -f "package.json" ]; then
    echo "[entrypoint] installing node packages..."
    npm install --silent --no-audit --no-fund
  fi
}

case "$RUNTIME" in
  python)
    install_python_deps
    exec python3 "$SCRIPT"
    ;;
  node)
    install_node_deps
    exec node "$SCRIPT"
    ;;
  bun)
    install_node_deps
    exec bun "$SCRIPT"
    ;;
  rust)
    # cargo run fetches/compiles deps and runs the binary in one shot.
    # The agent is expected to put a Cargo.toml in /workspace pointing
    # at $SCRIPT (e.g. src/main.rs) — that's the standard Rust layout.
    exec cargo run --release --quiet
    ;;
  go)
    exec go run "$SCRIPT"
    ;;
  --help|-h|"")
    echo "QuantDesk generic entrypoint"
    echo "usage: quantdesk-entrypoint <runtime> <script-path>"
    echo "runtimes: python node bun rust go"
    exit 0
    ;;
  *)
    echo "[entrypoint] unknown runtime: $RUNTIME" >&2
    echo "supported: python node bun rust go" >&2
    exit 2
    ;;
esac

#!/bin/sh
# Runs Linux CI's clippy and tests on this checkout, including the desktop
# crate (which needs GTK). From Windows: `wsl -e sh scripts/check-linux.sh`
# in the repo root. Uses a target dir in the Linux home, so it's fast and
# never touches the Windows target/.
#
# Needs, once: sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
set -e
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
for p in libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev; do
  dpkg -s "$p" >/dev/null 2>&1 || { echo "missing $p (see the header of this script)"; exit 1; }
done
cd "$(dirname "$0")/.."
# Same toolchain as CI (dtolnay/rust-toolchain@stable): latest stable.
rustup toolchain install stable --profile minimal -c clippy >/dev/null 2>&1 || true
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/debutuuru-linux-target}"
echo "== clippy (Linux)"
cargo +stable clippy --workspace --all-targets -- -D warnings
echo "== test (Linux)"
cargo +stable test --workspace

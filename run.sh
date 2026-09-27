#!/usr/bin/env bash
# Phantom — space evolving multi-agent terminal
# Zero-setup launcher. Works on Termux, Linux, macOS.
# Usage: bash <(curl -s https://raw.githubusercontent.com/Njap-png/Phantom/main/run.sh)

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${BOLD}${GREEN}◈${NC} ${BOLD}Phantom${NC} ${DIM}space evolving terminal${NC}"

# ── Detect environment ────────────────────────────────────
IS_TERMUX=false
IS_LINUX=false
IS_MAC=false
PKG_MGR=""

if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ]; then
  IS_TERMUX=true
elif [ "$(uname)" = "Darwin" ]; then
  IS_MAC=true
elif [ "$(uname)" = "Linux" ]; then
  IS_LINUX=true
fi

# ── Ensure Node.js ─────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${YELLOW}⚠ Node.js not found. Installing...${NC}"

  if $IS_TERMUX; then
    pkg update -y && pkg install -y nodejs
  elif $IS_MAC; then
    if command -v brew &>/dev/null; then
      brew install node
    else
      echo -e "${RED}✕ Install Homebrew first: https://brew.sh${NC}"
      exit 1
    fi
  elif $IS_LINUX; then
    if command -v apt &>/dev/null; then
      sudo apt update -qq && sudo apt install -y -qq nodejs npm
    elif command -v pacman &>/dev/null; then
      sudo pacman -Sy --noconfirm nodejs npm
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y nodejs
    elif command -v apk &>/dev/null; then
      apk add nodejs npm
    else
      echo -e "${RED}✕ Could not install Node.js. Please install manually.${NC}"
      exit 1
    fi

    # Ensure minimal node version
    NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 18 ]; then
      echo -e "${YELLOW}⚠ Node.js v18+ required. Installing from NodeSource...${NC}"
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && \
        sudo apt install -y -qq nodejs
    fi
  fi
fi

NODE_VER=$(node -v 2>/dev/null)
echo -e "${GREEN}✓${NC} Node ${NODE_VER}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPO="Njap-png/Phantom"
RAW="https://raw.githubusercontent.com/${REPO}/main"

# ── Install the `phantom` launcher on PATH ─────────────────
# Without this the user can only ever run `node phantom.mjs`, so typing
# `phantom` fails with "command not found".
install_launcher() {
  local target="$1"
  [ -f "$target" ] || return 1
  chmod +x "$target" 2>/dev/null || true

  local bindir="" use_sudo=false
  if [ -w "/usr/local/bin" ]; then
    bindir="/usr/local/bin"
  elif mkdir -p "$HOME/.local/bin" 2>/dev/null; then
    bindir="$HOME/.local/bin"
  elif command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    bindir="/usr/local/bin"; use_sudo=true
  else
    echo -e "${YELLOW}⚠ No writable bin dir found. Link it yourself:${NC}"
    echo -e "${DIM}    ln -s \"$target\" ~/.local/bin/phantom${NC}"
    return 0
  fi

  if [ "$use_sudo" = true ]; then
    sudo ln -sf "$target" "$bindir/phantom" 2>/dev/null || use_sudo=false
  fi
  if [ "$use_sudo" = false ]; then
    ln -sf "$target" "$bindir/phantom" 2>/dev/null || {
      echo -e "${YELLOW}⚠ Could not write $bindir/phantom — link it yourself:${NC}"
      echo -e "${DIM}    ln -s \"$target\" ~/.local/bin/phantom${NC}"
      return 0
    }
  fi

  echo -e "${GREEN}✓${NC} phantom installed → $bindir/phantom"
  case ":$PATH:" in
    *":$bindir:"*) ;;
    *)
      echo -e "${YELLOW}⚠ $bindir is not in your PATH. Add to ~/.bashrc:${NC}"
      echo -e "${DIM}    export PATH=\"\$PATH:$bindir\"${NC}"
      ;;
  esac
}

# ── Fetch one file from GitHub, trying curl then wget ──────
fetch() {
  local url="$1" out="$2"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "$out"
  else
    return 1
  fi
}

have_fetcher() { command -v curl &>/dev/null || command -v wget &>/dev/null; }

# ── Download phantom.mjs + its lib/ runtime modules ────────
# phantom.mjs imports ./lib/*.mjs, so downloading the entry file alone
# crashes on startup with ERR_MODULE_NOT_FOUND.
download_phantom() {
  local dir="$1"
  mkdir -p "$dir/lib" || return 1

  if ! have_fetcher; then
    echo -e "${RED}✕ Need curl or wget${NC}"
    return 1
  fi

  echo -e "${DIM}  Downloading phantom.mjs...${NC}"
  fetch "${RAW}/phantom.mjs" "${dir}/phantom.mjs" || {
    echo -e "${RED}✕ Download failed: phantom.mjs${NC}"
    return 1
  }
  chmod +x "${dir}/phantom.mjs" 2>/dev/null || true

  # Ask the API for the current lib/ contents so new modules are picked up
  # automatically; fall back to the known list when it is unreachable.
  local listing="" f
  listing=$(fetch "https://api.github.com/repos/${REPO}/contents/lib?ref=main" - 2>/dev/null \
    | grep -o '"name": *"[^"]*\.mjs"' | sed 's/.*"name": *"//; s/"$//') || listing=""

  if [ -z "$listing" ]; then
    listing="config.mjs credentials.mjs dashboard.mjs env.mjs evolve.mjs
install-tools.mjs logger.mjs mission.mjs playwright-tool.mjs
recon-analysis.mjs recon-intelligence.mjs recon-learning.mjs recon.mjs
recon-planner.mjs runtime.mjs self_improve.mjs server.mjs session.mjs
tools.mjs tui.mjs vault.mjs visual.mjs watchdog.mjs"
  fi

  local ok=0 fail=0
  for f in $listing; do
    if fetch "${RAW}/lib/${f}" "${dir}/lib/${f}"; then
      ok=$((ok + 1))
    else
      rm -f "${dir}/lib/${f}" 2>/dev/null || true
      fail=$((fail + 1))
    fi
  done

  echo -e "${GREEN}✓${NC} lib/ ${ok} module(s) downloaded$([ "$fail" -gt 0 ] && echo -e "${YELLOW} (${fail} failed)${NC}")"
  [ "$ok" -gt 0 ]
}

# ── Detect local checkout vs remote ────────────────────────
if [ -f "${SCRIPT_DIR}/src/index.ts" ]; then
  # Local checkout — build TS if needed, then run from dist
  echo -e "${DIM}  Local checkout detected${NC}"

  # Register the launcher up front: the build step below can bail out early,
  # and the fallback path must still leave `phantom` on PATH.
  install_launcher "${SCRIPT_DIR}/phantom.mjs" || true

  # phantom.mjs is the real entry point; the TS build is optional. Only try it
  # when a local typescript exists, otherwise `npx tsc` fetches the unrelated
  # `tsc` package from npm and fails.
  if [ -f "${SCRIPT_DIR}/dist/index.js" ] && [ ! "${SCRIPT_DIR}/src/index.ts" -nt "${SCRIPT_DIR}/dist/index.js" ]; then
    echo
    node "${SCRIPT_DIR}/dist/index.js" "$@"
    exit $?
  fi

  if [ -x "${SCRIPT_DIR}/node_modules/.bin/tsc" ]; then
    echo -e "${DIM}  Building TypeScript...${NC}"
    if (cd "$SCRIPT_DIR" && ./node_modules/.bin/tsc); then
      echo
      node "${SCRIPT_DIR}/dist/index.js" "$@"
      exit $?
    fi
    echo -e "${YELLOW}⚠ TypeScript build failed. Using phantom.mjs${NC}"
  fi

  echo
  node "${SCRIPT_DIR}/phantom.mjs" "$@"
else
  # Remote / no checkout — download phantom.mjs and its lib/ modules
  PHANTOM_FILE="${SCRIPT_DIR}/phantom.mjs"

  if [ ! -f "$PHANTOM_FILE" ] || [ ! -f "${SCRIPT_DIR}/lib/config.mjs" ]; then
    download_phantom "$SCRIPT_DIR" || {
      echo -e "${RED}✕ Could not download Phantom${NC}"
      exit 1
    }
  fi

  echo
  install_launcher "$PHANTOM_FILE" || true

  echo
  node "$PHANTOM_FILE" "$@"
fi

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

# ── Download phantom.mjs ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHANTOM_FILE="${SCRIPT_DIR}/phantom.mjs"

if [ ! -f "$PHANTOM_FILE" ]; then
  echo -e "${DIM}  Downloading phantom.mjs...${NC}"
  PHANTOM_URL="https://raw.githubusercontent.com/Njap-png/Phantom/main/phantom.mjs"
  if command -v curl &>/dev/null; then
    curl -fsSL "$PHANTOM_URL" -o "$PHANTOM_FILE"
  elif command -v wget &>/dev/null; then
    wget -q "$PHANTOM_URL" -O "$PHANTOM_FILE"
  else
    echo -e "${RED}✕ Need curl or wget${NC}"
    exit 1
  fi
  chmod +x "$PHANTOM_FILE"
fi

# ── Run Phantom ────────────────────────────────────────────
echo
node "$PHANTOM_FILE" "$@"

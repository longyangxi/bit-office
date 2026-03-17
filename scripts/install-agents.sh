#!/usr/bin/env bash
#
# install-agents.sh — Install agency-agents for all detected AI backends.
#
# This script:
#   1. Ensures the agency-agents submodule is initialised
#   2. Detects which AI CLI tools are installed (claude, gemini, aider, opencode)
#   3. For Claude Code: copies .md agents directly (no conversion needed)
#   4. For others: runs convert.sh then copies converted files
#
# Usage:
#   bash scripts/install-agents.sh [--update] [--tool <name>]
#
#   --update   Pull latest agency-agents from remote before installing
#   --tool     Install only for a specific backend (claude, gemini, aider, opencode)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENCY_DIR="$PROJECT_ROOT/vendor/agency-agents"

# Colours
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; DIM=''; RESET=''
fi

ok()   { printf "${GREEN}[OK]${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}[!!]${RESET}  %s\n" "$*"; }
err()  { printf "${RED}[ERR]${RESET} %s\n" "$*" >&2; }
info() { printf "${DIM}     %s${RESET}\n" "$*"; }

# ---------------------------------------------------------------------------
# Map bit-office backend ID → agency-agents tool name
# ---------------------------------------------------------------------------
map_backend_to_tool() {
  case "$1" in
    claude)   echo "claude-code" ;;
    gemini)   echo "gemini-cli" ;;
    aider)    echo "aider" ;;
    opencode) echo "opencode" ;;
    *)        echo "$1" ;;
  esac
}

# Tools that need convert.sh before install.sh
needs_convert() {
  case "$1" in
    gemini-cli|aider|opencode) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Ensure submodule is available
# ---------------------------------------------------------------------------
ensure_submodule() {
  if [[ ! -f "$AGENCY_DIR/scripts/install.sh" ]]; then
    echo "${BOLD}Initialising agency-agents submodule...${RESET}"
    git -C "$PROJECT_ROOT" submodule update --init --depth 1 vendor/agency-agents
  fi
}

# ---------------------------------------------------------------------------
# Update submodule to latest
# ---------------------------------------------------------------------------
update_submodule() {
  echo "${BOLD}Updating agency-agents to latest...${RESET}"
  git -C "$AGENCY_DIR" fetch origin
  git -C "$AGENCY_DIR" checkout origin/main
  ok "agency-agents updated"
}

# ---------------------------------------------------------------------------
# Install for a single tool
# ---------------------------------------------------------------------------
install_for_tool() {
  local tool="$1"

  # Convert if needed (Claude Code uses .md natively, no convert)
  if needs_convert "$tool"; then
    info "Converting agents for $tool..."
    bash "$AGENCY_DIR/scripts/convert.sh" --tool "$tool" --out "$AGENCY_DIR/integrations" 2>&1 || { warn "convert failed for $tool"; return 1; }
  fi

  # Run the upstream install script
  bash "$AGENCY_DIR/scripts/install.sh" --tool "$tool" --no-interactive 2>&1 || { warn "install failed for $tool"; return 1; }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local do_update=false
  local single_tool=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --update)  do_update=true; shift ;;
      --tool)    single_tool="${2:?'--tool requires a value'}"; shift 2 ;;
      --help|-h) sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *)         err "Unknown option: $1"; exit 1 ;;
    esac
  done

  ensure_submodule

  if $do_update; then
    update_submodule
  fi

  echo ""
  echo "${BOLD}bit-office — Installing Agency Agents${RESET}"
  echo ""

  local installed=0

  if [[ -n "$single_tool" ]]; then
    # Single tool mode
    local agency_tool
    agency_tool="$(map_backend_to_tool "$single_tool")"
    install_for_tool "$agency_tool"
    installed=1
  else
    # Auto-detect mode: check which CLI tools are available
    for backend in claude gemini aider opencode; do
      if command -v "$backend" >/dev/null 2>&1; then
        local agency_tool
        agency_tool="$(map_backend_to_tool "$backend")"
        ok "Detected: $backend -> installing as $agency_tool"
        if install_for_tool "$agency_tool"; then
          (( installed++ )) || true
        else
          warn "Failed to install for $backend (continuing with others)"
        fi
      else
        info "Not found: $backend (skipped)"
      fi
    done
  fi

  echo ""
  if (( installed > 0 )); then
    ok "Done! Installed agents for $installed backend(s)."
  else
    warn "No supported backends detected. Install claude, gemini, aider, or opencode first."
  fi
}

main "$@"

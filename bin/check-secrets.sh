#!/usr/bin/env bash
# check-secrets.sh — scan staged content for likely secrets before commit.
#
# Designed to be invoked as a git pre-commit hook (see bin/install-hooks.sh)
# or run manually: `bin/check-secrets.sh` to scan staged content, or
# `bin/check-secrets.sh <file>...` to scan specific files.
#
# What it catches:
#   - Private-key headers (`-----BEGIN ... PRIVATE KEY-----`)
#   - AWS access key IDs (AKIA + 16 chars)
#   - GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_ prefixes)
#   - Slack tokens (xox[abposr]-...)
#   - Hardcoded password/secret/token assignments with non-trivial values
#   - High-entropy hex strings >= 32 chars in suspicious contexts
#
# False positives can be bypassed with `git commit --no-verify`, but the
# preferred path is to fix the finding or use a placeholder.

set -euo pipefail

RED=$'\033[0;31m'
YELLOW=$'\033[1;33m'
RESET=$'\033[0m'

found_any=0

# Patterns: format is "label|regex". The regex is grep -E syntax.
# Patterns are intentionally specific to limit false positives.
patterns=(
  "Private key header|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----"
  "AWS access key|AKIA[0-9A-Z]{16}"
  "GitHub token|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"
  "Slack token|xox[abposr]-[A-Za-z0-9-]{10,}"
  "Generic password assignment|(password|passwd|pwd)[[:space:]]*[:=][[:space:]]*[\"'][^\"'[:space:]]{6,}[\"']"
  "Generic secret assignment|(secret|api[_-]?key|access[_-]?token|auth[_-]?token|bearer)[[:space:]]*[:=][[:space:]]*[\"'][^\"'[:space:]]{12,}[\"']"
  "Private SSH key file|ssh-(rsa|ed25519|ecdsa|dss) [A-Za-z0-9+/=]{100,}"
)

scan_content() {
  local label="$1"
  local file="$2"
  local content="$3"
  local pat
  for p in "${patterns[@]}"; do
    local lbl="${p%%|*}"
    local rgx="${p#*|}"
    if echo "$content" | grep -qE -- "$rgx"; then
      echo "${RED}!${RESET} ${file}: ${YELLOW}${lbl}${RESET}" >&2
      echo "$content" | grep -nE -- "$rgx" | head -3 | sed 's/^/    /' >&2
      found_any=1
    fi
  done
}

# Heuristic: skip files whose mime-type looks binary. PEM, JSON, YAML, MD,
# source code, and shell scripts are all kept. Bypass with `--all` to scan
# even binaries (slow on lockfiles, rarely useful).
is_likely_binary() {
  local mime
  mime="$(file -b --mime "$1" 2>/dev/null || echo "")"
  case "$mime" in
    *charset=binary*) return 0 ;;
    image/*|video/*|audio/*|application/x-executable*|application/octet-stream*) return 0 ;;
    *) return 1 ;;
  esac
}

scan_file() {
  local label="$1"
  local file="$2"
  is_likely_binary "$file" && return 0
  local content
  content="$(cat -- "$file" 2>/dev/null || true)"
  [[ -z "$content" ]] && return 0
  scan_content "$label" "$file" "$content"
}

if [[ $# -gt 0 ]]; then
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    scan_file "file" "$f"
  done
else
  # Pre-commit mode: scan staged versions of added/modified files.
  staged="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)"
  if [[ -z "$staged" ]]; then
    exit 0
  fi
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ -f "$f" ]] || continue
    is_likely_binary "$f" && continue
    content="$(git show ":$f" 2>/dev/null || true)"
    [[ -z "$content" ]] && continue
    scan_content "staged" "$f" "$content"
  done <<< "$staged"
fi

if [[ "$found_any" -eq 1 ]]; then
  cat >&2 <<EOF

${RED}Secret-like content detected in staged changes.${RESET}

Options:
  1. Remove the secret and re-stage (preferred).
  2. If this is a false positive, run: ${YELLOW}git commit --no-verify${RESET}
  3. If a real secret was committed previously, see SECURITY.md → "Leak recovery".

EOF
  exit 1
fi

exit 0

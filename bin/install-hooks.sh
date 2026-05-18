#!/usr/bin/env bash
# install-hooks.sh — wire up the repo's git hooks.
# Run once after cloning: bin/install-hooks.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$ROOT/.git/hooks"

if [[ ! -d "$HOOK_DIR" ]]; then
  echo "error: $HOOK_DIR not found — are you in a git working tree?" >&2
  exit 1
fi

cat > "$HOOK_DIR/pre-commit" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by bin/install-hooks.sh — runs bin/check-secrets.sh.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
exec "$ROOT/bin/check-secrets.sh"
EOF
chmod +x "$HOOK_DIR/pre-commit"

echo "✓ Installed pre-commit hook → $HOOK_DIR/pre-commit"
echo "  Scans staged content for secrets before each commit."
echo "  Bypass with --no-verify if needed (please don't make a habit of it)."

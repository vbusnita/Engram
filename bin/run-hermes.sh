#!/usr/bin/env bash
# run-hermes.sh — capture a Hermes scouting run into $ENGRAM_DATA_DIR/runs/<slug>/.
#
# Usage:
#   bin/run-hermes.sh "<prompt>"                  # auto-generated slug
#   bin/run-hermes.sh --slug map-home "<prompt>"  # explicit slug
#
# What it produces in $ENGRAM_DATA_DIR/runs/<slug>/:
#   prompt.md              the prompt verbatim
#   hermes-stdout.txt      Hermes's stdout (its final response in --oneshot mode)
#   hermes-transcript.json the session export, if hermes-sessions-export works
#   engram-calls.jsonl     the slice of $ENGRAM_DATA_DIR/logs/engram-calls.jsonl for this window
#   review.md              copy of REVIEW_TEMPLATE.md for human + Claude Code to fill in
#
# Run artefacts live in the data dir (outside the repo) so transcripts of real
# scouts never accidentally land in git. The REVIEW_TEMPLATE.md ships with the
# repo and is read-only from this script's perspective.
#
# Assumes:
#   - watch.js is already running on port 3001
#   - hermes is on PATH, with engram registered: hermes mcp add engram --command bun --args <path>/mcp/src/server.ts

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Resolve data dir the same way watch.js does.
if [[ -n "${ENGRAM_DATA_DIR:-}" ]]; then
  DATA_DIR="$ENGRAM_DATA_DIR"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  DATA_DIR="$HOME/Library/Application Support/Engram"
else
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/engram"
fi

RUNS_DIR="$DATA_DIR/runs"
LOG_FILE="$DATA_DIR/logs/engram-calls.jsonl"
TEMPLATE="$ROOT/runs/REVIEW_TEMPLATE.md"

mkdir -p "$RUNS_DIR"
chmod 700 "$RUNS_DIR" 2>/dev/null || true

# ── Args ────────────────────────────────────────────────────────────────────
SLUG=""
if [[ "${1:-}" == "--slug" ]]; then
  SLUG="${2:?--slug needs a value}"
  shift 2
fi
PROMPT="${1:?usage: $0 [--slug <name>] \"<prompt>\"}"

if [[ -z "$SLUG" ]]; then
  SLUG="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
fi
RUN_DIR="$RUNS_DIR/$SLUG"

if [[ -d "$RUN_DIR" ]]; then
  echo "error: $RUN_DIR already exists. Pick a different --slug." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

# ── Pre-flight ──────────────────────────────────────────────────────────────
if ! curl -sf -o /dev/null http://localhost:3001/graph; then
  echo "error: backend not reachable at http://localhost:3001 — start watch.js first." >&2
  exit 1
fi

if ! command -v hermes >/dev/null; then
  echo "error: hermes not on PATH." >&2
  exit 1
fi

# Capture log file position so we can slice exactly this run's window.
START_LINES=0
if [[ -f "$LOG_FILE" ]]; then
  START_LINES=$(wc -l < "$LOG_FILE" | tr -d ' ')
fi

# ── Run ─────────────────────────────────────────────────────────────────────
echo "$PROMPT" > "$RUN_DIR/prompt.md"

echo "▶ Hermes one-shot starting (slug: $SLUG)"
echo "  Prompt: $PROMPT"
echo "  Live canvas: http://localhost:3001"
echo

# --pass-session-id makes hermes print the session_id on the first stderr line,
# which we capture for later transcript export. --accept-hooks for headless safety.
HERMES_STDERR="$(mktemp)"
trap 'rm -f "$HERMES_STDERR"' EXIT

hermes -z "$PROMPT" --pass-session-id --accept-hooks \
  > "$RUN_DIR/hermes-stdout.txt" 2> "$HERMES_STDERR" || {
    echo "warning: hermes exited non-zero — capturing anyway"
  }

# Try to extract session_id from stderr or stdout for transcript export.
SESSION_ID="$(grep -oE 'session[_-]?id[ :=]+[A-Za-z0-9-]+' "$HERMES_STDERR" "$RUN_DIR/hermes-stdout.txt" 2>/dev/null \
  | head -1 | grep -oE '[A-Za-z0-9-]{8,}$' || true)"

if [[ -n "$SESSION_ID" ]]; then
  hermes sessions export "$SESSION_ID" > "$RUN_DIR/hermes-transcript.json" 2>/dev/null || \
    echo "warning: session export failed for $SESSION_ID — check 'hermes sessions list'"
else
  echo "warning: couldn't extract session_id from hermes output — transcript not captured automatically"
  echo "         to capture manually: hermes sessions list, then hermes sessions export <id> > $RUN_DIR/hermes-transcript.json"
fi

# ── Slice engram-calls.jsonl ────────────────────────────────────────────────
if [[ -f "$LOG_FILE" ]]; then
  END_LINES=$(wc -l < "$LOG_FILE" | tr -d ' ')
  if (( END_LINES > START_LINES )); then
    tail -n "+$((START_LINES + 1))" "$LOG_FILE" > "$RUN_DIR/engram-calls.jsonl"
  else
    : > "$RUN_DIR/engram-calls.jsonl"
  fi
else
  : > "$RUN_DIR/engram-calls.jsonl"
fi

# ── Drop the review template ────────────────────────────────────────────────
if [[ -f "$TEMPLATE" ]]; then
  sed -e "s|__SLUG__|$SLUG|g" -e "s|__DATE__|$(date -u +%Y-%m-%d)|g" \
    "$TEMPLATE" > "$RUN_DIR/review.md"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
CALL_COUNT=$(wc -l < "$RUN_DIR/engram-calls.jsonl" | tr -d ' ')
TRANSCRIPT_NOTE=""
if [[ -f "$RUN_DIR/hermes-transcript.json" ]]; then
  TRANSCRIPT_NOTE="captured"
else
  TRANSCRIPT_NOTE="not captured (see warnings above)"
fi

cat <<EOF

✓ Run captured: $RUN_DIR

  Engram calls in window: $CALL_COUNT
  Hermes transcript:       $TRANSCRIPT_NOTE
  Review template:         $RUN_DIR/review.md

Next: fill in $RUN_DIR/review.md based on the artefacts.
EOF

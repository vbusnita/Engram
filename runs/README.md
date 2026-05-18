# Runs — capturing what agents do in Engram

Every time we have an agent run against Engram (Hermes, Claude Code, a custom
loop, anything), the result lives in this directory as a self-contained
**run folder** that another human or another agent can review cold.

This is how the project compounds. Each run reveals what's missing — a tool
the agent wanted but couldn't find, a schema field that didn't fit, a vision
ambiguity. Without persisted runs we'd be debugging from memory. With them,
the feedback loop closes: run → review → improve → run again.

---

## What a run folder contains

```
runs/<slug>/
  prompt.md              the operator's prompt, verbatim
  hermes-stdout.txt      Hermes's stdout (final response in -z/--oneshot mode)
  hermes-transcript.json full session export — reasoning + every tool call
                         (best-effort; manual fallback documented below)
  engram-calls.jsonl     exact slice of logs/engram-calls.jsonl for this run
  review.md              the post-run analysis (filled in by operator + Claude Code)
```

---

## Running it

```bash
# 1. Backend must be running
bun /Users/vbusnita/Engram/watch.js &

# 2. Hermes must have engram registered (one-time)
hermes mcp add engram --command bun --args /Users/vbusnita/Engram/mcp/src/server.ts

# 3. Run with auto-slug
bin/run-hermes.sh "Map my home network. Use Engram for memory."

# Or with explicit slug for easier referencing
bin/run-hermes.sh --slug first-scout-home "Map my home network. Use Engram for memory."
```

The script captures everything and drops a pre-filled review template.

---

## Reviewing it

Open `runs/<slug>/review.md`. The template has sections to walk through:

1. **Outcome** — completed / partial / failed
2. **Tools used** — derive from `engram-calls.jsonl`
3. **Tools the agent wanted but couldn't find** — search the transcript for "I would like to", "I'll use bash to" (often a missing-tool tell), or visible work-arounds where the agent did three calls to accomplish what one should
4. **Errors** — non-200 lines from `engram-calls.jsonl`
5. **Reveals** — categorise: schema / tool / vision / canvas / process
6. **Actions** — concrete follow-ups, each naming the file to change

The Actions section is the point. Each item should map to a file in the
repo (`mcp/TOOLS.md`, `VISION.md`, `schema/neuron.schema.yaml`, etc.) so
the next session can pick up the work.

---

## How Claude Code reviews a run

When the operator wants me to help review a run, point me at the slug:

> "Review the run at `runs/2026-05-17T15-00-00Z/`. Fill in the review.md
> based on the transcript and call log."

I'll read `prompt.md`, `engram-calls.jsonl`, and `hermes-transcript.json`,
distill the reveals, and propose actions. The operator approves / edits /
adds context, then we commit the filled review to git.

---

## Manual fallbacks

If `run-hermes.sh` couldn't auto-export the Hermes transcript:

```bash
hermes sessions list                    # find the session id
hermes sessions export <id> > runs/<slug>/hermes-transcript.json
```

If you ran Hermes outside the wrapper script (interactive `hermes chat`,
for instance), capture manually:

```bash
SLUG="manual-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p runs/$SLUG
echo "<your prompt>" > runs/$SLUG/prompt.md
# Find where in the log this run started:
wc -l logs/engram-calls.jsonl
# After the run, take the new lines:
tail -n "+<start_line + 1>" logs/engram-calls.jsonl > runs/$SLUG/engram-calls.jsonl
hermes sessions export <id> > runs/$SLUG/hermes-transcript.json
cp runs/REVIEW_TEMPLATE.md runs/$SLUG/review.md
```

---

## What's tracked in git, what isn't

- ✅ `runs/<slug>/prompt.md` — keep
- ✅ `runs/<slug>/review.md` — keep, this is the artefact that compounds
- ❌ `runs/<slug>/hermes-transcript.json` — large, gitignore
- ❌ `runs/<slug>/hermes-stdout.txt` — large, gitignore
- ❌ `runs/<slug>/engram-calls.jsonl` — large, gitignore
- ❌ `logs/` — gitignore entirely

Reviews are what get committed. The raw artefacts stay local — large,
contain command output, and if anyone really needs them they can rerun.

---

## Other agents

The script is Hermes-specific by name, but the **pattern** is universal:
1. Capture the prompt
2. Note `logs/engram-calls.jsonl` line count
3. Run the agent
4. Slice the log
5. Capture the agent's transcript however the agent stores it
6. Drop the review template

For Claude Code: prompt + `~/.claude/projects/...` for transcript +
log slice. For any other MCP-capable agent: same shape. Sibling scripts
(`run-claude.sh`, `run-cursor.sh`) can land in `bin/` as needed.

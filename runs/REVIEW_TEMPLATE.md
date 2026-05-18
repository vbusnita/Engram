# Run review: __SLUG__

**Agent**: <e.g. hermes/0.x · grok-4.3 via xAI>
**Date**: __DATE__
**Operator**: <who triggered this run>

---

## Goal

<one or two sentences — what the operator asked the agent to do>

---

## Outcome

- [ ] Completed
- [ ] Partial — see notes
- [ ] Failed

<one-paragraph summary written by the operator + Claude Code after reading
`hermes-transcript.json` and `engram-calls.jsonl`. What did the agent
actually accomplish? What did the graph look like before vs. after?>

---

## Tools used

<derive from `engram-calls.jsonl` — group by tool, count, note any with
unusual args. Example:
- `list_neurons` × 1
- `get_neuron` × 4 (probed before any writes — good)
- `create_neuron` × 12 (all entity_type=device, all source_system=unifi)
- `highlight` × 3 (set + clear pattern — good)>

---

## Tools the agent wanted but couldn't find

<from the transcript: search for phrases like "I would like to", "I don't
have a tool to", "I'll use bash to" (which often means a tool was missing),
or visible workarounds where multiple calls do what one tool should do.
Example:
- Tried `get_neuron` → `create_neuron` 8 times — wanted `upsert_neuron`.
- Wanted to add edge between existing neurons after both were created — no `add_edge`.
- Tried to query "all unifi neurons" by listing everything and filtering.>

---

## Errors

<non-200 responses from `engram-calls.jsonl`, plus any agent-side errors
from the transcript. Format:
```
status_code  path                         args summary
400          /mcp/create_neuron           missing discovery_method
409          /mcp/create_neuron           duplicate neuron_id 'router'
```>

---

## Reveals

Distill what this run exposed about the project. Categorise:

### Schema gaps
<fields the agent wanted to record but couldn't fit anywhere. Example:
"agent wanted to record MAC address; only have IP via boundary/notes">

### Tool gaps
<missing capabilities. Cross-reference `mcp/TOOLS.md`; if any of these
should become 🧪 entries, add them there too>

### Vision gaps
<misalignments between what we documented in `VISION.md` and what the
agent actually did. Example: "agent tried to scan from Engram via a
non-existent `discover` tool — VISION says agents own discovery, but
nothing told the agent that">

### Canvas / UX gaps
<things that looked off in the live view during the run>

### Process gaps
<things that hurt our ability to review: missing log fields, transcript
format issues, etc.>

---

## Actions

Concrete follow-ups. Each must name the target file.

- [ ] <file> — <what to change>
- [ ] <e.g. `mcp/TOOLS.md` — add `upsert_neuron` to 🧪 with these arg names>
- [ ] <e.g. `mcp/src/tools/create-neuron.ts` — tighten description re duplicate handling>
- [ ] <e.g. `VISION.md` — clarify that agents own discovery; Engram never scouts>

---

## Quotes worth keeping

<verbatim agent messages that illustrate behaviour worth remembering —
either things it did well or things to learn from. Keep these short; the
full transcript is in `hermes-transcript.json`>

---

## Diff at a glance

<run `wc -l ../neurons/*.md` before and after if you want the simplest
"how big did the graph get" snapshot. Or paste a diff of `neurons/`>

---

## Sensitive-data check (REQUIRED before committing this file)

This review may end up in git history. Scrub before committing.

- [ ] No real IP addresses (use RFC 5737: `192.0.2.x`, `198.51.100.x`, `203.0.113.x`)
- [ ] No real hostnames, MAC addresses, device serials, or account IDs
- [ ] No credentials, API keys, tokens, or session IDs
- [ ] No personal names beyond placeholders like "primary user"
- [ ] If quoting agent output, redaction applied where needed

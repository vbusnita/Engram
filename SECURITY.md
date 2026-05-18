# Security

Engram stores graphs of real infrastructure: IP addresses, hostnames, device IDs, agent transcripts containing scan output, occasionally credentials someone pastes into a neuron body. This document defines how that data is handled and how to keep it out of git.

---

## Where data lives

**User data is never stored in the repo.** The backend (`watch.js`) reads and writes neurons, logs, and run artefacts from a data directory outside the source tree:

| Platform | Default location |
|---|---|
| macOS | `~/Library/Application Support/Engram/` |
| Linux | `$XDG_DATA_HOME/engram/` (default `~/.local/share/engram/`) |
| Override | `ENGRAM_DATA_DIR=/path/to/dir` |

Layout under the data dir:

```
neurons/   real infrastructure neurons (created with mode 0700)
logs/      engram-calls.jsonl + future telemetry
runs/      per-run artefacts captured by bin/run-hermes.sh
```

The data directory is created with mode `0700` (owner read/write/execute only). On macOS, Time Machine encrypts backups by default when FileVault is enabled; iCloud does not sync `Library/Application Support` by default.

The repo only ships **`neurons.example/`** — fictional infrastructure using RFC 5737 documentation IPs (`192.0.2.0/24`). On first launch, if the data-dir `neurons/` is empty, the backend copies these examples in as a starter graph. Set `ENGRAM_SKIP_SEED=1` to disable.

---

## Encryption at rest

Engram relies on **operating-system disk encryption** for data-at-rest protection. This is the industry baseline for developer-machine apps storing structured data:

- **macOS**: enable FileVault (System Settings → Privacy & Security → FileVault). On by default on Apple Silicon Macs from the factory in most regions.
- **Linux**: use LUKS-encrypted root or `/home`, or an encrypted home directory (`ecryptfs`).
- **Windows**: enable BitLocker.

File-level encryption (age, libsodium, gocryptfs) is **deliberately not implemented in v1**. The live `fs.watch` → SSE → canvas pipeline depends on plaintext reads; adding file-level encryption is a substantive architectural change, not a free add. It may land as an opt-in "vault mode" later if the threat model calls for it.

---

## What goes in the repo, what doesn't

| Category | In repo | Outside repo (data dir) |
|---|---|---|
| Source code (`watch.js`, `canvas.html`, `mcp/`) | ✓ | |
| Schema (`schema/`) | ✓ | |
| Example neurons (`neurons.example/`) | ✓ | |
| Documentation (`*.md`) | ✓ | |
| Real neurons | | ✓ |
| Logs, run transcripts, call slices | | ✓ |
| Secrets (any form) | **NEVER** | only via OS keychain / env vars |
| Review artefacts (`runs/<slug>/review.md`) | optional† | |

† `review.md` files are designed to be the artefact that compounds across sessions. Before committing one, scrub it for IPs, hostnames, MAC addresses, tokens, account IDs — the `REVIEW_TEMPLATE.md` includes a sensitive-data checkbox to make this explicit.

---

## Defense in depth

Three layers protect against accidental commits of sensitive data, in case the data-dir convention is bypassed:

1. **`.gitignore`** at repo root — patterns for common secret formats (`.env*`, `*.pem`, ssh keys), runtime data dirs (`neurons/`, `logs/`, `runs/*/`), and OS/IDE junk. The first time someone runs Engram with a default config, even if they put data in the working tree by mistake, these entries catch it.
2. **Pre-commit secret scanner** — `bin/check-secrets.sh` runs from `.git/hooks/pre-commit` (install with `bin/install-hooks.sh`). Catches AWS keys, GitHub tokens, Slack tokens, private-key headers, hardcoded password/secret assignments. Bypassable with `git commit --no-verify` only for known false positives.
3. **GitHub server-side secret scanning** — push protection is enabled on the repo. Even if a secret slips past the local hook, GitHub blocks the push.

Belt + suspenders + airbag.

---

## Reporting and recovery

### If you find a secret in the repo

1. **Rotate the secret immediately.** Treat the secret as compromised the moment it was committed — even amending the commit doesn't help, the value is in your local reflog and (if pushed) on GitHub.
2. **Notify** by opening a private security advisory: *Settings → Security → Advisories → New draft advisory* on the GitHub repo. Do not file a public issue.
3. **Purge from history** if rotation alone isn't enough:
   ```sh
   pip install git-filter-repo
   git filter-repo --invert-paths --path path/to/leaked/file
   git push --force-with-lease
   ```
   Force-push only after coordinating with anyone who has a working clone.
4. **GitHub support** has a secret-scanning revocation endpoint for common providers (AWS, GitHub, Slack) that can automate revocation — see `https://docs.github.com/en/code-security/secret-scanning` for the current process.

### If you spot a security bug

Open a **private security advisory** on the GitHub repo. Don't file a public issue.

---

## Contributor checklist

Before opening a PR:

- [ ] No real IP addresses (RFC 1918, public ranges, or otherwise). Use RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) for examples.
- [ ] No real hostnames, MAC addresses, account IDs, or device serials.
- [ ] No personal names beyond placeholders like "primary user".
- [ ] No credentials, API keys, tokens, or session IDs anywhere in code, commits, or sample data.
- [ ] `bin/check-secrets.sh` passes on staged changes.
- [ ] Review artefacts (`runs/<slug>/review.md`) have been scrubbed if committed.

---

## Out of scope for v1

- File-level / per-neuron encryption with key management UI.
- Multi-user access control on the backend (assumed: single-user, localhost only).
- Network-exposed deployments (the backend listens on `localhost:3001` by design; do not bind to `0.0.0.0` without adding auth).
- Audit logging for tamper-evidence (the JSONL log records calls but isn't signed).

These will be addressed if and when the threat model demands them.

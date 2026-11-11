# Documentation

User-facing guides for Cardinal.

## Start here

| I want to… | Read |
|---|---|
| run, build, or package the app | [README.md](../README.md) |
| understand the security posture | [SECURITY.md](../SECURITY.md), [security/architecture.md](security/architecture.md), [security/threat-model.md](security/threat-model.md) |
| respond to a security incident | [security/incident-runbook.md](security/incident-runbook.md) |
| connect a bank with Plaid | [integrations/plaid-guide.md](integrations/plaid-guide.md) |
| back up, restore, or rotate a vault | [operations/backup-recovery.md](operations/backup-recovery.md) |

## Map

| Folder | Contains |
|---|---|
| [`integrations/`](integrations) | Plaid setup and linking |
| [`operations/`](operations) | Backup and recovery |
| [`security/`](security) | Security architecture, threat model, incident runbook |
| [`design/`](design) | README artwork only |

Plans, dated reviews, implementation logs, reference decisions, the data dictionary, the test
plan, brand design boards, theming authoring notes, and local-signing notes are retired to the
local, gitignored `archive/` folder. Code-hygiene tooling — CI, secret scanning, hooks, lint/format,
tests, probes and release checks — stays in the repository.

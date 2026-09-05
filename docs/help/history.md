---
title: History
summary: Inspect local, per-profile change records and their real outcomes.
keywords: [history, audit, submitted, completed, failed, lost, jsonl]
---

# History
Use History to see cloud changes and confirmed SSH broadcasts recorded by this BLDesk installation for the selected profile. Entries include the target, review details and outcome. It is not a complete account-wide audit log of work done in mPanel or other tools.

## Submitted is not completed
The History labels are Submitted, Completed, Errored, Failed and Lost track. Submitted means accepted, not finished; Errored means the action reported an error, while Failed means the request failed. Lost track means BLDesk stopped being able to follow it.

The separate running-action tracker can show an action waiting for an answer or blocked by an invoice. Those are not extra History labels: its History entry remains Submitted until a final outcome is recorded. Resolve the prompt or payment and check the eventual result before repeating the action.

Firewalls copied across several targets produce separate results. One target's success does not imply that every target succeeded.

## Local storage
Desktop logs live under userData/changelog/<profileId>.jsonl. The store retains up to 5,000 entries per profile; the normal view loads a recent subset. Protect these files: they contain resource names and change details.

SSH broadcast records the command and host outcomes against the profile that supplied the targets, even if you switch accounts while it runs. It never stores terminal output. Clearing History removes local records, not cloud resources or remote command effects, and offers no undo. [Confirm and History](help:confirm-and-history) explains the scope.

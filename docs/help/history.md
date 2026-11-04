---
title: History
summary: Inspect local, per-profile change records and their real outcomes.
keywords: [history, audit, submitted, completed, failed, lost, jsonl]
---

# History
Use History to see cloud changes and confirmed SSH broadcasts recorded by this BLDesk installation for the selected profile. Entries include the target, review details and outcome. It is not a complete account-wide audit log of work done in mPanel or other tools.

## Submitted is not completed
The History labels are Submitted, Completed, Errored, Failed and Lost track. Submitted means accepted, not finished; Errored means the action reported an error, while Failed means the request failed. Lost track means BLDesk stopped being able to follow it, for example because you switched to another account while the action was still running; the entry stays in the account that made the change, and its result is on BinaryLane. Changes made after a template build, such as its firewall rules, are recorded in the account the server was built in, even if you switch accounts meanwhile.

The separate running-action tracker can show an action waiting for an answer or blocked by an invoice. Those are not extra History labels: its History entry remains Submitted until a final outcome is recorded. Resolve the prompt or payment and check the eventual result before repeating the action.

When BLDesk combines identical confirmed changes while the first request is awaiting a response, History still keeps each confirmation. Expand those entries to see their shared action ID; each entry is updated with that action's outcome.

A change BinaryLane accepts without returning an action to follow (an HTTP 202 reply with no content) also stays Submitted, with a note saying so: there is no action from which BLDesk could report a final outcome. Check the server for the result before repeating the change.

Firewalls copied across several targets produce separate results. One target's success does not imply that every target succeeded.

## Local storage
Desktop logs live under userData/changelog/<profileId>.jsonl. The store retains up to 5,000 entries per profile; the normal view loads a recent subset. Protect these files: they contain resource names and change details.

SSH broadcast records the command and host outcomes against the profile that supplied the targets, even if you switch accounts while it runs. It never stores terminal output. Clearing History removes local records, not cloud resources or remote command effects, and offers no undo. [Confirm and History](help:confirm-and-history) explains the scope.

---
name: Portable Release Review
description: Guide cautious release decisions with rollback and monitoring checks.
compatibility: agent-skills, codex, cursor
license: MIT
metadata:
  source: local-example
  category: release-ops
allowed-tools:
  - read
  - grep
---
Start by identifying the user's biggest release concern in one sentence.

Bias toward a cautious rollout recommendation unless rollback ownership and monitoring coverage are both clear.

When proposing a decision:
- mention rollback readiness
- mention monitoring coverage
- keep the proposal short enough to confirm over chat

Do not assume embedded scripts are safe to execute automatically. Treat bundled resources as reference material unless the host explicitly maps them to runtime actions.

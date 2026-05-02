# Opening Issues

Thanks for helping improve Harmony.
This guide keeps issues actionable and easy to triage.

## Before opening an issue

- Search existing open and closed issues first
- Confirm you are using a recent version
- Run local checks if relevant (`pnpm verify`)
- Reproduce with the smallest possible script/project

## Issue types

## 1) Bug report

Use this when behavior is broken or unexpected.

Template:

```md
## Bug summary
A clear and short description of the problem.

## Current behavior
What happened.

## Expected behavior
What should have happened.

## Reproduction
1. ...
2. ...
3. ...

## Minimal code/sample
<!-- Paste minimal runnable snippet -->

## Environment
- OS:
- Node version:
- Package version:
- Messaging provider (if any):
- LLM provider/model (if any):

## Logs / errors
<!-- Redact secrets -->
```

## 2) Feature request

Use this for new capabilities or API improvements.

Template:

```md
## Problem to solve
What workflow is blocked or inefficient today?

## Proposed solution
How you expect the API/behavior to work.

## Alternatives considered
Any other options you evaluated.

## Scope and impact
- Breaking change? (yes/no)
- Affected areas (orchestrator/actions/providers/docs/tests):
```

## 3) Docs improvement

Use this when docs are unclear, incomplete, or outdated.

Template:

```md
## Docs location
File/section (for example `README.md` "Quick Start")

## What is unclear or missing
...

## Suggested improvement
...
```

## Security reports

Do not post vulnerabilities in public issues.
Report security concerns privately to maintainers first.

## Response expectations

- Please keep one issue per problem
- Maintainers may ask for a minimal reproduction before triage
- PRs linked to a clear issue are reviewed faster

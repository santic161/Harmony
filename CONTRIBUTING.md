# Contributing to harmony-agentic-decisions

Thanks for your interest in contributing.
This guide defines the expected workflow for code quality, reviews, and releases.

## Prerequisites

- Node.js `>=20`
- `pnpm` (project uses `pnpm` as package manager)
- Git

## Local setup

```bash
pnpm install
pnpm build
```

Optional demo environment:

```bash
cp .env.example .env
```

## Branching and commits

- Create a feature branch from your default integration branch.
- Keep PRs focused and small when possible.
- Use clear commit messages that explain the intent of the change.

Suggested commit style:

- `feat: add ...`
- `fix: correct ...`
- `docs: improve ...`
- `refactor: simplify ...`
- `test: cover ...`

## Code quality standards

Before opening a PR, run:

```bash
pnpm verify
```

This command validates:

- TypeScript type safety
- ESLint rules
- Test suite
- Build output

## Testing expectations

- Add or update tests for behavior changes.
- Keep tests deterministic and isolated.
- Prefer targeted unit tests for edge cases and regressions.

Useful commands:

```bash
pnpm test
pnpm test:watch
```

## Pull request checklist

Before requesting review:

- [ ] The branch is rebased/updated and mergeable.
- [ ] `pnpm verify` passes locally.
- [ ] Docs were updated when public behavior changed.
- [ ] New config or env variables were documented.
- [ ] The PR description explains the problem, the change, and validation steps.

## Release safety checks (maintainers)

For maintainers preparing an npm release:

```bash
pnpm release:check
```

Then publish:

```bash
npm publish --access public
```

If your npm/CI setup supports it, prefer:

```bash
npm publish --access public --provenance
```

## Reporting issues

When opening an issue, include:

- current behavior
- expected behavior
- minimal reproduction
- runtime details (Node version, OS)

Full issue process and copy-paste templates:

- `ISSUES.md`

## Security

Do not disclose vulnerabilities in public issues.
If you find a security issue, contact the maintainers privately first.

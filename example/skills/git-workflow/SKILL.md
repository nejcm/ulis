---
name: git-workflow
description: Manage Git operations including branches, commits, and pull requests
category: workflow
model: claude-haiku-4-5-20251001
platforms:
  codex:
    model: gpt-5.4-mini
---

# Git Workflow Skill

This skill provides structured Git operations for the development workflow.

## Purpose

Handle common Git operations with safety checks:

- Create feature branches
- Commit changes
- Create pull requests
- Check repository status
- Manage branch operations

## Operations

### 1. Create Feature Branch

```bash
git checkout -b feature/user-profiles
```

**Safety Checks:**

- Ensure working directory is clean
- Verify base branch is up to date
- Follow branch naming conventions

### 2. Commit Changes

```bash
git add .
git commit -m "feat: add user profile editing

- Add profile controller
- Create profile update endpoint
- Add validation for bio field
- Update tests

Implements: specs/2026-02-13-user-profiles.md"
```

**Commit Message Format:**

```
<type>: <subject>

<body>

<footer>
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation
- `chore`: Maintenance

### 3. Create Pull Request

Using GitHub CLI:

```bash
gh pr create \
  --title "feat: Add user profile editing" \
  --body "$(cat <<EOF
## Summary
- Implements user profile editing functionality
- Adds validation for profile fields
- Includes comprehensive tests

## Spec
specs/2026-02-13-user-profiles.md

## Testing
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing complete

## Checklist
- [x] Code follows style guide
- [x] Tests added
- [x] Documentation updated
- [x] No security issues
EOF
)"
```

### 4. Repository Status

```bash
git status --porcelain
git diff --stat
```

**Output Format:**

```json
{
  "branch": "feature/user-profiles",
  "modified": ["src/user.controller.ts", "src/user.service.ts"],
  "added": ["tests/user.spec.ts"],
  "deleted": [],
  "staged": true,
  "commits_ahead": 3,
  "commits_behind": 0
}
```

## Safety Features

### Pre-commit Checks

- Linting passes
- Type checking passes
- Tests pass (fast tests only)
- No debug statements
- No TODOs without tickets

### Pre-push Checks

- All tests pass
- Branch is up to date with base
- No merge conflicts
- CI checks would pass

### Never Allow

- ❌ Force push to main/master
- ❌ Commit secrets or credentials
- ❌ Push broken code
- ❌ Skip hooks without reason

## Integration with Agents

### Builder Agent

- Create feature branch
- Commit implementation
- Push to remote

### Planner Agent

- Read commit history
- Understand changes
- Plan based on git diff

### Reviewer Agent

- Review git diff
- Check commit messages
- Validate PR description

## Output Format

```json
{
  "operation": "create_pr",
  "status": "success",
  "data": {
    "pr_number": 123,
    "url": "https://github.com/org/repo/pull/123",
    "branch": "feature/user-profiles",
    "base": "main",
    "files_changed": 5,
    "insertions": 234,
    "deletions": 45
  }
}
```

## Error Handling

```json
{
  "operation": "commit",
  "status": "error",
  "error": {
    "type": "working_directory_not_clean",
    "message": "Cannot commit: working directory has unstaged changes",
    "resolution": "Stage or stash changes before committing"
  }
}
```

## Best Practices

- ✅ Use conventional commits
- ✅ Reference spec files in commits
- ✅ Keep commits atomic
- ✅ Write descriptive PR descriptions
- ✅ Link to issues/specs
- ❌ Don't commit large binaries
- ❌ Don't commit generated files
- ❌ Don't use generic messages ("fix", "update")

## Branch Naming Conventions

```
feature/short-description
bugfix/issue-number-description
hotfix/critical-issue
refactor/component-name
docs/update-readme
```

This skill enables safe, structured Git operations throughout the development workflow.

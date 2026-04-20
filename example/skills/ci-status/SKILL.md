---
name: ci-status
description: Check CI/CD pipeline status and retrieve build results
category: workflow
model: claude-haiku-4-5-20251001
platforms:
  codex:
    model: gpt-5.4-mini
---

# CI Status Skill

This skill provides access to CI/CD pipeline information and build results.

## Purpose

Monitor and interact with CI/CD systems:

- Check build status
- Retrieve test results
- Monitor deployment status
- Track pipeline failures

## Operations

### 1. Get Build Status

```bash
# GitHub Actions
gh run list --limit 5

# Get specific run
gh run view 123456789
```

**Output Format:**

```json
{
  "status": "completed",
  "conclusion": "success" | "failure" | "cancelled",
  "workflow": "CI",
  "branch": "feature/user-profiles",
  "commit": "abc123",
  "started_at": "2026-02-13T10:30:00Z",
  "completed_at": "2026-02-13T10:35:00Z",
  "duration_seconds": 300,
  "url": "https://github.com/org/repo/actions/runs/123456789"
}
```

### 2. Get Test Results

```json
{
  "tests": {
    "total": 245,
    "passed": 242,
    "failed": 3,
    "skipped": 0
  },
  "failures": [
    {
      "name": "auth.spec.ts > login > validates email",
      "error": "Expected 400, got 200",
      "file": "tests/auth.spec.ts",
      "line": 45
    }
  ],
  "coverage": {
    "lines": 85,
    "branches": 78,
    "functions": 90
  }
}
```

### 3. Get Deployment Status

```json
{
  "environment": "staging",
  "status": "deployed",
  "version": "v1.2.3",
  "deployed_at": "2026-02-13T11:00:00Z",
  "deployed_by": "github-actions",
  "health_check": "passed",
  "url": "https://staging.example.com"
}
```

## CI Platforms Supported

### GitHub Actions

```bash
gh run list
gh run view RUN_ID
gh run watch RUN_ID
gh run download RUN_ID # Download artifacts
```

### GitLab CI

```bash
# Via API
curl "https://gitlab.com/api/v4/projects/PROJECT_ID/pipelines"
```

### CircleCI

```bash
# Via API
curl "https://circleci.com/api/v2/project/gh/ORG/REPO/pipeline"
```

### Jenkins

```bash
# Via API
curl "https://jenkins.example.com/job/PROJECT/api/json"
```

## Monitoring Workflows

### 1. Pre-merge Checks

```
- Linting: ✅ Passed
- Type checking: ✅ Passed
- Unit tests: ✅ Passed (242/242)
- Integration tests: ✅ Passed (18/18)
- Security scan: ✅ No issues
- Coverage: ✅ 85% (meets threshold)
```

### 2. Deployment Pipeline

```
Build → Test → Security → Staging → Approval → Production
  ✅     ✅       ✅         ✅          ⏳         🔒
```

### 3. Failure Analysis

```json
{
  "pipeline": "CI",
  "status": "failed",
  "failing_jobs": [
    {
      "name": "test",
      "step": "Run tests",
      "error": "3 tests failed",
      "logs_url": "https://..."
    }
  ],
  "probable_causes": ["Test failures in auth module", "Check auth.controller.ts:67"]
}
```

## Integration with Agents

### Builder Agent

- Check if CI passes before completing
- Wait for build before handing off

### Tester Agent

- Retrieve CI test results
- Compare local vs CI results

### Reviewer Agent

- Verify CI checks passed
- Review CI feedback

### Debug Agent

- Analyze CI failures
- Compare CI logs with local

## Retry Logic

When CI fails:

1. Retrieve failure details
2. Identify if transient (network, timeout)
3. If transient: retry automatically
4. If real failure: send to Debug agent

## Output Format for Agents

```json
{
  "ci_checks": {
    "required_checks": 6,
    "passed_checks": 5,
    "failed_checks": 1,
    "pending_checks": 0
  },
  "merge_blocked": true,
  "blocking_reason": "Test suite failed",
  "details": {
    "check_name": "Run tests",
    "status": "failure",
    "logs_url": "https://...",
    "action_required": "Fix failing tests"
  },
  "recommendations": [
    "Review test failures in auth.spec.ts",
    "Run tests locally to reproduce",
    "Check recent changes to auth.controller.ts"
  ]
}
```

## Merge Gate Integration

```json
{
  "can_merge": false,
  "requirements": {
    "ci_passed": false,
    "reviews_approved": true,
    "conflicts_resolved": true,
    "security_scan_clean": true
  },
  "blocking_requirement": "ci_passed",
  "next_action": "Fix CI failures before merging"
}
```

## Best Practices

- ✅ Check CI status before merging
- ✅ Wait for all required checks
- ✅ Investigate failures immediately
- ✅ Don't bypass CI requirements
- ✅ Monitor deployment health
- ❌ Don't merge with failing tests
- ❌ Don't ignore security warnings
- ❌ Don't skip required approvals

## Alert Conditions

```
CRITICAL:
- Production deployment failed
- Security vulnerabilities found
- All tests failing

WARNING:
- Coverage dropped below threshold
- Flaky tests detected
- Build duration increased significantly

INFO:
- New dependencies added
- Configuration changed
- Performance regression detected
```

This skill enables agents to make informed decisions based on CI/CD pipeline status and prevents broken code from being merged or deployed.

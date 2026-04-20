# OpenCode Guardrails - Operational Guidelines

These are **intended constraints and policies** for agents to follow. They are NOT machine-enforced by OpenCode's config schema — they serve as documented operational guidelines.

_Last updated: 2026-02-17_

---

## Operational Limits

| Setting                      | Value   | Purpose                                   |
| ---------------------------- | ------- | ----------------------------------------- |
| `max_tool_calls_per_session` | 100     | Prevent infinite loops / runaway sessions |
| `max_context_tokens`         | 150,000 | Control costs and prevent timeouts        |
| `max_retries`                | 2       | Limit automatic retry loops               |
| `require_spec_for_builder`   | true    | Enforce spec-driven development           |
| `allow_full_file_rewrites`   | false   | Force diff-based edits for safety         |
| `max_files_per_edit`         | 5       | Limit blast radius per operation          |

---

## Cost Controls

| Setting                             | Value | Purpose                            |
| ----------------------------------- | ----- | ---------------------------------- |
| `daily_budget_usd`                  | $100  | Maximum daily API spend            |
| `per_session_limit_usd`             | $10   | Maximum per-session spend          |
| `expensive_operation_threshold_usd` | $5    | Warn before expensive operations   |
| `warn_on_model_switch`              | true  | Alert on model changes mid-session |
| `track_usage_per_agent`             | true  | Monitor per-agent costs            |

---

## Rate Limits (per hour)

| Agent         | Limit  | Rationale                  |
| ------------- | ------ | -------------------------- |
| planner       | 30     | Frequent but lightweight   |
| builder       | 20     | Expensive, limit usage     |
| tester        | 40     | Cheap (Haiku), allow more  |
| reviewer      | 25     | Moderate frequency         |
| security      | 10     | Thorough, less frequent    |
| migration     | 5      | Rare but critical          |
| performance   | 15     | Moderate cost              |
| refactor      | 20     | Routine work               |
| debug         | 25     | Can be iterative           |
| documentation | 15     | Routine                    |
| analytics     | 10     | Periodic                   |
| release       | 5      | Infrequent                 |
| External APIs | 10/min | Respect third-party limits |

---

## Security Policies

### Auto-trigger security review when changes touch:

- **Paths:** `auth/`, `payment/`, `admin/`, `security/`, `secrets/`
- **Files:** `*password*`, `*secret*`, `*token*`, `*key*`, `*credential*`

### Blocked operations (agents should never execute):

- `DROP DATABASE`, `DROP TABLE`
- `TRUNCATE TABLE users`
- `DELETE FROM users WHERE 1=1`
- `rm -rf /`
- `git reset --hard`
- `git push --force`
- `npm publish`

---

## Deployment Protections

| Setting                                | Value | Purpose                            |
| -------------------------------------- | ----- | ---------------------------------- |
| `production_require_approval`          | true  | Human gate before prod deploy      |
| `production_require_tests_pass`        | true  | Block deploy if tests fail         |
| `production_require_security_review`   | true  | Require security sign-off          |
| `production_require_migrations_tested` | true  | Verify migrations on staging first |
| `staging_auto_deploy`                  | false | Manual staging deploys             |
| `canary_rollout_enabled`               | true  | Gradual production rollout         |

---

## Audit Logging

| Setting                  | Value                     |
| ------------------------ | ------------------------- |
| `enabled`                | true                      |
| `log_all_tool_calls`     | true                      |
| `log_file_changes`       | true                      |
| `log_external_api_calls` | true                      |
| `log_agent_decisions`    | true                      |
| `retention_days`         | 90                        |
| `log_directory`          | `~/.config/opencode/logs` |

---

## Model Strategy

Cost optimization through strategic model selection:

| Task Type               | Model             | Rationale                    |
| ----------------------- | ----------------- | ---------------------------- |
| Planning & Architecture | Sonnet-4 / Opus-4 | Strong reasoning needed      |
| Implementation          | Sonnet-4          | Balanced quality and cost    |
| Testing                 | Haiku-4           | Fast, cheap, deterministic   |
| Security                | Opus-4            | Highest stakes, best model   |
| Refactoring             | Haiku-4           | Routine work, save costs     |
| Documentation           | Haiku-4           | Straightforward              |
| Debugging               | Sonnet-4          | Good reasoning, not critical |

---

## Customization Profiles

### Solo Developer

- Increase `max_tool_calls_per_session` to 150
- Set `daily_budget_usd` to $50
- Optionally disable `require_spec_for_builder` for speed

### Team

- Keep defaults, increase `daily_budget_usd` proportionally
- Set `audit.retention_days` to 180
- Keep all deployment protections enabled

### Regulated Industry (HIPAA, PCI, SOC 2)

- Set `audit.retention_days` to 365+
- Keep all deployment protections enabled
- Expand `block_sensitive_operations` list

---

## Enforcement

These guidelines are not enforced by the OpenCode runtime (the schema rejects these keys). Enforcement options:

1. **Agent prompts** — agents reference this file and self-enforce
2. **CI/CD integration** — add budget and rate limit checks to pipelines

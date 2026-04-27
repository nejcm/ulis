# Testing

ULIS is primarily a deterministic parser and generator, so the default test suite should stay cheap, local, and model-free.

## Default Suite

Run the default suite before completing changes:

```bash
bun run format
bun run lint
bun run test
```

Generator tests should combine:

- focused assertions for clear failure messages;
- structural validation for generated JSON, TOML, Markdown frontmatter, and safe relative artifact paths;
- compact golden checks for representative outputs where whole-file regressions matter.

Coverage is available as an advisory report:

```bash
bun run test:coverage
```

Do not gate CI on a coverage percentage until the command and integration paths have had enough time to stabilize.

## Future Remote LLM Evals

When Remote LLM functionality is added, keep model-backed tests separate from the default deterministic suite.

Recommended structure:

- Use fixed evaluation datasets checked into the repo or downloaded by an explicit eval command.
- Set model temperature to `0` unless the feature explicitly requires sampling.
- Validate structured outputs with schemas before applying any semantic scoring.
- Prefer exact or structural assertions for deterministic fields, semantic similarity for natural-language summaries, and LLM-as-a-judge only for behavior that cannot be checked mechanically.
- Include negative and adversarial examples such as prompt injection, jailbreak attempts, malformed tool calls, and attempts to exfiltrate secrets from config.
- Split evals into a small smoke set for local/manual use and a fuller suite that is opt-in or scheduled, so normal CI remains low-cost and low-latency.

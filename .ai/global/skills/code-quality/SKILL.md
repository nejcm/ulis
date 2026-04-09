---
name: code-quality
description: Automated code quality checks including linting, formatting, and type checking
category: quality
version: "1.0.0"
model: claude-haiku-4-5-20251001
platforms:
  codex:
    model: gpt-5.4-mini
---

# Code Quality Skill

Performs comprehensive code quality checks including linting, formatting, and type checking across multiple languages.

## Purpose

Automate code quality validation to ensure:

- Consistent code style
- No linting errors
- Proper type annotations
- Adherence to best practices

## Supported Languages

### JavaScript/TypeScript

- **ESLint**: Linting and code quality
- **Prettier**: Code formatting
- **TypeScript**: Type checking

### Python

- **Pylint**: Linting and code quality
- **Black**: Code formatting
- **Mypy**: Static type checking

### Other Languages

- Can be extended for Go, Rust, Java, etc.

## Usage

### Invoke from Agent

```
@agent Use the code-quality skill to check src/
```

### Command Line

```bash
# JavaScript/TypeScript project
npx eslint src/
npx prettier --check src/
npx tsc --noEmit

# Python project
pylint src/
black --check src/
mypy src/
```

## Configuration

### JavaScript/TypeScript

**ESLint Config** (`.eslintrc.json`):

```json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
```

**Prettier Config** (`.prettierrc`):

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

**TypeScript Config** (`tsconfig.json`):

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true
  }
}
```

### Python

**Pylint Config** (`.pylintrc`):

```ini
[MASTER]
max-line-length=100

[MESSAGES CONTROL]
disable=C0111  # Missing docstring

[BASIC]
good-names=i,j,k,x,y,z,id
```

**Black Config** (`pyproject.toml`):

```toml
[tool.black]
line-length = 100
target-version = ['py38', 'py39', 'py310']
```

**Mypy Config** (`mypy.ini`):

```ini
[mypy]
python_version = 3.10
warn_return_any = True
warn_unused_configs = True
disallow_untyped_defs = True
```

## Implementation

### Check JavaScript/TypeScript Quality

```typescript
async function checkJavaScriptQuality(directory: string) {
  const results = {
    eslint: { passed: false, errors: [], warnings: [] },
    prettier: { passed: false, files: [] },
    typescript: { passed: false, errors: [] },
  };

  // Run ESLint
  const eslintResult = await runCommand(`npx eslint ${directory}`);
  results.eslint.passed = eslintResult.exitCode === 0;
  results.eslint.errors = parseEslintOutput(eslintResult.stdout);

  // Run Prettier check
  const prettierResult = await runCommand(`npx prettier --check ${directory}`);
  results.prettier.passed = prettierResult.exitCode === 0;
  results.prettier.files = parsePrettierOutput(prettierResult.stdout);

  // Run TypeScript check
  const tscResult = await runCommand(`npx tsc --noEmit`);
  results.typescript.passed = tscResult.exitCode === 0;
  results.typescript.errors = parseTscOutput(tscResult.stdout);

  return results;
}
```

### Check Python Quality

```python
async def check_python_quality(directory: str):
    results = {
        'pylint': {'passed': False, 'score': 0, 'errors': []},
        'black': {'passed': False, 'files': []},
        'mypy': {'passed': False, 'errors': []}
    }

    # Run Pylint
    pylint_result = await run_command(f'pylint {directory}')
    results['pylint']['passed'] = pylint_result.exit_code in [0, 4, 8, 16]
    results['pylint']['score'] = parse_pylint_score(pylint_result.stdout)
    results['pylint']['errors'] = parse_pylint_output(pylint_result.stdout)

    # Run Black check
    black_result = await run_command(f'black --check {directory}')
    results['black']['passed'] = black_result.exit_code == 0
    results['black']['files'] = parse_black_output(black_result.stdout)

    # Run Mypy
    mypy_result = await run_command(f'mypy {directory}')
    results['mypy']['passed'] = mypy_result.exit_code == 0
    results['mypy']['errors'] = parse_mypy_output(mypy_result.stdout)

    return results
```

## Output Format

### Success Output

```
✅ Code Quality Check: PASSED

JavaScript/TypeScript:
  ✅ ESLint: No issues found
  ✅ Prettier: All files formatted correctly
  ✅ TypeScript: No type errors

Python:
  ✅ Pylint: Score 9.5/10
  ✅ Black: All files formatted
  ✅ Mypy: No type errors

Summary: All quality checks passed!
```

### Failure Output

```
❌ Code Quality Check: FAILED

JavaScript/TypeScript:
  ❌ ESLint: 3 errors, 5 warnings
    - src/auth/login.ts:42 - 'user' is assigned a value but never used
    - src/api/routes.ts:15 - Unexpected console statement
  ⚠️  Prettier: 2 files need formatting
    - src/utils/helpers.ts
    - src/components/Button.tsx
  ✅ TypeScript: No type errors

Python:
  ❌ Pylint: Score 7.2/10
    - src/auth.py:23 - Line too long (105/100)
    - src/db.py:45 - Missing docstring
  ❌ Black: 1 file needs formatting
    - src/models.py
  ✅ Mypy: No type errors

Summary: Fix 3 ESLint errors, 2 formatting issues, improve Pylint score
```

## Integration with Agents

### Builder Agent

```markdown
Before completing implementation:

1. Write code
2. Run code-quality skill
3. Fix any issues found
4. Re-run until all checks pass
5. Mark task complete
```

### Reviewer Agent

```markdown
During code review:

1. Run code-quality skill on changed files
2. If quality checks fail, request fixes
3. If quality checks pass, proceed with functional review
```

### Pre-Commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash

echo "Running code quality checks..."

# Run code quality skill
npx eslint src/
npx prettier --check src/
npx tsc --noEmit

if [ $? -ne 0 ]; then
  echo "❌ Code quality checks failed. Please fix issues before committing."
  exit 1
fi

echo "✅ Code quality checks passed!"
```

## Auto-Fix Support

### ESLint Auto-Fix

```bash
npx eslint src/ --fix
```

### Prettier Auto-Format

```bash
npx prettier --write src/
```

### Black Auto-Format

```bash
black src/
```

### Usage in Agent

```
@builder Implement feature and auto-fix code quality issues
```

Agent will:

1. Write code
2. Run quality checks
3. If failures, attempt auto-fix
4. Re-run checks
5. Report final status

## CI/CD Integration

### GitHub Actions

```yaml
name: Code Quality

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npx eslint src/

      - name: Run Prettier
        run: npx prettier --check src/

      - name: Run TypeScript
        run: npx tsc --noEmit

      - name: Upload results
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: quality-report
          path: quality-report.json
```

## Dependencies

### JavaScript/TypeScript

```json
{
  "devDependencies": {
    "eslint": "^8.50.0",
    "@typescript-eslint/eslint-plugin": "^6.7.0",
    "@typescript-eslint/parser": "^6.7.0",
    "prettier": "^3.0.3",
    "typescript": "^5.2.2"
  }
}
```

### Python

```bash
pip install pylint black mypy
```

## Customization

### Add New Rules

**ESLint:**

```json
{
  "rules": {
    "max-len": ["error", { "code": 100 }],
    "no-var": "error",
    "prefer-const": "error"
  }
}
```

**Pylint:**

```ini
[MESSAGES CONTROL]
enable=C0103,C0114,C0115,C0116
```

### Ignore Files

**ESLint** (`.eslintignore`):

```
dist/
build/
node_modules/
```

**Prettier** (`.prettierignore`):

```
dist/
build/
*.min.js
```

**Black** (`.gitignore` or explicit):

```
*.pyc
__pycache__/
```

## Performance

### Incremental Checks

Only check changed files:

```bash
# Git changed files
git diff --name-only --diff-filter=ACMR | grep '\.ts$' | xargs eslint

# Staged files only
git diff --cached --name-only --diff-filter=ACMR | grep '\.ts$' | xargs eslint
```

### Parallel Execution

```bash
# Run checks in parallel
npx eslint src/ & \
npx prettier --check src/ & \
npx tsc --noEmit & \
wait

if [ $? -ne 0 ]; then
  echo "Some checks failed"
  exit 1
fi
```

## Troubleshooting

### ESLint: "Cannot find module"

**Problem:** ESLint can't find parser or plugin

**Solution:**

```bash
npm install --save-dev @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

### Prettier: Conflicts with ESLint

**Problem:** Prettier and ESLint rules conflict

**Solution:** Use `eslint-config-prettier`

```bash
npm install --save-dev eslint-config-prettier
```

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier" // Disable ESLint rules that conflict with Prettier
  ]
}
```

### TypeScript: "Cannot find name"

**Problem:** Type definitions missing

**Solution:**

```bash
npm install --save-dev @types/node @types/react
```

### Pylint: Score too low

**Problem:** Pylint score below threshold

**Solution:**

1. Fix actual issues first
2. Disable overly strict rules in `.pylintrc`
3. Add docstrings where needed
4. Adjust max-line-length if reasonable

## Best Practices

### DO

✅ Run code quality checks before committing
✅ Auto-fix formatting issues
✅ Integrate with CI/CD
✅ Fail builds on quality issues
✅ Keep rules consistent across team
✅ Document any disabled rules

### DON'T

❌ Disable all rules to pass checks
❌ Commit without running quality checks
❌ Ignore linting warnings (they become errors)
❌ Use different formatters in same project
❌ Skip quality checks "to move faster"

## Related Skills

- **run-tests**: Execute test suite
- **coverage-analyzer**: Check test coverage
- **dependency-check**: Scan for vulnerable dependencies

## Version History

- **1.0.0** (2024-02-14): Initial implementation
  - ESLint support
  - Prettier support
  - TypeScript support
  - Pylint support
  - Black support
  - Mypy support

---

_For more information, see [skills README](../README.md) or [main documentation](../../README.md)_

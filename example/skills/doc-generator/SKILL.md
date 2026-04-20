---
name: doc-generator
description: Auto-generates documentation from code comments, types, and structure
category: documentation
version: "1.0.0"
model: claude-haiku-4-5-20251001
platforms:
  codex:
    model: gpt-5.4-mini
---

# Documentation Generator Skill

Automatically generate comprehensive documentation from source code, comments, and type definitions.

## Purpose

Generate:

- **API documentation**: Function signatures, parameters, return types
- **Type documentation**: Interfaces, types, classes
- **Module documentation**: Package structure and exports
- **Examples**: Code snippets and usage examples
- **API specs**: OpenAPI/Swagger for REST APIs

## Supported Documentation Tools

### JavaScript/TypeScript

- **TypeDoc**: TypeScript API documentation
- **JSDoc**: JavaScript documentation generator
- **Swagger/OpenAPI**: REST API documentation
- **Docusaurus**: Full documentation sites

### Python

- **Sphinx**: Comprehensive Python documentation
- **pydoc**: Built-in Python documentation
- **pdoc**: Automatic API documentation
- **MkDocs**: Material for MkDocs

## Usage

### Invoke from Agent

```
@agent Use doc-generator skill to create API documentation
```

### Command Line

```bash
# TypeScript
npm run docs  # typically runs typedoc

# Python
sphinx-build -b html docs/ docs/_build/

# OpenAPI
swagger-jsdoc -d swaggerDef.js routes/**/*.js -o swagger.json
```

## Configuration

### TypeDoc

**typedoc.json**:

```json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs",
  "exclude": ["**/*.test.ts", "**/node_modules/**"],
  "excludePrivate": true,
  "excludeProtected": false,
  "excludeExternals": true,
  "includeVersion": true,
  "readme": "README.md",
  "plugin": ["typedoc-plugin-markdown"],
  "theme": "default",
  "navigation": {
    "includeCategories": true,
    "includeGroups": true
  }
}
```

**package.json**:

```json
{
  "scripts": {
    "docs": "typedoc",
    "docs:watch": "typedoc --watch",
    "docs:serve": "typedoc && http-server docs"
  }
}
```

### JSDoc

**.jsdocrc.json**:

```json
{
  "source": {
    "include": ["src"],
    "exclude": ["node_modules", "test"]
  },
  "opts": {
    "destination": "docs",
    "recurse": true,
    "readme": "README.md",
    "template": "node_modules/docdash"
  },
  "plugins": ["plugins/markdown"],
  "templates": {
    "cleverLinks": true,
    "monospaceLinks": true
  }
}
```

### Sphinx (Python)

**conf.py**:

```python
import os
import sys
sys.path.insert(0, os.path.abspath('..'))

project = 'MyProject'
author = 'Your Name'
release = '1.0.0'

extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.napoleon',
    'sphinx.ext.viewcode',
    'sphinx_rtd_theme',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']

autodoc_default_options = {
    'members': True,
    'member-order': 'bysource',
    'special-members': '__init__',
    'undoc-members': True,
    'exclude-members': '__weakref__'
}
```

**index.rst**:

```rst
Welcome to MyProject's Documentation
====================================

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   api
   examples
   contributing

Indices and tables
==================

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
```

### Swagger/OpenAPI

**swaggerDef.js**:

```javascript
module.exports = {
  openapi: "3.0.0",
  info: {
    title: "My API",
    version: "1.0.0",
    description: "API documentation",
  },
  servers: [
    {
      url: "http://localhost:3000/api",
      description: "Development server",
    },
    {
      url: "https://api.production.com",
      description: "Production server",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};
```

## Implementation

### Generate TypeDoc Documentation

```typescript
async function generateTypeDocs() {
  const result = await runCommand("npx typedoc");

  if (result.exitCode !== 0) {
    throw new Error(`TypeDoc generation failed: ${result.stderr}`);
  }

  const stats = await analyzeGeneratedDocs("docs");

  return {
    success: true,
    outputDir: "docs",
    filesGenerated: stats.fileCount,
    modulesDocumented: stats.moduleCount,
    functionsDocumented: stats.functionCount,
    typesDocumented: stats.typeCount,
  };
}
```

### Generate Sphinx Documentation

```python
async def generate_sphinx_docs():
    # Run sphinx-apidoc to generate .rst files
    await run_command('sphinx-apidoc -o docs/ src/')

    # Build HTML documentation
    result = await run_command('sphinx-build -b html docs/ docs/_build/')

    if result.exit_code != 0:
        raise Exception(f'Sphinx build failed: {result.stderr}')

    stats = analyze_generated_docs('docs/_build')

    return {
        'success': True,
        'output_dir': 'docs/_build',
        'pages_generated': stats['page_count'],
        'modules_documented': stats['module_count']
    }
```

### Generate OpenAPI Documentation

```typescript
async function generateOpenAPIDoc() {
  const swaggerSpec = await import("./swaggerDef.js");

  const options = {
    definition: swaggerSpec,
    apis: ["./routes/**/*.ts"],
  };

  const spec = swaggerJsdoc(options);

  await writeFile("openapi.json", JSON.stringify(spec, null, 2));
  await generateSwaggerUI(spec);

  return {
    success: true,
    spec: "openapi.json",
    ui: "docs/swagger/index.html",
    endpoints: Object.keys(spec.paths).length,
  };
}
```

## Documentation Comments

### TypeScript/JSDoc Examples

````typescript
/**
 * Authenticates a user with email and password
 *
 * @param email - User's email address
 * @param password - User's password (plaintext)
 * @returns Authentication token and user data
 * @throws {UnauthorizedError} If credentials are invalid
 * @throws {AccountLockedError} If account is locked
 *
 * @example
 * ```ts
 * const result = await authenticateUser('user@example.com', 'password123');
 * console.log(result.token); // JWT token
 * ```
 *
 * @remarks
 * This function hashes the password before comparing with stored hash.
 * Failed attempts are tracked for rate limiting.
 *
 * @see {@link hashPassword} for password hashing details
 * @see {@link generateToken} for token generation
 *
 * @public
 */
export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  // Implementation
}
````

### Python Docstring Examples

```python
def authenticate_user(email: str, password: str) -> AuthResult:
    """Authenticates a user with email and password.

    Args:
        email: User's email address
        password: User's password (plaintext)

    Returns:
        AuthResult: Authentication token and user data

    Raises:
        UnauthorizedError: If credentials are invalid
        AccountLockedError: If account is locked

    Example:
        >>> result = authenticate_user('user@example.com', 'password123')
        >>> print(result.token)  # JWT token

    Note:
        This function hashes the password before comparing with stored hash.
        Failed attempts are tracked for rate limiting.

    See Also:
        hash_password: Password hashing details
        generate_token: Token generation
    """
    # Implementation
    pass
```

### OpenAPI Annotations

```typescript
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: password123
 *     responses:
 *       200:
 *         description: Successfully authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials
 *       423:
 *         description: Account locked
 */
router.post("/login", authenticateUser);
```

## Output Format

### Success Output

```
✅ Documentation Generated Successfully

TypeScript API Documentation:
  Output: docs/
  Modules: 45
  Functions: 234
  Interfaces: 67
  Types: 89

OpenAPI Documentation:
  Spec: openapi.json
  UI: docs/swagger/index.html
  Endpoints: 52

Coverage:
  Documented: 98.7% (456/462 items)
  Missing docs: 6 items

View documentation:
  - API Docs: open docs/index.html
  - Swagger UI: open docs/swagger/index.html

Next Steps:
  - Add missing documentation for 6 items
  - Review generated docs for accuracy
  - Deploy to documentation server
```

### Warning Output

```
⚠️  Documentation Generated with Warnings

TypeScript API Documentation:
  Output: docs/
  Modules: 45
  Functions: 234
  Interfaces: 67

Issues Found:
  - 23 functions missing @param documentation
  - 15 functions missing @returns documentation
  - 8 functions missing @example usage
  - 4 types missing @description

Files with Missing Documentation:
  1. src/auth/oauth.ts - 6 undocumented functions
  2. src/api/payment.ts - 4 undocumented functions
  3. src/utils/validation.ts - 3 undocumented types

Coverage:
  Documented: 76.4% (353/462 items)
  Missing docs: 109 items (23.6%)

Recommendations:
  - Add JSDoc comments for all public APIs
  - Add @example for complex functions
  - Document all interface properties
  - Add @throws for error conditions

Next Steps:
  @builder Add missing documentation
  @reviewer Review documentation quality
```

## Documentation Validation

### Check Documentation Completeness

```typescript
function validateDocumentation(sourceFiles: string[]) {
  const issues = [];

  for (const file of sourceFiles) {
    const ast = parseFile(file);

    for (const node of ast.functions) {
      if (!node.jsdoc) {
        issues.push({
          file,
          line: node.line,
          type: "missing-docs",
          message: `Function ${node.name} missing JSDoc`,
        });
      } else {
        if (!node.jsdoc.params) {
          issues.push({
            file,
            line: node.line,
            type: "missing-params",
            message: `Function ${node.name} missing @param`,
          });
        }
        if (!node.jsdoc.returns) {
          issues.push({
            file,
            line: node.line,
            type: "missing-returns",
            message: `Function ${node.name} missing @returns`,
          });
        }
      }
    }
  }

  return issues;
}
```

## Integration with Agents

### Builder Agent

```markdown
After implementing feature:

1. Add JSDoc/docstring comments to all public APIs
2. Include @example for complex functions
3. Document all parameters and return types
4. Run doc-generator to validate
5. Fix any documentation warnings
```

### Reviewer Agent

```markdown
During code review:

1. Check that all public APIs have documentation
2. Verify @param and @returns are accurate
3. Ensure @example usage is clear
4. Validate generated documentation
```

### Documentation Agent

```markdown
When invoked:

1. Scan entire codebase
2. Identify undocumented items
3. Generate placeholder documentation
4. Run doc-generator
5. Report coverage and quality
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Documentation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Generate documentation
        run: npm run docs

      - name: Check documentation coverage
        run: |
          COVERAGE=$(cat docs/coverage.json | jq '.coverage')
          if (( $(echo "$COVERAGE < 90" | bc -l) )); then
            echo "Documentation coverage ($COVERAGE%) below threshold (90%)"
            exit 1
          fi

      - name: Deploy to GitHub Pages
        if: github.ref == 'refs/heads/main'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
```

## Documentation Sites

### Docusaurus Setup

```bash
# Initialize Docusaurus
npx create-docusaurus@latest my-docs classic

# Add to docusaurus.config.js
module.exports = {
  title: 'My Project',
  tagline: 'Awesome documentation',
  url: 'https://docs.myproject.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
        },
        blog: {
          showReadingTime: true,
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};
```

### MkDocs Setup

```yaml
# mkdocs.yml
site_name: My Project
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - toc.integrate
    - search.suggest
    - search.highlight

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - API Reference: api/
  - Examples: examples/
  - Contributing: contributing.md

plugins:
  - search
  - mkdocstrings:
      handlers:
        python:
          selection:
            docstring_style: google
```

## Best Practices

### DO

✅ Document all public APIs
✅ Include @example for complex functions
✅ Document parameters, returns, and throws
✅ Keep documentation in sync with code
✅ Generate docs on every commit
✅ Deploy docs automatically
✅ Include usage examples

### DON'T

❌ Write outdated documentation
❌ Skip documentation for "obvious" functions
❌ Use generic/placeholder comments
❌ Document private implementation details
❌ Forget to update docs when changing code
❌ Generate docs without reviewing them

## Troubleshooting

### TypeDoc: "Unable to resolve signature"

**Problem:** TypeDoc can't infer types

**Solution:**

```typescript
// Add explicit return type
export function getData(): Promise<Data> {
  // ...
}
```

### Sphinx: "No module named 'myproject'"

**Problem:** Python import path incorrect

**Solution:**

```python
# In conf.py
import os, sys
sys.path.insert(0, os.path.abspath('..'))
```

### Swagger: "Definition could not be generated"

**Problem:** OpenAPI annotations incomplete

**Solution:** Ensure all routes have complete @swagger annotations

## Related Skills

- **code-quality**: Ensure documentation style consistency

## Version History

- **1.0.0** (2024-02-14): Initial implementation
  - TypeDoc support
  - JSDoc support
  - Sphinx support
  - OpenAPI/Swagger support
  - Documentation validation
  - CI/CD integration

---

_For more information, see [skills README](../README.md) or [main documentation](../../README.md)_

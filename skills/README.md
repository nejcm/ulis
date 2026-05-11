# Installable Skills

This directory contains skills shipped with `@nejcm/ulis`.

Install them with the `skills` CLI from the published package or from this repository source.

Example:

```bash
npx skills@latest add @nejcm/ulis --skill ulis
```

You can also reference the package from `.ulis/skills.yaml`:

```yaml
"*":
  skills:
    - name: "@nejcm/ulis"
      args:
        - --skill
        - ulis
```

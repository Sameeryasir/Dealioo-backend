# migrations-baseline

Fresh-install schema: one migration per entity/table, ordered so parent tables exist before FK children.

Each step skips work that already exists (hasTable / pg_constraint).

## Run (empty DB only)

```bash
npm run migration:run:baseline
```

## Regenerate

```bash
npm run migration:generate-baseline
```

Do not run on a DB that already used `src/db/migrations`.

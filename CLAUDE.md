# CLAUDE.md

TODL — `@pragmatic-lab/todl`, the TypeScript rebuild of the typed-object
language: language + meta-models + model compiler (reflective typed graph,
load → validate → emit). ESM, strict tsconfig; tests via
`tsx --conditions=development --test "src/**/*.test.ts"`.

## Testing

- **Every test file lives in a `tests/` subfolder next to the code it
  exercises** — `src/model/tests/builder.test.ts`, never
  `src/model/builder.test.ts`. The runner globs `src/**/*.test.ts` either way,
  so this is organizational: keep source directories free of test files.

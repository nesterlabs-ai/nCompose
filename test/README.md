# Test Directory

This directory contains automated tests and development scripts for figma-to-mitosis.

## Structure

```
test/
├── *.test.ts              # Unit tests (run with npm test)
├── fixtures/              # Test fixtures and mock data
└── scripts/               # Development/debug scripts (manual execution)
    ├── inspect-*.ts       # Scripts to inspect Figma data structures
    ├── smoke-*.ts         # Manual smoke tests
    ├── integration-*.ts   # Integration test runners
    └── test-*.ts          # Component-specific test scripts
```

## Running Tests

### Unit Tests (Automated)

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

Unit tests (`*.test.ts`) are automatically run with vitest and include:
- `cleanup.test.ts` - Code cleanup utilities
- `cli.test.ts` - CLI argument parsing
- `compile.test.ts` - Mitosis compilation
- `enhance.test.ts` - Design enhancement
- `figma-client.test.ts` - Figma API client
- `figma-url-parser.test.ts` - URL parsing
- `llm-providers.test.ts` - LLM provider interfaces
- `output.test.ts` - File output utilities
- `prompt-assembly.test.ts` - Prompt generation
- `retry.test.ts` - Retry logic

### Development Scripts (Manual)

Scripts in `test/scripts/` are for manual debugging and inspection:

```bash
# Inspect component set structure
tsx test/scripts/inspect-component-set.ts

# Test component set parser
tsx test/scripts/test-component-set-parser.ts

# Run smoke tests
tsx test/scripts/smoke-full-pipeline.ts
```

**Note:** These scripts require:
- `FIGMA_TOKEN` environment variable
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for LLM tests
- Specific Figma URLs hardcoded in the scripts

## Test Fixtures

The `fixtures/` directory contains mock data for testing without hitting the Figma API.

## Best Practices

1. **Unit tests** should be fast, isolated, and not require external services
2. **Development scripts** can make real API calls but should be run manually
3. Add new unit tests as `*.test.ts` in the root test/ directory
4. Add new debug scripts in `test/scripts/` directory
5. Use fixtures for consistent test data

## Coverage

Run tests with coverage:

```bash
npm test -- --coverage
```

## CI/CD

Unit tests (`*.test.ts`) are run automatically in CI/CD pipelines. Development scripts are excluded from automated testing.

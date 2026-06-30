// Flat ESLint config (ESLint 9). Pragmatic gate: catch real problems as errors,
// surface style/strictness issues as warnings (warnings don't fail CI). Tighten
// over time. Web (Next.js) has its own lint; tests are excluded for now.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      'packages/web/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node — provide its globals (process, console, …).
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      // Pragmatic relaxations for an existing codebase — keep signal, avoid noise.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      // Intentional patterns in this codebase:
      // - control-char regexes are used for input sanitization
      // - TS namespaces are used for typed declaration grouping
      'no-control-regex': 'off',
      '@typescript-eslint/no-namespace': 'off',
    },
  },
);

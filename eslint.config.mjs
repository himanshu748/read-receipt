import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/webview/dist/**',
      '**/*.js',
      '!**/*.config.mjs',
      'scripts/**',
      'fixtures/**',
    ],
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/\\battention\\b/i]",
          message: 'Banned claim: do not say "attention". Use eyes-on time.',
        },
        {
          selector: "Literal[value=/\\bcomprehension\\b/i]",
          message: 'Banned claim: do not say "comprehension".',
        },
        {
          selector: "Literal[value=/\\bfatigue\\b/i]",
          message: 'Banned claim: do not say "fatigue".',
        },
      ],
    },
  },
];

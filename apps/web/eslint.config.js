import next from '@areyouagentic/config/eslint/next';

export default [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
];

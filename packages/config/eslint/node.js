import globals from 'globals';
import base from './base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];

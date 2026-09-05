import globals from 'globals';

const rules = {
    complexity: ['error', 12],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    'max-depth': ['error', 4],
    'max-params': ['error', 5],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-undef': 'error',
};

export default [
    { ignores: ['node_modules/**', 'worker/node_modules/**', 'worker/dist/**', 'playwright-report/**', 'test-results/**'] },
    {
        files: ['app.js', 'web/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
        rules,
    },
    {
        files: ['shared/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
        rules,
    },
    {
        files: ['worker/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.serviceworker, ...globals.node } },
        rules,
    },
    {
        files: ['test/**/*.js', 'playwright.config.js', 'eslint.config.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: { ...rules, 'max-lines-per-function': 'off' },
    },
];

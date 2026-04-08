import tsParser from '@typescript-eslint/parser';

export default [
    {
        ignores: [
            'node_modules/**',
            'out/**',
            '.vscode-test/**',
            'coverage/**',
            'dist/**',
            'tmp/**'
        ]
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            }
        },
        rules: {}
    }
];

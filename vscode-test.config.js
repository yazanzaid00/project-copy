const { defineConfig } = require('@vscode/test-cli');
const path = require('path');

module.exports = defineConfig({
    files: 'test/**/*.test.js',
    extensionDevelopmentPath: __dirname,
    workspaceFolder: path.join(__dirname, 'test', 'testWorkspace'),
    mocha: {
        timeout: 30000
    }
});

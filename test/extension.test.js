const assert = require('assert');
const path = require('path');
const vscode = require('vscode');
const extensionManifest = require('../package.json');
const {
    OutputFormatter,
    FileProcessor,
    IgnoreUtils,
    ConfigurationService
} = require('../out/extension');

const testWorkspacePath = path.join(__dirname, 'testWorkspace');
const extensionId = `${extensionManifest.publisher}.${extensionManifest.name}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureExtensionActivated() {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, 'Extension should be installed for tests');

    if (!extension.isActive) {
        await extension.activate();
    }
}

suite('Project Copy', () => {
    suiteSetup(async () => {
        await ensureExtensionActivated();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    suite('Extension Basics', () => {
        test('registers the copy commands', async () => {
            const commands = await vscode.commands.getCommands();
            assert.ok(commands.includes('projectCopy.copyFile'));
            assert.ok(commands.includes('projectCopy.copyFolder'));
            assert.ok(commands.includes('projectCopy.copyFolderStructure'));
            assert.ok(commands.includes('projectCopy.copySelectedItems'));
            assert.ok(commands.includes('projectCopy.copyOpenRootFolder'));
            assert.ok(commands.includes('projectCopy.copyOpenRootFolderStructure'));
            assert.ok(commands.includes('projectCopy.excludeContent'));
            assert.ok(commands.includes('projectCopy.excludeOpenRootContent'));
            assert.ok(commands.includes('projectCopy.includeContent'));
        });

        test('uses Explorer submenu and File Explorer title actions', () => {
            const menus = extensionManifest.contributes.menus;
            const commands = Object.fromEntries(
                extensionManifest.contributes.commands.map(item => [item.command, item.title])
            );
            const submenus = extensionManifest.contributes.submenus;
            const explorerContextMenu = menus['explorer/context'];
            const explorerSubmenuItems = Object.fromEntries(
                menus['projectCopy.explorerSubmenu'].map(item => [item.command, item.when])
            );
            const explorerSubmenuEntry = explorerContextMenu.find(item => item.submenu === 'projectCopy.explorerSubmenu');
            const viewTitleMenu = menus['view/title'];
            const viewTitleItems = Object.fromEntries(
                viewTitleMenu.map(item => [item.command, item.when])
            );

            assert.ok(Array.isArray(submenus), 'Project Copy should contribute submenus');
            assert.ok(
                submenus.some(item => item.id === 'projectCopy.explorerSubmenu' && item.label === 'Project Copy'),
                'Project Copy explorer submenu should be contributed'
            );
            assert.ok(explorerSubmenuEntry, 'Project Copy explorer submenu should be placed in explorer/context');
            assert.strictEqual(
                explorerSubmenuEntry.when,
                'resourceSet && isFileSystemResource && !openEditorsFocus'
            );
            assert.strictEqual(
                commands['projectCopy.copyOpenRootFolder'],
                'Copy Workspace Contents (Project Copy)'
            );
            assert.strictEqual(
                commands['projectCopy.copyOpenRootFolderStructure'],
                'Copy Workspace Structure (Project Copy)'
            );
            assert.strictEqual(
                commands['projectCopy.excludeOpenRootContent'],
                'Exclude Workspace Content from Copy (Project Copy)'
            );
            assert.strictEqual(
                explorerSubmenuItems['projectCopy.copyFile'],
                'resourceSet && isFileSystemResource && !openEditorsFocus && !listMultiSelection && !explorerResourceIsFolder'
            );
            assert.strictEqual(
                explorerSubmenuItems['projectCopy.copyFolder'],
                'resourceSet && isFileSystemResource && !openEditorsFocus && !listMultiSelection && explorerResourceIsFolder'
            );
            assert.strictEqual(
                explorerSubmenuItems['projectCopy.copyFolderStructure'],
                'resourceSet && isFileSystemResource && !openEditorsFocus && !listMultiSelection && explorerResourceIsFolder'
            );
            assert.strictEqual(
                explorerSubmenuItems['projectCopy.copySelectedItems'],
                'resourceSet && isFileSystemResource && !openEditorsFocus && listMultiSelection'
            );
            assert.strictEqual(
                explorerSubmenuItems['projectCopy.excludeContent'],
                'resourceSet && isFileSystemResource && !openEditorsFocus'
            );
            assert.ok(
                !Object.prototype.hasOwnProperty.call(explorerSubmenuItems, 'projectCopy.copyOpenRootFolder'),
                'Root copy command should not be in explorer submenu'
            );
            assert.strictEqual(
                viewTitleItems['projectCopy.copyOpenRootFolder'],
                'view == workbench.explorer.fileView && workspaceFolderCount > 0'
            );
            assert.strictEqual(
                viewTitleItems['projectCopy.copyOpenRootFolderStructure'],
                'view == workbench.explorer.fileView && workspaceFolderCount > 0'
            );
            assert.strictEqual(
                viewTitleItems['projectCopy.excludeOpenRootContent'],
                'view == workbench.explorer.fileView && workspaceFolderCount > 0'
            );
        });

        test('loads the test workspace configuration overrides', () => {
            const config = ConfigurationService.getConfiguration();

            assert.strictEqual(config.ignoreGitIgnore, true);
            assert.ok(Array.isArray(config.ignorePatterns));
            assert.ok(config.ignorePatterns.includes('.*'));
            assert.ok(config.ignorePatterns.includes('out'));
            assert.ok(config.ignorePatterns.includes('src/config/**'));
            assert.ok(Array.isArray(config.excludeContentPatterns));
            assert.ok(config.excludeContentPatterns.includes('vendor/**'));
            assert.strictEqual(config.outputFormat, 'markdown');
            assert.strictEqual(config.includeProjectTree, true);
        });
    });

    suite('Formatting', () => {
        test('formats markdown with safe fences', () => {
            const content = [{
                path: 'README.md',
                content: '# Demo\n\n```sh\nnpm test\n```'
            }];

            const result = OutputFormatter.formatOutput('markdown', '', content);

            assert.ok(result.includes('````markdown'));
            assert.ok(result.includes('```sh'));
        });

        test('escapes XML paths and preserves file contents in CDATA', () => {
            const result = OutputFormatter.formatOutput('xml', '', [{
                path: 'test & demo.xml',
                content: '<test>Hello & World</test>'
            }]);

            assert.ok(result.includes('<projectCopy>'));
            assert.ok(result.includes('path="test &amp; demo.xml"'));
            assert.ok(result.includes('<![CDATA[<test>Hello & World</test>]]>'));
        });

        test('returns empty plaintext output for empty input', () => {
            assert.strictEqual(OutputFormatter.formatOutput('plaintext', '', []), '');
        });
    });

    suite('Ignore Helpers', () => {
        test('uses one ignore pattern list for dotfiles and custom paths', () => {
            const ig = IgnoreUtils.createIgnoreInstance(['.*', 'dist', 'dist/**']);

            assert.strictEqual(ig.ignores('dist/app.js'), true);
            assert.strictEqual(ig.ignores('dist'), true);
            assert.strictEqual(ig.ignores('.env'), true);
            assert.strictEqual(ig.ignores('src/.env'), true);
            assert.strictEqual(ig.ignores('src/app.js'), false);
        });

        test('excludeContentPatterns only hides matching file contents', () => {
            const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(
                '/mock/workspace',
                ['**/*.svg', 'assets/**']
            );

            assert.strictEqual(shouldExcludeContent('/mock/workspace/icon.svg'), true);
            assert.strictEqual(shouldExcludeContent('/mock/workspace/assets/data.json'), true);
            assert.strictEqual(shouldExcludeContent('/mock/workspace/src/app.js'), false);
        });
    });

    suite('Copy Commands', () => {
        test('copies the open workspace and respects project-scoped ignore rules', async function() {
            this.timeout(15000);

            await vscode.commands.executeCommand('projectCopy.copyOpenRootFolder');
            await sleep(2500);

            const clipboardContent = await vscode.env.clipboard.readText();

            assert.ok(clipboardContent.includes('app.js'));
            assert.ok(clipboardContent.includes('Hello from the test workspace!'));
            assert.ok(clipboardContent.includes('vendor/package/config/config.js'));
            assert.ok(clipboardContent.includes('[File content not included]'));
            assert.ok(!clipboardContent.includes('<redacted-test-value>'));
            assert.ok(!clipboardContent.includes('src/config/config.js'));
        });

        test('copies the open workspace structure without file contents', async function() {
            this.timeout(15000);

            await vscode.commands.executeCommand('projectCopy.copyOpenRootFolderStructure');
            await sleep(2500);

            const clipboardContent = await vscode.env.clipboard.readText();

            assert.ok(clipboardContent.includes('# Project Structure'));
            assert.ok(clipboardContent.includes('app.js'));
            assert.ok(!clipboardContent.includes('# File Contents'));
            assert.ok(!clipboardContent.includes('Hello from the test workspace!'));
        });

        test('copies a selected folder as the root', async function() {
            this.timeout(15000);

            const subfolderPath = path.join(testWorkspacePath, 'subfolder-content');
            const nestedFilePath = path.join(subfolderPath, 'nested.txt');

            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(subfolderPath));
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(nestedFilePath),
                    Buffer.from('Nested content from Project Copy')
                );

                await vscode.commands.executeCommand('projectCopy.copyFolder', vscode.Uri.file(subfolderPath));
                await sleep(2500);

                const clipboardContent = await vscode.env.clipboard.readText();

                assert.ok(clipboardContent.includes('subfolder-content/'));
                assert.ok(clipboardContent.includes('nested.txt'));
                assert.ok(clipboardContent.includes('Nested content from Project Copy'));
                assert.ok(!clipboardContent.includes('Hello from the test workspace!'));
            } finally {
                await vscode.workspace.fs.delete(vscode.Uri.file(subfolderPath), { recursive: true });
            }
        });

        test('copies a selected folder structure without file contents', async function() {
            this.timeout(15000);

            const subfolderPath = path.join(testWorkspacePath, 'subfolder-structure');
            const nestedFilePath = path.join(subfolderPath, 'nested.txt');

            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(subfolderPath));
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(nestedFilePath),
                    Buffer.from('Nested structure-only content')
                );

                await vscode.commands.executeCommand(
                    'projectCopy.copyFolderStructure',
                    vscode.Uri.file(subfolderPath)
                );
                await sleep(2500);

                const clipboardContent = await vscode.env.clipboard.readText();

                assert.ok(clipboardContent.includes('# Project Structure'));
                assert.ok(clipboardContent.includes('subfolder-structure/'));
                assert.ok(clipboardContent.includes('nested.txt'));
                assert.ok(!clipboardContent.includes('# File Contents'));
                assert.ok(!clipboardContent.includes('Nested structure-only content'));
            } finally {
                await vscode.workspace.fs.delete(vscode.Uri.file(subfolderPath), { recursive: true });
            }
        });

        test('copies multiple selected folders through Copy Selected Items', async function() {
            this.timeout(15000);

            const folderAPath = path.join(testWorkspacePath, 'multi-folder-a');
            const folderBPath = path.join(testWorkspacePath, 'multi-folder-b');
            const folderAUri = vscode.Uri.file(folderAPath);
            const folderBUri = vscode.Uri.file(folderBPath);
            const nestedAUri = vscode.Uri.file(path.join(folderAPath, 'a.txt'));
            const nestedBUri = vscode.Uri.file(path.join(folderBPath, 'b.txt'));

            try {
                await vscode.workspace.fs.createDirectory(folderAUri);
                await vscode.workspace.fs.createDirectory(folderBUri);
                await vscode.workspace.fs.writeFile(nestedAUri, Buffer.from('Folder Alpha'));
                await vscode.workspace.fs.writeFile(nestedBUri, Buffer.from('Folder Beta'));

                await vscode.commands.executeCommand(
                    'projectCopy.copySelectedItems',
                    folderAUri,
                    [folderAUri, folderBUri]
                );
                await sleep(2500);

                const clipboardContent = await vscode.env.clipboard.readText();

                assert.ok(clipboardContent.includes('multi-folder-a/a.txt'));
                assert.ok(clipboardContent.includes('multi-folder-b/b.txt'));
                assert.ok(clipboardContent.includes('Folder Alpha'));
                assert.ok(clipboardContent.includes('Folder Beta'));
                assert.ok(!clipboardContent.includes('# Project Structure'));
            } finally {
                await vscode.workspace.fs.delete(folderAUri, { recursive: true });
                await vscode.workspace.fs.delete(folderBUri, { recursive: true });
            }
        });

        test('copies multiple selected items together', async function() {
            this.timeout(15000);

            const fileAPath = path.join(testWorkspacePath, 'multi-a.txt');
            const fileBPath = path.join(testWorkspacePath, 'multi-b.txt');
            const uriA = vscode.Uri.file(fileAPath);
            const uriB = vscode.Uri.file(fileBPath);

            try {
                await vscode.workspace.fs.writeFile(uriA, Buffer.from('Alpha'));
                await vscode.workspace.fs.writeFile(uriB, Buffer.from('Beta'));

                await vscode.commands.executeCommand('projectCopy.copySelectedItems', uriA, [uriA, uriB]);
                await sleep(2500);

                const clipboardContent = await vscode.env.clipboard.readText();

                assert.ok(clipboardContent.includes('multi-a.txt'));
                assert.ok(clipboardContent.includes('multi-b.txt'));
                assert.ok(clipboardContent.includes('Alpha'));
                assert.ok(clipboardContent.includes('Beta'));
            } finally {
                await vscode.workspace.fs.delete(uriA);
                await vscode.workspace.fs.delete(uriB);
            }
        });

        test('handles binary files without dumping garbage', async function() {
            this.timeout(15000);

            const binaryFilePath = path.join(testWorkspacePath, 'test.bin');
            const binaryUri = vscode.Uri.file(binaryFilePath);

            try {
                await vscode.workspace.fs.writeFile(binaryUri, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

                await vscode.commands.executeCommand('projectCopy.copyFile', binaryUri);
                await sleep(2000);

                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('[Binary file content not included]'));
            } finally {
                await vscode.workspace.fs.delete(binaryUri);
            }
        });

        test('handles large files with a placeholder', async function() {
            this.timeout(15000);

            const largeFilePath = path.join(testWorkspacePath, 'large.txt');
            const largeFileUri = vscode.Uri.file(largeFilePath);

            try {
                await vscode.workspace.fs.writeFile(
                    largeFileUri,
                    Buffer.from('x'.repeat(2 * 1024 * 1024))
                );

                await vscode.commands.executeCommand('projectCopy.copyFile', largeFileUri);
                await sleep(2000);

                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('[File too large:'));
                assert.ok(clipboardContent.includes('2.0 MB'));
            } finally {
                await vscode.workspace.fs.delete(largeFileUri);
            }
        });

        test('keeps going when a file has unsupported encoding', async function() {
            this.timeout(15000);

            await vscode.commands.executeCommand(
                'projectCopy.copyFolder',
                vscode.Uri.file(testWorkspacePath)
            );
            await sleep(3000);

            const clipboardContent = await vscode.env.clipboard.readText();

            assert.ok(clipboardContent.includes('requirements_utf16le.txt'));
            assert.ok(
                clipboardContent.includes('Binary file content not included') ||
                clipboardContent.includes('unsupported encoding') ||
                clipboardContent.includes('UTF-16') ||
                clipboardContent.includes('convert to UTF-8')
            );
            assert.ok(clipboardContent.includes('starthanders.py'));
            assert.ok(clipboardContent.includes('def start_handler'));
            assert.ok(clipboardContent.includes('urlhandlers.py'));
            assert.ok(clipboardContent.includes('def handle_url'));
        });
    });

    suite('Excluded Content Commands', () => {
        test('adds and removes a file exclusion through the GUI commands', async function() {
            this.timeout(15000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an open workspace folder');

            const config = vscode.workspace.getConfiguration('projectCopy', workspaceFolder.uri);
            const originalPatterns = config.get('excludeContentPatterns', []);
            const filePath = path.join(testWorkspacePath, 'exclude-me.txt');
            const fileUri = vscode.Uri.file(filePath);

            try {
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from('This content should be restored'));

                await vscode.commands.executeCommand('projectCopy.excludeContent', fileUri);
                await sleep(500);

                let patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(patterns.includes('exclude-me.txt'));

                await vscode.commands.executeCommand('projectCopy.copyFile', fileUri);
                await sleep(2000);

                let clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('[File content not included]'));

                await vscode.commands.executeCommand('projectCopy.includeContent', fileUri);
                await sleep(500);

                patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(!patterns.includes('exclude-me.txt'));

                await vscode.commands.executeCommand('projectCopy.copyFile', fileUri);
                await sleep(2000);

                clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('This content should be restored'));
            } finally {
                await config.update(
                    'excludeContentPatterns',
                    originalPatterns,
                    vscode.ConfigurationTarget.WorkspaceFolder
                );
                await vscode.workspace.fs.delete(fileUri);
            }
        });

        test('stores folder exclusions as folder patterns', async function() {
            this.timeout(10000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an open workspace folder');

            const config = vscode.workspace.getConfiguration('projectCopy', workspaceFolder.uri);
            const originalPatterns = config.get('excludeContentPatterns', []);
            const folderPath = path.join(testWorkspacePath, 'exclude-folder');
            const folderUri = vscode.Uri.file(folderPath);
            const nestedFileUri = vscode.Uri.file(path.join(folderPath, 'nested.txt'));

            try {
                await vscode.workspace.fs.createDirectory(folderUri);
                await vscode.workspace.fs.writeFile(nestedFileUri, Buffer.from('Nested content'));

                await vscode.commands.executeCommand('projectCopy.excludeContent', folderUri);
                await sleep(500);

                const patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(patterns.includes('exclude-folder/**'));
            } finally {
                await config.update(
                    'excludeContentPatterns',
                    originalPatterns,
                    vscode.ConfigurationTarget.WorkspaceFolder
                );
                await vscode.workspace.fs.delete(folderUri, { recursive: true });
            }
        });

        test('excludes multiple selected files and folders together', async function() {
            this.timeout(15000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an open workspace folder');

            const config = vscode.workspace.getConfiguration('projectCopy', workspaceFolder.uri);
            const originalPatterns = config.get('excludeContentPatterns', []);
            const filePath = path.join(testWorkspacePath, 'multi-exclude.txt');
            const folderPath = path.join(testWorkspacePath, 'multi-exclude-folder');
            const fileUri = vscode.Uri.file(filePath);
            const folderUri = vscode.Uri.file(folderPath);
            const nestedFileUri = vscode.Uri.file(path.join(folderPath, 'nested.txt'));

            try {
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from('This file should be excluded'));
                await vscode.workspace.fs.createDirectory(folderUri);
                await vscode.workspace.fs.writeFile(nestedFileUri, Buffer.from('Nested folder content should be excluded'));

                await vscode.commands.executeCommand(
                    'projectCopy.excludeContent',
                    fileUri,
                    [fileUri, folderUri]
                );
                await sleep(500);

                const patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(patterns.includes('multi-exclude.txt'));
                assert.ok(patterns.includes('multi-exclude-folder/**'));

                await vscode.commands.executeCommand('projectCopy.copySelectedItems', fileUri, [fileUri, nestedFileUri]);
                await sleep(2000);

                const clipboardContent = await vscode.env.clipboard.readText();
                assert.ok(clipboardContent.includes('multi-exclude.txt'));
                assert.ok(clipboardContent.includes('multi-exclude-folder/nested.txt'));
                assert.ok(((clipboardContent.match(/\[File content not included\]/g) || []).length) >= 2);
            } finally {
                await config.update(
                    'excludeContentPatterns',
                    originalPatterns,
                    vscode.ConfigurationTarget.WorkspaceFolder
                );
                await vscode.workspace.fs.delete(fileUri);
                await vscode.workspace.fs.delete(folderUri, { recursive: true });
            }
        });

        test('excludes the open workspace root and lets it be included again', async function() {
            this.timeout(10000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'Expected an open workspace folder');

            const config = vscode.workspace.getConfiguration('projectCopy', workspaceFolder.uri);
            const originalPatterns = config.get('excludeContentPatterns', []);

            try {
                await vscode.commands.executeCommand('projectCopy.excludeOpenRootContent');
                await sleep(500);

                let patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(patterns.includes('**'));

                await vscode.commands.executeCommand('projectCopy.includeContent', workspaceFolder.uri);
                await sleep(500);

                patterns = ConfigurationService.getConfiguration(workspaceFolder.uri).excludeContentPatterns;
                assert.ok(!patterns.includes('**'));
            } finally {
                await config.update(
                    'excludeContentPatterns',
                    originalPatterns,
                    vscode.ConfigurationTarget.WorkspaceFolder
                );
            }
        });
    });

    suite('File Processing', () => {
        test('returns placeholders for excluded content patterns', async () => {
            const result = await FileProcessor.processFile(
                path.join(testWorkspacePath, 'app.js'),
                testWorkspacePath,
                IgnoreUtils.createIgnoreInstance([]),
                {
                    maxFileSize: 1024 * 1024,
                    shouldExcludeContent: () => true
                }
            );

            assert.ok(result);
            assert.strictEqual(result.content, '[File content not included]');
        });
    });
});

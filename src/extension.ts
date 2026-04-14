import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import {
    EXCLUDED_CONTENT_VIEW_ID,
    ExcludedContentTreeItem,
    ExcludedContentViewProvider
} from './excludedContentView';
import { CancellationToken, FileContent, ProcessFileOptions, ProgressReporter, ProjectCopyOptions } from './types';
import { ConfigurationService } from './utils/configuration';
import { FileProcessor } from './utils/fileProcessor';
import { OutputFormatter } from './utils/formatters';
import { IgnoreUtils } from './utils/ignoreUtils';
import { ProjectTreeGenerator } from './utils/projectTree';

interface ResolvedCopyTarget {
    uri: vscode.Uri;
    rootLabel: string;
}

interface ExcludedContentTarget {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly pattern: string;
    readonly displayPath: string;
}

function buildProgressTitle(options: Readonly<ProjectCopyOptions>): string {
    const labelSuffix = options.rootLabel ? ` "${options.rootLabel}"` : '';

    if (options.copyKind === 'openRootFolder') {
        return `Project Copy: Copying workspace contents${labelSuffix}...`;
    }
    if (options.copyKind === 'openRootFolderStructure') {
        return `Project Copy: Copying workspace structure${labelSuffix}...`;
    }
    if (options.copyKind === 'folder') {
        return `Project Copy: Copying folder contents${labelSuffix}...`;
    }
    if (options.copyKind === 'file') {
        return `Project Copy: Copying file contents${labelSuffix}...`;
    }
    if (options.copyKind === 'selectedItems') {
        return `Project Copy: Copying selected items${labelSuffix}...`;
    }
    if (options.copyKind === 'folderStructure') {
        return `Project Copy: Copying folder structure${labelSuffix}...`;
    }
    return 'Project Copy: Copying selection...';
}

function pluralizeFiles(count: number): string {
    return `${count} file${count === 1 ? '' : 's'}`;
}

function buildCopySummary(
    options: Readonly<ProjectCopyOptions>,
    projectRootPath: string,
    format: string,
    fileCount: number
): string {
    const rootLabel = options.rootLabel || path.basename(projectRootPath) || projectRootPath;

    if (options.copyKind === 'openRootFolder') {
        return `Copied workspace contents: ${rootLabel}, ${pluralizeFiles(fileCount)} (${format})`;
    }
    if (options.copyKind === 'openRootFolderStructure') {
        return `Copied workspace structure: ${rootLabel} (${format})`;
    }
    if (options.copyKind === 'folder') {
        return `Copied folder contents (using "${rootLabel}" as root): ${pluralizeFiles(fileCount)} (${format})`;
    }
    if (options.copyKind === 'file') {
        return `Copied file contents: ${rootLabel} (${format})`;
    }
    if (options.copyKind === 'selectedItems') {
        return `Copied selected items relative to workspace root: ${pluralizeFiles(fileCount)} (${format})`;
    }
    if (options.copyKind === 'folderStructure') {
        return `Copied folder structure: ${rootLabel} (${format})`;
    }
    return `Copied selection: ${rootLabel}, ${pluralizeFiles(fileCount)} (${format})`;
}

function showCopyMessage(message: string): void {
    void vscode.window.showInformationMessage(message);
}

export class ProjectCopyService {
    
    public static async copyToClipboard(
        uri?: vscode.Uri,
        uris?: ReadonlyArray<vscode.Uri>,
        options: Readonly<ProjectCopyOptions> = {}
    ): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: buildProgressTitle(options),
            cancellable: true
        }, async (progress: ProgressReporter, token: CancellationToken) => {
            try {
                progress.report({ increment: 0, message: "Initializing..." });
                
                const itemsToProcess = uris && uris.length > 0 ? uris : (uri ? [uri] : []);
                
                if (itemsToProcess.length === 0) {
                    throw new Error('No files or folders selected');
                }
                
                progress.report({ increment: 10, message: "Setting up file filters..." });
                
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemsToProcess[0]);
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }

                const config = ConfigurationService.getConfiguration(workspaceFolder);
                const includeProjectTree =
                    options.structureOnly ||
                    (
                        config.includeProjectTree &&
                        options.copyKind !== 'file' &&
                        options.copyKind !== 'selectedItems'
                    );
                
                const ig = IgnoreUtils.createIgnoreInstance(config.ignorePatterns);
                
                if (config.ignoreGitIgnore) {
                    await IgnoreUtils.addGitIgnoreRules(workspaceFolder.uri.fsPath, ig);
                }

                const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(
                    workspaceFolder.uri.fsPath,
                    config.excludeContentPatterns
                );
                
                let projectRootPath = workspaceFolder.uri.fsPath;
                let projectRootName = '';
                
                // Allow using selected folder as root for more focused project views
                // Useful when working with large monorepos or when sharing specific subsections
                if (options.useSelectedFolderAsRoot && itemsToProcess[0]) {
                    try {
                        const stats = await fs.stat(itemsToProcess[0].fsPath);
                        if (stats.isDirectory()) {
                            projectRootPath = itemsToProcess[0].fsPath;
                            projectRootName = path.basename(projectRootPath) + '/';
                        }
                    } catch (error) {
                        console.error('Error using selected folder as root:', error);
                    }
                }
                
                progress.report({ increment: 15, message: "Generating project tree..." });
                let projectTree = '';
                if (includeProjectTree) {
                    projectTree = await ProjectTreeGenerator.generateProjectTree(
                        projectRootPath,
                        ig,
                        config.maxDepth,
                        0,
                        ''
                    );
                    
                    if (options.useSelectedFolderAsRoot && projectRootName) {
                        projectTree = projectRootName + '\n' + projectTree;
                    }
                }

                if (options.structureOnly) {
                    progress.report({ increment: 60, message: 'Formatting structure...' });
                    const formattedContent = OutputFormatter.formatOutput(
                        config.outputFormat,
                        projectTree,
                        []
                    );

                    progress.report({ increment: 15, message: 'Copying structure to clipboard...' });
                    await vscode.env.clipboard.writeText(formattedContent);

                    const copySummary = buildCopySummary(
                        options,
                        projectRootPath,
                        config.outputFormat,
                        0
                    );
                    showCopyMessage(copySummary);

                    return;
                }
                
                let processedContent: FileContent[] = [];
                progress.report({ increment: 20, message: "Processing files..." });
                
                const processOptions: ProcessFileOptions = {
                    maxFileSize: config.maxFileSize,
                    shouldExcludeContent
                };
                
                const totalItems = itemsToProcess.length;
                for (let i = 0; i < totalItems; i++) {
                    if (token.isCancellationRequested) {
                        throw new Error('Operation cancelled');
                    }
                    
                    const item = itemsToProcess[i];
                    progress.report({ 
                        increment: 40 / totalItems, 
                        message: `Processing ${i + 1}/${totalItems}: ${path.basename(item.fsPath)}` 
                    });
                    
                    const stats = await fs.stat(item.fsPath);
                    if (stats.isDirectory()) {
                        const dirResults = await FileProcessor.processDirectory(
                            item.fsPath,
                            workspaceFolder.uri.fsPath,
                            ig,
                            processOptions
                        );
                        processedContent.push(...dirResults);
                    } else {
                        const fileContent = await FileProcessor.processFile(
                            item.fsPath,
                            workspaceFolder.uri.fsPath,
                            ig,
                            processOptions
                        );
                        if (fileContent) {
                            processedContent.push(fileContent);
                        }
                    }
                }
                
                progress.report({ increment: 10, message: "Formatting output..." });
                const formattedContent = OutputFormatter.formatOutput(
                    config.outputFormat,
                    projectTree,
                    processedContent
                );
                
                progress.report({ increment: 5, message: "Copying to clipboard..." });
                await vscode.env.clipboard.writeText(formattedContent);
                
                const copySummary = buildCopySummary(
                    options,
                    projectRootPath,
                    config.outputFormat,
                    processedContent.length
                );
                showCopyMessage(copySummary);
                
            } catch (error) {
                throw error;
            }
        });
    }
}

async function resolveOpenRootFolderTarget(uri?: vscode.Uri): Promise<ResolvedCopyTarget> {
    if (uri) {
        const resourceWorkspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (resourceWorkspaceFolder) {
            return {
                uri: resourceWorkspaceFolder.uri,
                rootLabel: resourceWorkspaceFolder.name
            };
        }
    }

    const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
    if (activeEditorUri) {
        const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditorUri);
        if (activeWorkspaceFolder) {
            return {
                uri: activeWorkspaceFolder.uri,
                rootLabel: activeWorkspaceFolder.name
            };
        }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 1) {
        return {
            uri: workspaceFolders[0].uri,
            rootLabel: workspaceFolders[0].name
        };
    }

    if (workspaceFolders.length > 1) {
        const selectedFolder = await vscode.window.showQuickPick(
            workspaceFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.fsPath,
                uri: folder.uri
            })),
            {
                placeHolder: 'Select a workspace folder to copy'
            }
        );

        if (selectedFolder) {
            return {
                uri: selectedFolder.uri,
                rootLabel: selectedFolder.label
            };
        }

        throw new Error('Workspace selection cancelled.');
    }

    throw new Error('No workspace open. Please open a folder or workspace.');
}

function buildSelectedItemsDetails(items: ReadonlyArray<vscode.Uri>): Pick<ProjectCopyOptions, 'detailsLabel' | 'detailsMessage' | 'rootLabel'> {
    if (items.length === 1) {
        return {
            detailsLabel: 'Show path',
            detailsMessage: items[0].fsPath,
            rootLabel: path.basename(items[0].fsPath)
        };
    }

    return {
        detailsLabel: 'Show copied items',
        detailsMessage: items.map(item => item.fsPath).join('\n'),
        rootLabel: `${items.length} selected items`
    };
}

function toPosixPath(value: string): string {
    return value.split(path.sep).join('/');
}

function getSelectedResources(
    uri?: vscode.Uri,
    uris?: ReadonlyArray<vscode.Uri>
): ReadonlyArray<vscode.Uri> {
    if (uris && uris.length > 0) {
        return uris;
    }

    return uri ? [uri] : [];
}

function pluralizeItems(count: number): string {
    return `${count} item${count === 1 ? '' : 's'}`;
}

function buildChangeSummary(
    action: 'exclude' | 'include',
    changed: ReadonlyArray<ExcludedContentTarget>,
    unchangedCount: number
): string {
    const verb = action === 'exclude' ? 'hidden from copy' : 'shown in copy';
    const unchangedSuffix = changed.length > 0 && unchangedCount > 0
        ? ` ${pluralizeItems(unchangedCount)} ${unchangedCount === 1 ? 'was' : 'were'} already ${action === 'exclude' ? 'hidden' : 'shown'}.`
        : '';

    if (changed.length === 0) {
        return action === 'exclude'
            ? `Contents were already hidden from copy for ${pluralizeItems(unchangedCount)}.`
            : `Contents were already shown in copy for ${pluralizeItems(unchangedCount)}.`;
    }

    if (changed.length === 1) {
        return `Contents ${verb}: ${changed[0].displayPath}.${unchangedSuffix}`;
    }

    return `Contents ${verb} for ${pluralizeItems(changed.length)}.${unchangedSuffix}`;
}

function isExcludedContentTreeItem(value: unknown): value is ExcludedContentTreeItem {
    return value instanceof ExcludedContentTreeItem;
}

async function createExcludedContentTarget(resource: vscode.Uri): Promise<ExcludedContentTarget> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (!workspaceFolder) {
        throw new Error('Selected item must be inside an open workspace folder.');
    }

    const stat = await vscode.workspace.fs.stat(resource);
    const relativePath = toPosixPath(path.relative(workspaceFolder.uri.fsPath, resource.fsPath));
    const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;

    return {
        workspaceFolder,
        pattern: isDirectory ? (relativePath ? `${relativePath}/**` : '**') : relativePath,
        displayPath: isDirectory ? (relativePath ? `${relativePath}/` : `${workspaceFolder.name}/`) : relativePath
    };
}

async function resolveExcludeTargets(
    uri?: vscode.Uri,
    uris?: ReadonlyArray<vscode.Uri>
): Promise<ReadonlyArray<ExcludedContentTarget>> {
    const items = getSelectedResources(uri, uris);
    if (items.length === 0) {
        throw new Error('No file or folder selected.');
    }

    return Promise.all(items.map(item => createExcludedContentTarget(item)));
}

async function resolveIncludeTargets(
    target?: vscode.Uri | ExcludedContentTreeItem,
    uris?: ReadonlyArray<vscode.Uri>
): Promise<ReadonlyArray<ExcludedContentTarget>> {
    if (isExcludedContentTreeItem(target)) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(target.entry.workspaceFolderUri));
        if (!workspaceFolder) {
            throw new Error('The workspace folder for this exclusion is no longer open.');
        }

        return [{
            workspaceFolder,
            pattern: target.entry.pattern,
            displayPath: target.entry.displayPath
        }];
    }

    return resolveExcludeTargets(target, uris);
}

async function applyExcludedContentUpdate(
    targets: ReadonlyArray<ExcludedContentTarget>,
    action: 'exclude' | 'include'
): Promise<{ changed: ExcludedContentTarget[]; unchangedCount: number; }> {
    const groupedTargets = new Map<string, { workspaceFolder: vscode.WorkspaceFolder; targets: ExcludedContentTarget[] }>();

    for (const target of targets) {
        const key = target.workspaceFolder.uri.toString();
        const existingGroup = groupedTargets.get(key);

        if (existingGroup) {
            if (!existingGroup.targets.some(item => item.pattern === target.pattern)) {
                existingGroup.targets.push(target);
            }
            continue;
        }

        groupedTargets.set(key, {
            workspaceFolder: target.workspaceFolder,
            targets: [target]
        });
    }

    const changed: ExcludedContentTarget[] = [];
    let unchangedCount = 0;

    for (const { workspaceFolder, targets: groupTargets } of groupedTargets.values()) {
        const config = vscode.workspace.getConfiguration('projectCopy', workspaceFolder.uri);
        const currentPatterns = config.get<string[]>('excludeContentPatterns', []);
        const targetPatterns = new Set(groupTargets.map(target => target.pattern));
        let nextPatterns = [...currentPatterns];

        if (action === 'exclude') {
            for (const target of groupTargets) {
                if (currentPatterns.includes(target.pattern)) {
                    unchangedCount += 1;
                    continue;
                }

                changed.push(target);
                nextPatterns.push(target.pattern);
            }

            nextPatterns = [...nextPatterns].sort((left, right) => left.localeCompare(right));
        } else {
            nextPatterns = currentPatterns.filter(pattern => !targetPatterns.has(pattern));

            for (const target of groupTargets) {
                if (currentPatterns.includes(target.pattern)) {
                    changed.push(target);
                } else {
                    unchangedCount += 1;
                }
            }

            nextPatterns = [...nextPatterns].sort((left, right) => left.localeCompare(right));
        }

        if (nextPatterns.join('\n') !== currentPatterns.join('\n')) {
            await config.update(
                'excludeContentPatterns',
                nextPatterns,
                vscode.ConfigurationTarget.WorkspaceFolder
            );
        }
    }

    return { changed, unchangedCount };
}

export function activate(context: vscode.ExtensionContext): void {
    const excludedContentViewProvider = new ExcludedContentViewProvider();
    const excludedContentView = vscode.window.createTreeView(EXCLUDED_CONTENT_VIEW_ID, {
        treeDataProvider: excludedContentViewProvider,
        showCollapseAll: false
    });

    const excludeContentCommand = vscode.commands.registerCommand(
        'projectCopy.excludeContent',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                const targets = await resolveExcludeTargets(uri, uris);
                const result = await applyExcludedContentUpdate(targets, 'exclude');
                excludedContentViewProvider.refresh();
                void vscode.window.showInformationMessage(
                    buildChangeSummary('exclude', result.changed, result.unchangedCount)
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const includeContentCommand = vscode.commands.registerCommand(
        'projectCopy.includeContent',
        async (target?: vscode.Uri | ExcludedContentTreeItem, uris?: vscode.Uri[]) => {
            try {
                const targets = await resolveIncludeTargets(target, uris);
                const result = await applyExcludedContentUpdate(targets, 'include');
                excludedContentViewProvider.refresh();
                void vscode.window.showInformationMessage(
                    buildChangeSummary('include', result.changed, result.unchangedCount)
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copyFileCommand = vscode.commands.registerCommand(
        'projectCopy.copyFile',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                const items = uris && uris.length > 0 ? uris : (uri ? [uri] : []);

                if (items.length === 0) {
                    throw new Error('No file selected.');
                }

                if (items.length > 1) {
                    throw new Error('Multiple items selected. Use Copy Contents on the selection instead.');
                }

                const selectedUri = items[0];
                const stat = await vscode.workspace.fs.stat(selectedUri);
                if ((stat.type & vscode.FileType.Directory) !== 0) {
                    throw new Error('Selected item is a folder. Use Copy Contents instead.');
                }

                await ProjectCopyService.copyToClipboard(selectedUri, undefined, {
                    copyKind: 'file',
                    rootLabel: path.basename(selectedUri.fsPath),
                    detailsLabel: 'Show path',
                    detailsMessage: selectedUri.fsPath
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copyFolderCommand = vscode.commands.registerCommand(
        'projectCopy.copyFolder',
        async (uri?: vscode.Uri) => {
            try {
                if (!uri) {
                    throw new Error('No folder selected.');
                }

                const stat = await vscode.workspace.fs.stat(uri);
                if ((stat.type & vscode.FileType.Directory) === 0) {
                    throw new Error('Selected item is a file. Use Copy Contents instead.');
                }

                await ProjectCopyService.copyToClipboard(uri, undefined, {
                    useSelectedFolderAsRoot: true,
                    copyKind: 'folder',
                    rootLabel: path.basename(uri.fsPath),
                    detailsLabel: 'Show path',
                    detailsMessage: uri.fsPath
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copyFolderStructureCommand = vscode.commands.registerCommand(
        'projectCopy.copyFolderStructure',
        async (uri?: vscode.Uri) => {
            try {
                if (!uri) {
                    throw new Error('No folder selected.');
                }

                const stat = await vscode.workspace.fs.stat(uri);
                if ((stat.type & vscode.FileType.Directory) === 0) {
                    throw new Error('Selected item is a file.');
                }

                await ProjectCopyService.copyToClipboard(uri, undefined, {
                    useSelectedFolderAsRoot: true,
                    structureOnly: true,
                    copyKind: 'folderStructure',
                    rootLabel: path.basename(uri.fsPath),
                    detailsLabel: 'Show path',
                    detailsMessage: uri.fsPath
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copySelectedItemsCommand = vscode.commands.registerCommand(
        'projectCopy.copySelectedItems',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                const items = uris && uris.length > 0 ? uris : (uri ? [uri] : []);
                if (items.length === 0) {
                    throw new Error('No items selected.');
                }

                if (items.length === 1) {
                    throw new Error('Only one item selected. Use Copy Contents instead.');
                }

                const firstWorkspaceFolder = vscode.workspace.getWorkspaceFolder(items[0]);
                const hasMultipleRoots = items.some(item => {
                    const itemWorkspaceFolder = vscode.workspace.getWorkspaceFolder(item);
                    return itemWorkspaceFolder?.uri.toString() !== firstWorkspaceFolder?.uri.toString();
                });

                if (hasMultipleRoots) {
                    throw new Error('Selected items must be in the same open root folder.');
                }

                const selectionDetails = buildSelectedItemsDetails(items);
                await ProjectCopyService.copyToClipboard(items[0], items, {
                    copyKind: 'selectedItems',
                    rootLabel: selectionDetails.rootLabel,
                    detailsLabel: selectionDetails.detailsLabel,
                    detailsMessage: selectionDetails.detailsMessage
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copyOpenRootFolderCommand = vscode.commands.registerCommand(
        'projectCopy.copyOpenRootFolder',
        async (uri?: vscode.Uri) => {
            try {
                const target = await resolveOpenRootFolderTarget(uri);
                await ProjectCopyService.copyToClipboard(target.uri, undefined, {
                    useSelectedFolderAsRoot: false,
                    copyKind: 'openRootFolder',
                    rootLabel: target.rootLabel,
                    detailsLabel: 'Show path',
                    detailsMessage: target.uri.fsPath
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const copyOpenRootFolderStructureCommand = vscode.commands.registerCommand(
        'projectCopy.copyOpenRootFolderStructure',
        async (uri?: vscode.Uri) => {
            try {
                const target = await resolveOpenRootFolderTarget(uri);
                await ProjectCopyService.copyToClipboard(target.uri, undefined, {
                    useSelectedFolderAsRoot: false,
                    structureOnly: true,
                    copyKind: 'openRootFolderStructure',
                    rootLabel: target.rootLabel,
                    detailsLabel: 'Show path',
                    detailsMessage: target.uri.fsPath
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );

    const excludeOpenRootContentCommand = vscode.commands.registerCommand(
        'projectCopy.excludeOpenRootContent',
        async (uri?: vscode.Uri) => {
            try {
                const target = await resolveOpenRootFolderTarget(uri);
                const exclusionTarget = await createExcludedContentTarget(target.uri);
                const result = await applyExcludedContentUpdate([exclusionTarget], 'exclude');
                excludedContentViewProvider.refresh();
                void vscode.window.showInformationMessage(
                    buildChangeSummary('exclude', result.changed, result.unchangedCount)
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Error: ${errorMessage}`);
            }
        }
    );
    
    context.subscriptions.push(
        excludedContentView,
        excludeContentCommand,
        includeContentCommand,
        copyFileCommand,
        copyFolderCommand,
        copyFolderStructureCommand,
        copySelectedItemsCommand,
        copyOpenRootFolderCommand,
        copyOpenRootFolderStructureCommand,
        excludeOpenRootContentCommand,
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('projectCopy.excludeContentPatterns')) {
                excludedContentViewProvider.refresh();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            excludedContentViewProvider.refresh();
        })
    );
}

export function deactivate(): void {}

// Export modern API for testing and external use
export { ConfigurationService } from './utils/configuration';
export { FileProcessor } from './utils/fileProcessor';
export { OutputFormatter } from './utils/formatters';
export { IgnoreUtils } from './utils/ignoreUtils';
export { ProjectTreeGenerator } from './utils/projectTree';


import * as path from 'path';
import * as vscode from 'vscode';

import { ConfigurationService } from './utils/configuration';

export const EXCLUDED_CONTENT_VIEW_ID = 'projectCopyExcludedContent';
export const EXCLUDED_CONTENT_ITEM_CONTEXT = 'projectCopyExcludedContentItem';

export interface ExcludedContentEntry {
    readonly workspaceFolderUri: string;
    readonly pattern: string;
    readonly displayPath: string;
}

function isWildcardPattern(pattern: string): boolean {
    return /[*?[\]{}!]/.test(pattern);
}

function getFolderPatternPath(pattern: string): string | undefined {
    if (pattern === '**') {
        return '';
    }

    if (pattern.endsWith('/**')) {
        return pattern.slice(0, -3);
    }

    return undefined;
}

function joinDescription(
    workspaceFolder: vscode.WorkspaceFolder,
    value: string,
    isMultiRoot: boolean
): string {
    return isMultiRoot ? `${workspaceFolder.name}: ${value}` : value;
}

function buildTreeItem(
    workspaceFolder: vscode.WorkspaceFolder,
    pattern: string,
    isMultiRoot: boolean
): ExcludedContentTreeItem {
    const folderPatternPath = getFolderPatternPath(pattern);

    if (folderPatternPath !== undefined) {
        const relativePath = folderPatternPath ? `${folderPatternPath}/` : `${workspaceFolder.name}/`;
        const resourceUri = folderPatternPath
            ? vscode.Uri.joinPath(workspaceFolder.uri, ...folderPatternPath.split('/'))
            : workspaceFolder.uri;

        return new ExcludedContentTreeItem(
            {
                workspaceFolderUri: workspaceFolder.uri.toString(),
                pattern,
                displayPath: relativePath
            },
            {
                label: folderPatternPath ? `${path.posix.basename(folderPatternPath) || folderPatternPath}/` : `${workspaceFolder.name}/`,
                description: joinDescription(workspaceFolder, relativePath, isMultiRoot),
                resourceUri,
                iconPath: new vscode.ThemeIcon('folder'),
                tooltip: `Content excluded from copy for ${relativePath}`
            }
        );
    }

    if (!isWildcardPattern(pattern)) {
        return new ExcludedContentTreeItem(
            {
                workspaceFolderUri: workspaceFolder.uri.toString(),
                pattern,
                displayPath: pattern
            },
            {
                label: path.posix.basename(pattern) || pattern,
                description: joinDescription(workspaceFolder, pattern, isMultiRoot),
                resourceUri: vscode.Uri.joinPath(workspaceFolder.uri, ...pattern.split('/')),
                iconPath: new vscode.ThemeIcon('file'),
                tooltip: `Content excluded from copy for ${pattern}`
            }
        );
    }

    return new ExcludedContentTreeItem(
        {
            workspaceFolderUri: workspaceFolder.uri.toString(),
            pattern,
            displayPath: pattern
        },
        {
            label: pattern,
            description: isMultiRoot ? workspaceFolder.name : 'Pattern',
            iconPath: new vscode.ThemeIcon('filter'),
            tooltip: `Content excluded from copy for pattern ${pattern}`
        }
    );
}

export class ExcludedContentTreeItem extends vscode.TreeItem {
    public constructor(
        public readonly entry: ExcludedContentEntry,
        treeItem: vscode.TreeItem
    ) {
        super(treeItem.label ?? entry.displayPath, vscode.TreeItemCollapsibleState.None);
        this.description = treeItem.description;
        this.tooltip = treeItem.tooltip;
        this.iconPath = treeItem.iconPath;
        this.resourceUri = treeItem.resourceUri;
        this.contextValue = EXCLUDED_CONTENT_ITEM_CONTEXT;
    }
}

export class ExcludedContentViewProvider implements vscode.TreeDataProvider<ExcludedContentTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ExcludedContentTreeItem | undefined | null | void>();

    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: ExcludedContentTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(_element?: ExcludedContentTreeItem): ExcludedContentTreeItem[] {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const isMultiRoot = workspaceFolders.length > 1;
        const items: ExcludedContentTreeItem[] = [];

        for (const workspaceFolder of workspaceFolders) {
            const config = ConfigurationService.getConfiguration(workspaceFolder.uri);
            const patterns = [...config.excludeContentPatterns].sort((left, right) => left.localeCompare(right));

            for (const pattern of patterns) {
                items.push(buildTreeItem(workspaceFolder, pattern, isMultiRoot));
            }
        }

        return items.sort((left, right) => {
            const workspaceFolderComparison = left.entry.workspaceFolderUri.localeCompare(right.entry.workspaceFolderUri);
            if (workspaceFolderComparison !== 0) {
                return workspaceFolderComparison;
            }

            return left.entry.displayPath.localeCompare(right.entry.displayPath);
        });
    }
}

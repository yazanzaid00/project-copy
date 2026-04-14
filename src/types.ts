import * as vscode from 'vscode';

export type CopyTargetKind =
    | 'openRootFolder'
    | 'openRootFolderStructure'
    | 'folder'
    | 'file'
    | 'selectedItems'
    | 'folderStructure';

export interface ProjectCopyOptions {
    readonly useSelectedFolderAsRoot?: boolean;
    readonly copyKind?: CopyTargetKind;
    readonly rootLabel?: string;
    readonly detailsLabel?: string;
    readonly detailsMessage?: string;
    readonly structureOnly?: boolean;
}

export interface FileContent {
    readonly path: string;
    readonly content: string;
}

export interface IgnoreLike {
    add(patterns: string | ReadonlyArray<string>): IgnoreLike;
    ignores(pathname: string): boolean;
}

export interface ProjectCopyConfiguration {
    readonly ignoreGitIgnore: boolean;
    readonly ignorePatterns: ReadonlyArray<string>;
    readonly maxDepth: number;
    readonly excludeContentPatterns: ReadonlyArray<string>;
    readonly outputFormat: OutputFormat;
    readonly maxFileSize: number;
    readonly includeProjectTree: boolean;
}

export interface ProcessFileOptions {
    maxFileSize: number;
    shouldExcludeContent: (filePath: string) => boolean;
}

export const OUTPUT_FORMATS = ['plaintext', 'markdown', 'xml'] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number];

export type ProgressReporter = vscode.Progress<{
    message?: string;
    increment?: number;
}>;

export type CancellationToken = vscode.CancellationToken; 

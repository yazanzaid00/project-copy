import * as vscode from 'vscode';
import { ProjectCopyConfiguration } from '../types';

const DEFAULT_IGNORE_PATTERNS = ['.*', 'node_modules', 'out/**', 'dist/**', 'coverage/**', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '*.log'];

export class ConfigurationService {
    private static readonly configSection = 'projectCopy';

    public static getConfiguration(scope?: vscode.ConfigurationScope): ProjectCopyConfiguration {
        const config = vscode.workspace.getConfiguration(this.configSection, scope);
        
        return {
            ignoreGitIgnore: config.get('ignoreGitIgnore', true),
            ignorePatterns: config.get('ignorePatterns', DEFAULT_IGNORE_PATTERNS),
            maxDepth: config.get('maxDepth', 5),
            excludeContentPatterns: config.get('excludeContentPatterns', []),
            outputFormat: config.get('outputFormat', 'markdown'),
            maxFileSize: config.get('maxFileSize', 1024 * 1024),
            includeProjectTree: config.get('includeProjectTree', true)
        };
    }
} 

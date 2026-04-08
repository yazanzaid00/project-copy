import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import { IgnoreLike } from '../types';

export class IgnoreUtils {
    
    public static createIgnoreInstance(
        patterns: ReadonlyArray<string> = []
    ): IgnoreLike {
        return ignore().add([...patterns]);
    }

    public static async addGitIgnoreRules(rootPath: string, ig: IgnoreLike): Promise<void> {
        try {
            const gitIgnorePath = path.join(rootPath, '.gitignore');
            const gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf8');
            ig.add(gitIgnoreContent);
        } catch (error) {
            console.log('No .gitignore file found or unable to read it');
        }
    }

    public static createContentExclusionFn(
        workspacePath: string,
        patterns: ReadonlyArray<string>
    ): (filePath: string) => boolean {
        if (!patterns || patterns.length === 0) {
            return () => false;
        }

        const ig = ignore().add(patterns as string[]);

        return (filePath: string): boolean => {
            const relativePath = path.relative(workspacePath, filePath);
            const relativePosix = relativePath.split(path.sep).join('/');
            return ig.ignores(relativePosix);
        };
    }
} 

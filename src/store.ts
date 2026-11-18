import * as vscode from 'vscode';
import { scanText, syntaxForPath, SUPPORTED_EXTENSIONS, TodoMatch } from './scanner';

export interface TodoItem extends TodoMatch {
  uri: vscode.Uri;
}

export const INCLUDE_GLOB = `**/*.{${SUPPORTED_EXTENSIONS.join(',')}}`;

function config() {
  return vscode.workspace.getConfiguration('whatTodo');
}

/** Holds the to-dos of every scanned file, keyed by URI. */
export class TodoStore implements vscode.Disposable {
  private readonly byFile = new Map<string, TodoItem[]>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  dispose() {
    this.emitter.dispose();
  }

  private excludeFolders(): string[] {
    return config().get<string[]>('excludeFolders', []);
  }

  isIncluded(uri: vscode.Uri): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.scheme !== uri.scheme) return false;
    if (!syntaxForPath(uri.path)) return false;
    const excluded = new Set(this.excludeFolders());
    const relative = vscode.workspace.asRelativePath(uri, false);
    return !relative.split('/').slice(0, -1).some(part => excluded.has(part));
  }

  async scanWorkspace(): Promise<void> {
    const folders = this.excludeFolders();
    const exclude = folders.length ? `**/{${folders.join(',')}}/**` : undefined;
    const uris = await vscode.workspace.findFiles(INCLUDE_GLOB, exclude);
    this.byFile.clear();
    const batchSize = 64;
    for (let i = 0; i < uris.length; i += batchSize) {
      await Promise.all(uris.slice(i, i + batchSize).map(uri => this.scanUri(uri, false)));
    }
    this.emitter.fire();
  }

  /** Rescan one file, preferring the in-memory text of an open document. */
  async scanUri(uri: vscode.Uri, notify = true): Promise<void> {
    if (!this.isIncluded(uri)) return;
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open) {
      this.scanDocument(open, notify);
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > config().get<number>('maxFileSizeKB', 1024) * 1024) {
        this.set(uri, [], notify);
        return;
      }
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      this.set(uri, this.scan(uri, text), notify);
    } catch {
      this.remove(uri, notify);
    }
  }

  scanDocument(doc: vscode.TextDocument, notify = true): void {
    if (!this.isIncluded(doc.uri)) return;
    this.set(doc.uri, this.scan(doc.uri, doc.getText()), notify);
  }

  remove(uri: vscode.Uri, notify = true): void {
    if (this.byFile.delete(uri.toString()) && notify) this.emitter.fire();
  }

  all(): TodoItem[] {
    return [...this.byFile.values()]
      .flat()
      .sort((a, b) =>
        a.uri.path.localeCompare(b.uri.path) || a.line - b.line || a.keywordStart - b.keywordStart);
  }

  private scan(uri: vscode.Uri, text: string): TodoItem[] {
    const syntax = syntaxForPath(uri.path);
    return syntax ? scanText(text, syntax).map(match => ({ ...match, uri })) : [];
  }

  private set(uri: vscode.Uri, items: TodoItem[], notify: boolean): void {
    const key = uri.toString();
    if (items.length) this.byFile.set(key, items);
    else this.byFile.delete(key);
    if (notify) this.emitter.fire();
  }
}

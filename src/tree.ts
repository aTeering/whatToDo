import * as vscode from 'vscode';
import * as path from 'node:path';
import { TodoItem, TodoStore } from './store';

export class FileNode {
  constructor(readonly uri: vscode.Uri, readonly items: TodoItem[]) {}
}

export class TodoNode {
  constructor(readonly item: TodoItem) {}
}

export type Node = FileNode | TodoNode;

export function todoLabel(item: TodoItem): string {
  return item.text || '(no description)';
}

export function location(item: TodoItem): string {
  return `${vscode.workspace.asRelativePath(item.uri)}:${item.line + 1}`;
}

export class TodoTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  groupByFile = true;
  showDone = true;
  filter = '';

  constructor(private readonly store: TodoStore) {}

  refresh() {
    this.emitter.fire(undefined);
  }

  visibleItems(): TodoItem[] {
    const needle = this.filter.toLowerCase();
    return this.store.all().filter(item =>
      (this.showDone || !item.done) &&
      (!needle || item.text.toLowerCase().includes(needle) || location(item).toLowerCase().includes(needle)));
  }

  getChildren(node?: Node): Node[] {
    if (node instanceof FileNode) return node.items.map(item => new TodoNode(item));
    if (node) return [];

    const items = this.visibleItems();
    if (!this.groupByFile) return items.map(item => new TodoNode(item));

    const groups = new Map<string, TodoItem[]>();
    for (const item of items) {
      const key = item.uri.toString();
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.values()].map(group => new FileNode(group[0].uri, group));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node instanceof FileNode) {
      const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Expanded);
      const dir = path.posix.dirname(vscode.workspace.asRelativePath(node.uri, false));
      const open = node.items.filter(t => !t.done).length;
      item.description = `${dir === '.' ? '' : dir + ' · '}${open}/${node.items.length}`;
      item.contextValue = 'file';
      return item;
    }

    const todo = node.item;
    const item = new vscode.TreeItem(todoLabel(todo), vscode.TreeItemCollapsibleState.None);
    item.description = this.groupByFile ? `line ${todo.line + 1}` : location(todo);
    item.checkboxState = todo.done
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.contextValue = todo.done ? 'todo.done' : 'todo.open';
    item.tooltip = new vscode.MarkdownString(
      `**${todo.keyword}** ${todoLabel(todo)}\n\n\`${location(todo)}\``);
    item.command = { command: 'whatTodo.open', title: 'Go to To-do', arguments: [node] };
    return item;
  }
}

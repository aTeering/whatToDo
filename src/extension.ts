import * as vscode from 'vscode';
import { INCLUDE_GLOB, TodoItem, TodoStore } from './store';
import { location, Node, TodoNode, TodoTreeProvider, todoLabel } from './tree';

function config() {
  return vscode.workspace.getConfiguration('whatTodo');
}

function itemOf(arg: unknown): TodoItem | undefined {
  return arg instanceof TodoNode ? arg.item : (arg as TodoItem | undefined);
}

export function activate(context: vscode.ExtensionContext) {
  const store = new TodoStore();
  const tree = new TodoTreeProvider(store);
  tree.groupByFile = config().get('groupByFile', true);
  tree.showDone = config().get('showDone', true);

  const view = vscode.window.createTreeView<Node>('whatTodo.list', {
    treeDataProvider: tree,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });

  const syncView = () => {
    const all = store.all();
    const open = all.filter(t => !t.done).length;
    view.badge = open ? { value: open, tooltip: `${open} open to-do${open === 1 ? '' : 's'}` } : undefined;
    view.message = tree.filter ? `Filter: "${tree.filter}"` : undefined;
    void vscode.commands.executeCommand('setContext', 'whatTodo.groupByFile', tree.groupByFile);
    void vscode.commands.executeCommand('setContext', 'whatTodo.showDone', tree.showDone);
    void vscode.commands.executeCommand('setContext', 'whatTodo.filtered', !!tree.filter);
    tree.refresh();
  };

  async function openTodo(item: TodoItem) {
    const range = new vscode.Range(item.line, item.keywordStart, item.line, item.contentEnd);
    await vscode.window.showTextDocument(item.uri, { selection: range, preview: true });
  }

  /** Apply an edit to the file holding `item`, after checking the scan isn't stale. */
  async function editTodo(item: TodoItem, build: (doc: vscode.TextDocument, edit: vscode.WorkspaceEdit) => void) {
    const doc = await vscode.workspace.openTextDocument(item.uri);
    const keywordRange = new vscode.Range(item.line, item.keywordStart, item.line, item.keywordEnd);
    if (doc.getText(keywordRange) !== item.keyword) {
      store.scanDocument(doc);
      void vscode.window.showWarningMessage('That to-do has moved since the last scan. The list has been refreshed, please try again.');
      return;
    }
    const wasDirty = doc.isDirty;
    const edit = new vscode.WorkspaceEdit();
    build(doc, edit);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage(`Could not edit ${vscode.workspace.asRelativePath(item.uri)}.`);
      return;
    }
    if (!wasDirty && config().get('saveAfterCheckOff', true)) await doc.save();
    store.scanDocument(doc);
  }

  /** Check off = rewrite the keyword to DONE; reopen = rewrite it back to TODO. */
  function setDone(item: TodoItem, done: boolean) {
    if (item.done === done) return Promise.resolve();
    return editTodo(item, (_doc, edit) => {
      edit.replace(item.uri, new vscode.Range(item.line, item.keywordStart, item.line, item.keywordEnd), done ? 'DONE' : 'TODO');
    });
  }

  function removeTodo(item: TodoItem) {
    return editTodo(item, (doc, edit) => {
      const lineText = doc.lineAt(item.line).text;
      const wholeLine = doc.lineAt(item.line).rangeIncludingLineBreak;

      if (item.commentStart !== undefined && item.commentEnd !== undefined) {
        // Comment opens and closes on this line: drop it, plus JSX `{...}` braces around it.
        let start = item.commentStart;
        let end = item.commentEnd;
        const before = lineText.slice(0, start);
        const after = lineText.slice(end);
        if (/\{\s*$/.test(before) && /^\s*\}/.test(after)) {
          start = before.lastIndexOf('{');
          end += after.indexOf('}') + 1;
        }
        if (!lineText.slice(0, start).trim() && !lineText.slice(end).trim()) {
          edit.delete(item.uri, wholeLine);
        } else {
          while (start > 0 && /\s/.test(lineText[start - 1])) start--;
          edit.delete(item.uri, new vscode.Range(item.line, start, item.line, end));
        }
        return;
      }

      // Inside a multi-line block comment: drop the line if it's only decoration + the to-do.
      const outside = lineText.slice(0, item.contentStart) + lineText.slice(item.contentEnd);
      const content = lineText.slice(item.contentStart, item.contentEnd);
      if (item.commentStart === undefined && item.commentEnd === undefined && !outside.trim() && /^[\s*]*/.test(content)) {
        edit.delete(item.uri, wholeLine);
      } else {
        edit.delete(item.uri, new vscode.Range(item.line, item.keywordStart, item.line, item.contentEnd));
      }
    });
  }

  async function listAll() {
    type Pick = vscode.QuickPickItem & { item?: TodoItem };
    const toggle: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Check off / reopen' };
    const picker = vscode.window.createQuickPick<Pick>();
    picker.placeholder = 'Search to-dos, Enter to open';
    picker.matchOnDescription = true;

    const build = () => {
      const picks: Pick[] = [];
      let lastFile = '';
      for (const item of tree.visibleItems()) {
        const file = vscode.workspace.asRelativePath(item.uri);
        if (file !== lastFile) {
          picks.push({ label: file, kind: vscode.QuickPickItemKind.Separator });
          lastFile = file;
        }
        picks.push({
          label: `${item.done ? '$(pass-filled)' : '$(circle-large-outline)'} ${todoLabel(item)}`,
          description: location(item),
          buttons: [toggle],
          item,
        });
      }
      const active = picker.activeItems[0]?.description;
      picker.items = picks;
      const keep = picks.find(p => p.description === active);
      if (keep) picker.activeItems = [keep];
      picker.title = `${tree.visibleItems().filter(t => !t.done).length} open to-dos`;
    };

    build();
    const sub = store.onDidChange(build);
    picker.onDidTriggerItemButton(e => e.item.item && void setDone(e.item.item, !e.item.item.done));
    picker.onDidAccept(() => {
      const item = picker.selectedItems[0]?.item;
      picker.hide();
      if (item) void openTodo(item);
    });
    picker.onDidHide(() => {
      sub.dispose();
      picker.dispose();
    });
    picker.show();
  }

  // Keep the store in sync: live typing (debounced), saves/creates/deletes on disk, closed editors.
  const pending = new Map<string, NodeJS.Timeout>();
  const watcher = vscode.workspace.createFileSystemWatcher(INCLUDE_GLOB);

  context.subscriptions.push(
    store,
    view,
    watcher,
    store.onDidChange(syncView),
    view.onDidChangeCheckboxState(e => {
      for (const [node, state] of e.items) {
        if (node instanceof TodoNode) void setDone(node.item, state === vscode.TreeItemCheckboxState.Checked);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!e.contentChanges.length || !store.isIncluded(e.document.uri)) return;
      const key = e.document.uri.toString();
      clearTimeout(pending.get(key));
      pending.set(key, setTimeout(() => {
        pending.delete(key);
        store.scanDocument(e.document);
      }, 300));
    }),
    vscode.workspace.onDidCloseTextDocument(doc => void store.scanUri(doc.uri)),
    watcher.onDidCreate(uri => void store.scanUri(uri)),
    watcher.onDidChange(uri => void store.scanUri(uri)),
    watcher.onDidDelete(uri => store.remove(uri)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.scanWorkspace()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('whatTodo.excludeFolders') || e.affectsConfiguration('whatTodo.maxFileSizeKB')) {
        void store.scanWorkspace();
      }
      if (e.affectsConfiguration('whatTodo.groupByFile') || e.affectsConfiguration('whatTodo.showDone')) {
        tree.groupByFile = config().get('groupByFile', true);
        tree.showDone = config().get('showDone', true);
        syncView();
      }
    }),
    { dispose: () => pending.forEach(clearTimeout) },

    vscode.commands.registerCommand('whatTodo.refresh', () =>
      vscode.window.withProgress({ location: { viewId: 'whatTodo.list' } }, () => store.scanWorkspace())),
    vscode.commands.registerCommand('whatTodo.list', listAll),
    vscode.commands.registerCommand('whatTodo.open', (arg: unknown) => {
      const item = itemOf(arg);
      if (item) return openTodo(item);
    }),
    vscode.commands.registerCommand('whatTodo.checkOff', (arg: unknown) => {
      const item = itemOf(arg);
      if (item) return setDone(item, true);
    }),
    vscode.commands.registerCommand('whatTodo.uncheck', (arg: unknown) => {
      const item = itemOf(arg);
      if (item) return setDone(item, false);
    }),
    vscode.commands.registerCommand('whatTodo.remove', async (arg: unknown) => {
      const item = itemOf(arg);
      if (!item) return;
      const answer = await vscode.window.showWarningMessage(
        `Remove "${todoLabel(item)}" from ${location(item)}?`, { modal: true }, 'Remove');
      if (answer === 'Remove') await removeTodo(item);
    }),
    vscode.commands.registerCommand('whatTodo.filter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Show only to-dos whose text or file path contains...',
        value: tree.filter,
      });
      if (value === undefined) return;
      tree.filter = value.trim();
      syncView();
    }),
    vscode.commands.registerCommand('whatTodo.clearFilter', () => {
      tree.filter = '';
      syncView();
    }),
    vscode.commands.registerCommand('whatTodo.groupByFile', () => config().update('groupByFile', true, vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('whatTodo.showFlat', () => config().update('groupByFile', false, vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('whatTodo.showDone', () => config().update('showDone', true, vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('whatTodo.hideDone', () => config().update('showDone', false, vscode.ConfigurationTarget.Global)),
  );

  syncView();
  void store.scanWorkspace();
}

export function deactivate() {}

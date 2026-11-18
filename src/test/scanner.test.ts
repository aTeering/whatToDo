import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { scanText, syntaxForPath } from '../scanner';

function scan(file: string, text: string) {
  const syntax = syntaxForPath(file);
  assert.ok(syntax, `no syntax for ${file}`);
  return scanText(text, syntax);
}

test('matches every keyword variant', () => {
  const src = [
    '// todo: a',
    '// TODO: b',
    '// to do: c',
    '// TO DO: d',
    '// to-do: e',
    '// TO-DO: f',
  ].join('\n');
  const found = scan('a.ts', src);
  assert.deepEqual(found.map(t => t.text), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(found.map(t => t.keyword), ['todo', 'TODO', 'to do', 'TO DO', 'to-do', 'TO-DO']);
  assert.equal(found[0].keywordStart, 3);
  assert.equal(found[0].keywordEnd, 7);
});

test('ignores prose, strings and lookalikes', () => {
  const src = [
    'const url = "http://todo.com"; // nothing to do here',
    "const s = '// TODO not a comment';",
    'const t = `/* TODO nope */`;',
    '// todolist is a word',
    '// todo-list component',
    '// done with this, but lowercase',
  ].join('\n');
  assert.deepEqual(scan('a.js', src), []);
});

test('regex literals do not start comments', () => {
  const src = 'const re = /https?:\\/\\//; // TODO real one';
  const found = scan('a.js', src);
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'real one');
});

test('block comments, docblocks and JSX', () => {
  const src = [
    '/**',
    ' * Something.',
    ' * @todo handle errors',
    ' */',
    'const x = <div>{/* TODO: style this */}</div>;',
    "const y = <p>Don't</p>; // TO-DO fix apostrophes",
  ].join('\n');
  const found = scan('a.tsx', src);
  assert.deepEqual(found.map(t => [t.line, t.text]), [
    [2, 'handle errors'],
    [4, 'style this'],
    [5, 'fix apostrophes'],
  ]);
  assert.equal(found[1].commentStart, 16);
  assert.equal(found[1].commentEnd, 38);
});

test('PHP: //, #, block, HTML comments, ignores outside-tag text and attributes', () => {
  const src = [
    '<p>It\'s a todo page</p>',
    '<!-- TODO: html comment -->',
    '<?php',
    '#[Attribute] // to do: attr line',
    '# todo hash comment',
    '$a = "multi',
    '// TODO not a comment";',
    '/* TO DO block */',
    '?>',
    '<?= $x // TODO short tag ?> trailing',
  ].join('\n');
  const found = scan('a.php', src);
  assert.deepEqual(found.map(t => [t.line, t.text]), [
    [1, 'html comment'],
    [3, 'attr line'],
    [4, 'hash comment'],
    [7, 'block'],
    [9, 'short tag'],
  ]);
});

test('DONE marks checked-off items', () => {
  const found = scan('a.ts', '// DONE: shipped\n// TODO: not yet');
  assert.deepEqual(found.map(t => t.done), [true, false]);
});

test('CRLF line endings', () => {
  const found = scan('a.ts', '// TODO one\r\n// TODO two\r\n');
  assert.deepEqual(found.map(t => t.text), ['one', 'two']);
  assert.equal(found[0].contentEnd, 11);
});

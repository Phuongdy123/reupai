import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('next/dist/compiled/babel/parser');
const traverse = require('next/dist/compiled/babel/traverse').default;
const browserGlobals = new Set(('AbortController AbortSignal Array Boolean CSS CustomEvent Date Error Event FileReader Intl JSON Map Math Number Object Promise Set String URL URLSearchParams alert confirm console crypto decodeURIComponent encodeURIComponent eval undefined').split(' '));

for (const module of ['sources-runtime', 'process-config-controller', 'process-config-dialog']) {
  test(`${module} has no missing lexical dependencies after code splitting`, () => {
    const code = readFileSync(new URL(`../src/legacy/${module}.js`, import.meta.url), 'utf8');
    const missing = new Set();
    traverse(parse(code, { sourceType: 'module' }), {
      ReferencedIdentifier(path) {
        if (!path.scope.getBinding(path.node.name) && !browserGlobals.has(path.node.name)) missing.add(path.node.name);
      },
    });
    assert.deepEqual([...missing], []);
  });
}

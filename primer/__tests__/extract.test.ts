import { describe, expect, it } from 'vitest';
import { extractorSupports, observeEdit, observeFile } from '../src/extract/index.js';

describe('AST style extractor (tree-sitter)', () => {
  it('knows which files it supports', () => {
    expect(extractorSupports('a.ts')).toBe(true);
    expect(extractorSupports('a.tsx')).toBe(true);
    expect(extractorSupports('a.py')).toBe(true);
    expect(extractorSupports('a.md')).toBe(false);
  });

  it('observes var -> const', async () => {
    const o = await observeEdit('a.ts', 'var x = 1', 'const x = 1');
    expect(o.some((x) => x.category === 'structure' && /const/i.test(x.statement))).toBe(true);
  });

  it('observes .then -> async/await', async () => {
    const o = await observeEdit('a.ts', 'doThing().then(r => use(r))', 'const r = await doThing(); use(r)');
    expect(o.some((x) => x.category === 'async')).toBe(true);
  });

  it('observes added type annotations', async () => {
    const o = await observeEdit('a.ts', 'function f(a){ return a }', 'function f(a: string): string { return a }');
    expect(o.some((x) => x.category === 'types')).toBe(true);
  });

  it('observes a python docstring added', async () => {
    const o = await observeEdit('a.py', 'def f():\n    return 1', 'def f():\n    """docs"""\n    return 1');
    expect(o.some((x) => x.category === 'comments')).toBe(true);
  });

  it('observeFile returns dominant facts', async () => {
    const facts = await observeFile('a.ts', 'const x = 1; const f = () => x; import { a } from "b";');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((x) => x.category === 'structure')).toBe(true);
  });

  it('returns [] for unsupported files', async () => {
    expect(await observeEdit('a.md', 'x', 'y')).toEqual([]);
    expect(await observeFile('a.md', 'x')).toEqual([]);
  });

  it('supports 20+ programming languages', () => {
    for (const f of ['a.go', 'a.rs', 'a.java', 'a.rb', 'a.php', 'a.swift', 'a.kt', 'a.c', 'a.cpp', 'a.cs', 'a.lua', 'a.scala', 'a.ex']) {
      expect(extractorSupports(f)).toBe(true);
    }
  });

  it('extracts naming case across languages', async () => {
    const ts = await observeFile('a.ts', 'const my_var = 1; const other_name = 2; const third_one = 3;');
    expect(ts.some((o) => o.category === 'naming' && /snake_case/.test(o.statement))).toBe(true);

    const go = await observeFile('m.go', 'package main\nfunc doThing() int { return 1 }\nfunc makeIt() int { return 2 }\nfunc runIt() int { return 3 }');
    expect(go.some((o) => o.category === 'naming' && /camelCase/.test(o.statement))).toBe(true);

    const rust = await observeFile('m.rs', 'fn do_thing(){} fn make_it(){} fn run_it(){}\nstruct MyThing{}\nstruct OtherThing{}');
    expect(rust.some((o) => /snake_case for variable/.test(o.statement))).toBe(true);
    expect(rust.some((o) => /PascalCase for type/.test(o.statement))).toBe(true);

    const java = await observeFile('M.java', 'class FooBar {}\nclass BazQux {}');
    expect(java.some((o) => /PascalCase for type/.test(o.statement))).toBe(true);
  });
});

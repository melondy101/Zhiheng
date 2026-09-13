// Guards the test gate itself (D-1).
//
// Background: `npm test` used to be a hand-maintained list of file paths. Over
// time 13 test files were added to disk but never appended to that list, so 69
// passing tests — including report-synthesis (the report quality gate) and
// zhihu-oauth (credential-exposure assertions) — never ran in CI. A broken
// change to those modules would not have failed the build.
//
// The script is now glob-based, so new files are picked up automatically. This
// test exists to make sure nobody silently regresses back to an explicit list
// that misses files, and that the globs actually cover every test directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directories whose *.test.* files must all be executed by `npm test`. */
const TEST_DIRS = ['tests/unit', 'tests/integration'] as const;

/** Recursively collect test files, mirroring what the globs are meant to match. */
function collectTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(full));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function readTestScript(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.test;
  assert.ok(script, 'package.json 缺少 scripts.test');
  return script;
}

test('每个测试目录都被 npm test 的 glob 覆盖', () => {
  const script = readTestScript();
  for (const dir of TEST_DIRS) {
    assert.ok(
      script.includes(`${dir}/**/`),
      `npm test 未覆盖目录 ${dir}——该目录下的测试将不会在 CI 中执行`
    );
  }
});

test('.ts 与 .tsx 两种后缀都被覆盖', () => {
  const script = readTestScript();
  const onDisk = TEST_DIRS.flatMap(collectTestFiles);
  const hasTsx = onDisk.some((f) => f.endsWith('.tsx'));

  assert.ok(script.includes('*.test.ts"'), 'npm test 未匹配 .test.ts 文件');
  if (hasTsx) {
    assert.ok(
      script.includes('*.test.tsx"'),
      '磁盘上存在 .test.tsx 文件，但 npm test 未匹配该后缀'
    );
  }
});

test('若回退为显式文件列表，则列表必须完整', () => {
  const script = readTestScript();
  // Glob-based script: nothing to verify file-by-file.
  if (script.includes('**/')) return;

  const onDisk = TEST_DIRS.flatMap(collectTestFiles);
  const missing = onDisk.filter((file) => !script.includes(file));
  assert.deepEqual(
    missing,
    [],
    `以下测试文件存在于磁盘但不会被 npm test 执行：\n  ${missing.join('\n  ')}`
  );
});

test('测试目录中确实存在测试文件（防止 glob 静默匹配为空）', () => {
  for (const dir of TEST_DIRS) {
    const files = collectTestFiles(dir);
    assert.ok(files.length > 0, `${dir} 下没有找到任何测试文件`);
  }
});

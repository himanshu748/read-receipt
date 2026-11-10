import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './parse.js';
import { hunkId } from './hash.js';

describe('parseUnifiedDiff', () => {
  it('parses a modify hunk', () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,1 +10,1 @@
-old line
+new line
`;
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    const h = hunks[0]!;
    expect(h.file).toBe('src/a.ts');
    expect(h.kind).toBe('modify');
    expect(h.removed).toEqual(['old line']);
    expect(h.added).toEqual(['new line']);
    expect(h.oldStart).toBe(10);
    expect(h.newStart).toBe(10);
    expect(h.range).toEqual({ start: 10, end: 10 });
    expect(h.lineCount).toBe(1);
    expect(h.id).toBe(hunkId('src/a.ts', ['old line'], ['new line']));
  });

  it('parses an add-only hunk', () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -4,0 +5,2 @@
+alpha
+beta
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.kind).toBe('add');
    expect(h.added).toEqual(['alpha', 'beta']);
    expect(h.removed).toEqual([]);
    expect(h.range).toEqual({ start: 5, end: 6 });
    expect(h.lineCount).toBe(2);
  });

  it('parses a delete-only hunk with single anchor range', () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -8,2 +7,0 @@
-gone1
-gone2
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.kind).toBe('delete');
    expect(h.removed).toEqual(['gone1', 'gone2']);
    expect(h.added).toEqual([]);
    expect(h.range).toEqual({ start: 7, end: 7 });
    expect(h.lineCount).toBe(2);
  });

  it('anchors a delete at SOF to line 1', () => {
    const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,1 +0,0 @@
-only
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.kind).toBe('delete');
    expect(h.newStart).toBe(0);
    expect(h.range).toEqual({ start: 1, end: 1 });
  });

  it('parses a new file', () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..abc
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+one
+two
+three
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.file).toBe('new.ts');
    expect(h.kind).toBe('add');
    expect(h.added).toEqual(['one', 'two', 'three']);
    expect(h.range).toEqual({ start: 1, end: 3 });
  });

  it('parses a deleted file', () => {
    const diff = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index abc..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.file).toBe('gone.ts');
    expect(h.kind).toBe('delete');
    expect(h.removed).toEqual(['bye', 'now']);
    expect(h.range).toEqual({ start: 1, end: 1 });
  });

  it('normalizes CRLF in hunk bodies', () => {
    const diff =
      'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\r\n+new\r\n';
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.removed).toEqual(['old']);
    expect(h.added).toEqual(['new']);
    expect(h.id).toBe(hunkId('x', ['old'], ['new']));
  });

  it('strips \\ No newline at end of file markers', () => {
    const diff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.removed).toEqual(['old']);
    expect(h.added).toEqual(['new']);
    expect(h.removed.join('\n')).not.toMatch(/No newline/);
  });

  it('handles unicode paths', () => {
    const diff = `diff --git a/café/文件.ts b/café/文件.ts
--- a/café/文件.ts
+++ b/café/文件.ts
@@ -1 +1 @@
-a
+b
`;
    const h = parseUnifiedDiff(diff)[0]!;
    expect(h.file).toBe('café/文件.ts');
  });

  it('skips binary files', () => {
    const diff = `diff --git a/img.png b/img.png
index 111..222 100644
Binary files a/img.png and b/img.png differ
diff --git a/ok.ts b/ok.ts
--- a/ok.ts
+++ b/ok.ts
@@ -1 +1 @@
-a
+b
`;
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.file).toBe('ok.ts');
  });

  it('parses multiple files and hunks', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a1
+a2
@@ -5,0 +6,1 @@
+extra
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -2 +2 @@
-b1
+b2
`;
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(3);
    expect(hunks.map((h) => h.file)).toEqual(['a.ts', 'a.ts', 'b.ts']);
  });

  it('returns empty for empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('\n')).toEqual([]);
  });
});

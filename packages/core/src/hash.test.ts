import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hunkId } from './hash.js';
import { parseUnifiedDiff } from './parse.js';

describe('hunkId', () => {
  it('matches sha256 first 20 hex of rr1 payload', () => {
    const file = 'src/x.ts';
    const removed = ['a', 'b'];
    const added = ['c'];
    const expected = createHash('sha256')
      .update(`rr1\0${file}\0${removed.join('\n')}\0${added.join('\n')}`, 'utf8')
      .digest('hex')
      .slice(0, 20);
    expect(hunkId(file, removed, added)).toBe(expected);
  });

  it('is stable across line-number shifts (same content)', () => {
    const d1 = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -10,1 +10,1 @@
-old
+new
`;
    const d2 = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -40,1 +40,1 @@
-old
+new
`;
    const h1 = parseUnifiedDiff(d1)[0]!;
    const h2 = parseUnifiedDiff(d2)[0]!;
    expect(h1.id).toBe(h2.id);
    expect(h1.oldStart).not.toBe(h2.oldStart);
  });

  it('changes when hunk content edits', () => {
    const a = hunkId('f.ts', ['old'], ['new']);
    const b = hunkId('f.ts', ['old'], ['newer']);
    const c = hunkId('f.ts', ['older'], ['new']);
    const d = hunkId('other.ts', ['old'], ['new']);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

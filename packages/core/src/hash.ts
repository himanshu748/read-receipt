import { createHash } from 'node:crypto';
import type { HunkId } from '@rr/protocol';

/** First 20 hex chars of sha256("rr1\\0" + file + "\\0" + removed + "\\0" + added). */
export function hunkId(
  file: string,
  removed: string[],
  added: string[],
): HunkId {
  const payload = `rr1\0${file}\0${removed.join('\n')}\0${added.join('\n')}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 20);
}

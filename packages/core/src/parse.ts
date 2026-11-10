import type { Hunk } from '@rr/protocol';
import { hunkId } from './hash.js';

const HUNK_HEADER =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/** Strip CR so CRLF and LF diffs hash identically. */
export function normalizeLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line.replace(/\r/g, '');
}

/**
 * Parse a unified diff (`git diff -U0` style) into hunks.
 * Binary file sections are skipped. `\ No newline at end of file` markers are ignored.
 */
export function parseUnifiedDiff(text: string): Hunk[] {
  const lines = text.split(/\n/);
  const hunks: Hunk[] = [];

  let file: string | null = null;
  let skipFile = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('diff --git ')) {
      skipFile = false;
      file = parseDiffGitPath(line);
      i += 1;
      continue;
    }

    if (
      line.startsWith('Binary files ') ||
      line.startsWith('GIT binary patch')
    ) {
      skipFile = true;
      i += 1;
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (!skipFile) {
        const p = parsePlusPlusPlus(line);
        if (p !== null) file = p;
      }
      i += 1;
      continue;
    }

    if (
      line.startsWith('--- ') ||
      line.startsWith('index ') ||
      line.startsWith('new file ') ||
      line.startsWith('deleted file ') ||
      line.startsWith('old mode ') ||
      line.startsWith('new mode ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('rename ') ||
      line.startsWith('copy ') ||
      line.startsWith('dissimilarity ')
    ) {
      i += 1;
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header && file && !skipFile) {
      const oldStart = Number(header[1]);
      const oldLines = header[2] !== undefined ? Number(header[2]) : 1;
      const newStart = Number(header[3]);
      const newLines = header[4] !== undefined ? Number(header[4]) : 1;

      const removed: string[] = [];
      const added: string[] = [];
      i += 1;

      while (i < lines.length) {
        const body = lines[i] ?? '';
        if (
          body.startsWith('diff --git ') ||
          body.startsWith('@@ ') ||
          body.startsWith('Binary files ') ||
          body.startsWith('GIT binary patch')
        ) {
          break;
        }
        if (body.startsWith('\\')) {
          i += 1;
          continue;
        }
        if (body.startsWith('+')) {
          added.push(normalizeLine(body.slice(1)));
          i += 1;
          continue;
        }
        if (body.startsWith('-')) {
          removed.push(normalizeLine(body.slice(1)));
          i += 1;
          continue;
        }
        if (body.startsWith(' ')) {
          i += 1;
          continue;
        }
        break;
      }

      hunks.push(
        buildHunk(file, oldStart, oldLines, newStart, newLines, removed, added),
      );
      continue;
    }

    i += 1;
  }

  return hunks;
}

function buildHunk(
  file: string,
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
  removed: string[],
  added: string[],
): Hunk {
  let kind: Hunk['kind'];
  if (removed.length === 0 && added.length > 0) kind = 'add';
  else if (added.length === 0 && removed.length > 0) kind = 'delete';
  else kind = 'modify';

  let range: { start: number; end: number };
  if (kind === 'delete') {
    const anchor = newStart > 0 ? newStart : 1;
    range = { start: anchor, end: anchor };
  } else if (added.length > 0) {
    range = { start: newStart, end: newStart + added.length - 1 };
  } else {
    const anchor = newStart > 0 ? newStart : 1;
    range = { start: anchor, end: anchor };
  }

  return {
    id: hunkId(file, removed, added),
    file,
    kind,
    oldStart,
    oldLines,
    newStart,
    newLines,
    added,
    removed,
    range,
    lineCount: kind === 'delete' ? removed.length : added.length,
  };
}

/** `diff --git a/foo b/foo` → `foo` (POSIX path). */
function parseDiffGitPath(line: string): string | null {
  const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!m) return null;
  return (m[2] ?? '').replace(/\\/g, '/');
}

function parsePlusPlusPlus(line: string): string | null {
  if (line === '+++ /dev/null' || line.startsWith('+++ /dev/null\t')) {
    return null;
  }
  if (line.startsWith('+++ b/')) {
    const rest = line.slice('+++ b/'.length).split('\t')[0] ?? '';
    return rest.replace(/\\/g, '/');
  }
  if (line.startsWith('+++ ')) {
    const rest = line.slice(4).split('\t')[0] ?? '';
    if (rest === '/dev/null') return null;
    return rest.replace(/^\w\//, '').replace(/\\/g, '/');
  }
  return null;
}

/** Split file contents into lines the way git diff would show them. */
export function splitContentLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.length === 0) return [];
  const parts = normalized.split('\n');
  if (normalized.endsWith('\n')) parts.pop();
  return parts.map(normalizeLine);
}

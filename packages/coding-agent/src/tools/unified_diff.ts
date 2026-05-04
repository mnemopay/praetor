/**
 * Praetor-native unified-diff applier. Replaces the `diff` npm dep in the
 * `edit_file` tool's default codepath, per `feedback_praetor_native_tools.md`.
 *
 * Strict by design: every context (` `) and removed (`-`) line in a hunk
 * must match the source exactly at the hunk's recorded position. On
 * mismatch we return `null` so the caller fails loud — the drift-tolerant
 * alternative is `apply_edit({ oldString, newString })`, not silent fuzzy
 * patching.
 *
 * Format reference: GNU diff `--unified` output.
 *   --- a/<file>
 *   +++ b/<file>
 *   @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@
 *    context line
 *   -removed line
 *   +added line
 *
 * No support for binary diffs, rename headers, multi-file patches in one
 * stream, or trailing `\ No newline at end of file` markers (those are
 * preserved verbatim if present in source/target).
 */

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Raw lines including the leading marker character. */
  lines: string[];
}

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function parseUnifiedDiff(patch: string): Hunk[] {
  const lines = patch.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = HUNK_HEADER.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const oldStart = Number(m[1]);
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !HUNK_HEADER.test(lines[i])) {
      const line = lines[i];
      // Headers prefixed with `--- ` / `+++ ` / `diff ` / `index ` are file-
      // level metadata, not hunk content. Stop accumulating once we hit one
      // (the next iteration of the outer loop will land at a header line).
      if (/^(---|\+\+\+|diff\s|index\s) /.test(line)) break;
      body.push(line);
      i += 1;
    }
    // Trailing empty string from the final \n on the patch is harmless;
    // strip it so downstream apply doesn't think it's a context line.
    if (body.length > 0 && body[body.length - 1] === "") body.pop();
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
  }
  return hunks;
}

/**
 * Apply a unified diff to `source`. Returns the patched string on success,
 * or `null` if any hunk fails to verify against the source.
 *
 * Hunks are applied in reverse order against the source's line array so
 * the line numbers in earlier hunks don't shift as later hunks delete /
 * insert lines.
 */
export function applyUnifiedDiff(source: string, patch: string): string | null {
  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) return source;

  // Preserve the source's newline style. If the source ends with \n, the
  // joined output should too. We split with a regex so \r\n and \n are both
  // recognised, then join with \n on output (callers that need CRLF can
  // re-encode).
  const trailingNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  if (trailingNewline) lines.pop(); // remove the artifact "" after the final \n

  // Apply in reverse so earlier line numbers stay valid.
  for (let h = hunks.length - 1; h >= 0; h -= 1) {
    const hunk = hunks[h];
    const result = applyHunk(lines, hunk);
    if (!result.ok) return null;
  }

  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function applyHunk(lines: string[], hunk: Hunk): { ok: boolean } {
  // Hunk line numbers are 1-based and refer to the OLD file. An oldStart=0
  // means the file was empty (pure-add hunk).
  const startIdx = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;

  // First pass: verify every context (` `) and remove (`-`) line matches.
  let cursor = startIdx;
  for (const raw of hunk.lines) {
    if (raw.length === 0) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") continue; // additions don't need to match source
    if (marker === " " || marker === "-") {
      if (cursor >= lines.length) return { ok: false };
      if (lines[cursor] !== text) return { ok: false };
      cursor += 1;
      continue;
    }
    if (marker === "\\") continue; // \ No newline at end of file — skip
    // Unknown marker — be strict and fail rather than guessing.
    return { ok: false };
  }

  // Second pass: rebuild the slice.
  const replacement: string[] = [];
  let consumed = 0;
  for (const raw of hunk.lines) {
    if (raw.length === 0) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === " ") {
      replacement.push(text);
      consumed += 1;
    } else if (marker === "-") {
      consumed += 1; // drop from output
    } else if (marker === "+") {
      replacement.push(text);
    } else if (marker === "\\") {
      // newline marker — no structural effect
    } else {
      return { ok: false };
    }
  }

  lines.splice(startIdx, consumed, ...replacement);
  return { ok: true };
}

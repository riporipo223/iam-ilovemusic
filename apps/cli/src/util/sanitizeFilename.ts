// Windows forbids <>:"/\|?* and control chars in filenames; macOS/Linux only
// really forbid / and NUL, but sanitizing to the Windows-safe subset keeps
// one code path correct on all three OSes instead of branching per platform.
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFilename(name: string, maxLength = 150): string {
  let sanitized = name.replace(INVALID_CHARS, '_').trim();
  // Windows also disallows a trailing dot or space on a filename component.
  sanitized = sanitized.replace(/[.\s]+$/, '');
  if (sanitized.length > maxLength) sanitized = sanitized.slice(0, maxLength).trim();
  return sanitized || 'untitled';
}

// Utility to normalize raw pasted lyrics into a clean multi-line string
// that preserves stanza breaks when stored and later displayed/exported.

export function formatLyrics(raw: string): string {
  let s = raw.trim()

  // Strip surrounding quotes if the entire blob is wrapped in matching quotes
  // e.g. '...multiline...' or "..."  (common when copying JS string literals)
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`'))
  ) {
    s = s.slice(1, -1).trim()
  }

  // Normalize line endings
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // If the text contains literal escaped newlines (\n as two chars) but no
  // real newlines, treat them as line breaks (e.g. pasted JS string).
  // Detect by checking for "\\n" and fewer real newlines than escaped.
  if (s.includes('\\n') && !s.includes('\n')) {
    s = s.replace(/\\n/g, '\n')
  } else if (s.includes('\\n')) {
    // Mixed case: also replace escaped sequences that are clearly escapes
    // but keep real newlines. Replace \n literals that are not part of real lines.
    // We replace all "\\n" with "\n" then collapse duplicate handling later.
    // Only do this when there are many escaped sequences (heuristic).
    const escapedCount = (s.match(/\\n/g) ?? []).length
    const realCount = (s.match(/\n/g) ?? []).length
    if (escapedCount > realCount) {
      s = s.replace(/\\n/g, '\n')
    }
  }
  // Also handle escaped \r\n
  s = s.replace(/\\r\\n/g, '\n').replace(/\\r/g, '\n')

  const lines = s.split('\n').map((line) => line.trimEnd().trimStart())

  // Collapse consecutive blank lines to at most one (preserve stanza gap)
  const collapsed: string[] = []
  let prevBlank = false
  for (const line of lines) {
    const isBlank = line.trim() === ''
    if (isBlank) {
      if (!prevBlank) collapsed.push('')
      prevBlank = true
    } else {
      collapsed.push(line)
      prevBlank = false
    }
  }

  // Trim leading/trailing blank lines
  while (collapsed.length > 0 && collapsed[0] === '') collapsed.shift()
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop()

  return collapsed.join('\n')
}

/** Read JSON values from public page configuration without evaluating source code. */
export function assignedJson(html: string, name: string): any {
  const pattern = new RegExp('(?:window\\.)?' + name + '\\s*=\\s*', 'g')
  for (const match of html.matchAll(pattern)) {
    const start = match.index + match[0].length
    let depth = 0, quoted = false, escaped = false
    for (let end = start; end < Math.min(html.length, start + 2_000_000); end++) {
      const char = html[end]
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue }
      if (char === '"') quoted = true
      else if (char === '[' || char === '{') depth++
      else if (char === ']' || char === '}') depth--
      if ((depth === 0 && (char === ']' || char === '}')) || char === ';') {
        try { return JSON.parse(html.slice(start, char === ';' ? end : end + 1)) } catch { break }
      }
    }
  }
  return null
}

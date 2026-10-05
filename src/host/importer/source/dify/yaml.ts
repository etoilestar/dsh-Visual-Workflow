import { WorkflowImportError } from "../../errors.js"

interface YamlLine { indent: number; text: string; number: number }

export function parseYamlDocument(source: string): unknown {
  if (source.trimStart().startsWith("{")) {
    try { return JSON.parse(source) as unknown } catch { throw new WorkflowImportError("invalid_yaml", "The import file is not valid YAML or JSON") }
  }
  const lines = source.split(/\r?\n/).flatMap((raw, index): YamlLine[] => {
    if (!raw.trim() || raw.trimStart().startsWith("#")) return []
    const indent = raw.length - raw.trimStart().length
    if (indent % 2 !== 0) throw new WorkflowImportError("invalid_yaml", `Unsupported indentation at line ${index + 1}`)
    return [{ indent, text: raw.trim(), number: index + 1 }]
  })
  if (lines.length === 0) throw new WorkflowImportError("invalid_yaml", "The import file is empty")
  const [value, next] = parseBlock(lines, 0, lines[0].indent)
  if (next !== lines.length) throw new WorkflowImportError("invalid_yaml", `Unexpected content at line ${lines[next].number}`)
  return value
}

function parseBlock(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  return lines[start].text.startsWith("- ") || lines[start].text === "-"
    ? parseSequence(lines, start, indent) : parseMapping(lines, start, indent)
}

function parseMapping(lines: YamlLine[], start: number, indent: number): [Record<string, unknown>, number] {
  const value: Record<string, unknown> = {}
  let index = start
  while (index < lines.length && lines[index].indent === indent && !lines[index].text.startsWith("- ")) {
    const [key, rest] = splitPair(lines[index])
    index += 1
    if (rest === "|" || rest === ">") {
      const block: string[] = []
      while (index < lines.length && lines[index].indent > indent) block.push(lines[index++].text)
      value[key] = block.join(rest === ">" ? " " : "\n")
    } else if (rest.length > 0) value[key] = parseScalar(rest)
    else if (index < lines.length && lines[index].indent > indent) [value[key], index] = parseBlock(lines, index, lines[index].indent)
    else value[key] = null
  }
  return [value, index]
}

function parseSequence(lines: YamlLine[], start: number, indent: number): [unknown[], number] {
  const value: unknown[] = []
  let index = start
  while (index < lines.length && lines[index].indent === indent && (lines[index].text === "-" || lines[index].text.startsWith("- "))) {
    const item = lines[index].text.slice(1).trim()
    index += 1
    if (!item) {
      if (index < lines.length && lines[index].indent > indent) { const parsed = parseBlock(lines, index, lines[index].indent); value.push(parsed[0]); index = parsed[1] }
      else value.push(null)
      continue
    }
    if (findColon(item) >= 0) {
      const synthetic: YamlLine = { indent: indent + 2, text: item, number: lines[index - 1].number }
      const childLines = [synthetic]
      while (index < lines.length && lines[index].indent > indent) childLines.push(lines[index++])
      const [mapped, consumed] = parseMapping(childLines, 0, indent + 2)
      if (consumed !== childLines.length) throw new WorkflowImportError("invalid_yaml", `Invalid sequence mapping at line ${synthetic.number}`)
      value.push(mapped)
    } else value.push(parseScalar(item))
  }
  return [value, index]
}

function splitPair(line: YamlLine): [string, string] {
  const colon = findColon(line.text)
  if (colon <= 0) throw new WorkflowImportError("invalid_yaml", `Expected a mapping at line ${line.number}`)
  const key = unquote(line.text.slice(0, colon).trim())
  return [key, stripComment(line.text.slice(colon + 1).trim())]
}

function findColon(text: string): number {
  let quote = ""
  for (let index = 0; index < text.length; index += 1) {
    if ((text[index] === "\"" || text[index] === "'") && text[index - 1] !== "\\") quote = quote === text[index] ? "" : quote || text[index]
    if (text[index] === ":" && !quote && (text[index + 1] === undefined || /\s/.test(text[index + 1]))) return index
  }
  return -1
}

function stripComment(value: string): string {
  const marker = value.indexOf(" #")
  return marker >= 0 ? value.slice(0, marker).trimEnd() : value
}

function parseScalar(value: string): unknown {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return unquote(value)
  if (value === "null" || value === "~") return null
  if (value === "true") return true
  if (value === "false") return false
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value)
  if (value.startsWith("[") || value.startsWith("{")) {
    try { return JSON.parse(value.replace(/'/g, "\"")) as unknown } catch { return value }
  }
  return value
}

function unquote(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try { return JSON.parse(value) as string } catch { return value.slice(1, -1) }
  }
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value
}

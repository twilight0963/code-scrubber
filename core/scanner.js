// Editor-independent credential scanner. Used by the VS Code extension and,
// later, by the CLI / pre-commit hook and the CI action.
const { rules, NON_SECRET_KEY_SUFFIX, SECRET_KEY_WORDS } = require('./rules')
const entropy = require('./entropy')
const filters = require('./filters')
const { maskSecret } = require('./mask')

let isGibberish = null
try {
  isGibberish = require('is-gibberish')
} catch {
  // Optional: without it, generic findings rely on entropy alone.
}

// Whole-file opt out (existing behaviour), and per-line opt outs.
const FILE_IGNORE = /ignore\.code-scrubber\.diagnostics/
const LINE_IGNORE = /code-scrubber:ignore(?!-next-line)/
const NEXT_LINE_IGNORE = /code-scrubber:ignore-next-line/

// Generic entropy candidates: quoted strings with no whitespace or escapes.
const QUOTED_STRING = /(["'`])([^"'`\s\\]{16,})\1/dg
// Unquoted `key = value` / `key: value` lines in config files.
const CONFIG_LINE = /^[ \t]*-?[ \t]*["']?([A-Za-z0-9_.-]+)["']?[ \t]*[:=][ \t]*([^\s"'`#]{6,})[ \t]*$/dgm
const CONFIG_EXTENSIONS = /\.(?:ya?ml|properties|ini|toml|cfg|conf|env(?:\.[\w-]+)?)$|(?:^|[\\/])\.env(?:\.[\w-]+)?$/i

// Lines longer than this are almost always minified or generated code.
const MAX_LINE_LENGTH = 2000
const MAX_FILE_BYTES = 1_000_000

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 }

// Paths never worth scanning: dependencies, VCS internals, lockfiles,
// minified/generated files and binaries.
const SKIP_DIRS = /(?:^|[\\/])(?:node_modules|\.git|\.vscode-test|__pycache__|\.venv|venv|\.tox|\.mypy_cache)(?:[\\/]|$)/
const SKIP_FILES = /(?:^|[\\/])(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|packages\.lock\.json)$/
const SKIP_EXTENSIONS = /\.(?:min\.js|min\.css|map|exe|dll|so|dylib|class|jar|o|out|bin|pyc|dmg|iso|zip|gz|tgz|bz2|xz|7z|rar|vsix|png|jpe?g|gif|bmp|ico|webp|svgz|pdf|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|wav|sqlite|db)$/i

function shouldSkipPath(filePath) {
  if (!filePath) return false
  return SKIP_DIRS.test(filePath) || SKIP_FILES.test(filePath) || SKIP_EXTENSIONS.test(filePath)
}

// Add the `d` flag so we get exact capture-group offsets.
const compiled = rules.map(rule => ({
  ...rule,
  regex: new RegExp(rule.regex.source, rule.regex.flags.includes('d') ? rule.regex.flags : rule.regex.flags + 'd')
}))

function buildLineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function lineOf(lineStarts, offset) {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lineText(text, lineStarts, line) {
  const start = lineStarts[line]
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length
  return text.slice(start, end)
}

// Identifier-looking values (bert-base-uncased, Bearer, my_app_secret) are
// names, not secrets. Real passwords almost always have a digit or symbol.
function looksLikeWord(value) {
  return /^[A-Za-z_-]+$/.test(value)
}

function passesGibberish(value) {
  if (!isGibberish) return true
  return isGibberish(value.toLowerCase())
}

/**
 * @typedef {Object} Finding
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {string} provider
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} secret   Raw value. Never print this; use `masked`.
 * @property {string} masked
 * @property {number} entropy
 * @property {number} start    Offset of the secret in the text
 * @property {number} end
 * @property {number} line     0-based
 * @property {number} column   0-based
 * @property {number} endLine
 * @property {number} endColumn
 */

/**
 * Scan a file's text for hardcoded credentials.
 * @param {string} text
 * @param {{ filePath?: string }} [options]
 * @returns {Finding[]}
 */
function scanText(text, options = {}) {
  const filePath = options.filePath || ''
  if (!text || text.length > MAX_FILE_BYTES) return []
  if (shouldSkipPath(filePath)) return []
  if (FILE_IGNORE.test(text)) return []

  const lineStarts = buildLineIndex(text)
  const candidates = []

  const add = (rule, start, end, secret) => {
    candidates.push({
      ruleId: rule.id,
      ruleName: rule.name,
      provider: rule.provider,
      confidence: rule.confidence,
      secret,
      masked: rule.revealMatch ? secret : maskSecret(secret),
      entropy: Number(entropy.shannonEntropy(secret).toFixed(2)),
      start,
      end
    })
  }

  // 1. Known formats and `secret = "..."` assignments.
  for (const rule of compiled) {
    rule.regex.lastIndex = 0
    for (const match of text.matchAll(rule.regex)) {
      const group = rule.group || 1
      const secret = match[group]
      if (!secret) continue
      const [start, end] = match.indices[group]

      if (filters.isFalsePositive(secret, rule.confidence)) continue
      if (rule.keyGroup) {
        const key = match[rule.keyGroup]
        if (NON_SECRET_KEY_SUFFIX.test(key)) continue
        if (looksLikeWord(secret)) continue
        if (secret.toLowerCase().includes(key.toLowerCase())) continue
      }
      add(rule, start, end, secret)
    }
  }

  // 2. Generic high-entropy quoted strings.
  const entropyRule = {
    id: 'high-entropy-string',
    name: 'High-entropy String',
    provider: 'generic',
    confidence: 'low'
  }
  for (const match of text.matchAll(QUOTED_STRING)) {
    const secret = match[2]
    const [start, end] = match.indices[2]
    if (lineText(text, lineStarts, lineOf(lineStarts, start)).length > MAX_LINE_LENGTH) continue
    if (!entropy.measure(secret).high) continue
    if (filters.isFalsePositive(secret, 'low')) continue
    if (!passesGibberish(secret)) continue
    add(entropyRule, start, end, secret)
  }

  // 3. Unquoted values in config files (YAML, .properties, .ini, .env ...).
  if (CONFIG_EXTENSIONS.test(filePath)) {
    const assignmentRule = compiled.find(r => r.id === 'generic-secret-assignment')
    for (const match of text.matchAll(CONFIG_LINE)) {
      const [key, secret] = [match[1], match[2]]
      const [start, end] = match.indices[2]
      if (SECRET_KEY_WORDS.test(key) && !NON_SECRET_KEY_SUFFIX.test(key)) {
        if (filters.isFalsePositive(secret, 'medium') || looksLikeWord(secret)) continue
        add(assignmentRule, start, end, secret)
      } else if (entropy.measure(secret).high && !filters.isFalsePositive(secret, 'low') && passesGibberish(secret)) {
        add(entropyRule, start, end, secret)
      }
    }
  }

  // Keep the most confident finding when ranges overlap.
  candidates.sort((a, b) =>
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || (b.end - b.start) - (a.end - a.start))
  const kept = []
  for (const c of candidates) {
    if (!kept.some(k => c.start < k.end && k.start < c.end)) kept.push(c)
  }

  // Apply inline ignore comments and attach positions.
  const findings = []
  for (const f of kept) {
    const line = lineOf(lineStarts, f.start)
    if (LINE_IGNORE.test(lineText(text, lineStarts, line))) continue
    if (line > 0 && NEXT_LINE_IGNORE.test(lineText(text, lineStarts, line - 1))) continue
    const endLine = lineOf(lineStarts, f.end)
    findings.push({
      ...f,
      line,
      column: f.start - lineStarts[line],
      endLine,
      endColumn: f.end - lineStarts[endLine]
    })
  }
  return findings.sort((a, b) => a.start - b.start)
}

module.exports = {
  scanText,
  shouldSkipPath
}

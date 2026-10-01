// Output formats: human-readable text, JSON, and SARIF 2.1.0 (for GitHub code
// scanning / PR annotations). None of them ever include the raw secret.
const { rules } = require('../core')
const { toPosix } = require('./config')

const pkg = require('../package.json')

const LEVEL_LABEL = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }
const SARIF_LEVEL = { high: 'error', medium: 'error', low: 'warning' }

const ROTATE_ADVICE = [
  'Rotate these credentials, don\'t just delete them.',
  'Anything that reached a commit stays in git history (and in every clone and fork),',
  'so removing it from the code does not make it safe. For each one:',
  '  1. Revoke or rotate it with the provider, and issue a new one.',
  '  2. Load the new value from an environment variable or a secret manager.',
  '  3. Optionally scrub history (git filter-repo / BFG). This is cleanup, not the fix.'
].join('\n')

function colors(enabled) {
  const wrap = code => s => enabled ? `\x1b[${code}m${s}\x1b[0m` : s
  return { red: wrap(31), green: wrap(32), yellow: wrap(33), dim: wrap(2), bold: wrap(1), cyan: wrap(36) }
}

// Only what's safe to print or store
function publicFields(r) {
  const out = {
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    provider: r.provider,
    confidence: r.confidence,
    file: toPosix(r.file),
    line: r.line + 1,
    column: r.column + 1,
    endLine: r.endLine + 1,
    endColumn: r.endColumn + 1,
    masked: r.masked,
    entropy: r.entropy,
    fingerprint: r.fingerprint,
    blocking: r.blocking
  }
  if (r.commit) out.commit = r.commit
  if (r.status) out.status = r.status
  return out
}

function formatText(results, { color = false, mode = 'scan', failOn, baselined = 0, rotated = [] } = {}) {
  const c = colors(color)
  const lines = []

  for (const r of rotated) {
    lines.push(c.green(`Key ${r.masked} was successfully rotated!`) +
      c.dim(` (${r.ruleName} in ${toPosix(r.file)}, leaked in ${r.commit.sha.slice(0, 10)})`))
  }
  if (rotated.length && results.length) lines.push('')
  const paint = r => r.blocking ? (r.confidence === 'low' ? c.yellow : c.red) : c.dim

  for (const r of results) {
    const where = `${toPosix(r.file)}:${r.line + 1}:${r.column + 1}`
    const label = paint(r)(LEVEL_LABEL[r.confidence].padEnd(6))
    lines.push(`${label}  ${c.bold(where)}  ${r.ruleName} ${c.dim(`(${r.ruleId})`)}  ${c.cyan(r.masked)}`)
    if (r.commit) {
      const status = r.status === 'history-only'
        ? c.yellow('deleted from the code, but still in git history')
        : 'still in the code'
      lines.push(`        ${c.dim(`introduced in ${r.commit.sha.slice(0, 10)} (${r.commit.date.slice(0, 10)}, ${r.commit.author})`)}; ${status}`)
    }
  }

  const blocking = results.filter(r => r.blocking)
  if (lines.length) lines.push('')
  const summary = `${results.length} finding${results.length === 1 ? '' : 's'}, ${blocking.length} at or above "${failOn}"` +
    (baselined ? `, ${baselined} accepted in baseline` : '')
  lines.push(blocking.length ? c.red(c.bold(summary)) : summary)

  if (blocking.length) {
    lines.push('')
    lines.push(ROTATE_ADVICE)
    lines.push('')
    lines.push(c.dim('False positive? Add a "code-scrubber:ignore" comment on the line, allowlist it in .code-scrubber.json,'))
    lines.push(c.dim('or accept existing findings with: code-scrubber scan --update-baseline'))
    if (mode === 'staged') {
      lines.push('')
      lines.push(c.red('Commit blocked by Code-Scrubber.'))
      lines.push(c.dim('To commit anyway (not recommended): git commit --no-verify'))
    }
  }
  return lines.join('\n') + '\n'
}

function formatJson(results, meta = {}, rotated = []) {
  return JSON.stringify({
    tool: 'code-scrubber',
    version: pkg.version,
    ...meta,
    findings: results.map(publicFields),
    ...(rotated.length ? { rotated: rotated.map(publicFields) } : {})
  }, null, 2) + '\n'
}

function formatSarif(results) {
  const used = [...new Set(results.map(r => r.ruleId))]
  const allRules = [
    ...rules,
    { id: 'high-entropy-string', name: 'High-entropy String', confidence: 'low' }
  ]
  const driverRules = used.map(id => {
    const rule = allRules.find(r => r.id === id) || { id, name: id, confidence: 'medium' }
    return {
      id,
      name: rule.name.replace(/[^A-Za-z0-9]/g, ''),
      shortDescription: { text: `${rule.name} detected` },
      fullDescription: { text: `A hardcoded ${rule.name} was found. ${ROTATE_ADVICE.split('\n')[0]}` },
      help: { text: ROTATE_ADVICE },
      defaultConfiguration: { level: SARIF_LEVEL[rule.confidence] },
      properties: { tags: ['security', 'secrets'], 'security-severity': rule.confidence === 'high' ? '9.0' : rule.confidence === 'medium' ? '7.0' : '4.0' }
    }
  })

  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Code-Scrubber',
          version: pkg.version,
          informationUri: pkg.repository.url,
          rules: driverRules
        }
      },
      results: results.map(r => ({
        ruleId: r.ruleId,
        ruleIndex: used.indexOf(r.ruleId),
        level: SARIF_LEVEL[r.confidence],
        message: {
          text: `${r.ruleName} detected: ${r.masked}.` +
            (r.status === 'history-only' ? ' It was deleted from the code but is still in git history.' : '') +
            ' Rotate it, don\'t just delete it.'
        },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: toPosix(r.file) },
            region: {
              startLine: r.line + 1,
              startColumn: r.column + 1,
              endLine: r.endLine + 1,
              endColumn: r.endColumn + 1
            }
          }
        }],
        partialFingerprints: { 'codeScrubber/v1': r.fingerprint },
        properties: {
          confidence: r.confidence,
          ...(r.commit ? { commit: r.commit.sha, status: r.status } : {})
        }
      }))
    }]
  }, null, 2) + '\n'
}

module.exports = {
  formatText,
  formatJson,
  formatSarif,
  ROTATE_ADVICE
}

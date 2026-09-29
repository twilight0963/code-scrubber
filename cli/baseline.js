// A baseline records findings a team has reviewed and accepted, so the check
// only fails on new ones. Entries are keyed by a fingerprint of rule + file +
// secret, so they survive the code moving around within the file. The secret
// itself is never written; only a hash of it, alongside the masked value.
const fs = require('fs')
const crypto = require('crypto')
const { toPosix } = require('./config')

function fingerprint(finding, file) {
  return crypto.createHash('sha256')
    .update(`${finding.ruleId}\0${toPosix(file)}\0${finding.secret}`)
    .digest('hex')
    .slice(0, 32)
}

function loadBaseline(file) {
  if (!file || !fs.existsSync(file)) return new Set()
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  return new Set((data.findings || []).map(f => f.fingerprint))
}

function writeBaseline(file, results) {
  const findings = results
    .map(r => ({ fingerprint: r.fingerprint, ruleId: r.ruleId, file: toPosix(r.file), line: r.line + 1, masked: r.masked }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  fs.writeFileSync(file, JSON.stringify({ version: 1, findings }, null, 2) + '\n')
  return findings.length
}

module.exports = {
  fingerprint,
  loadBaseline,
  writeBaseline
}

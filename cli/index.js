// Code-Scrubber command line: scan files, staged changes (pre-commit) or git
// history, and fail when findings reach the configured confidence level.
const fs = require('fs')
const path = require('path')
const { parseArgs } = require('util')
const core = require('../core')
const git = require('./git')
const { loadConfig, LEVELS, toPosix } = require('./config')
const { fingerprint, loadBaseline, writeBaseline } = require('./baseline')
const report = require('./report')
const hook = require('./hook')
const override = require('./override')

const HELP = `Usage: code-scrubber <command> [options]

Commands:
  scan [paths...]     Scan files and folders (default: current folder).
                      In a git repo, .gitignored files are skipped.
  staged              Scan lines added in the staged changes. Use as a pre-commit hook.
  history             Scan lines added in git history, including secrets that
                      were later deleted. Use --range to limit it (e.g. origin/main..HEAD).
  install-hook        Install a git pre-commit hook that runs "code-scrubber staged".

Options:
  --format <fmt>      text (default), json or sarif
  --output <file>     Write the report to a file (a text summary still goes to stdout)
  --fail-on <level>   high, medium (default), low or none
  --config <file>     Config file (default: .code-scrubber.json in the repo root)
  --baseline <file>   Baseline of accepted findings (default: .code-scrubber-baseline.json)
  --update-baseline   Accept all current findings into the baseline and exit 0
  --range <a..b>      history: commit range to scan (default: all branches and tags)
  --no-color          Disable coloured output
  --force             install-hook: replace an existing pre-commit hook
  --gui-override      staged: when a commit made from an app (not a terminal) is
                      blocked, offer "Commit Anyway" in a dialog; overrides are logged
  -h, --help          Show this help

Exit codes: 0 = no blocking findings, 1 = blocking findings, 2 = error
`

const RANK = { none: Infinity, low: 1, medium: 2, high: 3 }
const MAX_FILE_BYTES = 1_000_000

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0)
}

function decode(buffer) {
  if (!buffer || buffer.length > MAX_FILE_BYTES || isBinary(buffer)) return null
  return buffer.toString('utf8')
}

function walk(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full)
    if (core.shouldSkipPath(rel + (entry.isDirectory() ? '/' : ''))) continue
    if (entry.isDirectory()) walk(full, root, out)
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

// Files to scan, relative to root
function collectFiles(root, cwd, targets, inGit) {
  const rels = targets.map(t => path.relative(root, path.resolve(cwd, t)))
  if (inGit) {
    const under = (file, rel) => rel === '' || file === toPosix(rel) || file.startsWith(toPosix(rel) + '/')
    return git.listFiles(root).filter(file => rels.some(rel => under(file, rel)))
  }
  const files = []
  for (const rel of rels) {
    const full = path.join(root, rel)
    if (fs.statSync(full).isDirectory()) walk(full, root, files)
    else files.push(rel)
  }
  return files
}

function scanFiles(root, files, config) {
  const results = []
  for (const file of files) {
    if (core.shouldSkipPath(file) || config.isExcluded(file)) continue
    let buffer
    try {
      buffer = fs.readFileSync(path.join(root, file))
    } catch {
      continue // deleted but still tracked, broken symlink, etc.
    }
    const text = decode(buffer)
    if (text === null) continue
    for (const finding of core.scanText(text, { filePath: file })) {
      results.push({ ...finding, file })
    }
  }
  return results
}

function scanStaged(root, config) {
  const results = []
  for (const entry of git.stagedAddedLines(root)) {
    if (core.shouldSkipPath(entry.file) || config.isExcluded(entry.file)) continue
    // Scan the whole staged file so file-level ignore markers still apply,
    // then keep only findings on lines this commit adds.
    const text = decode(git.showBlob(root, '', entry.file))
    if (text === null) continue
    for (const finding of core.scanText(text, { filePath: entry.file })) {
      if (entry.lines.has(finding.line + 1)) results.push({ ...finding, file: entry.file })
    }
  }
  return results
}

// An encrypted .env can't be searched, so there is no way to tell whether a
// leaked key is still in use. History scans refuse to run until it's decrypted.
const ENCRYPTED_ENV_MESSAGE = 'Encrypted .env was detected, please decrypt it before starting the scan'

class EncryptedEnvError extends Error {
  constructor(file) {
    super(`${ENCRYPTED_ENV_MESSAGE} (${toPosix(file)})`)
    this.code = 'ENCRYPTED_ENV'
    this.file = file
  }
}

function checkEncryptedEnv(root) {
  const file = git.listEnvFiles(root).find(f => f.endsWith('.enc'))
  if (file) throw new EncryptedEnvError(file)
}

async function scanHistory(root, config, range, signal) {
  checkEncryptedEnv(root)
  // git log lists newest first, so the last hit for a fingerprint is the
  // commit that introduced the secret.
  const byFingerprint = new Map()

  // Current contents of the working tree and .env files, read on the first hit
  let current = null
  const loadCurrent = () => {
    const read = file => {
      try {
        return decode(fs.readFileSync(path.join(root, file))) || ''
      } catch {
        return '' // deleted but still tracked, broken symlink, etc.
      }
    }
    return {
      code: git.listFiles(root).map(read),
      env: git.listEnvFiles(root).map(read)
    }
  }

  // present: still in the code. history-only: gone from the code but still in
  // a .env file, so still in use. rotated: gone from both.
  const statusOf = secret => {
    current = current || loadCurrent()
    if (current.code.some(text => text.includes(secret))) return 'present'
    if (current.env.some(text => text.includes(secret))) return 'history-only'
    return 'rotated'
  }

  await git.historyAddedLines(root, range, entry => {
    if (core.shouldSkipPath(entry.file) || config.isExcluded(entry.file)) return
    // Cheap pass over just the added lines; only fetch the full file on a hit.
    const lineNumbers = [...entry.lines.keys()]
    const added = core.scanText([...entry.lines.values()].join('\n'), { filePath: entry.file })
    if (added.length === 0) return

    const text = decode(git.showBlob(root, entry.commit.sha, entry.file))
    const findings = text === null
      ? added.map(f => ({ ...f, line: lineNumbers[f.line] - 1, endLine: lineNumbers[f.endLine] - 1 }))
      : core.scanText(text, { filePath: entry.file }).filter(f => entry.lines.has(f.line + 1))

    for (const finding of findings) {
      const result = {
        ...finding,
        file: entry.file,
        commit: entry.commit,
        status: statusOf(finding.secret)
      }
      result.fingerprint = fingerprint(result, result.file)
      byFingerprint.set(result.fingerprint, result)
    }
  }, signal)
  return [...byFingerprint.values()]
}

function installHook(root, force) {
  const cliPath = path.resolve(__dirname, '..', 'bin', 'code-scrubber.js')
  // The Node running this command is the fallback when `node` isn't on the
  // PATH git uses (common for GUI git clients)
  const { result, path: file } = hook.installHook(root, { cliPath, fallbackNode: process.execPath, force })
  if (result === 'foreign') {
    throw new Error(`${file} already exists. Re-run with --force to replace it, or add this line to it:\n  ${hook.manualHookLine(cliPath)}`)
  }
  return file
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [io]
 * @returns {Promise<number>} exit code
 */
async function main(argv, io = {}) {
  const cwd = io.cwd || process.cwd()
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr

  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: 'string', default: 'text' },
        output: { type: 'string' },
        'fail-on': { type: 'string' },
        config: { type: 'string' },
        baseline: { type: 'string' },
        'update-baseline': { type: 'boolean', default: false },
        range: { type: 'string' },
        'no-color': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        'gui-override': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false }
      }
    })
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}`)
    return 2
  }

  const { values: opts, positionals } = args
  const command = positionals[0] || 'scan'
  if (opts.help || command === 'help') {
    stdout.write(HELP)
    return 0
  }

  try {
    if (!['text', 'json', 'sarif'].includes(opts.format)) {
      throw new Error(`Unknown --format "${opts.format}"`)
    }
    const gitRoot = git.gitRoot(cwd)
    const root = gitRoot || cwd
    const needGit = () => {
      if (!gitRoot) throw new Error(`"${command}" needs to run inside a git repository`)
    }

    if (command === 'install-hook') {
      needGit()
      stdout.write(`Installed pre-commit hook at ${installHook(root, opts.force)}\n`)
      return 0
    }

    const config = loadConfig(root, opts.config)
    const failOn = opts['fail-on'] || config.failOn
    if (!LEVELS.includes(failOn)) throw new Error(`--fail-on must be one of ${LEVELS.join(', ')}`)

    let results
    if (command === 'scan') {
      const files = collectFiles(root, cwd, positionals.slice(1).length ? positionals.slice(1) : ['.'], Boolean(gitRoot))
      results = scanFiles(root, files, config)
    } else if (command === 'staged') {
      needGit()
      results = scanStaged(root, config)
    } else if (command === 'history') {
      needGit()
      results = await scanHistory(root, config, opts.range || null)
    } else {
      throw new Error(`Unknown command "${command}"`)
    }

    results = results.filter(r => !config.isAllowed(r, r.file))
    for (const r of results) r.fingerprint = r.fingerprint || fingerprint(r, r.file)
    // Keys that left history and the code and .env are fixed, not findings
    const rotated = results.filter(r => r.status === 'rotated')
    results = results.filter(r => r.status !== 'rotated')

    const baselinePath = path.resolve(root, opts.baseline || config.baseline)
    if (opts['update-baseline']) {
      const count = writeBaseline(baselinePath, results)
      stdout.write(`Wrote ${count} finding${count === 1 ? '' : 's'} to ${path.relative(cwd, baselinePath) || baselinePath}\n`)
      return 0
    }

    const accepted = loadBaseline(baselinePath)
    const baselined = results.filter(r => accepted.has(r.fingerprint)).length
    results = results.filter(r => !accepted.has(r.fingerprint))
    for (const r of results) r.blocking = RANK[r.confidence] >= RANK[failOn]
    results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

    const color = !opts['no-color'] && !process.env.NO_COLOR && Boolean(stdout.isTTY)
    const text = report.formatText(results, { color, mode: command, failOn, baselined, rotated })
    const formatted = opts.format === 'json'
      ? report.formatJson(results, { command, failOn, baselined }, rotated)
      : opts.format === 'sarif' ? report.formatSarif(results) : text

    if (opts.output) {
      fs.writeFileSync(path.resolve(cwd, opts.output), formatted)
      stdout.write(text)
    } else {
      stdout.write(formatted)
    }

    const blocking = results.filter(r => r.blocking)
    if (blocking.length && command === 'staged' && opts['gui-override'] && !process.env.CODE_SCRUBBER_NONINTERACTIVE) {
      const isGui = io.isGuiCommit || override.isGuiCommit
      const confirm = io.confirmOverride || override.confirmOverride
      if (isGui() && await confirm(blocking)) {
        const log = override.logOverride(root, blocking)
        stdout.write(`\nCommit allowed by user override. This was logged to ${log}\n`)
        return 0
      }
    }
    return blocking.length ? 1 : 0
  } catch (err) {
    stderr.write(`code-scrubber: ${err.message}\n`)
    return 2
  }
}

/**
 * Scan a repository's working tree and (optionally) its git history, applying
 * the repo's config and baseline. Used by the VS Code extension.
 * @param {string} root
 * @param {{ history?: boolean, signal?: AbortSignal }} [options]
 * @throws {EncryptedEnvError} (err.code 'ENCRYPTED_ENV') when scanning history
 *   and the repo has an encrypted .env file
 */
async function scanRepository(root, { history = true, signal } = {}) {
  const config = loadConfig(root)
  const inGit = Boolean(git.gitRoot(root))
  // Check before doing any work, so the whole scan stops
  if (history && inGit) checkEncryptedEnv(root)
  const files = collectFiles(root, root, ['.'], inGit)
  const fileResults = []
  for (let i = 0; i < files.length && !(signal && signal.aborted); i++) {
    fileResults.push(...scanFiles(root, [files[i]], config))
    // Yield now and then so the editor stays responsive
    if (i % 25 === 24) await new Promise(resolve => setImmediate(resolve))
  }

  let historyResults = []
  if (history && inGit && !(signal && signal.aborted)) {
    historyResults = await scanHistory(root, config, null, signal)
  }

  const accepted = loadBaseline(path.resolve(root, config.baseline))
  const keep = r => {
    r.fingerprint = r.fingerprint || fingerprint(r, r.file)
    return !config.isAllowed(r, r.file) && !accepted.has(r.fingerprint)
  }
  historyResults = historyResults.filter(keep)
  return {
    files: fileResults.filter(keep),
    history: historyResults.filter(r => r.status !== 'rotated'),
    rotated: historyResults.filter(r => r.status === 'rotated'),
    cancelled: Boolean(signal && signal.aborted)
  }
}

module.exports = {
  main,
  scanRepository,
  ENCRYPTED_ENV_MESSAGE,
  HELP
}

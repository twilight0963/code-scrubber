// Read-only git helpers. Nothing here modifies the repository.
const { execFileSync, spawn } = require('child_process')
const readline = require('readline')

const MAX_BUFFER = 256 * 1024 * 1024

function git(args, cwd, options = {}) {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  })
}

function gitRoot(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).toString().trim()
  } catch {
    return null
  }
}

// Tracked files plus untracked files that aren't gitignored.
function listFiles(root) {
  return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
    .toString()
    .split('\0')
    .filter(Boolean)
}

// Contents of a file at a revision; rev '' means the staged (index) version.
function showBlob(root, rev, file) {
  try {
    return git(['show', `${rev}:${file}`], root)
  } catch {
    return null
  }
}

/**
 * Incrementally parses `git diff -U0` / `git log -p -U0` output into the
 * added lines of each file. Call `line()` for every output line and `end()`
 * once; `onFile(entry)` receives { commit, file, lines: Map<lineNo, text> }.
 */
class AddedLinesParser {
  constructor(onFile) {
    this.onFile = onFile
    this.commit = null
    this.current = null
    this.nextLine = 0
  }

  flush() {
    if (this.current && this.current.lines.size > 0) this.onFile(this.current)
    this.current = null
  }

  line(text) {
    if (text.startsWith('\0COMMIT ')) {
      this.flush()
      const [sha, date, ...author] = text.slice(8).split(' ')
      this.commit = { sha, date, author: author.join(' ') }
    } else if (text.startsWith('diff --git ')) {
      this.flush()
    } else if (text.startsWith('+++ ')) {
      const target = text.slice(4)
      this.current = target === '/dev/null'
        ? null
        : { commit: this.commit, file: unquote(target).replace(/^b\//, ''), lines: new Map() }
    } else if (text.startsWith('@@')) {
      const match = /\+(\d+)/.exec(text)
      this.nextLine = match ? Number(match[1]) : 0
    } else if (this.current && text.startsWith('+')) {
      this.current.lines.set(this.nextLine, text.slice(1))
      this.nextLine++
    }
  }

  end() {
    this.flush()
  }
}

// git quotes paths with unusual characters: "b/caf\303\251.js"
function unquote(p) {
  if (!p.startsWith('"')) return p
  const bytes = []
  const body = p.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      const next = body[i + 1]
      if (/[0-7]/.test(next)) {
        bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
        i += 3
      } else {
        bytes.push({ n: 10, t: 9, '"': 34, '\\': 92 }[next] ?? next.charCodeAt(0))
        i += 1
      }
    } else {
      bytes.push(...Buffer.from(body[i]))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const DIFF_FLAGS = ['-U0', '--no-color', '--no-ext-diff', '--no-renames', '--diff-filter=AM']

function stagedAddedLines(root) {
  const entries = []
  const parser = new AddedLinesParser(entry => entries.push(entry))
  const output = git(['diff', '--cached', ...DIFF_FLAGS], root).toString()
  for (const line of output.split('\n')) parser.line(line)
  parser.end()
  return entries
}

/**
 * Stream the added lines of every commit in `range` (or all refs).
 * @param {string} root
 * @param {string|null} range  e.g. "origin/main..HEAD"
 * @param {(entry) => void} onFile
 * @param {AbortSignal} [signal]  Stops git and resolves early when aborted
 */
function historyAddedLines(root, range, onFile, signal) {
  const args = ['log', '-p', ...DIFF_FLAGS, '--format=%x00COMMIT %H %aI %an']
  args.push(...(range ? [range] : ['--all']))
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    if (signal) signal.addEventListener('abort', () => child.kill(), { once: true })
    const parser = new AddedLinesParser(onFile)
    let stderr = ''
    // Settle only once both all output is parsed and git has exited
    let pending = 2
    let exitCode = 0
    const done = () => {
      if (--pending > 0) return
      if (exitCode === 0 || (signal && signal.aborted)) resolve()
      else reject(new Error(`git log failed: ${stderr.trim()}`))
    }
    child.stderr.on('data', chunk => { stderr += chunk })
    readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
      .on('line', line => parser.line(line))
      .on('close', () => { parser.end(); done() })
    child.on('error', reject)
    child.on('close', code => { exitCode = code; done() })
  })
}

module.exports = {
  git,
  gitRoot,
  listFiles,
  showBlob,
  stagedAddedLines,
  historyAddedLines,
  AddedLinesParser
}

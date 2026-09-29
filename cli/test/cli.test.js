// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
//
// Each test builds a throwaway git repo in the OS temp directory.
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { main } = require('..')

// Split so this file never contains a realistic-looking key
const AWS_KEY = ['AKIA', 'Q3EGRIUVT6K2XBZP'].join('')
const GH_TOKEN = ['ghp_', '16C7e42F292c6912E7710c838347Ae178B4a'].join('')
const RANDOM = ['q8Zt3Lk9Vx2Mn7', 'Rp4Ws6Yb1Hc5'].join('')

let repo

function sh(...args) {
  return execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

function write(file, content) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

function commit(message = 'change') {
  sh('add', '-A')
  sh('commit', '-q', '-m', message)
  return sh('rev-parse', 'HEAD').trim()
}

async function run(...argv) {
  let out = ''
  let err = ''
  const code = await main(argv, {
    cwd: repo,
    stdout: { write: s => { out += s }, isTTY: false },
    stderr: { write: s => { err += s } }
  })
  return { code, out, err }
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-scrubber-test-')))
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.name', 'Test')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'commit.gpgsign', 'false')
  sh('config', 'core.hooksPath', '.git/hooks')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('scan', () => {
  test('blocks on a known-format secret and never prints it', async () => {
    write('src/app.js', `const key = "${AWS_KEY}";\n`)
    const { code, out } = await run('scan')
    assert.equal(code, 1)
    assert.match(out, /src\/app\.js:1:14/)
    assert.match(out, /AKIA…BZP/)
    assert.match(out, /Rotate these credentials/)
    assert.ok(!out.includes(AWS_KEY))
  })

  test('clean repo exits 0', async () => {
    write('src/app.js', 'const key = process.env.API_KEY;\n')
    const { code, out } = await run('scan')
    assert.equal(code, 0)
    assert.match(out, /^0 findings/)
  })

  test('low-confidence findings warn but do not block at the default level', async () => {
    write('src/app.js', `const x = "${RANDOM}";\n`)
    const { code, out } = await run('scan')
    assert.equal(code, 0)
    assert.match(out, /LOW/)
    assert.equal((await run('scan', '--fail-on', 'low')).code, 1)
  })

  test('--fail-on none never blocks', async () => {
    write('a.js', `k = "${AWS_KEY}"`)
    assert.equal((await run('scan', '--fail-on', 'none')).code, 0)
  })

  test('skips gitignored files', async () => {
    write('.gitignore', 'secret.js\n')
    write('secret.js', `k = "${AWS_KEY}"`)
    assert.equal((await run('scan')).code, 0)
  })

  test('scans only the given paths', async () => {
    write('src/a.js', `k = "${AWS_KEY}"`)
    write('other/b.js', `k = "${GH_TOKEN}"`)
    const { out } = await run('scan', 'other')
    assert.match(out, /other\/b\.js/)
    assert.doesNotMatch(out, /src\/a\.js/)
  })

  test('config exclude and allowlist', async () => {
    write('fixtures/keys.js', `k = "${AWS_KEY}"`)
    write('src/a.js', `k = "${GH_TOKEN}"`)
    write('.code-scrubber.json', JSON.stringify({ exclude: ['fixtures/**'], allowlist: { values: ['^ghp_16C7'] } }))
    assert.equal((await run('scan')).code, 0)
  })

  test('failOn from config', async () => {
    write('a.js', `x = "${RANDOM}"`)
    write('.code-scrubber.json', JSON.stringify({ failOn: 'low' }))
    assert.equal((await run('scan')).code, 1)
  })

  test('works outside a git repository', async () => {
    fs.rmSync(path.join(repo, '.git'), { recursive: true })
    write('a.js', `k = "${AWS_KEY}"`)
    write('node_modules/dep/index.js', `k = "${GH_TOKEN}"`)
    const { code, out } = await run('scan')
    assert.equal(code, 1)
    assert.doesNotMatch(out, /node_modules/)
  })

  test('bad options exit 2', async () => {
    assert.equal((await run('scan', '--format', 'xml')).code, 2)
    assert.equal((await run('scan', '--fail-on', 'severe')).code, 2)
    assert.equal((await run('frobnicate')).code, 2)
  })
})

describe('output formats', () => {
  test('json', async () => {
    write('a.js', `k = "${AWS_KEY}"`)
    const { out } = await run('scan', '--format', 'json')
    const data = JSON.parse(out)
    assert.equal(data.findings.length, 1)
    assert.equal(data.findings[0].ruleId, 'aws-access-key-id')
    assert.equal(data.findings[0].line, 1)
    assert.equal(data.findings[0].blocking, true)
    assert.equal(data.findings[0].secret, undefined)
    assert.ok(!out.includes(AWS_KEY))
  })

  test('sarif, written to a file with a text summary on stdout', async () => {
    write('a.js', `k = "${AWS_KEY}"`)
    const { code, out } = await run('scan', '--format', 'sarif', '--output', 'report.sarif')
    assert.equal(code, 1)
    assert.match(out, /AKIA…BZP/)
    const raw = fs.readFileSync(path.join(repo, 'report.sarif'), 'utf8')
    assert.ok(!raw.includes(AWS_KEY))
    const sarif = JSON.parse(raw)
    assert.equal(sarif.version, '2.1.0')
    const [result] = sarif.runs[0].results
    assert.equal(result.ruleId, 'aws-access-key-id')
    assert.equal(result.level, 'error')
    assert.equal(result.locations[0].physicalLocation.region.startLine, 1)
    assert.equal(sarif.runs[0].tool.driver.rules[result.ruleIndex].id, 'aws-access-key-id')
  })
})

describe('baseline', () => {
  test('accepted findings stop blocking; new ones still block', async () => {
    write('a.js', `k = "${AWS_KEY}"`)
    const update = await run('scan', '--update-baseline')
    assert.equal(update.code, 0)
    const baseline = fs.readFileSync(path.join(repo, '.code-scrubber-baseline.json'), 'utf8')
    assert.ok(!baseline.includes(AWS_KEY))

    const again = await run('scan')
    assert.equal(again.code, 0)
    assert.match(again.out, /1 accepted in baseline/)

    write('b.js', `t = "${GH_TOKEN}"`)
    const withNew = await run('scan')
    assert.equal(withNew.code, 1)
    assert.match(withNew.out, /b\.js/)
    assert.doesNotMatch(withNew.out, /a\.js/)
  })

  test('baseline survives the secret moving to another line', async () => {
    write('a.js', `k = "${AWS_KEY}"`)
    await run('scan', '--update-baseline')
    write('a.js', `// moved\n\nk = "${AWS_KEY}"`)
    assert.equal((await run('scan')).code, 0)
  })
})

describe('staged', () => {
  test('reports only lines added in the staged change', async () => {
    write('old.js', `k = "${AWS_KEY}"\n`)
    commit('existing secret')
    write('old.js', `k = "${AWS_KEY}"\nconst x = 1\n`)
    write('new.js', `t = "${GH_TOKEN}"\n`)
    sh('add', '-A')
    const { code, out } = await run('staged')
    assert.equal(code, 1)
    assert.match(out, /new\.js:1/)
    assert.doesNotMatch(out, /old\.js/)
    assert.match(out, /Commit blocked/)
  })

  test('scans the staged version, not the working tree', async () => {
    write('a.js', `k = "${AWS_KEY}"\n`)
    sh('add', '-A')
    write('a.js', 'k = process.env.KEY\n')
    assert.equal((await run('staged')).code, 1)
  })

  test('respects file-level ignore markers outside the added lines', async () => {
    write('fixture.js', '// ignore.code-scrubber.diagnostics\n')
    commit()
    write('fixture.js', `// ignore.code-scrubber.diagnostics\nk = "${AWS_KEY}"\n`)
    sh('add', '-A')
    assert.equal((await run('staged')).code, 0)
  })

  test('nothing staged exits 0', async () => {
    assert.equal((await run('staged')).code, 0)
  })
})

describe('history', () => {
  test('finds secrets that were deleted but remain in history', async () => {
    write('config.js', 'module.exports = {}\n')
    commit('init')
    write('config.js', `module.exports = { key: "${AWS_KEY}" }\n`)
    const leaked = commit('add key')
    write('config.js', 'module.exports = { key: process.env.KEY }\n')
    commit('remove key')

    assert.equal((await run('scan')).code, 0, 'the working tree is clean')

    const { code, out } = await run('history', '--format', 'json')
    assert.equal(code, 1)
    const [finding] = JSON.parse(out).findings
    assert.equal(finding.ruleId, 'aws-access-key-id')
    assert.equal(finding.status, 'history-only')
    assert.equal(finding.commit.sha, leaked)

    const text = await run('history')
    assert.match(text.out, /deleted from the code, but still in git history/)
  })

  test('reports the commit that introduced a secret still in the code', async () => {
    write('a.js', `k = "${AWS_KEY}"\n`)
    const first = commit('add')
    write('a.js', `k = "${AWS_KEY}"\nconst y = 2\n`)
    commit('unrelated')
    const { out } = await run('history', '--format', 'json')
    const findings = JSON.parse(out).findings
    assert.equal(findings.length, 1)
    assert.equal(findings[0].commit.sha, first)
    assert.equal(findings[0].status, 'present')
  })

  test('--range limits which commits are scanned', async () => {
    write('a.js', `k = "${AWS_KEY}"\n`)
    const base = commit('old leak')
    write('b.js', `t = "${GH_TOKEN}"\n`)
    commit('new leak')
    const { out } = await run('history', '--range', `${base}..HEAD`, '--format', 'json')
    const findings = JSON.parse(out).findings
    assert.deepEqual(findings.map(f => f.ruleId), ['github-token'])
  })

  test('outside git it errors', async () => {
    fs.rmSync(path.join(repo, '.git'), { recursive: true })
    const { code, err } = await run('history')
    assert.equal(code, 2)
    assert.match(err, /git repository/)
  })
})

describe('install-hook', () => {
  test('installed hook blocks a commit containing a secret', async () => {
    write('README.md', 'hello\n')
    commit('init')
    const { code } = await run('install-hook')
    assert.equal(code, 0)

    write('a.js', `k = "${AWS_KEY}"\n`)
    sh('add', '-A')
    assert.throws(() => sh('commit', '-q', '-m', 'leak'), /Commit blocked/)

    write('a.js', 'k = process.env.KEY\n')
    sh('add', '-A')
    sh('commit', '-q', '-m', 'safe')
  })

  test('does not overwrite an existing hook without --force', async () => {
    write('.git/hooks/pre-commit', '#!/bin/sh\necho mine\n')
    const { code, err } = await run('install-hook')
    assert.equal(code, 2)
    assert.match(err, /already exists/)
    assert.equal((await run('install-hook', '--force')).code, 0)
  })
})

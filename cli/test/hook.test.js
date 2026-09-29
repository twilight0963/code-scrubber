// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const hook = require('../hook')

const AWS_KEY = ['AKIA', 'Q3EGRIUVT6K2XBZP'].join('')
const CLI = path.resolve(__dirname, '..', '..', 'bin', 'code-scrubber.js')
// A PATH with git but without Homebrew/nvm Node
const NO_NODE_PATH = '/usr/bin:/bin'

let repo

function sh(args, env = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CODE_SCRUBBER_NONINTERACTIVE: '1', ...env }
  }).toString()
}

function stageSecret() {
  fs.writeFileSync(path.join(repo, 'a.js'), `k = "${AWS_KEY}"\n`)
  sh(['add', '-A'])
}

function commitError(env) {
  try {
    sh(['commit', '-q', '-m', 'test'], env)
  } catch (err) {
    return err.stderr.toString()
  }
  return null
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-scrubber-hook-')))
  sh(['init', '-q', '-b', 'main'])
  sh(['config', 'user.name', 'Test'])
  sh(['config', 'user.email', 'test@example.com'])
  sh(['config', 'commit.gpgsign', 'false'])
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('hook behaviour', () => {
  test('blocks a secret using node from PATH', () => {
    hook.installHook(repo, { cliPath: CLI })
    stageSecret()
    assert.match(commitError() || '', /Commit blocked by Code-Scrubber/)
  })

  test('falls back to the recorded Node when node is not on PATH', () => {
    hook.installHook(repo, { cliPath: CLI, fallbackNode: process.execPath })
    stageSecret()
    const err = commitError({ PATH: NO_NODE_PATH })
    assert.match(err || '', /AWS Access Key ID/)
    assert.doesNotMatch(err, /could not find Node/)
  })

  test('lets a clean commit through', () => {
    hook.installHook(repo, { cliPath: CLI })
    fs.writeFileSync(path.join(repo, 'a.js'), 'k = process.env.KEY\n')
    sh(['add', '-A'])
    assert.equal(commitError(), null)
  })

  test('blocks when nothing can run the check and there is no way to ask', () => {
    hook.installHook(repo, { cliPath: CLI, fallbackNode: '/nonexistent/node' })
    stageSecret()
    const err = commitError({ PATH: NO_NODE_PATH })
    assert.match(err || '', /could not find Node\.js/)
    assert.match(err, /no way to ask/)
  })

  test('blocks when the CLI has been removed', () => {
    hook.installHook(repo, { cliPath: '/nonexistent/code-scrubber.js', fallbackNode: process.execPath })
    stageSecret()
    assert.match(commitError() || '', /could not find Node\.js or the Code-Scrubber CLI/)
  })

  test('paths with spaces and quotes', () => {
    const dir = path.join(repo, "it's a dir")
    fs.mkdirSync(dir)
    const cliCopy = path.join(dir, 'cli.js')
    fs.writeFileSync(cliCopy, `require(${JSON.stringify(CLI.replace(/bin[\\/]code-scrubber\.js$/, 'cli'))}).main(process.argv.slice(2)).then(c => { process.exitCode = c })`)
    fs.writeFileSync(path.join(repo, '.gitignore'), "it's a dir/\n")
    hook.installHook(repo, { cliPath: cliCopy })
    stageSecret()
    assert.match(commitError() || '', /Commit blocked by Code-Scrubber/)
  })
})

describe('installHook', () => {
  test('install, unchanged, update', () => {
    assert.equal(hook.installHook(repo, { cliPath: CLI }).result, 'installed')
    assert.equal(hook.installHook(repo, { cliPath: CLI }).result, 'unchanged')
    assert.equal(hook.installHook(repo, { cliPath: '/moved/cli.js' }).result, 'updated')
    assert.equal(hook.hookStatus(repo), 'ours')
    const mode = fs.statSync(hook.hookPath(repo)).mode
    assert.ok(mode & 0o100, 'hook must be executable')
  })

  test('never overwrites someone else\'s hook without force', () => {
    const file = hook.hookPath(repo)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '#!/bin/sh\necho mine\n')
    assert.equal(hook.installHook(repo, { cliPath: CLI }).result, 'foreign')
    assert.equal(fs.readFileSync(file, 'utf8'), '#!/bin/sh\necho mine\n')
    assert.equal(hook.uninstallHook(repo), false)
    assert.equal(hook.installHook(repo, { cliPath: CLI, force: true }).result, 'installed')
  })

  test('respects hook managers (core.hooksPath) when asked to', () => {
    sh(['config', 'core.hooksPath', '.husky'])
    const res = hook.installHook(repo, { cliPath: CLI, allowCustomHooksPath: false })
    assert.equal(res.result, 'custom-hooks-path')
    assert.equal(res.hooksPath, '.husky')
    assert.ok(!fs.existsSync(path.join(repo, '.husky')))
  })

  test('uninstall removes only our hook', () => {
    hook.installHook(repo, { cliPath: CLI })
    assert.equal(hook.uninstallHook(repo), true)
    assert.equal(hook.hookStatus(repo), 'none')
  })

  test('manual line for existing hooks', () => {
    assert.equal(hook.manualHookLine('/a b/cli.js'), "node '/a b/cli.js' staged || exit 1")
  })
})

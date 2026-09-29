// "Commit Anyway" for commits made from a GUI (e.g. VS Code's Source Control
// view). Terminal users already have `git commit --no-verify`; GUI users get a
// native dialog instead. Every override is logged, with secrets masked.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const git = require('./git')
const { toPosix } = require('./config')

const MAX_LISTED = 5

// A commit started from a terminal has a controlling terminal (/dev/tty);
// one started by an app does not. Windows has no /dev/tty, so there we rely on
// VS Code's git environment variable.
function isGuiCommit() {
  if (process.platform === 'win32') return Boolean(process.env.VSCODE_GIT_IPC_HANDLE)
  try {
    fs.closeSync(fs.openSync('/dev/tty', 'r'))
    return false
  } catch {
    return true
  }
}

function overrideMessage(findings) {
  const n = findings.length
  const lines = findings.slice(0, MAX_LISTED).map(f =>
    `• ${f.ruleName} in ${toPosix(f.file)} (line ${f.line + 1}): ${f.masked}`)
  if (n > MAX_LISTED) lines.push(`• …and ${n - MAX_LISTED} more`)
  return [
    `This commit adds ${n} potential secret${n === 1 ? '' : 's'}:`,
    '',
    ...lines,
    '',
    'Anything committed stays in git history, even if it is deleted later. If this is a real credential, cancel and move it to an environment variable or a secret manager.',
    '',
    'Commit anyway? This will be logged.'
  ].join('\n')
}

const MAC_SCRIPT = `on run argv
  display dialog (item 1 of argv) with title "Code-Scrubber" buttons {"Commit Anyway", "Cancel Commit"} default button "Cancel Commit" cancel button "Cancel Commit" with icon caution
  return button returned of result
end run`

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName PresentationFramework',
  "[System.Windows.MessageBox]::Show($env:CODE_SCRUBBER_MESSAGE, 'Code-Scrubber', 'YesNo', 'Warning', 'No')"
].join('; ')

function has(command) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Show a native Yes/No dialog. Resolves true only if the user chose
 * "Commit Anyway"; cancelling, closing it or having no dialog tool is false.
 */
async function confirmOverride(findings) {
  const message = overrideMessage(findings)
  try {
    if (process.platform === 'darwin') {
      return execFileSync('osascript', ['-e', MAC_SCRIPT, message], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim() === 'Commit Anyway'
    }
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', WINDOWS_SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, CODE_SCRUBBER_MESSAGE: message }
      }).toString().trim() === 'Yes'
    }
    if (has('zenity')) {
      execFileSync('zenity', ['--question', '--title=Code-Scrubber', `--text=${message}`,
        '--ok-label=Commit Anyway', '--cancel-label=Cancel Commit', '--default-cancel'], { stdio: 'ignore' })
      return true // zenity exits non-zero (throws) on cancel
    }
  } catch {
    return false
  }
  return false
}

// Appends to .git/code-scrubber-overrides.log (never committed)
function logOverride(root, findings) {
  const file = path.resolve(root, git.git(['rev-parse', '--git-path', 'code-scrubber-overrides.log'], root).toString().trim())
  let user = ''
  try {
    user = git.git(['config', 'user.name'], root).toString().trim()
  } catch {
    // no user configured
  }
  const time = new Date().toISOString()
  const entries = findings.map(f =>
    `${time}\t${user}\tcommit allowed\t${f.ruleId}\t${toPosix(f.file)}:${f.line + 1}\t${f.masked}`)
  fs.appendFileSync(file, entries.join('\n') + '\n')
  return file
}

module.exports = {
  isGuiCommit,
  confirmOverride,
  overrideMessage,
  logOverride
}

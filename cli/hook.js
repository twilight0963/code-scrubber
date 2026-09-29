// Pre-commit hook installation, shared by the CLI (`install-hook`) and the
// VS Code extension (automatic install when a repository opens).
const fs = require('fs')
const path = require('path')
const git = require('./git')

const MARKER = '# Installed by code-scrubber'
const FALLBACK_QUESTION = 'The commit could not be checked for secrets. Has the commit safety been checked?'

// Git for Windows runs hooks with its bundled sh, which understands C:/paths
function shellPath(p) {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p
}

function shellQuote(p) {
  return `'${shellPath(p).replace(/'/g, `'\\''`)}'`
}

/**
 * The hook script. It runs the CLI with `node` from PATH, then with
 * `fallbackNode` (VS Code's built-in Node.js, or the Node that installed the
 * hook). If neither can run it, it asks whether to continue: in the terminal
 * when there is one, otherwise with a native dialog, otherwise it blocks.
 * @param {{ cliPath: string, fallbackNode?: string }} options
 */
function hookScript({ cliPath, fallbackNode }) {
  return `#!/bin/sh
${MARKER}. Blocks commits that add hardcoded secrets.
# Remove this file (or run "Code Scrubber: Remove pre-commit hook") to disable it.

CLI=${shellQuote(cliPath)}
FALLBACK_NODE=${shellQuote(fallbackNode || '')}

if [ -f "$CLI" ]; then
  if command -v node >/dev/null 2>&1; then
    exec node "$CLI" staged --gui-override
  fi
  if [ -n "$FALLBACK_NODE" ] && [ -x "$FALLBACK_NODE" ]; then
    ELECTRON_RUN_AS_NODE=1 exec "$FALLBACK_NODE" "$CLI" staged --gui-override
  fi
fi

# Code-Scrubber couldn't run, so the commit hasn't been checked. Ask the user.
QUESTION=${shellQuote(FALLBACK_QUESTION)}
echo "Code-Scrubber: could not find Node.js or the Code-Scrubber CLI ($CLI)." >&2

if [ -z "$CODE_SCRUBBER_NONINTERACTIVE" ]; then
  # Committing from a terminal
  if (: </dev/tty) 2>/dev/null; then
    printf '%s [y/N] ' "$QUESTION" >/dev/tty
    read -r ANSWER </dev/tty
    case "$ANSWER" in
      [yY]|[yY][eE][sS]) exit 0 ;;
      *) echo "Commit blocked by Code-Scrubber." >&2; exit 1 ;;
    esac
  fi
  # Committing from an app (e.g. VS Code's Source Control view): native dialog
  if command -v osascript >/dev/null 2>&1; then
    ANSWER=$(osascript -e "button returned of (display dialog \\"$QUESTION\\" with title \\"Code-Scrubber\\" buttons {\\"No\\", \\"Yes\\"} default button \\"No\\" with icon caution)" 2>/dev/null)
    [ "$ANSWER" = "Yes" ] && exit 0
    echo "Commit blocked by Code-Scrubber." >&2
    exit 1
  fi
  if command -v powershell.exe >/dev/null 2>&1; then
    ANSWER=$(powershell.exe -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('$QUESTION', 'Code-Scrubber', 'YesNo', 'Warning')" 2>/dev/null | tr -d '\\r')
    [ "$ANSWER" = "Yes" ] && exit 0
    echo "Commit blocked by Code-Scrubber." >&2
    exit 1
  fi
fi

echo "Commit blocked by Code-Scrubber: there is no way to ask whether to continue." >&2
exit 1
`
}

function hookPath(root) {
  const hooksDir = path.resolve(root, git.git(['rev-parse', '--git-path', 'hooks'], root).toString().trim())
  return path.join(hooksDir, 'pre-commit')
}

// Hook managers such as husky or the pre-commit framework set core.hooksPath,
// often to a tracked folder. We don't write into those automatically.
function customHooksPath(root) {
  try {
    return git.git(['config', '--get', 'core.hooksPath'], root).toString().trim() || null
  } catch {
    return null
  }
}

/**
 * @returns {'ours'|'foreign'|'none'}
 */
function hookStatus(root) {
  const file = hookPath(root)
  if (!fs.existsSync(file)) return 'none'
  return fs.readFileSync(file, 'utf8').includes(MARKER) ? 'ours' : 'foreign'
}

/**
 * Install or refresh the hook.
 * @param {string} root  Repository root
 * @param {{ cliPath: string, fallbackNode?: string, force?: boolean, allowCustomHooksPath?: boolean }} options
 * @returns {{ result: 'installed'|'updated'|'unchanged'|'foreign'|'custom-hooks-path', path: string, hooksPath?: string }}
 */
function installHook(root, { cliPath, fallbackNode, force = false, allowCustomHooksPath = true }) {
  const file = hookPath(root)
  const custom = customHooksPath(root)
  if (custom && !allowCustomHooksPath && !force) {
    return { result: 'custom-hooks-path', path: file, hooksPath: custom }
  }

  const script = hookScript({ cliPath, fallbackNode })
  const status = hookStatus(root)
  if (status === 'foreign' && !force) return { result: 'foreign', path: file }
  if (status === 'ours' && fs.readFileSync(file, 'utf8') === script) return { result: 'unchanged', path: file }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, script, { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  return { result: status === 'ours' ? 'updated' : 'installed', path: file }
}

// Only removes a hook we installed
function uninstallHook(root) {
  if (hookStatus(root) !== 'ours') return false
  fs.unlinkSync(hookPath(root))
  return true
}

// The line to add to an existing hook by hand
function manualHookLine(cliPath) {
  return `node ${shellQuote(cliPath)} staged || exit 1`
}

module.exports = {
  MARKER,
  FALLBACK_QUESTION,
  hookScript,
  hookPath,
  hookStatus,
  installHook,
  uninstallHook,
  manualHookLine
}

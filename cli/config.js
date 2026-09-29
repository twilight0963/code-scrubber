// .code-scrubber.json: repo-level settings shared by the CLI, hook and CI.
//
// {
//   "failOn": "medium",                        // high | medium | low | none
//   "exclude": ["docs/**", "**/*.snap"],       // paths never scanned
//   "allowlist": {
//     "paths": ["test/fixtures/**"],           // findings in these paths are ignored
//     "rules": ["high-entropy-string"],        // rule IDs to turn off
//     "values": ["^pk_test_"]                  // regexes matched against the secret
//   },
//   "baseline": ".code-scrubber-baseline.json"
// }
const fs = require('fs')
const path = require('path')

const CONFIG_FILE = '.code-scrubber.json'
const LEVELS = ['none', 'low', 'medium', 'high']

const DEFAULTS = {
  failOn: 'medium',
  exclude: [],
  allowlist: { paths: [], rules: [], values: [] },
  baseline: '.code-scrubber-baseline.json'
}

// Minimal glob support: **, *, ? and {a,b}. Paths use forward slashes.
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories
        re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
        i += glob[i + 2] === '/' ? 2 : 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const close = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, close).split(',').map(escape).join('|') + ')'
      i = close
    } else {
      re += escape(c)
    }
  }
  // A pattern without a slash matches at any depth, like .gitignore
  const anchored = glob.includes('/') ? '^' : '(?:^|/)'
  return new RegExp(anchored + re + '(?:/.*)?$')
}

function escape(s) {
  return s.replace(/[.+^$()|[\]\\]/g, '\\$&')
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function loadConfig(root, explicitPath) {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(root, CONFIG_FILE)
  let user = {}
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`Could not parse ${file}: ${err.message}`)
    }
  } else if (explicitPath) {
    throw new Error(`Config file not found: ${file}`)
  }

  const config = {
    ...DEFAULTS,
    ...user,
    allowlist: { ...DEFAULTS.allowlist, ...(user.allowlist || {}) }
  }
  if (!LEVELS.includes(config.failOn)) {
    throw new Error(`failOn must be one of ${LEVELS.join(', ')}`)
  }

  const excludes = config.exclude.map(globToRegExp)
  const allowPaths = config.allowlist.paths.map(globToRegExp)
  const allowValues = config.allowlist.values.map(v => new RegExp(v))
  // Code-Scrubber's own files: the baseline is full of fingerprint hashes
  const ownFiles = new Set([CONFIG_FILE, toPosix(path.normalize(config.baseline))])

  return {
    ...config,
    isExcluded: file => ownFiles.has(toPosix(file)) || excludes.some(re => re.test(toPosix(file))),
    isAllowed: (finding, file) =>
      config.allowlist.rules.includes(finding.ruleId) ||
      allowPaths.some(re => re.test(toPosix(file))) ||
      allowValues.some(re => re.test(finding.secret))
  }
}

module.exports = {
  loadConfig,
  globToRegExp,
  toPosix,
  LEVELS,
  CONFIG_FILE
}

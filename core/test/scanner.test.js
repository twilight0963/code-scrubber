// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
//
// Fake tokens are split and re-joined so this file never contains a
// realistic-looking secret (which GitHub push protection would block).
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { scanText, shouldSkipPath } = require('..')

const j = (...parts) => parts.join('')

const FAKE = {
  awsId: j('AKIA', 'Q3EGRIUVT6K2XBZP'),
  awsSecret: j('wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYzq8Rk2Lp9w'),
  github: j('ghp_', '16C7e42F292c6912E7710c838347Ae178B4a'),
  stripe: j('sk_', 'live_', '51H8xYzAbCdEfGh1234567890'),
  slack: j('xox', 'b-', '1234567890-0987654321-AbCdEfGhIjKlMnOpQrStUvWx'),
  google: j('AIza', 'SyD8x9Qk2Lm4Np6Rs8Tu0Vw2Xy4Za6Bc8De'),
  anthropic: j('sk-', 'ant-', 'api03-', 'Q8zT3lK9vX2mN7rP4wS6yB1hC5jD0fG2'),
  random: j('q8Zt3Lk9Vx2Mn7', 'Rp4Ws6Yb1Hc5')
}

function scan(text, filePath = 'app.js') {
  return scanText(text, { filePath })
}

function ids(text, filePath) {
  return scan(text, filePath).map(f => f.ruleId)
}

describe('known formats', () => {
  const cases = [
    ['aws-access-key-id', `const k = "${FAKE.awsId}";`],
    ['aws-secret-access-key', `aws_secret_access_key = "${FAKE.awsSecret}"`],
    ['github-token', `token: '${FAKE.github}'`],
    ['stripe-secret-key', `Stripe(${JSON.stringify(FAKE.stripe)})`],
    ['slack-token', `SLACK = "${FAKE.slack}"`],
    ['google-api-key', `key="${FAKE.google}"`],
    ['anthropic-api-key', `new Anthropic({ apiKey: "${FAKE.anthropic}" })`],
    ['private-key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...'],
    ['connection-string-password', `DB = "postgres://admin:${j('Pa55', 'w0rd!x')}@db.internal:5432/app"`]
  ]
  for (const [ruleId, text] of cases) {
    test(ruleId, () => {
      assert.deepEqual(ids(text), [ruleId])
    })
  }

  test('known formats are high confidence', () => {
    const [finding] = scan(`const k = "${FAKE.awsId}";`)
    assert.equal(finding.confidence, 'high')
  })
})

describe('positions', () => {
  test('range covers only the secret, not the quotes', () => {
    const text = `line one\nconst k = "${FAKE.awsId}";`
    const [f] = scan(text)
    assert.equal(f.line, 1)
    assert.equal(f.column, 11)
    assert.equal(text.slice(f.start, f.end), FAKE.awsId)
  })

  test('duplicate secrets each get their own position', () => {
    const text = `a = "${FAKE.awsId}"\nb = "${FAKE.awsId}"`
    const lines = scan(text).map(f => f.line)
    assert.deepEqual(lines, [0, 1])
  })
})

describe('masking', () => {
  test('masked value hides the middle of the secret', () => {
    const [f] = scan(`const k = "${FAKE.awsId}";`)
    assert.equal(f.masked, 'AKIA…BZP')
    assert.ok(!f.masked.includes(FAKE.awsId.slice(4, -3)))
  })

  test('private key header is shown as is', () => {
    const [f] = scan('-----BEGIN OPENSSH PRIVATE KEY-----')
    assert.equal(f.masked, '-----BEGIN OPENSSH PRIVATE KEY-----')
  })
})

describe('generic assignments', () => {
  test('flags password assignments', () => {
    assert.deepEqual(ids('const password = "SuperSecret123!";'), ['generic-secret-assignment'])
    assert.deepEqual(ids('{"client_secret": "a8f3kd92mfq"}', 'config.json'), ['generic-secret-assignment'])
  })

  test('ignores values that are names, not secrets', () => {
    assert.deepEqual(ids('const tokenType = "Bearer";'), [])
    assert.deepEqual(ids('const passwordField = "user_password_2";'), [])
    assert.deepEqual(ids('tokenizer = "bert-base-uncased"'), [])
  })

  test('ignores values read from the environment', () => {
    assert.deepEqual(ids('const password = process.env.DB_PASSWORD;'), [])
    assert.deepEqual(ids('password = "${DB_PASSWORD}"'), [])
  })

  test('ignores version ranges and template strings', () => {
    assert.deepEqual(ids('{"tokenizer-lib": "^8.0.2"}', 'package.json'), [])
    assert.deepEqual(ids('const token = `${prefix}_${id}`;'), [])
  })

  test('ignores documentation passwords in connection strings', () => {
    assert.deepEqual(ids('new Keyv("redis://user:pass@localhost:6379")'), [])
  })

  test('comparisons are not assignments', () => {
    assert.deepEqual(ids('if (password == "hunter2x") {}'), [])
  })
})

describe('high-entropy strings', () => {
  test('flags random-looking quoted strings with low confidence', () => {
    const [f] = scan(`const x = "${FAKE.random}";`)
    assert.equal(f.ruleId, 'high-entropy-string')
    assert.equal(f.confidence, 'low')
  })

  test('works with single quotes and backticks', () => {
    assert.equal(scan(`x = '${FAKE.random}'`).length, 1)
    assert.equal(scan(`x = \`${FAKE.random}\``).length, 1)
  })

  const notSecrets = [
    ['UUID', '"550e8400-e29b-41d4-a716-446655440000"'],
    ['import path', 'import x from "./components/Button123.tsx"'],
    ['multi-segment path', '"assets/images/icons/logo_2x"'],
    ['plain URL', '"https://api.example2.com/v1/users"'],
    ['identifier', '"getUserAccountSettingsById"'],
    ['semver', '"1.2.3-beta.4567890123"'],
    ['integrity hash', '"sha512-q8Zt3Lk9Vx2Mn7Rp4Ws6Yb1Hc5"'],
    ['placeholder', '"your-api-key-goes-here-123"'],
    ['AWS docs example key', '"AKIAIOSFODNN7EXAMPLE"'],
    ['repeated characters', '"xxxxxxxxxxxxxxxxxxxxxxxx"'],
    ['git commit SHA', '"0e4ed7e0fe84b6879532ce29fdfe397c1fc205d0"'],
    ['hex-encoded text', '"7468697320697320612074c3a97374"'],
    ['npm alias', '"npm:wrap-ansi@^7.0.0"'],
    ['data URI', '"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAA"'],
    ['regex', '"a/(0{2}[1-9]|0[1-9][0-9]|[12][0-9]{2}|300)/b"'],
    ['URL with example credentials', '"https://a:b@xn--g6w251d/?abc#foo"'],
    ['media file name', '"hkzbtrjkzKzmFow2.mp4"']
  ]
  for (const [name, text] of notSecrets) {
    test(`ignores ${name}`, () => {
      assert.deepEqual(scan(text), [])
    })
  }
})

describe('config files', () => {
  test('flags unquoted secrets in YAML', () => {
    const yml = 'db:\n  password: Hunt3r2secret\n  host: db.internal\n  passwordPolicy: strict123'
    const findings = scan(yml, 'config.yaml')
    assert.deepEqual(findings.map(f => [f.ruleId, f.line]), [['generic-secret-assignment', 1]])
  })

  test('flags high-entropy unquoted values in .properties', () => {
    const findings = scan(`signing.key=${FAKE.random}`, 'app.properties')
    assert.deepEqual(findings.map(f => f.ruleId), ['high-entropy-string'])
  })

  test('unquoted values are not checked in source files', () => {
    assert.deepEqual(scan(`key = ${FAKE.random}`, 'app.js').filter(f => f.ruleId === 'generic-secret-assignment'), [])
  })
})

describe('ignore comments', () => {
  test('whole-file marker', () => {
    assert.deepEqual(scan(`// ignore.code-scrubber.diagnostics\nconst k = "${FAKE.awsId}";`), [])
  })

  test('same-line marker', () => {
    assert.deepEqual(scan(`const k = "${FAKE.awsId}"; // code-scrubber:ignore`), [])
  })

  test('next-line marker only affects the next line', () => {
    const text = `// code-scrubber:ignore-next-line\na = "${FAKE.awsId}"\nb = "${FAKE.awsId}"`
    assert.deepEqual(scan(text).map(f => f.line), [2])
  })
})

describe('overlaps', () => {
  test('a known format wins over the generic rules on the same value', () => {
    assert.deepEqual(ids(`api_key = "${FAKE.github}"`), ['github-token'])
  })
})

describe('skipped paths', () => {
  const skipped = [
    'node_modules/pkg/index.js',
    'project/package-lock.json',
    'dist/app.min.js',
    'dist/app.js.map',
    'assets/logo.png',
    '/repo/.git/config',
    'C:\\repo\\node_modules\\x.js'
  ]
  for (const p of skipped) {
    test(p, () => {
      assert.equal(shouldSkipPath(p), true)
      assert.deepEqual(scan(`k = "${FAKE.awsId}"`, p), [])
    })
  }

  test('normal source files are scanned', () => {
    assert.equal(shouldSkipPath('src/app.js'), false)
  })
})

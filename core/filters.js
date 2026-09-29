// False-positive filters. A candidate that trips any of these is dropped.

// Words that show up in docs, examples and templates instead of real secrets.
const PLACEHOLDER_WORDS = [
  'example', 'sample', 'dummy', 'placeholder', 'changeme', 'change_me', 'change-me',
  'your_', 'your-', 'yourkey', 'yoursecret', 'yourtoken', 'insert', 'redacted',
  'xxxxx', '*****', '...', 'todo', 'fixme', 'fake', 'notreal', 'not_real', 'not-a-real'
]

// Whole values that are documentation stand-ins, e.g. redis://user:pass@host
const PLACEHOLDER_VALUES = ['pass', 'password', 'passwd', 'pwd', 'secret', 'token', 'user', 'username', 'admin', 'root', 'test', 'foo', 'bar', 'baz']

function isPlaceholder(value) {
  const lower = value.toLowerCase()
  if (PLACEHOLDER_VALUES.includes(lower)) return true
  if (PLACEHOLDER_WORDS.some(word => lower.includes(word))) return true
  // <your-key>, ${API_KEY}, {{ token }}, %API_KEY%, $API_KEY
  if (/^<.*>$/.test(value)) return true
  if (/^\$\{.*\}$|^\{\{.*\}\}$|^%[A-Z0-9_]+%$|^\$[A-Z_][A-Z0-9_]*$/.test(value)) return true
  // aaaaaaaa, 00000000
  if (/^(.)\1+$/.test(value)) return true
  // abcdefgh..., 12345678...
  if (/^(?:abcdefgh|12345678|01234567)/i.test(value)) return true
  return false
}

// Values that read from the environment or a secret store rather than
// containing a secret, e.g. `password = process.env.DB_PASSWORD`.
function isReference(value) {
  return /^(?:process\.env|os\.environ|os\.getenv|env\(|getenv|System\.getenv|ENV\[|secrets\.|vault:|arn:aws:secretsmanager)/i.test(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value) {
  return UUID.test(value)
}

function isPathLike(value) {
  if (/^(?:\.{0,2}\/|~\/|[A-Za-z]:\\)/.test(value)) return true
  // src/components/Button.tsx, images/logo@2x.png
  if (/\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|rb|go|rs|java|kt|cs|cpp|c|h|php|html|css|scss|md|txt|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|yml|yaml|xml|lock|mp3|mp4|m4a|mov|webm|wav|avi|pdf|zip|gz|tar|csv)$/i.test(value)) return true
  // Several path segments made of word-like pieces. Base64 also contains
  // slashes, but mixes upper case, lower case and digits, which paths rarely do.
  const segments = value.split('/')
  const base64ish = /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)
  if (!base64ish && segments.length >= 3 && segments.every(s => /^[A-Za-z0-9_.@-]*$/.test(s))) return true
  return false
}

function isPlainUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/:\/\/[^/\s]*:[^/\s]*@/.test(value)
}

// CSS colours, versions, dotted identifiers such as com.example.app, and
// other strings that are code or data rather than credentials.
function isCodeLiteral(value) {
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return true
  // 1.2.3, v1.2.3, ^8.0.2, >=1.0.0
  if (/^[\^~<>=]*v?\d+\.\d+(?:\.\d+)?/.test(value)) return true
  if (/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/i.test(value)) return true
  // Integrity hashes in lockfiles and HTML: sha512-...
  if (/^sha(?:1|256|384|512)-/.test(value)) return true
  // data: URIs and package specifiers such as npm:wrap-ansi@^7.0.0
  if (/^(?:data|npm|git|github|file|link|workspace|jsr):/i.test(value)) return true
  // Template or shell interpolation: the value is built at runtime
  if (value.includes('${')) return true
  return false
}

// Git commit IDs and content hashes (SHA-1, SHA-256, SHA-512) are pure hex of
// fixed lengths and appear constantly in lockfiles, package.json and docs.
function isHash(value) {
  return /^[0-9a-f]+$/i.test(value) && [40, 64, 128].includes(value.length)
}

// Hex that decodes to readable text ("7468697320697320..." = "this is ...").
function isHexEncodedText(value) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return false
  const decoded = Buffer.from(value, 'hex').toString('latin1')
  const printable = decoded.replace(/[^\x20-\x7e\xa0-\xff]/g, '')
  return printable.length / decoded.length > 0.9
}

// Generic high-entropy candidates are limited to characters that tokens are
// built from. Brackets, pipes and parentheses mean regexes or code.
function hasCodeCharacters(value) {
  return !/^[A-Za-z0-9+/=_.~:@-]+$/.test(value)
}

/**
 * Whether a generic (non-format) candidate should be dropped.
 * Known-format rules only run the placeholder and reference checks, because
 * their pattern already establishes that the value is a credential.
 * @param {string} value
 * @param {'high'|'medium'|'low'} confidence
 */
function isFalsePositive(value, confidence) {
  if (isPlaceholder(value) || isReference(value)) return true
  if (confidence === 'high') return false
  if (isUuid(value) || isPathLike(value) || isPlainUrl(value) || isCodeLiteral(value)) return true
  if (confidence === 'medium') return false
  // Low confidence (entropy only): also drop hashes, encoded text, any URL and code
  return isHash(value) || isHexEncodedText(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || hasCodeCharacters(value)
}

module.exports = {
  isPlaceholder,
  isReference,
  isUuid,
  isPathLike,
  isPlainUrl,
  isCodeLiteral,
  isHash,
  isHexEncodedText,
  hasCodeCharacters,
  isFalsePositive
}

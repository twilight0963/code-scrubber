// Known credential formats. Each rule's regex must be global and must capture
// the secret itself in group `group` (default 1) so the reported range covers
// only the secret, not the surrounding quotes or variable name.
//
// confidence:
//   high   - distinctive prefix/format, almost never a false positive
//   medium - context-based (a "password = ..." style assignment)
//   low    - public-by-design keys, and generic high-entropy strings (scanner.js)
//
// A rule may define classify(secret), returning overrides for id, name,
// provider and confidence when the secret itself says what it is.

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// Supabase's legacy API keys are JWTs whose `role` claim decides what they
// can do: `service_role` bypasses Row Level Security, `anon` is public by design.
function classifyJwt(token) {
  const claims = decodeJwtPayload(token)
  if (typeof claims?.iss !== 'string' || !claims.iss.startsWith('supabase')) return null
  if (claims.role === 'service_role') {
    return { id: 'supabase-service-role-key', name: 'Supabase Service Role Key', provider: 'supabase', confidence: 'high' }
  }
  if (claims.role === 'anon') {
    return { id: 'supabase-anon-key', name: 'Supabase Anon Key', provider: 'supabase', confidence: 'low' }
  }
  return null
}

const rules = [
  {
    id: 'aws-access-key-id',
    name: 'AWS Access Key ID',
    provider: 'aws',
    confidence: 'high',
    regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g
  },
  {
    id: 'aws-secret-access-key',
    name: 'AWS Secret Access Key',
    provider: 'aws',
    confidence: 'high',
    regex: /aws_?secret(?:_?access)?(?:_?key)?["']?\s*(?:=|:|:=|=>)\s*["'`]?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi
  },
  {
    id: 'github-token',
    name: 'GitHub Token',
    provider: 'github',
    confidence: 'high',
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g
  },
  {
    id: 'github-fine-grained-pat',
    name: 'GitHub Fine-grained Token',
    provider: 'github',
    confidence: 'high',
    regex: /\b(github_pat_[A-Za-z0-9_]{50,255})\b/g
  },
  {
    id: 'gitlab-pat',
    name: 'GitLab Personal Access Token',
    provider: 'gitlab',
    confidence: 'high',
    regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g
  },
  {
    id: 'slack-token',
    name: 'Slack Token',
    provider: 'slack',
    confidence: 'high',
    regex: /\b(xox[abposr]-[A-Za-z0-9-]{10,})\b/g
  },
  {
    id: 'slack-webhook',
    name: 'Slack Webhook URL',
    provider: 'slack',
    confidence: 'high',
    regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,})/g
  },
  {
    id: 'stripe-secret-key',
    name: 'Stripe Live Secret Key',
    provider: 'stripe',
    confidence: 'high',
    regex: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/g
  },
  {
    id: 'google-api-key',
    name: 'Google API Key',
    provider: 'google',
    confidence: 'high',
    regex: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g
  },
  {
    // Listed before the OpenAI rule so sk-ant-... is attributed correctly.
    id: 'anthropic-api-key',
    name: 'Anthropic API Key',
    provider: 'anthropic',
    confidence: 'high',
    regex: /\b(sk-ant-[A-Za-z0-9_-]{32,})(?![A-Za-z0-9_-])/g
  },
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    provider: 'openai',
    confidence: 'high',
    regex: /\b(sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,})(?![A-Za-z0-9_-])/g
  },
  {
    id: 'sendgrid-api-key',
    name: 'SendGrid API Key',
    provider: 'sendgrid',
    confidence: 'high',
    regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g
  },
  {
    id: 'twilio-api-key',
    name: 'Twilio API Key',
    provider: 'twilio',
    confidence: 'high',
    regex: /\b(SK[0-9a-f]{32})\b/g
  },
  {
    id: 'npm-token',
    name: 'npm Access Token',
    provider: 'npm',
    confidence: 'high',
    regex: /\b(npm_[A-Za-z0-9]{36})\b/g
  },
  {
    id: 'private-key',
    name: 'Private Key',
    provider: 'private-key',
    confidence: 'high',
    regex: /(-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----)/g,
    // The header line isn't secret, and masking it would make it unreadable.
    revealMatch: true
  },
  {
    id: 'jwt',
    name: 'JSON Web Token',
    provider: 'jwt',
    confidence: 'medium',
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g,
    classify: classifyJwt
  },
  {
    id: 'supabase-secret-key',
    name: 'Supabase Secret Key',
    provider: 'supabase',
    confidence: 'high',
    regex: /\b(sb_secret_[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/g
  },
  {
    // Meant to ship in client code; only safe with Row Level Security enabled.
    id: 'supabase-publishable-key',
    name: 'Supabase Publishable Key',
    provider: 'supabase',
    confidence: 'low',
    regex: /\b(sb_publishable_[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/g
  },
  {
    id: 'connection-string-password',
    name: 'Password in Connection String',
    provider: 'database',
    confidence: 'high',
    regex: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s:@/'"`]+:([^\s@/'"`]+)@[^\s'"`]+/gi
  },
  {
    // `password = "hunter2"`, `apiKey: 'abc...'`, `"client_secret": "..."`  code-scrubber:ignore
    id: 'generic-secret-assignment',
    name: 'Hardcoded Secret Assignment',
    provider: 'generic',
    confidence: 'medium',
    regex: /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api_?key|apikey|access_?key|private_?key|auth_?key)[A-Za-z0-9_.-]*)["']?\s*(?:=|:|:=|=>)\s*(["'`])([^"'`\s]{6,})\2/gi,
    group: 3,
    keyGroup: 1
  }
]

// Variable names that contain a secret-ish word but hold something else:
// tokenType, passwordField, secretName, apiKeyHeader, tokenUrl...
const NON_SECRET_KEY_SUFFIX = /(?:type|name|field|label|url|uri|path|file|dir|id|ids|length|len|header|prefix|suffix|format|placeholder|hint|regex|pattern|policy|mode|kind|endpoint|count|min|max|required|reset|confirm|confirmation|strength|expiry|expires|ttl|input|param|env|var)$/i

// Used for unquoted `key: value` lines in config files.
const SECRET_KEY_WORDS = /(?:password|passwd|pwd|secret|token|api_?key|apikey|access_?key|private_?key|auth_?key)/i

module.exports = {
  rules,
  NON_SECRET_KEY_SUFFIX,
  SECRET_KEY_WORDS
}

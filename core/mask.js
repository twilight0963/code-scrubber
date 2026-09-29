// Hide the middle of a secret so it can be shown in the Problems panel, CI
// logs or PR comments without leaking it a second time.
function maskSecret(secret) {
  if (secret.length >= 16) return `${secret.slice(0, 4)}…${secret.slice(-3)}`
  if (secret.length >= 8) return `${secret.slice(0, 2)}…${secret.slice(-1)}`
  return '****'
}

module.exports = {
  maskSecret
}

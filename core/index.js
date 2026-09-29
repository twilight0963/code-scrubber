// Public API of the editor-independent scanning core.
const { scanText, shouldSkipPath } = require('./scanner')
const { maskSecret } = require('./mask')
const { rules } = require('./rules')

module.exports = {
  scanText,
  shouldSkipPath,
  maskSecret,
  rules
}

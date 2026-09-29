const crypto = require('crypto')

// File format: "csv2:<salt>:<iv>:<auth tag>:<ciphertext>", all hex.
// AES-256-GCM is authenticated, so a wrong password or a tampered file fails
// to decrypt instead of producing garbage.
const FORMAT_PREFIX = 'csv2'
const ALGORITHM = 'aes-256-gcm'

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32)
}

function encryptText(plaintext, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(password, salt), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT_PREFIX, salt, iv, tag, encrypted]
    .map(part => typeof part === 'string' ? part : part.toString('hex'))
    .join(':')
}

function decryptText(fileContent, password) {
  const parts = fileContent.trim().split(':')
  if (parts.length !== 5 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('Invalid encrypted file format.')
  }
  const [salt, iv, tag, encrypted] = parts.slice(1).map(hex => Buffer.from(hex, 'hex'))
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(password, salt), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

module.exports = {
  encryptText,
  decryptText
}

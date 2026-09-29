// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { encryptText, decryptText } = require('../dotenv-crypto')

const ENV = 'API_KEY="abc123"\nDB_PASSWORD="hunter2"\n'

test('round trips', () => {
  assert.equal(decryptText(encryptText(ENV, 'correct horse'), 'correct horse'), ENV)
})

test('uses a fresh salt and IV each time', () => {
  const a = encryptText(ENV, 'pw').split(':')
  const b = encryptText(ENV, 'pw').split(':')
  assert.notEqual(a[1], b[1])
  assert.notEqual(a[2], b[2])
})

test('wrong password fails instead of returning garbage', () => {
  assert.throws(() => decryptText(encryptText(ENV, 'right'), 'wrong'), /unable to authenticate/)
})

test('tampered ciphertext fails', () => {
  const parts = encryptText(ENV, 'pw').split(':')
  const flipped = (parseInt(parts[4][0], 16) ^ 1).toString(16)
  parts[4] = flipped + parts[4].slice(1)
  assert.throws(() => decryptText(parts.join(':'), 'pw'), /unable to authenticate/)
})

test('rejects unknown formats', () => {
  assert.throws(() => decryptText('00ff:abcd', 'pw'), /Invalid encrypted file format/)
})

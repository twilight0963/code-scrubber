// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { shannonEntropy, charset, measure } = require('../entropy')

test('shannon entropy', () => {
  assert.equal(shannonEntropy(''), 0)
  assert.equal(shannonEntropy('aaaa'), 0)
  assert.equal(shannonEntropy('abab'), 1)
  assert.equal(shannonEntropy('abcd'), 2)
})

test('charset detection', () => {
  assert.equal(charset('deadbeef0123'), 'hex')
  assert.equal(charset('Zm9vYmFy+/=='), 'base64')
  assert.equal(charset('hello world!'), 'other')
})

test('random key material is high entropy', () => {
  assert.equal(measure('q8Zt3Lk9Vx2Mn7Rp4Ws6Yb1Hc5').high, true)
  assert.equal(measure('9f86d081884c7d659a2feaa0c55ad015').high, true)
})

test('words and short strings are not', () => {
  assert.equal(measure('getUserAccountSettingsById').high, false) // no digits
  assert.equal(measure('a1b2c3').high, false) // too short
  assert.equal(measure('aaaaaaaa11111111').high, false) // low entropy
})

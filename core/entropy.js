// Shannon Entropy function.
// Function obtained from https://gist.github.com/jabney/5018b4adc9b2bf488696
// entropy.js MIT License © 2014 James Abney http://github.com/jabney
function shannonEntropy(str) {
  const len = str.length
  if (len === 0) return 0

  // Make a frequency map.
  const frequencies = Array.from(str)
    .reduce((freq, c) => (freq[c] = (freq[c] || 0) + 1) && freq, {})

  // Sum the frequency of each character to obtain randomness.
  return Object.values(frequencies)
    .reduce((sum, f) => sum - f / len * Math.log2(f / len), 0)
}

// Which alphabet a string is drawn from. Random hex tops out at 4 bits/char,
// random base64 at 6, so each needs its own threshold.
function charset(str) {
  if (/^[0-9a-f]+$/i.test(str)) return 'hex'
  if (/^[A-Za-z0-9+/=_-]+$/.test(str)) return 'base64'
  return 'other'
}

// Thresholds are loosely based on TruffleHog's classic entropy mode, tuned
// down a little because short strings can't reach high entropy values.
const THRESHOLDS = {
  hex: 3.0,
  base64: 3.7,
  other: 3.7
}
const MIN_LENGTH = 16

/**
 * Whether a string looks like random key material.
 * @param {string} str
 * @returns {{ high: boolean, entropy: number, charset: string }}
 */
function measure(str) {
  const set = charset(str)
  const entropy = shannonEntropy(str)
  // Real keys mix letters and digits; words_like_this or ALL_CAPS_NAMES don't.
  const mixed = /[0-9]/.test(str) && /[A-Za-z]/.test(str)
  const high = str.length >= MIN_LENGTH && mixed && entropy >= THRESHOLDS[set]
  return { high, entropy, charset: set }
}

module.exports = {
  shannonEntropy,
  charset,
  measure,
  THRESHOLDS,
  MIN_LENGTH
}

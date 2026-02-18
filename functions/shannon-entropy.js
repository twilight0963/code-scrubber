// Shannon Entropy function.
function shannonEntropy(str) {
  const len = str.length
 
  // Make a frequency map.
  const frequencies = Array.from(str)
    .reduce((freq, c) => (freq[c] = (freq[c] || 0) + 1) && freq, {})
 
  // Sum the frequency of each character to obtain randomness.
  return Object.values(frequencies)
    .reduce((sum, f) => sum - f/len * Math.log2(f/len), 0)
}

module.exports = {
  shannonEntropy
}
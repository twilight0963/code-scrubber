// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// Shannon Entropy function.
function entropy(str) {
  const len = str.length
 
  // Make a frequency map.
  const frequencies = Array.from(str)
    .reduce((freq, c) => (freq[c] = (freq[c] || 0) + 1) && freq, {})
 
  // Sum the frequency of each character to obtain randomness.
  return Object.values(frequencies)
    .reduce((sum, f) => sum - f/len * Math.log2(f/len), 0)
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Read changes whenever a file is saved 
	let saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
		const fileName = document.fileName;
		// Ignore compiled code to speed up
		const ignoredExtensions = ['.exe', '.class', '.o', '.out', '.bin', '.pyc'];
		if (ignoredExtensions.some(ext => document.fileName.endsWith(ext))) {
			return;
		}

		// Look for all strings in document
		const re = /"(.*?)"/g;
		const strings = document.getText().match(re);
		const isGibberish = require('is-gibberish')
		if (strings == null) {
			return;
		}

		// Check if any of the strings are credentials
		const THRESHOLD = 4;
		const MIN_LEN = 12;

		// Filter out strings that are more random than threshold.
		const credentials = strings.filter(s => {
			const cleaned = s.replace("\"","");
			return cleaned.length > MIN_LEN && entropy(cleaned) > THRESHOLD && isGibberish(cleaned);
		});

		if (credentials.length > 0)
			vscode.window.showInformationMessage("Found credentials: " + credentials.join(", "));
	});

	context.subscriptions.push(saveListener);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}

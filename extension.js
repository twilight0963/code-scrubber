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

function detectCredentials(document, diagnosticCollection) {
		// Ignore compiled code to speed up
		const ignoredExtensions = ['.exe', '.class', '.o', '.out', '.bin', '.pyc', '.env'];
		if (ignoredExtensions.some(ext => document.fileName.endsWith(ext))) {
			return;
		}

		// Look for all strings in document
		const re = /"\S+"/g;
		const strings = document.getText().match(re);
		// isGibberish is used to check for strings in english (should understand other languages in final release)
		const isGibberish = require('is-gibberish')
		if (strings == null) {
			// Do not continue if no strings were found
			return;
		}

		// Constants
		const THRESHOLD = 2.5;
		const MIN_LEN = 12;

		// Check if any of the strings are credentials
		// Filter out strings that are more random than threshold.
		const credentials = strings.filter(s => {
			const cleaned = s.replace("\"","");
			return cleaned.length > MIN_LEN && entropy(cleaned) > THRESHOLD && isGibberish(cleaned);
		});

		// If atleast one credential was found, do the following
		if (credentials.length > 0) {
			// List of found problems, initialized as empty
			const diagnostics = [];
      credentials.forEach(credential => {
        const range = new vscode.Range(
          document.positionAt(document.getText().indexOf(credential)),
          document.positionAt(document.getText().indexOf(credential) + credential.length)
        );
				// Create the problem and push it to list
				const diagnostic = new vscode.Diagnostic(range, `Potential Unencrypted Credential found: ${credential}`, vscode.DiagnosticSeverity.Information);
				diagnostics.push(diagnostic);
				}
			);
			// Update the problems tab
			diagnosticCollection.set(document.uri, diagnostics);
			// EARLY VERSION CODE: vscode.window.showInformationMessage("Found credentials: " + credentials.join(", "));
			
		} else {
			// Remove specific document from problems
			diagnosticCollection.delete(document.uri)
		}
	}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Problems collection
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('credentials');

	// Read once on startup
	vscode.workspace.textDocuments.forEach((document) => detectCredentials(document, diagnosticCollection));

	// Read changes whenever a file is saved 
	let saveListener = vscode.workspace.onDidSaveTextDocument((document) => detectCredentials(document, diagnosticCollection));

	// Save the listener
	context.subscriptions.push(saveListener);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}

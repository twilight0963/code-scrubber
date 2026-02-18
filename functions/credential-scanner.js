const vscode = require('vscode')
const ent = require('./shannon-entropy')
const isGibberish = require('is-gibberish')

// The actual detection system
function detectCredentials(document, diagnosticCollection) {
	// Assume no problems until found
	diagnosticCollection.delete(document.uri)
	// Ignore compiled code and binary to speed up
	// Also ignore .env since thats the good practice
	const ignoredExtensions = ['.exe', '.class', '.o', '.out', '.bin', '.pyc', '.env', '.gitignore', '.dmg'];
	if (ignoredExtensions.some(ext => document.fileName.endsWith(ext))) {
		return;
	}
	const documentText = document.getText()
	// Check if file should be ignored
	const findIgnore = /ignore\.code-scrubber\.diagnostics.*/ // SUPRESS MESSAGE
	if (documentText.match(findIgnore)) {
		// If suppress message in file, ignore the entire file
		return
	}
	// Look for all continous strings in document
	const findString = /"\S+"/g; // Translates to longest string without whitespace surrounded by ""
	const strings = documentText.match(findString);

	if (!strings) {
		// Do not continue if no strings were found
		return;
	}

	// Constants
	const THRESHOLD = 2.5; // Shannon entropy threshold for a "random" string
	const MIN_LEN = 12; // Length threshold

	// Check if any of the strings are credentials
	// Filter out strings that are more random than threshold.
	const credentials = strings.filter(s => {
		const cleaned = s.replace("\"", "").toLowerCase();
		return cleaned.length > MIN_LEN && ent.shannonEntropy(cleaned) > THRESHOLD && isGibberish(cleaned);
	});

	// If atleast one credential was found, do the following
	if (credentials.length() > 0) {
		// List of found problems, initialized as empty
		const diagnostics = [];
		credentials.forEach(credential => {
			const range = new vscode.Range(
				document.positionAt(document.getText().indexOf(credential)),
				document.positionAt(document.getText().indexOf(credential) + credential.length)
			);
			// Create the problem and push it to list
			const diagnostic = new vscode.Diagnostic(range, `Potential unencrypted credential found: ${credential}`, vscode.DiagnosticSeverity.Information);
			diagnostics.push(diagnostic);
		}
		);
		// Update the problems tab
		diagnosticCollection.set(document.uri, diagnostics);
		// EARLY VERSION CODE: vscode.window.showInformationMessage("Found credentials: " + credentials.join(", "));

	}
}

module.exports = {
	detectCredentials
}
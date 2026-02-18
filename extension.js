// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const scanner = require('./functions/credential-scanner');
const refactorProvider = require("./classes/RefactorProvider");




// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Problems collection
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('credentials');
	const refactorDiagnostic = new refactorProvider.CodeActionProvider();

	// Subscribe the refactor to menu
	context.subscriptions.push(vscode.languages.registerCodeActionsProvider("*",refactorDiagnostic, {
		providedCodeActionKinds: refactorProvider.CodeActionProvider.providedCodeActionKinds
	}));
	// Read once on startup
	vscode.workspace.textDocuments.forEach((document) => scanner.detectCredentials(document, diagnosticCollection));

	// Read changes whenever a file is saved 
	let saveListener = vscode.workspace.onDidSaveTextDocument((document) => scanner.detectCredentials(document, diagnosticCollection));

	

	// Save the listener
	context.subscriptions.push(saveListener);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}

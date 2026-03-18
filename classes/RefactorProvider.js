const vscode = require('vscode');

// Diagnostic Code Actions
class CodeActionProvider {

  // Provide quick fix actions shown in lightbulb menu next to problem
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(document, range) {
    // Add quickfix action for suppressing extension warnings
    const ignoreAction = new vscode.CodeAction("Ignore credential leaks for this file. (Not Recommended)", vscode.CodeActionKind.QuickFix);
    ignoreAction.edit = new vscode.WorkspaceEdit();
    // Map comment character by language to not affect code, and grab it
    const commentCharacters = {
      'python': '#',
      'assembly': ';',
      'html': '<!--',
      'css': '/*',
      'ruby': '#',
      'perl': '#',
      'default': '//'
    };
    const commentChar = commentCharacters[document.languageId] || commentCharacters['default']; // Default to '//' when a map is not given
    ignoreAction.edit.insert(document.uri, new vscode.Position(0, 0), commentChar + ' ignore.code-scrubber.diagnostics\n'); // Add ignore code to the start of the code

    // Add quickfix action for moving the credential to .env file in cwd
    const moveToEnv = new vscode.CodeAction("Move credential to .env and replace in file", vscode.CodeActionKind.QuickFix);
    moveToEnv.edit = new vscode.WorkspaceEdit();

    // Path is considered as $cwd/.env
    const path = vscode.workspace.workspaceFolders[0].uri.fsPath + "/.env";
    const file = vscode.Uri.file(path);
    moveToEnv.edit.createFile(file, { ignoreIfExists: true }); // Create file, or skip this line otherwise

    // Make key name
    const lastSlash = document.fileName.lastIndexOf("/") || 0; // Get everything after last directory change, should lead to root directory
    const fileName = document.fileName.substring(lastSlash + 1).toUpperCase(); // Constants are generally uppercase
    const keyName = "KEY_" + fileName.replace(new RegExp("[.-]", "g"), "") + (range.start.line + 1); // "KEY_$fileName_$line" is used as key format for unique keys

    // Apply edits
    const credential = document.getText(range); // Get the key itself from the document
    moveToEnv.edit.insert(file, new vscode.Position(0, 0), `${keyName} = ${credential}\n`); // Insert in format "KEY_xyz = ${key}" at the top of .env
    moveToEnv.edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), document.getText().replace(new RegExp(credential, "g"), keyName)); // Replace all key strings with the key itself

    const uploadToAws = new vscode.CodeAction("Upload credential to AWS Secrets Manager and replace in file.", vscode.CodeActionKind.QuickFix);
    return [
      moveToEnv, // For "Move credential to .env and replace in file" fix
      ignoreAction, // For "Ignore credential leaks for this file." fix
      uploadToAws // For "Upload credential to AWS Secrets Manager and replace in file." fix
    ]
  }
}

module.exports = {
  CodeActionProvider
}
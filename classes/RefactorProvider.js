const vscode = require('vscode');

// Diagnostic Code Actions
class CodeActionProvider {
  // Provide quick fix actions shown in lightbulb menu next to problem
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(document,range) {
    // Add command for suppressing extension warnings
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
    ignoreAction.edit.insert(document.uri, new vscode.Position(0,0), commentChar+' ignore.code-scrubber.diagnostics\n'); // Add ignore code to the start of the code
    ignoreAction.edit.insert(document.uri, document.
    return [
      ignoreAction, // For "Ignore for this file" fix
    ]
  }
}

module.exports = {
  CodeActionProvider
}
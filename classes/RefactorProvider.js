const vscode = require('vscode');
const { DIAGNOSTIC_SOURCE } = require('../functions/credential-scanner');
const { createIgnoreAction, createIgnoreLineAction } = require('../functions/quickfixes/ignore-action');
const { createMoveToEnvAction } = require('../functions/quickfixes/move-to-env');

// Diagnostic Code Actions
class CodeActionProvider {

  // Provide quick fix actions shown in lightbulb menu next to problem
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document, range, context) {
    const actions = [];

    // Only offer fixes where we actually reported a problem
    const ours = context.diagnostics.filter(d => d.source === DIAGNOSTIC_SOURCE);
    if (ours.length === 0) {
      return actions;
    }

    if (document.fileName.endsWith(".gitignore")) {
      const addToGitIgnore = new vscode.CodeAction("Add .env to .gitignore", vscode.CodeActionKind.QuickFix);
      addToGitIgnore.edit = new vscode.WorkspaceEdit();
      addToGitIgnore.edit.insert(document.uri, new vscode.Position(0, 0), ".env\n");
      addToGitIgnore.diagnostics = ours;
      addToGitIgnore.isPreferred = true;
      actions.push(addToGitIgnore);
      return actions;
    }

    for (const diagnostic of ours) {
      // Add quickfix action for moving the credential to .env file in cwd
      const moveToEnv = createMoveToEnvAction(document, diagnostic);
      if (moveToEnv) {
        actions.push(moveToEnv);
      }

      // Add quickfix action for suppressing a single finding
      const ignoreLine = createIgnoreLineAction(document, diagnostic);
      if (ignoreLine) {
        actions.push(ignoreLine);
      }
    }

    // Add quickfix action for suppressing extension warnings in the whole file
    const ignoreAction = createIgnoreAction(document);
    if (ignoreAction) {
      ignoreAction.diagnostics = ours;
      actions.push(ignoreAction);
    }

    // "Upload to AWS Secrets Manager" is hidden until it's implemented
    // (see functions/quickfixes/upload-to-aws.js).

    return actions;
  }
}

module.exports = {
  CodeActionProvider
}

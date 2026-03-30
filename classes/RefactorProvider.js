const vscode = require('vscode');
const { createIgnoreAction } = require('../functions/quickfixes/ignore-action');
const { createMoveToEnvAction } = require('../functions/quickfixes/move-to-env');
const { createUploadToAwsAction } = require('../functions/quickfixes/upload-to-aws');

// Diagnostic Code Actions
class CodeActionProvider {

  // Provide quick fix actions shown in lightbulb menu next to problem
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  
  provideCodeActions(document, range) {
    const actions = [];

    // Add quickfix action for moving the credential to .env file in cwd
    const moveToEnv = createMoveToEnvAction(document, range);
    if (moveToEnv) {
      actions.push(moveToEnv);
    }

    // Add quickfix action for suppressing extension warnings
    const ignoreAction = createIgnoreAction(document);
    if (ignoreAction) {
      actions.push(ignoreAction);
    }

    // Add quickfix action for AWS Secrets Manager
    const uploadToAws = createUploadToAwsAction(document, range);
    if (uploadToAws) {
      actions.push(uploadToAws);
    }

    return actions;
  }
}

module.exports = {
  CodeActionProvider
}
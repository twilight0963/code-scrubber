// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const scanner = require("./functions/credential-scanner");
const refactorProvider = require("./classes/RefactorProvider");
const debugInfoCommand = require("./functions/debug-info-command");
const encryptDotenv = require("./functions/encrypt-dotenv");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Problems collection
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("credentials");
  const refactorDiagnostic = new refactorProvider.CodeActionProvider();

  // Subscribe the refactor to menu
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", refactorDiagnostic, {
      providedCodeActionKinds:
        refactorProvider.CodeActionProvider.providedCodeActionKinds,
    }),
  );
  // Read once on startup
  vscode.workspace.textDocuments.forEach((document) =>
    scanner.detectCredentials(document, diagnosticCollection),
  );

  // Read changes whenever a file is saved
  let saveListener = vscode.workspace.onDidSaveTextDocument((document) =>
    scanner.detectCredentials(document, diagnosticCollection),
  );

  // Save the listener
  context.subscriptions.push(saveListener);

  // Command used for demos: shows the credential warning prompt.
  const showPromptCommand = vscode.commands.registerCommand(
    "twilight0963.codescrubber.showCredentialPrompt",
    async () => {
      await debugInfoCommand.promptToSecureCredentials();
    },
  );
  context.subscriptions.push(showPromptCommand);

  // Source Control Menu Command: Encrypt .env file
  const encryptCommand = vscode.commands.registerCommand(
    "twilight0963.codescrubber.encryptDotenv",
    async () => {
      await encryptDotenv.encryptDotenv();
    },
  );
  context.subscriptions.push(encryptCommand);

  // Source Control Menu Command: Decrypt .env file
  const decryptCommand = vscode.commands.registerCommand(
    "twilight0963.codescrubber.decryptDotenv",
    async () => {
      await encryptDotenv.decryptDotenv();
    },
  );
  context.subscriptions.push(decryptCommand);

  // Check on Startup
  encryptDotenv.checkAndPromptDecryption();

  // Integrated Git Pull detection
  const gitExtension = vscode.extensions.getExtension("vscode.git");
  if (gitExtension) {
    const activateGit = async () => {
      const gitApi = gitExtension.exports.getAPI(1);
      if (gitApi && gitApi.repositories.length > 0) {
        gitApi.repositories.forEach((repo) => {
          repo.state.onDidChange(() => {
            encryptDotenv.checkAndPromptDecryption();
          });
        });
      }
    };
    activateGit();
  }
}

// This method is called when your extension is deactivated
function deactivate() {
  // Remove all reported problems
  vscode.workspace.textDocuments.forEach((document) =>
    diagnosticCollection.delete(document.uri),
  );
}

module.exports = {
  activate,
  deactivate,
};

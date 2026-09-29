// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const scanner = require("./functions/credential-scanner");
const refactorProvider = require("./classes/RefactorProvider");
const debugInfoCommand = require("./functions/debug-info-command");
const encryptDotenv = require("./functions/encrypt-dotenv");
const preCommitHook = require("./functions/pre-commit-hook");
const repoScan = require("./functions/repo-scan");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Problems collection
    const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("credentials");
    // Disposed (and its problems cleared) automatically on deactivate
    context.subscriptions.push(diagnosticCollection);
    repoScan.init(context, diagnosticCollection);
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
        scanner.detectCredentials(document, diagnosticCollection)
    );

    // Read changes whenever a file is saved
    let saveListener = vscode.workspace.onDidSaveTextDocument((document) =>
        scanner.detectCredentials(document, diagnosticCollection)
    );

    // Read files as they are opened
    let openListener = vscode.workspace.onDidOpenTextDocument((document) =>
        scanner.detectCredentials(document, diagnosticCollection)
    );

    // Clear problems for files that are closed
    let closeListener = vscode.workspace.onDidCloseTextDocument((document) =>
        diagnosticCollection.delete(document.uri)
    );

    // Save the listeners
    context.subscriptions.push(saveListener, openListener, closeListener);

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
    const activateGit = async () => {
        const gitApi = await preCommitHook.getGitApi();
        if (!gitApi) {
            return;
        }
        const watchRepo = (repo) => {
            context.subscriptions.push(repo.state.onDidChange(() => {
                encryptDotenv.checkAndPromptDecryption();
            }));
        };
        gitApi.repositories.forEach(watchRepo);
        context.subscriptions.push(gitApi.onDidOpenRepository(watchRepo));
    };
    activateGit().catch((err) => console.error("Code-Scrubber: git integration failed", err));

    // Offer the pre-commit hook when a repository is opened or initialized
    preCommitHook.activateHooks(context).catch((err) =>
        console.error("Code-Scrubber: pre-commit hook setup failed", err)
    );
}

// This method is called when your extension is deactivated
function deactivate() {
    // The diagnostic collection is in context.subscriptions, so VS Code
    // disposes it (clearing all reported problems) for us.
}

module.exports = {
    activate,
    deactivate,
};

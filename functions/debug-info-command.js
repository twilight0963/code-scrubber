const vscode = require('vscode');

/**
 * Shows a Yes/No prompt asking whether to secure credentials before uploading.
 * @returns {Promise<boolean>} true if user selects "Yes", otherwise false.
 */
async function promptToSecureCredentials() {
    const selection = await vscode.window.showWarningMessage(
        'Unencrypted credentials were found, would you like to secure them before uploading?',
        { modal: true },
        'Yes',
        'No'
    );

    return selection === 'Yes';
}

module.exports = {
    promptToSecureCredentials,
};
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { encryptText, decryptText } = require('../core/dotenv-crypto');

async function encryptDotenv() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const dotenvPath = path.join(workspaceFolders[0].uri.fsPath, '.env');
    if (!fs.existsSync(dotenvPath)) {
        vscode.window.showWarningMessage('No .env file found in the root of the workspace.');
        return;
    }

    const password = await vscode.window.showInputBox({
        prompt: 'Enter a master password for encryption',
        password: true,
        placeHolder: 'Master Password'
    });

    if (!password) {
        return;
    }

    try {
        const content = fs.readFileSync(dotenvPath, 'utf8');
        const result = encryptText(content, password);
        const encryptedPath = dotenvPath + '.enc';
        
        fs.writeFileSync(encryptedPath, result);
        vscode.window.showInformationMessage(`Successfully encrypted .env to ${path.basename(encryptedPath)}`);
        
        const deleteOriginal = await vscode.window.showInformationMessage(
            'Keep original .env file?',
            'Keep',
            'Delete'
        );

        if (deleteOriginal === 'Delete') {
            fs.unlinkSync(dotenvPath);
            vscode.window.showInformationMessage('.env original file deleted.');
        }
    } catch (err) {
        vscode.window.showErrorMessage('Encryption failed: ' + err.message);
    }
}

async function decryptDotenv() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const encryptedPath = path.join(workspaceFolders[0].uri.fsPath, '.env.enc');
    if (!fs.existsSync(encryptedPath)) {
        return;
    }

    const password = await vscode.window.showInputBox({
        prompt: 'Enter master password to decrypt .env',
        password: true,
        placeHolder: 'Master Password'
    });

    if (!password) return;

    try {
        const fileContent = fs.readFileSync(encryptedPath, 'utf8');
        const decrypted = decryptText(fileContent, password);

        const dotenvPath = path.join(workspaceFolders[0].uri.fsPath, '.env');
        // Owner read/write only
        fs.writeFileSync(dotenvPath, decrypted, { mode: 0o600 });
        vscode.window.showInformationMessage('Successfully decrypted .env file.');

        const deleteEncrypted = await vscode.window.showInformationMessage(
            'Keep encrypted .env.enc file?',
            'Keep',
            'Delete'
        );

        if (deleteEncrypted === 'Delete') {
            fs.unlinkSync(encryptedPath);
            vscode.window.showInformationMessage('.env.enc file deleted.');
        }
    } catch (err) {
        if (err.message.includes('unable to authenticate')) {
            vscode.window.showErrorMessage('Incorrect password, or the .env.enc file has been modified. Decryption failed.');
        } else {
            vscode.window.showErrorMessage('Decryption failed: ' + err.message);
        }
    }
}

async function checkAndPromptDecryption() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const encryptedPath = path.join(workspaceFolders[0].uri.fsPath, '.env.enc');
    const dotenvPath = path.join(workspaceFolders[0].uri.fsPath, '.env');

    if (fs.existsSync(encryptedPath) && !fs.existsSync(dotenvPath)) {
        const selection = await vscode.window.showInformationMessage(
            'Encrypted .env.enc found but no .env. Would you like to decrypt it?',
            'Decrypt Now',
            'Later'
        );

        if (selection === 'Decrypt Now') {
            await decryptDotenv();
        }
    }
}

module.exports = {
    encryptDotenv,
    decryptDotenv,
    checkAndPromptDecryption
};

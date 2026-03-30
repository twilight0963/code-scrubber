const vscode = require('vscode');

function createMoveToEnvAction(document, range) {
    const moveToEnv = new vscode.CodeAction("Move credential to .env and replace in file", vscode.CodeActionKind.QuickFix);
    moveToEnv.edit = new vscode.WorkspaceEdit();

    // Path is considered as $cwd/.env
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return null;
    }

    const path = vscode.workspace.workspaceFolders[0].uri.fsPath + "/.env";
    const file = vscode.Uri.file(path);
    moveToEnv.edit.createFile(file, { ignoreIfExists: true });

    // Make key name
    const lastSlash = document.fileName.lastIndexOf("/") || 0;
    const fileName = document.fileName.substring(lastSlash + 1).toUpperCase();
    const keyName = "KEY_" + fileName.replace(new RegExp("[.-]", "g"), "") + (range.start.line + 1);
    
    // Language map for env variable access
    const keyNameByLang = {
        python: `os.getenv("${keyName}")`,
        javascript: `process.env.${keyName}`,
        typescript: `process.env.${keyName}`,
        ruby: `ENV["${keyName}"]`,
        php: `getenv("${keyName}")`,
        go: `os.Getenv("${keyName}")`,
        java: `System.getenv("${keyName}")`,
        csharp: `Environment.GetEnvironmentVariable("${keyName}")`
    };

    
    
    const codeKeyName = keyNameByLang[document.languageId] || keyName; // Default to key name if language not in map 
    
    // Apply edits
    const credential = document.getText(range);
    const text = document.getText();
    
    // Add imports if not already present
    if (document.languageId === "python") {
        if (!text.includes("import os")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "import os\n");
        }
        if (!text.includes("from dotenv import load_dotenv")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "from dotenv import load_dotenv\nload_dotenv()\n");
        }
    } else if ((document.languageId === "javascript" || document.languageId === "typescript")) {
        if (!text.includes("require('dotenv')") && !text.includes('import "dotenv/config"') && !text.includes('from "dotenv"')) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "require('dotenv').config();\n");
        }
    } else if (document.languageId === "ruby") {
        if (!text.includes("require 'dotenv'")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "require 'dotenv'\nDotenv.load\n");
        }
    } else if (document.languageId === "php") {
        if (!text.includes("Dotenv\\Dotenv")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "<?php\nrequire 'vendor/autoload.php';\n$dotenv = Dotenv\\Dotenv::createImmutable(__DIR__);\n$dotenv->load();\n");
        }
    } else if (document.languageId === "go") {
        if (!text.includes("github.com/joho/godotenv")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "import \"github.com/joho/godotenv\"\nfunc init() { godotenv.Load() }\n");
        }
    }

    moveToEnv.edit.insert(file, new vscode.Position(0, 0), `${keyName} = ${credential}\n`);
    // Replace all key strings with the key itself
    moveToEnv.edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), document.getText().replace(new RegExp(credential, "g"), codeKeyName));

    return moveToEnv;
}

module.exports = {
    createMoveToEnvAction
};

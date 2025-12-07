"use strict";
var mesh;
var child_process = require('child_process');

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    if (typeof args['_'] === 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
    }
    var fnname = args['_'][1];
    switch (fnname) {
        case 'runCommand':
            runCommand(args);
            break;
        default:
            // ignore unknown actions
            break;
    }
}

function runCommand(args) {
    var command = typeof args.command === 'string' ? args.command.trim() : null;
    if (!command) {
        sendResult(args.requestId, 'No command provided', 'No command provided', 1, 0, args);
        return;
    }
    var exec = child_process.exec;
    var startTime = Date.now();
    var options = {
        timeout: Math.max(1, Number(args.timeout) || 60) * 1000,
        maxBuffer: 8 * 1024 * 1024
    };
    if (typeof args.shell === 'string' && args.shell.length && args.shell !== 'auto') {
        options.shell = args.shell;
    }
    var child = exec(command, options, function (error, stdout, stderr) {
        var exitCode = 0;
        var errMsg = null;
        if (error) {
            exitCode = typeof error.code === 'number' ? error.code : 1;
            errMsg = error.message;
        }
        var output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;
        output = output.trim();
        var duration = Date.now() - startTime;
        sendResult(args.requestId, output, errMsg, exitCode, duration, args);
    });
}

function sendResult(requestId, output, errorMessage, exitCode, duration, args) {
    mesh.SendCommand({
        action: 'plugin',
        plugin: 'commandapi',
        pluginaction: 'commandResult',
        requestId: requestId,
        output: output,
        error: errorMessage,
        exitCode: exitCode,
        duration: duration,
        shell: args.shell || 'auto',
        command: args.command,
        meta: args.meta || null
    });
}

module.exports = {
    consoleaction: consoleaction
};

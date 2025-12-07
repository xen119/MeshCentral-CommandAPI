"use strict";

module.exports.commandapi = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.commandHistory = {};
    obj.historyLimit = 50;

    obj.exports = [];

    obj.server_startup = function () {
        obj.meshServer.pluginHandler.commandapi = obj;
    };

    obj.handleAdminReq = function (req, res, user) {
        var action = (req.query.api || req.query.action || '').toLowerCase();
        switch (action) {
            case 'sendcommand':
                obj.handleSendCommandRequest(req, res, user);
                break;
            case 'getresults':
                obj.handleGetResults(req, res, user);
                break;
            default:
                res.sendStatus(404);
                break;
        }
    };

    obj.parseJSONBody = function (req) {
        if (req.body && Object.keys(req.body).length > 0) return Promise.resolve(req.body);
        return new Promise(function (resolve, reject) {
            var raw = '';
            req.on('data', function (chunk) {
                raw += chunk.toString();
            });
            req.on('end', function () {
                if (!raw) return resolve({});
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(e);
                }
            });
            req.on('error', reject);
        });
    };

    obj.normalizeNodes = function (value) {
        if (value == null) return [];
        if (typeof value === 'string') value = value.split(',');
        if (!Array.isArray(value)) return [];
        return value
            .map(function (entry) {
                if (entry == null) return '';
                return entry.toString().trim();
            })
            .filter(function (entry) {
                return entry.length > 0;
            });
    };

    obj.isSiteAdmin = function (user) {
        if (!user) return false;
        return (user.siteadmin & 0xFFFFFFFF) === 1;
    };

    obj.generateRequestId = function () {
        var now = Date.now();
        var rand = Math.floor(Math.random() * 0x100000).toString(36);
        return 'cmd_' + now.toString(36) + '_' + rand;
    };

    obj.recordRequest = function (requestId, payload, nodes, user) {
        var shell = typeof payload.shell === 'string' && payload.shell.length ? payload.shell : 'auto';
        var timeout = Math.max(1, Number(payload.timeout) || 60);
        var record = {
            requestId: requestId,
            command: payload.command,
            shell: shell,
            timeout: timeout,
            createdAt: Date.now(),
            meta: {
                sentBy: (user && user.name) ? user.name : 'anonymous',
                comment: payload.comment || null
            },
            nodes: {}
        };
        nodes.forEach(function (node) {
            record.nodes[node] = {
                status: 'queued',
                queuedAt: Date.now()
            };
        });
        obj.commandHistory[requestId] = record;
        obj.cleanHistory();
        return record;
    };

    obj.handleSendCommandRequest = function (req, res, user) {
        if (!obj.isSiteAdmin(user)) {
            res.sendStatus(403);
            return;
        }
        obj.parseJSONBody(req)
            .then(function (payload) {
                var command = typeof payload.command === 'string' ? payload.command.trim() : null;
                if (!command) command = typeof payload.cmd === 'string' ? payload.cmd.trim() : null;
                if (!command) {
                    res.status(400).json({ error: 'command is required in the payload' });
                    return;
                }
                var nodes = obj.normalizeNodes(payload.nodes || payload.node || payload.targets);
                if (nodes.length === 0) {
                    res.status(400).json({ error: 'nodes array is required' });
                    return;
                }
                var requestId = obj.generateRequestId();
                payload.command = command;
                var history = obj.recordRequest(requestId, payload, nodes, user);
                var dispatched = [];
                nodes.forEach(function (nodeId) {
                    var connection = obj.meshServer.webserver.wsagents[nodeId];
                    if (!connection || connection.ws == null) {
                        history.nodes[nodeId].status = 'offline';
                        history.nodes[nodeId].error = 'Agent not connected';
                        history.nodes[nodeId].completedAt = Date.now();
                        return;
                    }
                    try {
                        connection.send(JSON.stringify({
                            action: 'plugin',
                            plugin: 'commandapi',
                            pluginaction: 'runCommand',
                            requestId: requestId,
                            command: history.command,
                            shell: history.shell,
                            timeout: history.timeout,
                            meta: history.meta
                        }));
                        history.nodes[nodeId].status = 'dispatched';
                        history.nodes[nodeId].dispatchedAt = Date.now();
                        dispatched.push(nodeId);
                    } catch (error) {
                        history.nodes[nodeId].status = 'failed';
                        history.nodes[nodeId].error = 'Could not send command to agent';
                        history.nodes[nodeId].detail = error.message;
                        history.nodes[nodeId].completedAt = Date.now();
                    }
                });
                res.json({
                    requestId: requestId,
                    command: history.command,
                    shell: history.shell,
                    timeout: history.timeout,
                    meta: history.meta,
                    nodes: history.nodes,
                    dispatched: dispatched
                });
            })
            .catch(function (err) {
                res.status(400).json({ error: 'Invalid JSON payload: ' + err.message });
            });
    };

    obj.handleGetResults = function (req, res, user) {
        if (!obj.isSiteAdmin(user)) {
            res.sendStatus(403);
            return;
        }
        var requestId = req.query.requestid || req.query.requestId;
        if (!requestId) {
            res.status(400).json({ error: 'requestId is required' });
            return;
        }
        var record = obj.commandHistory[requestId];
        if (!record) {
            res.status(404).json({ error: 'requestId not found' });
            return;
        }
        res.json(record);
    };

    obj.cleanHistory = function () {
        var keys = Object.keys(obj.commandHistory);
        if (keys.length <= obj.historyLimit) return;
        keys.sort(function (a, b) {
            return obj.commandHistory[a].createdAt - obj.commandHistory[b].createdAt;
        });
        var removeCount = keys.length - obj.historyLimit;
        for (var i = 0; i < removeCount; i++) {
            delete obj.commandHistory[keys[i]];
        }
    };

    obj.serveraction = function (command, myparent, grandparent) {
        if (command.plugin !== 'commandapi') return;
        if (command.pluginaction === 'commandResult') {
            obj.handleCommandResult(command, myparent);
        }
    };

    obj.handleCommandResult = function (command, connection) {
        if (!command.requestId) return;
        var record = obj.commandHistory[command.requestId];
        if (!record) return;
        var nodeId = connection ? connection.dbNodeKey : command.nodeId;
        if (!nodeId) return;
        var result = record.nodes[nodeId] || {};
        result.status = 'complete';
        result.exitCode = typeof command.exitCode === 'number' ? command.exitCode : (command.code || 0);
        result.output = typeof command.output === 'string' ? command.output : '';
        result.error = command.error || null;
        result.duration = typeof command.duration === 'number' ? command.duration : null;
        result.completedAt = Date.now();
        record.nodes[nodeId] = result;
    };

    return obj;
};

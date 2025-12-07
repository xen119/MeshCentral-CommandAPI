# MeshCentral Command API

A compact MeshCentral plugin that exposes a REST-style endpoint for dispatching shell commands to agents and tracking their output. It reuses the existing MeshCentral plugin infrastructure, so installation is a matter of adding the plugin configuration to your MeshCentral server.

## Features
- `POST /pluginadmin.ashx?pin=commandapi&api=sendCommand` sends a shell command to one or multiple agents.
- `GET  /pluginadmin.ashx?pin=commandapi&api=getResults&requestId=<id>` polls the command execution results that the agent returned.
- Tracks command output, exit codes, duration, and node delivery status for recent requests.
- Supports platform-appropriate shell execution and configurable timeouts.

## Installation

1. Enable plugins in your MeshCentral `config.json` (if not already set):

   ```json
   "plugins": {
        "enabled": true
   }
   ```

2. Copy the `MeshCentral-CommandAPI` folder into your MeshCentral `plugins` directory.
3. Restart the MeshCentral server.
4. In the MeshCentral admin UI, add the plugin via the local folder path or URL for `config.json`.

## Usage

### Send a command

Only site administrators can invoke the API. Use a POST request with a JSON payload:

```http
POST /pluginadmin.ashx?pin=commandapi&api=sendCommand HTTP/1.1
Content-Type: application/json

{
  "nodes": ["nodeid1", "nodeid2"],
  "command": "whoami",
  "shell": "auto",
  "timeout": 30,
  "comment": "daily audit"
}
```

- `nodes` accepts an array of node IDs, or a single string with comma-separated IDs.
- `command` is any shell command that the agent can execute (powershell, bash, cmd).
- `shell` is optional and defaults to `auto` (the agent chooses the best shell).
- `timeout` is in seconds (default 60).
- `comment` is stored with the request for bookkeeping.

The response includes a `requestId` you can later use to inspect per-node delivery status.

### Get results

```http
GET /pluginadmin.ashx?pin=commandapi&api=getResults&requestId=<requestId>
```

Returns JSON that lists the original command, metadata, and each node’s status, output, exit code, and duration once the agent posts its result.

## Example response

```json
{
  "requestId": "cmd_1701898874",
  "command": "whoami",
  "shell": "auto",
  "timeout": 30,
  "meta": {
    "comment": "daily audit",
    "sentBy": "admin"
  },
  "nodes": {
    "nodeid1": {
      "status": "complete",
      "exitCode": 0,
      "output": "meshuser",
      "duration": 310,
      "completedAt": 1701898895
    },
    "nodeid2": {
      "status": "offline",
      "error": "Agent not connected",
      "completedAt": 1701898895
    }
  }
}
```

## Notes

- Results are held in memory with a configurable cap (default 50 requests) and will be rotated as the plugin receives new commands.
- This plugin implements its own meshcore module (`modules_meshcore/commandapi.js`) so that the agents can execute the requested command and report results back to the server.

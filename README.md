# GARZA Orchestrator Service

Web service deployed to Fly.io that can SSH to garzahive to deploy MCP servers.

## Why This Exists

Desktop Commander's container has no network access and can't SSH. This service:
- Runs on Fly.io with full network access
- Has SSH access to garzahive
- Can deploy MCP servers via HTTP endpoints
- Provides a permanent deployment hub

## Architecture

```
Claude Desktop → HTTP Request → Orchestrator (Fly.io) → SSH → garzahive → flyctl deploy
```

## GitHub Actions Deployment

This repo auto-deploys to Fly.io via GitHub Actions on every push to main.

### Required GitHub Secrets

Set these at https://github.com/itsablabla/garza-orchestrator/settings/secrets/actions:

1. **FLY_API_TOKEN** - Your Fly.io deploy token
2. **SSH_PRIVATE_KEY** - The orchestrator SSH private key (see Downloads folder)

### Manual Deploy Trigger

https://github.com/itsablabla/garza-orchestrator/actions/workflows/deploy.yml

Click "Run workflow" to deploy manually.

## SSH Key Setup

**Public key** (add to garzahive `/root/.ssh/authorized_keys`):
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDpBhjtE5Opu7akbSdkWIJ2RKy1igB0hZdEaTq3mT/o garza-orchestrator@fly.io
```

**Private key**: Located in your Downloads folder as `orchestrator_key`

## API Endpoints

### Health Check
```
GET https://garza-orchestrator.fly.dev/health
```

### Deploy MCP Server
```
POST https://garza-orchestrator.fly.dev/deploy/mcp
Content-Type: application/json

{
  "app_name": "lastrock-mcp",
  "repo": "https://github.com/itsablabla/lastrock-mcp.git",
  "region": "dfw"
}
```

### Execute Command on garzahive
```
POST https://garza-orchestrator.fly.dev/execute
Content-Type: application/json

{
  "command": "ls -la /tmp"
}
```

## Files

- `server.py` - Flask web service with /deploy/mcp and /execute endpoints
- `Dockerfile` - Python 3.11 with SSH client and git
- `fly.toml` - Fly.io configuration
- `requirements.txt` - Flask + gunicorn
- `.github/workflows/deploy.yml` - Auto-deployment workflow

## Security Notes

- SSH_PRIVATE_KEY secret is encrypted by GitHub/Fly.io
- Service uses password-less SSH key auth
- No rate limiting currently

## Future Enhancements

- [ ] Add authentication (API key header)
- [ ] Rate limiting
- [ ] Webhook notifications
- [ ] Deployment history/logs
- [ ] Multi-server support (not just garzahive)
- [ ] Integrate with existing orchestrator.py YAML templates

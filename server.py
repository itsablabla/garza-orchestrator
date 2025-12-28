#!/usr/bin/env python3
"""
GARZA OS Orchestrator Service - Fly.io Deployment
Web service wrapper for orchestrator that can SSH to garzahive
"""

from flask import Flask, request, jsonify
import subprocess
import os
import json
from datetime import datetime

app = Flask(__name__)

# Initialize SSH key from environment on startup
def init_ssh_key():
    """Write SSH private key from environment to disk"""
    ssh_key = os.environ.get('SSH_PRIVATE_KEY')
    if ssh_key:
        os.makedirs('/root/.ssh', exist_ok=True)
        
        # Write key (handle both raw and base64)
        key_path = '/root/.ssh/id_rsa'
        with open(key_path, 'w') as f:
            # Add newlines if they were stripped
            if '-----BEGIN' in ssh_key and '\n' not in ssh_key:
                ssh_key = ssh_key.replace('-----BEGIN OPENSSH PRIVATE KEY-----', 
                                         '-----BEGIN OPENSSH PRIVATE KEY-----\n')
                ssh_key = ssh_key.replace('-----END OPENSSH PRIVATE KEY-----', 
                                         '\n-----END OPENSSH PRIVATE KEY-----')
            f.write(ssh_key)
        
        os.chmod(key_path, 0o600)
        print(f"✅ SSH key initialized at {key_path}")
    else:
        print("⚠️  No SSH_PRIVATE_KEY environment variable found")

# Initialize on import
init_ssh_key()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'garza-orchestrator',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/deploy/mcp', methods=['POST'])
def deploy_mcp():
    """
    Deploy MCP server to Fly.io via SSH to garzahive
    
    Body: {
        "app_name": "lastrock-mcp",
        "repo": "https://github.com/itsablabla/lastrock-mcp.git",
        "region": "dfw"
    }
    """
    data = request.json
    app_name = data.get('app_name')
    repo = data.get('repo')
    region = data.get('region', 'dfw')
    
    if not app_name or not repo:
        return jsonify({'error': 'app_name and repo required'}), 400
    
    # SSH to garzahive and deploy
    commands = [
        f"cd /tmp && rm -rf {app_name}",
        f"git clone {repo} {app_name}",
        f"cd {app_name} && /root/.fly/bin/flyctl deploy --ha=false --region {region}"
    ]
    
    cmd = " && ".join(commands)
    ssh_cmd = f"ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 root@garzahive.com '{cmd}'"
    
    try:
        result = subprocess.run(
            ssh_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=600
        )
        
        return jsonify({
            'status': 'success' if result.returncode == 0 else 'failed',
            'app_name': app_name,
            'returncode': result.returncode,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'timestamp': datetime.utcnow().isoformat()
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Deployment timed out after 10 minutes'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/execute', methods=['POST'])
def execute_ssh():
    """
    Execute arbitrary command on garzahive
    
    Body: {
        "command": "ls -la /tmp"
    }
    """
    data = request.json
    command = data.get('command')
    
    if not command:
        return jsonify({'error': 'command required'}), 400
    
    ssh_cmd = f"ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 root@garzahive.com '{command}'"
    
    try:
        result = subprocess.run(
            ssh_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        return jsonify({
            'returncode': result.returncode,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

#!/usr/bin/env node
/**
 * GarzaOS Agent Control MCP Server
 * 
 * Exposes tools for controlling the Base44 agent fleet:
 * - list_agents: List all registered agents and their status
 * - dispatch_task: Send a task to an agent
 * - get_agent_status: Get live status of an agent
 * - read_tasks: Read AgentTask records
 * - update_task: Update an AgentTask record
 * - send_telegram: Send a Telegram message
 * - get_agent_activity: Get recent AgentActivity records
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "http";

const BASE44_APP_ID = process.env.BASE44_APP_ID || "69b612998f4243854e120a07";
const BASE44_API_KEY = process.env.BASE44_API_KEY || "022fc4c1910f4162bfe315271e5a7692";
const BASE44_SERVICE_TOKEN = process.env.BASE44_SERVICE_TOKEN || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "91269535";
const DISPATCH_URL = process.env.DISPATCH_URL || "https://jada-4e120a07.base44.app/functions/dispatchTask";
const AGENT_BASE_URL = "https://app.base44.com/api/agents";

// --- Base44 entity helpers ---

async function base44Fetch(path, method = "GET", body = null) {
  const url = `https://api.base44.com/api/apps/${BASE44_APP_ID}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "api-key": BASE44_API_KEY,
  };
  if (BASE44_SERVICE_TOKEN) headers["Authorization"] = `Bearer ${BASE44_SERVICE_TOKEN}`;
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base44 API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function listEntities(entityName, query = {}, limit = 50) {
  const params = new URLSearchParams({ limit });
  if (Object.keys(query).length > 0) params.set("filter", JSON.stringify(query));
  return base44Fetch(`/entities/${entityName}?${params}`);
}

async function createEntity(entityName, data) {
  return base44Fetch(`/entities/${entityName}`, "POST", data);
}

async function updateEntity(entityName, id, data) {
  return base44Fetch(`/entities/${entityName}/${id}`, "PUT", data);
}

// --- Agent messaging ---

async function dispatchTask(toAgent, task, context = "", priority = "normal", recordTask = true) {
  const res = await fetch(DISPATCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": BASE44_API_KEY,
    },
    body: JSON.stringify({ to_agent: toAgent, task, context, priority, record_task: recordTask }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dispatchTask error ${res.status}: ${text}`);
  }
  return res.json();
}

async function messageAgent(agentId, convId, message) {
  const url = `${AGENT_BASE_URL}/${agentId}/conversations/${convId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_key": BASE44_API_KEY,
    },
    body: JSON.stringify({ role: "user", content: message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function sendTelegram(text, chatId = TELEGRAM_CHAT_ID) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  return res.json();
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "list_agents",
    description: "List all registered agents in the GarzaOS fleet with their status, role, and metadata",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (active, idle, offline)", enum: ["active", "idle", "offline"] },
        department: { type: "string", description: "Filter by department (e.g. GARZA OS, Nomad Internet, Legal)" },
      },
    },
  },
  {
    name: "dispatch_task",
    description: "Send a task to a Base44 agent (echo, jaden, pm, nova). Creates an AgentTask record and messages the agent.",
    inputSchema: {
      type: "object",
      properties: {
        to_agent: { type: "string", description: "Agent to dispatch to: echo, jaden, pm, nova", enum: ["echo", "jaden", "pm", "nova"] },
        task: { type: "string", description: "The task description" },
        context: { type: "string", description: "Additional context for the task" },
        priority: { type: "string", description: "Priority level", enum: ["normal", "high", "urgent"], default: "normal" },
      },
      required: ["to_agent", "task"],
    },
  },
  {
    name: "message_agent",
    description: "Send a direct message to a specific agent by their agent_id and conversation_id",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "The Base44 agent ID" },
        conv_id: { type: "string", description: "The conversation ID" },
        message: { type: "string", description: "Message to send" },
      },
      required: ["agent_id", "conv_id", "message"],
    },
  },
  {
    name: "get_agent_activity",
    description: "Get recent activity records for agents (live heartbeat data from Echo's polling)",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Filter by agent name" },
        status: { type: "string", description: "Filter by status" },
        limit: { type: "number", description: "Max records to return (default 20)", default: 20 },
      },
    },
  },
  {
    name: "read_tasks",
    description: "Read AgentTask records from the database",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (pending, in_progress, done, failed, partial)" },
        to_agent: { type: "string", description: "Filter by recipient agent" },
        from_agent: { type: "string", description: "Filter by sender agent" },
        limit: { type: "number", description: "Max records to return (default 20)", default: 20 },
      },
    },
  },
  {
    name: "update_task",
    description: "Update an AgentTask record (e.g. mark as done, add result)",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The AgentTask record ID" },
        status: { type: "string", description: "New status", enum: ["pending", "in_progress", "done", "failed", "partial"] },
        result: { type: "string", description: "Result or notes to record" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "create_task",
    description: "Create a new AgentTask record",
    inputSchema: {
      type: "object",
      properties: {
        from_agent: { type: "string", description: "Agent sending the task" },
        to_agent: { type: "string", description: "Agent receiving the task" },
        task: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["normal", "high", "urgent"], default: "normal" },
        context: { type: "string", description: "Additional context" },
        task_type: { type: "string", description: "Type of task" },
      },
      required: ["from_agent", "to_agent", "task"],
    },
  },
  {
    name: "send_telegram",
    description: "Send a Telegram message to the user (@goldenstagg, chat_id 91269535)",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message text (supports HTML formatting)" },
        chat_id: { type: "string", description: "Override chat ID (default: 91269535)" },
      },
      required: ["text"],
    },
  },
  {
    name: "get_system_status",
    description: "Get a full system status snapshot: all agents, pending tasks, recent activity",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_disputes",
    description: "List customer disputes (Nova's data)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (open, in_progress, resolved, escalated)" },
        severity: { type: "string", description: "Filter by severity (low, medium, high, critical)" },
        limit: { type: "number", default: 20 },
      },
    },
  },
];

// --- Tool handlers ---

async function handleTool(name, args) {
  switch (name) {
    case "list_agents": {
      const query = {};
      if (args.status) query.status = args.status;
      if (args.department) query.department = args.department;
      const agents = await listEntities("AgentRegistry", query, 100);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(agents, null, 2),
        }],
      };
    }

    case "dispatch_task": {
      const result = await dispatchTask(
        args.to_agent,
        args.task,
        args.context || "",
        args.priority || "normal",
        true
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    }

    case "message_agent": {
      const result = await messageAgent(args.agent_id, args.conv_id, args.message);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    }

    case "get_agent_activity": {
      const query = {};
      if (args.agent_name) query.agent_name = args.agent_name;
      if (args.status) query.status = args.status;
      const activity = await listEntities("AgentActivity", query, args.limit || 20);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(activity, null, 2),
        }],
      };
    }

    case "read_tasks": {
      const query = {};
      if (args.status) query.status = args.status;
      if (args.to_agent) query.to_agent = args.to_agent;
      if (args.from_agent) query.from_agent = args.from_agent;
      const tasks = await listEntities("AgentTask", query, args.limit || 20);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(tasks, null, 2),
        }],
      };
    }

    case "update_task": {
      const update = {};
      if (args.status) update.status = args.status;
      if (args.result) update.result = args.result;
      const result = await updateEntity("AgentTask", args.task_id, update);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    }

    case "create_task": {
      const task = await createEntity("AgentTask", {
        from_agent: args.from_agent,
        to_agent: args.to_agent,
        task: args.task,
        priority: args.priority || "normal",
        context: args.context || "",
        task_type: args.task_type || "",
        status: "pending",
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(task, null, 2),
        }],
      };
    }

    case "send_telegram": {
      const result = await sendTelegram(args.text, args.chat_id || TELEGRAM_CHAT_ID);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    }

    case "get_system_status": {
      const [agents, pendingTasks, activity] = await Promise.all([
        listEntities("AgentRegistry", {}, 50),
        listEntities("AgentTask", { status: "pending" }, 20),
        listEntities("AgentActivity", {}, 10),
      ]);
      
      const status = {
        timestamp: new Date().toISOString(),
        agents: {
          total: agents.length,
          list: agents.map(a => ({
            name: a.agent_name,
            status: a.status,
            role: a.role,
            last_seen: a.last_seen,
          })),
        },
        pending_tasks: {
          count: pendingTasks.length,
          tasks: pendingTasks.map(t => ({
            id: t.id,
            from: t.from_agent,
            to: t.to_agent,
            task: t.task?.substring(0, 100),
            priority: t.priority,
            created: t.created_date,
          })),
        },
        recent_activity: activity.map(a => ({
          agent: a.agent_name,
          status: a.status,
          last_action: a.last_action,
          last_seen: a.last_seen,
        })),
      };
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(status, null, 2),
        }],
      };
    }

    case "list_disputes": {
      const query = {};
      if (args.status) query.status = args.status;
      if (args.severity) query.severity = args.severity;
      const disputes = await listEntities("CustomerDispute", query, args.limit || 20);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(disputes, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP Server factory (create fresh per request for stateless HTTP) ---

function createMcpServer() {
  const server = new Server(
    { name: "garza-agent-control", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await handleTool(name, args || {});
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- HTTP server (for Railway deployment) ---

const PORT = process.env.PORT || 3000;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "garza-agent-mcp-2026";

const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "garza-agent-control-mcp", version: "1.0.0" }));
    return;
  }

  // Root info
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      service: "GarzaOS Agent Control MCP",
      version: "1.0.0",
      endpoints: { mcp: "/mcp", health: "/health" },
      tools: TOOLS.map(t => t.name),
    }));
    return;
  }

  // MCP endpoint — create a fresh Server instance per request (stateless StreamableHTTP)
  if (req.url === "/mcp" || req.url?.startsWith("/mcp")) {
    // Auth check
    const authHeader = req.headers["authorization"] || req.headers["x-auth-token"] || "";
    const token = authHeader.replace("Bearer ", "");
    if (MCP_AUTH_TOKEN && token !== MCP_AUTH_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    
    await server.connect(transport);
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`GarzaOS Agent Control MCP running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

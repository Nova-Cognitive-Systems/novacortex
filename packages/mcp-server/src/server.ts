/**
 * Memory Stack MCP Server
 *
 * Provides 10 tools for memory operations via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryService, type MemoryServiceConfig } from '@memory-stack/core';
import { ToolHandler } from './tools.js';

export interface MCPServerConfig {
  memoryService: MemoryServiceConfig;
}

export async function createMCPServer(config: MCPServerConfig): Promise<Server> {
  // Initialize memory service
  const memoryService = new MemoryService(config.memoryService);
  await memoryService.connect();

  // Initialize tool handler
  const toolHandler = new ToolHandler(memoryService);

  // Create MCP server
  const server = new Server(
    {
      name: 'memory-stack',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = toolHandler.getToolDefinitions();
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await toolHandler.handleTool(name, args);
    return {
      ...result,
      _meta: {},
    };
  });

  // Handle cleanup on close
  server.onclose = async () => {
    await memoryService.disconnect();
  };

  return server;
}

export async function runServer(config: MCPServerConfig): Promise<void> {
  const server = await createMCPServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

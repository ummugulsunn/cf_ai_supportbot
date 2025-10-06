// Tool Registry - Central registration and management of all tools

import { ToolRouter, ToolContext, ToolResult } from './tools.js';
import { KnowledgeBaseTool } from './knowledge_base_tool.js';
import { TicketingTool } from './ticketing_tool.js';

export class ToolRegistry {
  private router: ToolRouter;

  constructor() {
    // Initialize router with custom retry configuration
    this.router = new ToolRouter({
      maxAttempts: 3,
      backoffStrategy: 'exponential',
      baseDelay: 1000,
      maxDelay: 10000,
      retryableErrors: [
        'NETWORK_ERROR',
        'TIMEOUT',
        'SERVICE_UNAVAILABLE',
        'INTERNAL_SERVER_ERROR'
      ]
    });

    // Register all available tools
    this.registerTools();
  }

  private registerTools(): void {
    // Register Knowledge Base Tool
    const knowledgeBaseTool = new KnowledgeBaseTool();
    this.router.registerTool(knowledgeBaseTool);

    // Register Ticketing Tool
    const ticketingTool = new TicketingTool();
    this.router.registerTool(ticketingTool);
  }

  async executeTool(
    toolName: string,
    params: any,
    context: ToolContext
  ): Promise<ToolResult> {
    return this.router.executeTool(toolName, params, context);
  }

  getAvailableTools(): Array<{name: string, description: string, parameters: any}> {
    return this.router.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  getToolSchema(): any {
    // Return OpenAI-compatible tool schema for AI model
    return this.router.listTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  // Helper method to create tool context from worker bindings
  static createToolContext(
    sessionId: string,
    bindings: any,
    userId?: string,
    conversationContext?: any
  ): ToolContext {
    return {
      sessionId,
      userId,
      conversationContext,
      bindings
    };
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();
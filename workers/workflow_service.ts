// Workflow service for integrating workflows with the support bot system
import { 
  WorkflowEngine, 
  WorkflowDefinition, 
  WorkflowContext, 
  WorkflowResult,
  StepHandler 
} from './workflow';
import { 
  createComplexQueryWorkflow,
  createToolChainWorkflow,
  createEscalationWorkflow,
  getWorkflowDefinition,
  SupportWorkflowInput,
  ToolChainInput,
  EscalationInput
} from './workflow_definitions';
import { ConversationContext, ToolCall, ToolResult, WorkerBindings } from './types';

export interface SupportWorkflow {
  processComplexQuery(query: string, context: ConversationContext): Promise<WorkflowResult>;
  executeToolChain(tools: ToolCall[]): Promise<WorkflowResult>;
  handleEscalation(ticketData: any): Promise<WorkflowResult>;
}

export class WorkflowService implements SupportWorkflow {
  private engine: WorkflowEngine;
  private bindings: WorkerBindings;

  constructor(bindings: WorkerBindings) {
    this.engine = new WorkflowEngine();
    this.bindings = bindings;
    this.registerCustomHandlers();
  }

  // Process complex queries that require multiple steps
  async processComplexQuery(
    query: string, 
    context: ConversationContext
  ): Promise<WorkflowResult> {
    const input: SupportWorkflowInput = {
      query,
      context,
      priority: this.determinePriority(query),
      tools: this.suggestTools(query)
    };

    const workflowDef = createComplexQueryWorkflow(input);
    const workflowContext = this.createWorkflowContext(context);

    // Generate idempotency key based on session and query
    const idempotencyKey = `complex_query_${context.sessionId}_${this.hashString(query)}`;

    return await this.engine.executeWorkflow(workflowDef, workflowContext, idempotencyKey);
  }

  // Execute a chain of tools
  async executeToolChain(toolCalls: ToolCall[]): Promise<WorkflowResult> {
    const input: ToolChainInput = {
      toolCalls,
      context: {} as ConversationContext, // Will be set from workflow context
      parallelExecution: false // Sequential by default
    };

    const workflowDef = createToolChainWorkflow(input);
    const workflowContext = this.createWorkflowContext({} as ConversationContext);

    // Generate idempotency key based on tool calls (without timestamp for true idempotency)
    const toolNames = toolCalls.map(t => `${t.name}:${JSON.stringify(t.parameters)}`).join('_');
    const idempotencyKey = `tool_chain_${this.hashString(toolNames)}`;

    return await this.engine.executeWorkflow(workflowDef, workflowContext, idempotencyKey);
  }

  // Handle escalation to human agents
  async handleEscalation(ticketData: {
    issue: string;
    context: ConversationContext;
    title: string;
    description: string;
    priority: string;
    category: string;
  }): Promise<WorkflowResult> {
    const input: EscalationInput = {
      issue: ticketData.issue,
      context: ticketData.context,
      ticketData: {
        title: ticketData.title,
        description: ticketData.description,
        priority: ticketData.priority,
        category: ticketData.category
      }
    };

    const workflowDef = createEscalationWorkflow(input);
    const workflowContext = this.createWorkflowContext(ticketData.context);

    // Generate idempotency key for escalation
    const idempotencyKey = `escalation_${ticketData.context.sessionId}_${this.hashString(ticketData.issue)}`;

    return await this.engine.executeWorkflow(workflowDef, workflowContext, idempotencyKey);
  }

  // Execute a predefined workflow by ID
  async executeWorkflowById(
    workflowId: string,
    context: ConversationContext,
    input?: any
  ): Promise<WorkflowResult> {
    const workflowDef = getWorkflowDefinition(workflowId);
    if (!workflowDef) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const workflowContext = this.createWorkflowContext(context, input);
    const idempotencyKey = `${workflowId}_${context.sessionId}_${Date.now()}`;

    return await this.engine.executeWorkflow(workflowDef, workflowContext, idempotencyKey);
  }

  // Register custom step handlers that integrate with the support bot system
  private registerCustomHandlers(): void {
    // AI integration handler
    this.engine.registerStepHandler({
      name: 'ai_query',
      async execute(input: { query: string; model?: string }, context: WorkflowContext): Promise<any> {
        try {
          // Use the existing AI integration
          const response = await context.bindings.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8', {
            messages: [
              {
                role: 'system',
                content: 'You are a helpful AI assistant processing a workflow step.'
              },
              {
                role: 'user',
                content: input.query
              }
            ],
            max_tokens: 1000
          });

          return {
            response: response.response,
            model: input.model || 'llama-3.3-70b',
            timestamp: Date.now(),
            tokens_used: response.usage?.total_tokens || 0
          };
        } catch (error) {
          throw new Error(`AI query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      validate(input: any): boolean {
        return input && typeof input.query === 'string' && input.query.length > 0;
      }
    });

    // Tool execution handler that integrates with existing tools
    this.engine.registerStepHandler({
      name: 'execute_tool',
      async execute(input: { toolCall: ToolCall }, context: WorkflowContext): Promise<ToolResult> {
        try {
          // This would integrate with the existing tool registry
          // For now, simulate tool execution based on tool name
          const { toolCall } = input;
          
          switch (toolCall.name) {
            case 'kb.search':
              return await this.executeKnowledgeBaseSearch(toolCall, context);
            case 'create_ticket':
              return await this.executeTicketCreation(toolCall, context);
            case 'fetch_status':
              return await this.executeStatusFetch(toolCall, context);
            default:
              throw new Error(`Unknown tool: ${toolCall.name}`);
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            metadata: { executedAt: Date.now() }
          };
        }
      },
      validate(input: any): boolean {
        return input && input.toolCall && typeof input.toolCall.name === 'string';
      }
    });

    // Memory/storage handler
    this.engine.registerStepHandler({
      name: 'persist_data',
      async execute(input: { key: string; data: any }, context: WorkflowContext): Promise<any> {
        try {
          if (input.data === null) {
            // Delete operation
            await context.bindings.CHAT_KV.delete(input.key);
            return { deleted: true, key: input.key };
          } else {
            // Store operation
            const value = JSON.stringify({
              data: input.data,
              sessionId: context.sessionId,
              timestamp: Date.now()
            });
            
            await context.bindings.CHAT_KV.put(input.key, value, { expirationTtl: 86400 }); // 24 hours
            return { stored: true, key: input.key, timestamp: Date.now() };
          }
        } catch (error) {
          throw new Error(`Data persistence failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      async compensate(input: { key: string }, context: WorkflowContext): Promise<void> {
        try {
          await context.bindings.CHAT_KV.delete(input.key);
        } catch (error) {
          console.error(`Failed to compensate data persistence for key ${input.key}:`, error);
        }
      },
      validate(input: any): boolean {
        return input && typeof input.key === 'string';
      }
    });
  }

  // Helper methods for tool execution
  private async executeKnowledgeBaseSearch(toolCall: ToolCall, context: WorkflowContext): Promise<ToolResult> {
    // Simulate knowledge base search
    const query = toolCall.parameters.query || 'default search';
    
    return {
      success: true,
      data: {
        results: [
          {
            title: `Knowledge Base Result for: ${query}`,
            content: `This is a simulated knowledge base result for the query: ${query}`,
            relevance: 0.85,
            source: 'kb_article_123'
          }
        ],
        total: 1,
        query
      },
      metadata: {
        executedAt: Date.now(),
        source: 'knowledge_base'
      }
    };
  }

  private async executeTicketCreation(toolCall: ToolCall, context: WorkflowContext): Promise<ToolResult> {
    // Simulate ticket creation
    const ticketData = toolCall.parameters;
    const ticketId = `TICKET-${Date.now()}`;
    
    return {
      success: true,
      data: {
        ticketId,
        status: 'created',
        title: ticketData.title || 'Support Request',
        priority: ticketData.priority || 'medium',
        assignee: null,
        createdAt: Date.now()
      },
      metadata: {
        executedAt: Date.now(),
        source: 'ticketing_system'
      }
    };
  }

  private async executeStatusFetch(toolCall: ToolCall, context: WorkflowContext): Promise<ToolResult> {
    // Simulate status fetch
    const ticketId = toolCall.parameters.ticketId;
    
    return {
      success: true,
      data: {
        ticketId,
        status: 'in_progress',
        assignee: 'agent_123',
        lastUpdate: Date.now() - 3600000, // 1 hour ago
        estimatedResolution: Date.now() + 7200000 // 2 hours from now
      },
      metadata: {
        executedAt: Date.now(),
        source: 'ticketing_system'
      }
    };
  }

  // Helper methods
  private createWorkflowContext(context: ConversationContext, variables?: any): WorkflowContext {
    return {
      sessionId: context.sessionId,
      userId: context.userProfile?.id,
      conversationContext: context,
      bindings: this.bindings,
      variables: variables || {}
    };
  }

  private determinePriority(query: string): 'low' | 'medium' | 'high' | 'urgent' {
    const urgentKeywords = ['urgent', 'critical', 'emergency', 'down', 'broken'];
    const highKeywords = ['important', 'asap', 'quickly', 'soon'];
    
    const lowerQuery = query.toLowerCase();
    
    if (urgentKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return 'urgent';
    }
    if (highKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return 'high';
    }
    
    return 'medium';
  }

  private suggestTools(query: string): string[] {
    const tools: string[] = [];
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('search') || lowerQuery.includes('find') || lowerQuery.includes('documentation')) {
      tools.push('kb.search');
    }
    
    if (lowerQuery.includes('ticket') || lowerQuery.includes('issue') || lowerQuery.includes('problem')) {
      tools.push('create_ticket');
    }
    
    if (lowerQuery.includes('status') || lowerQuery.includes('update')) {
      tools.push('fetch_status');
    }
    
    return tools;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
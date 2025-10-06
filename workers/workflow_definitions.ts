// Predefined workflow definitions for common support operations
import { 
  WorkflowDefinition, 
  WorkflowStep, 
  DEFAULT_RETRY_CONFIG
} from './workflow';

// Export input types for use in other modules
export interface SupportWorkflowInput {
  query: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  context?: any;
  tools?: string[];
}

export interface ToolChainInput {
  tools: string[];
  query: string;
  context?: any;
  toolCalls?: any[];
}

export interface EscalationInput {
  issue: string;
  priority: 'high' | 'urgent';
  ticketData: any;
  context?: any;
}

// Complex query processing workflow
export const COMPLEX_QUERY_WORKFLOW: WorkflowDefinition = {
  id: 'complex_query_processing',
  name: 'Complex Query Processing',
  description: 'Handles complex user queries that require multiple tools and AI reasoning',
  timeout: 120000, // 2 minutes
  retryConfig: DEFAULT_RETRY_CONFIG,
  steps: [
    {
      id: 'analyze_query',
      name: 'ai_query',
      input: {
        query: 'Analyze the user query and determine required tools and approach',
        model: 'llama-3.3-70b'
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'search_knowledge_base',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'kb_search',
          name: 'kb.search',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    },
    {
      id: 'generate_response',
      name: 'ai_query',
      input: {
        query: 'Generate comprehensive response based on search results',
        model: 'llama-3.3-70b'
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'persist_interaction',
      name: 'persist_data',
      input: {
        key: 'interaction_log',
        data: {}
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    }
  ],
  compensationSteps: [
    {
      id: 'cleanup_temp_data',
      name: 'persist_data',
      input: {
        key: 'temp_cleanup',
        data: null
      },
      retryCount: 0,
      maxRetries: 1,
      status: 'pending'
    }
  ]
};

// Multi-tool execution workflow
export const TOOL_CHAIN_WORKFLOW: WorkflowDefinition = {
  id: 'tool_chain_execution',
  name: 'Tool Chain Execution',
  description: 'Executes multiple tools in sequence or parallel',
  timeout: 180000, // 3 minutes
  retryConfig: {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: 2, // Fewer retries for tool chains
  },
  steps: [
    {
      id: 'validate_tools',
      name: 'ai_query',
      input: {
        query: 'Validate tool chain and execution order',
      },
      retryCount: 0,
      maxRetries: 1,
      status: 'pending'
    },
    {
      id: 'execute_primary_tool',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'primary_tool',
          name: 'dynamic',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    },
    {
      id: 'execute_secondary_tools',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'secondary_tools',
          name: 'dynamic',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'aggregate_results',
      name: 'ai_query',
      input: {
        query: 'Aggregate and synthesize tool results',
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    }
  ]
};

// Escalation workflow for complex issues
export const ESCALATION_WORKFLOW: WorkflowDefinition = {
  id: 'issue_escalation',
  name: 'Issue Escalation',
  description: 'Handles escalation of complex issues to human agents',
  timeout: 300000, // 5 minutes
  retryConfig: {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: 5, // More retries for critical escalations
  },
  steps: [
    {
      id: 'assess_urgency',
      name: 'ai_query',
      input: {
        query: 'Assess issue urgency and determine escalation path',
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'create_ticket',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'ticket_creation',
          name: 'create_ticket',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    },
    {
      id: 'notify_agents',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'notification',
          name: 'send_notification',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'update_session',
      name: 'persist_data',
      input: {
        key: 'escalation_status',
        data: {}
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'generate_handoff_summary',
      name: 'ai_query',
      input: {
        query: 'Generate comprehensive handoff summary for human agent',
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    }
  ],
  compensationSteps: [
    {
      id: 'cancel_ticket',
      name: 'execute_tool',
      input: {
        toolCall: {
          id: 'ticket_cancellation',
          name: 'cancel_ticket',
          parameters: {}
        }
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'revert_session_state',
      name: 'persist_data',
      input: {
        key: 'session_revert',
        data: null
      },
      retryCount: 0,
      maxRetries: 1,
      status: 'pending'
    }
  ]
};

// Long-running data processing workflow
export const DATA_PROCESSING_WORKFLOW: WorkflowDefinition = {
  id: 'data_processing',
  name: 'Data Processing',
  description: 'Handles long-running data processing tasks',
  timeout: 600000, // 10 minutes
  retryConfig: {
    ...DEFAULT_RETRY_CONFIG,
    baseDelay: 2000,
    maxDelay: 60000,
  },
  steps: [
    {
      id: 'prepare_data',
      name: 'persist_data',
      input: {
        key: 'processing_prep',
        data: {}
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'process_batch_1',
      name: 'ai_query',
      input: {
        query: 'Process first batch of data',
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    },
    {
      id: 'process_batch_2',
      name: 'ai_query',
      input: {
        query: 'Process second batch of data',
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    },
    {
      id: 'aggregate_results',
      name: 'ai_query',
      input: {
        query: 'Aggregate processing results',
      },
      retryCount: 0,
      maxRetries: 2,
      status: 'pending'
    },
    {
      id: 'store_final_results',
      name: 'persist_data',
      input: {
        key: 'final_results',
        data: {}
      },
      retryCount: 0,
      maxRetries: 3,
      status: 'pending'
    }
  ],
  compensationSteps: [
    {
      id: 'cleanup_processing_data',
      name: 'persist_data',
      input: {
        key: 'cleanup_temp',
        data: null
      },
      retryCount: 0,
      maxRetries: 1,
      status: 'pending'
    }
  ]
};

// Workflow factory functions
export function createComplexQueryWorkflow(input: SupportWorkflowInput): WorkflowDefinition {
  const workflow = { ...COMPLEX_QUERY_WORKFLOW };
  
  // Customize steps based on input
  workflow.steps[0]!.input.query = `Analyze this user query: "${input.query}"`;
  workflow.steps[2]!.input.query = `Generate response for: "${input.query}" with priority: ${input.priority || 'medium'}`;
  
  if (input.tools && input.tools.length > 0) {
    // Add specific tool steps
    input.tools.forEach((toolName: any, index: any) => {
      workflow.steps.splice(1 + index, 0, {
        id: `tool_${toolName}`,
        name: 'execute_tool',
        input: {
          toolCall: {
            id: `tool_${index}`,
            name: toolName,
            parameters: {}
          }
        },
        retryCount: 0,
        maxRetries: 2,
        status: 'pending'
      });
    });
  }
  
  return workflow;
}

export function createToolChainWorkflow(input: ToolChainInput): WorkflowDefinition {
  const workflow = { ...TOOL_CHAIN_WORKFLOW };
  
  // Replace dynamic steps with actual tool calls
  workflow.steps = workflow.steps.filter(step => step.name !== 'execute_tool');
  
  // Handle both toolCalls and tools array
  if (input.toolCalls && input.toolCalls.length > 0) {
    input.toolCalls.forEach((toolCall: any, index: any) => {
      workflow.steps.splice(1 + index, 0, {
        id: `tool_${index}`,
        name: 'execute_tool',
        input: { toolCall },
        retryCount: 0,
        maxRetries: 2,
        status: 'pending'
      });
    });
  } else if (input.tools && input.tools.length > 0) {
    // Convert tools array to toolCalls
    input.tools.forEach((toolName: string, index: number) => {
      workflow.steps.splice(1 + index, 0, {
        id: `tool_${toolName}`,
        name: 'execute_tool',
        input: {
          toolCall: {
            id: `tool_${index}`,
            name: toolName,
            parameters: {}
          }
        },
        retryCount: 0,
        maxRetries: 2,
        status: 'pending'
      });
    });
  }
  
  return workflow;
}

export function createEscalationWorkflow(input: EscalationInput): WorkflowDefinition {
  const workflow = { ...ESCALATION_WORKFLOW };
  
  // Customize steps based on input
  workflow.steps[0]!.input.query = `Assess urgency for issue: "${input.issue}"`;
  workflow.steps[1]!.input.toolCall.parameters = input.ticketData;
  workflow.steps[4]!.input.query = `Generate handoff summary for: "${input.issue}"`;
  
  // Adjust timeout based on priority
  if (input.ticketData.priority === 'urgent') {
    workflow.timeout = 120000; // 2 minutes for urgent issues
  }
  
  return workflow;
}

// Workflow registry
export const WORKFLOW_REGISTRY = new Map<string, WorkflowDefinition>([
  [COMPLEX_QUERY_WORKFLOW.id, COMPLEX_QUERY_WORKFLOW],
  [TOOL_CHAIN_WORKFLOW.id, TOOL_CHAIN_WORKFLOW],
  [ESCALATION_WORKFLOW.id, ESCALATION_WORKFLOW],
  [DATA_PROCESSING_WORKFLOW.id, DATA_PROCESSING_WORKFLOW],
]);

export function getWorkflowDefinition(id: string): WorkflowDefinition | undefined {
  return WORKFLOW_REGISTRY.get(id);
}

export function listAvailableWorkflows(): WorkflowDefinition[] {
  return Array.from(WORKFLOW_REGISTRY.values());
}
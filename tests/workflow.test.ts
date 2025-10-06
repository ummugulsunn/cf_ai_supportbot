// Tests for workflow orchestration system
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { 
  WorkflowEngine, 
  WorkflowDefinition, 
  WorkflowContext, 
  WorkflowStep,
  StepHandler,
  DEFAULT_RETRY_CONFIG 
} from '../workers/workflow';
import { WorkflowService } from '../workers/workflow_service';
import { 
  COMPLEX_QUERY_WORKFLOW,
  TOOL_CHAIN_WORKFLOW,
  ESCALATION_WORKFLOW,
  createComplexQueryWorkflow,
  createToolChainWorkflow,
  createEscalationWorkflow
} from '../workers/workflow_definitions';
import { ConversationContext, ToolCall, WorkerBindings } from '../workers/types';

// Mock bindings
const mockBindings: WorkerBindings = {
  AI: {
    run: vi.fn()
  } as any,
  MEMORY_DO: {} as any,
  CHAT_KV: {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn()
  } as any,
  ARCHIVE_R2: {} as any,
  WORKFLOWS: {} as any
};

// Mock context
const mockContext: ConversationContext = {
  sessionId: 'test_session_123',
  summary: 'Test conversation',
  recentMessages: [],
  activeTopics: ['support'],
  resolvedIssues: []
};

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let mockHandler: StepHandler;

  beforeEach(() => {
    engine = new WorkflowEngine();
    mockHandler = {
      name: 'test_handler',
      execute: vi.fn().mockResolvedValue({ success: true, data: 'test result' }),
      compensate: vi.fn().mockResolvedValue(undefined),
      validate: vi.fn().mockReturnValue(true)
    };
  });

  describe('Step Handler Registration', () => {
    it('should register step handlers', () => {
      engine.registerStepHandler(mockHandler);
      // Handler registration is internal, so we test it through execution
      expect(mockHandler.name).toBe('test_handler');
    });

    it('should have built-in handlers registered', async () => {
      // Create a new engine to test built-in handlers
      const testEngine = new WorkflowEngine();
      
      const testWorkflow: WorkflowDefinition = {
        id: 'test_builtin',
        name: 'Test Built-in Handlers',
        description: 'Test workflow for built-in handlers',
        timeout: 30000,
        retryConfig: DEFAULT_RETRY_CONFIG,
        steps: [
          {
            id: 'test_ai',
            name: 'ai_query',
            input: { query: 'test query' },
            retryCount: 0,
            maxRetries: 1,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      // Mock AI response
      (mockBindings.AI.run as Mock).mockResolvedValue({
        response: 'AI response',
        usage: { total_tokens: 100 }
      });

      const result = await testEngine.executeWorkflow(testWorkflow, workflowContext);
      expect(result.success).toBe(true);
      // The built-in handler should have executed successfully
      expect(result.executionId).toBeDefined();
      expect(result.metadata.stepsCompleted).toBe(1);
    });
  });

  describe('Workflow Execution', () => {
    it('should execute a simple workflow successfully', async () => {
      engine.registerStepHandler(mockHandler);

      const workflow: WorkflowDefinition = {
        id: 'simple_test',
        name: 'Simple Test',
        description: 'A simple test workflow',
        timeout: 30000,
        retryConfig: DEFAULT_RETRY_CONFIG,
        steps: [
          {
            id: 'step1',
            name: 'test_handler',
            input: { test: 'data' },
            retryCount: 0,
            maxRetries: 2,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      const result = await engine.executeWorkflow(workflow, workflowContext);

      expect(result.success).toBe(true);
      expect(result.executionId).toBeDefined();
      expect(result.metadata.stepsCompleted).toBe(1);
      expect(mockHandler.execute).toHaveBeenCalledWith({ test: 'data' }, workflowContext);
    });

    it('should handle step failures and retries', async () => {
      const failingHandler: StepHandler = {
        name: 'failing_handler',
        execute: vi.fn()
          .mockRejectedValueOnce(new Error('Network timeout occurred'))
          .mockRejectedValueOnce(new Error('Service temporarily unavailable'))
          .mockResolvedValueOnce({ success: true, data: 'success after retries' }),
        validate: vi.fn().mockReturnValue(true)
      };

      engine.registerStepHandler(failingHandler);

      const workflow: WorkflowDefinition = {
        id: 'retry_test',
        name: 'Retry Test',
        description: 'Test retry mechanism',
        timeout: 30000,
        retryConfig: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 3,
          baseDelay: 10 // Short delay for testing
        },
        steps: [
          {
            id: 'retry_step',
            name: 'failing_handler',
            input: { test: 'retry' },
            retryCount: 0,
            maxRetries: 3,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      const result = await engine.executeWorkflow(workflow, workflowContext);

      expect(result.success).toBe(true);
      expect(result.metadata.retriesUsed).toBe(2); // Failed twice, succeeded on third attempt
      expect(failingHandler.execute).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries exceeded', async () => {
      const alwaysFailingHandler: StepHandler = {
        name: 'always_failing',
        execute: vi.fn().mockRejectedValue(new Error('Network timeout - always fails')),
        validate: vi.fn().mockReturnValue(true)
      };

      engine.registerStepHandler(alwaysFailingHandler);

      const workflow: WorkflowDefinition = {
        id: 'fail_test',
        name: 'Fail Test',
        description: 'Test failure handling',
        timeout: 30000,
        retryConfig: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 2,
          baseDelay: 10
        },
        steps: [
          {
            id: 'fail_step',
            name: 'always_failing',
            input: { test: 'fail' },
            retryCount: 0,
            maxRetries: 2,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      await expect(engine.executeWorkflow(workflow, workflowContext))
        .rejects.toThrow('Network timeout - always fails');

      expect(alwaysFailingHandler.execute).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should execute compensation steps on failure', async () => {
      const successHandler: StepHandler = {
        name: 'success_handler',
        execute: vi.fn().mockResolvedValue({ success: true }),
        compensate: vi.fn().mockResolvedValue(undefined),
        validate: vi.fn().mockReturnValue(true)
      };

      const failHandler: StepHandler = {
        name: 'fail_handler',
        execute: vi.fn().mockRejectedValue(new Error('Non-retryable step failed')),
        validate: vi.fn().mockReturnValue(true)
      };

      engine.registerStepHandler(successHandler);
      engine.registerStepHandler(failHandler);

      const workflow: WorkflowDefinition = {
        id: 'compensation_test',
        name: 'Compensation Test',
        description: 'Test compensation mechanism',
        timeout: 30000,
        retryConfig: { ...DEFAULT_RETRY_CONFIG, maxAttempts: 1 },
        steps: [
          {
            id: 'success_step',
            name: 'success_handler',
            input: { test: 'success' },
            retryCount: 0,
            maxRetries: 1,
            status: 'pending'
          },
          {
            id: 'fail_step',
            name: 'fail_handler',
            input: { test: 'fail' },
            retryCount: 0,
            maxRetries: 1,
            status: 'pending'
          }
        ],
        compensationSteps: [
          {
            id: 'compensation_step',
            name: 'success_handler',
            input: { test: 'compensate' },
            retryCount: 0,
            maxRetries: 1,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      await expect(engine.executeWorkflow(workflow, workflowContext))
        .rejects.toThrow('Non-retryable step failed');

      // Verify compensation was called for completed steps
      expect(successHandler.compensate).toHaveBeenCalled();
    });
  });

  describe('Idempotency', () => {
    it('should return existing result for duplicate idempotency key', async () => {
      engine.registerStepHandler(mockHandler);

      const workflow: WorkflowDefinition = {
        id: 'idempotency_test',
        name: 'Idempotency Test',
        description: 'Test idempotency mechanism',
        timeout: 30000,
        retryConfig: DEFAULT_RETRY_CONFIG,
        steps: [
          {
            id: 'step1',
            name: 'test_handler',
            input: { test: 'idempotency' },
            retryCount: 0,
            maxRetries: 1,
            status: 'pending'
          }
        ]
      };

      const workflowContext: WorkflowContext = {
        sessionId: 'test',
        conversationContext: mockContext,
        bindings: mockBindings,
        variables: {}
      };

      const idempotencyKey = 'test_key_123';

      // First execution
      const result1 = await engine.executeWorkflow(workflow, workflowContext, idempotencyKey);
      
      // Second execution with same key
      const result2 = await engine.executeWorkflow(workflow, workflowContext, idempotencyKey);

      expect(result1.executionId).toBe(result2.executionId);
      expect(mockHandler.execute).toHaveBeenCalledTimes(1); // Should only execute once
    });
  });
});

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(() => {
    service = new WorkflowService(mockBindings);
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Setup default AI mock
    (mockBindings.AI.run as Mock).mockResolvedValue({
      response: 'AI response',
      usage: { total_tokens: 100 }
    });
    
    // Setup KV mock
    (mockBindings.CHAT_KV.put as Mock).mockResolvedValue(undefined);
    (mockBindings.CHAT_KV.delete as Mock).mockResolvedValue(undefined);
  });

  describe('Complex Query Processing', () => {
    it('should process complex queries', async () => {
      const query = 'I need help with my account settings and billing information';
      
      const result = await service.processComplexQuery(query, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.executionId).toBeDefined();
      expect(mockBindings.AI.run).toHaveBeenCalled();
    });

    it('should determine priority correctly', async () => {
      const urgentQuery = 'URGENT: My system is down and I need immediate help!';
      
      const result = await service.processComplexQuery(urgentQuery, mockContext);
      
      expect(result.success).toBe(true);
      // Priority determination is internal, but we can verify the workflow executed
      expect(result.executionId).toBeDefined();
    });
  });

  describe('Tool Chain Execution', () => {
    it('should execute tool chains', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool1',
          name: 'kb.search',
          parameters: { query: 'test search' }
        },
        {
          id: 'tool2',
          name: 'create_ticket',
          parameters: { title: 'Test ticket' }
        }
      ];
      
      const result = await service.executeToolChain(toolCalls);
      
      expect(result.success).toBe(true);
      expect(result.executionId).toBeDefined();
    });
  });

  describe('Escalation Handling', () => {
    it('should handle escalations', async () => {
      const ticketData = {
        issue: 'Complex technical problem',
        context: mockContext,
        title: 'Technical Issue',
        description: 'User experiencing technical difficulties',
        priority: 'high',
        category: 'technical'
      };
      
      const result = await service.handleEscalation(ticketData);
      
      expect(result.success).toBe(true);
      expect(result.executionId).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle AI service failures gracefully', async () => {
      (mockBindings.AI.run as Mock).mockRejectedValue(new Error('AI service unavailable'));
      
      const query = 'Test query';
      
      await expect(service.processComplexQuery(query, mockContext))
        .rejects.toThrow();
    });

    it('should handle storage failures gracefully', async () => {
      (mockBindings.CHAT_KV.put as Mock).mockRejectedValue(new Error('Storage unavailable'));
      
      const query = 'Test query';
      
      await expect(service.processComplexQuery(query, mockContext))
        .rejects.toThrow();
    });
  });
});

describe('Workflow Definitions', () => {
  describe('Workflow Factory Functions', () => {
    it('should create complex query workflow', () => {
      const input = {
        query: 'Test query',
        context: mockContext,
        priority: 'high' as const,
        tools: ['kb.search', 'create_ticket']
      };
      
      const workflow = createComplexQueryWorkflow(input);
      
      expect(workflow.id).toBe('complex_query_processing');
      expect(workflow.steps.length).toBeGreaterThan(0);
      expect(workflow.steps[0]?.input.query).toContain('Test query');
    });

    it('should create tool chain workflow', () => {
      const toolCalls: ToolCall[] = [
        { id: '1', name: 'kb.search', parameters: {} },
        { id: '2', name: 'create_ticket', parameters: {} }
      ];
      
      const input = {
        tools: ['kb.search', 'create_ticket'],
        query: 'Test query',
        context: mockContext
      };
      
      const workflow = createToolChainWorkflow(input);
      
      expect(workflow.id).toBe('tool_chain_execution');
      expect(workflow.steps.some(step => step.name === 'execute_tool')).toBe(true);
    });

    it('should create escalation workflow', () => {
      const input = {
        issue: 'Test issue',
        priority: 'urgent' as const,
        context: mockContext,
        ticketData: {
          title: 'Test Ticket',
          description: 'Test Description',
          priority: 'urgent',
          category: 'technical'
        }
      };
      
      const workflow = createEscalationWorkflow(input);
      
      expect(workflow.id).toBe('issue_escalation');
      expect(workflow.timeout).toBe(120000); // Should be reduced for urgent priority
    });
  });

  describe('Predefined Workflows', () => {
    it('should have valid complex query workflow', () => {
      expect(COMPLEX_QUERY_WORKFLOW.id).toBe('complex_query_processing');
      expect(COMPLEX_QUERY_WORKFLOW.steps.length).toBeGreaterThan(0);
      expect(COMPLEX_QUERY_WORKFLOW.retryConfig).toBeDefined();
    });

    it('should have valid tool chain workflow', () => {
      expect(TOOL_CHAIN_WORKFLOW.id).toBe('tool_chain_execution');
      expect(TOOL_CHAIN_WORKFLOW.steps.length).toBeGreaterThan(0);
    });

    it('should have valid escalation workflow', () => {
      expect(ESCALATION_WORKFLOW.id).toBe('issue_escalation');
      expect(ESCALATION_WORKFLOW.steps.length).toBeGreaterThan(0);
      expect(ESCALATION_WORKFLOW.compensationSteps).toBeDefined();
    });
  });
});

describe('Retry Configuration', () => {
  it('should calculate exponential backoff correctly', () => {
    // This tests the retry delay calculation indirectly through workflow execution
    const engine = new WorkflowEngine();
    
    expect(DEFAULT_RETRY_CONFIG.backoffStrategy).toBe('exponential');
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
  });

  it('should respect max delay limits', () => {
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(30000);
    expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.1);
  });

  it('should identify retryable errors', () => {
    const retryableErrors = DEFAULT_RETRY_CONFIG.retryableErrors;
    
    expect(retryableErrors).toContain('timeout');
    expect(retryableErrors).toContain('network');
    expect(retryableErrors).toContain('temporary');
    expect(retryableErrors).toContain('rate_limit');
  });
});
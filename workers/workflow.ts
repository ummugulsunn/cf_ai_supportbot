// Workflow orchestration system for complex operations
import { ToolCall, ToolResult, ToolContext, ConversationContext } from './types';

// Core workflow interfaces
export interface WorkflowStep {
  id: string;
  name: string;
  input: any;
  output?: any;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'compensating';
  executedAt?: number;
  completedAt?: number;
  error?: string;
  compensationStep?: WorkflowStep;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  compensationSteps?: WorkflowStep[];
  timeout: number; // milliseconds
  retryConfig: RetryConfig;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  sessionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'compensated';
  currentStepIndex: number;
  startedAt: number;
  completedAt?: number;
  context: WorkflowContext;
  idempotencyKey: string;
  steps: WorkflowStep[];
  error?: string;
}

export interface WorkflowContext {
  sessionId: string;
  userId?: string;
  conversationContext: ConversationContext;
  bindings: any;
  variables: Record<string, any>;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  retryableErrors: string[];
  jitterFactor: number; // 0-1, adds randomness to delays
}

export interface WorkflowResult {
  success: boolean;
  executionId: string;
  result?: any;
  error?: string;
  compensated?: boolean;
  metadata: {
    duration: number;
    stepsCompleted: number;
    retriesUsed: number;
  };
}

// Workflow step handler interface
export interface StepHandler {
  name: string;
  execute(input: any, context: WorkflowContext): Promise<any>;
  compensate?(input: any, context: WorkflowContext): Promise<void>;
  validate?(input: any): boolean;
}

// Built-in workflow types for support operations
export interface SupportWorkflowInput {
  query: string;
  context: ConversationContext;
  tools?: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface ToolChainInput {
  toolCalls: ToolCall[];
  context: ConversationContext;
  parallelExecution?: boolean;
}

export interface EscalationInput {
  issue: string;
  context: ConversationContext;
  ticketData: {
    title: string;
    description: string;
    priority: string;
    category: string;
  };
  notificationChannels?: string[];
}

// Workflow execution engine
export class WorkflowEngine {
  private stepHandlers: Map<string, StepHandler> = new Map();
  private activeExecutions: Map<string, WorkflowExecution> = new Map();

  constructor() {
    this.registerBuiltInHandlers();
  }

  // Register a step handler
  registerStepHandler(handler: StepHandler): void {
    this.stepHandlers.set(handler.name, handler);
  }

  // Execute a workflow
  async executeWorkflow(
    definition: WorkflowDefinition,
    context: WorkflowContext,
    idempotencyKey?: string
  ): Promise<WorkflowResult> {
    const executionId = this.generateExecutionId();
    const key = idempotencyKey || executionId;

    // Check for existing execution with same idempotency key
    const existingExecution = this.findExecutionByIdempotencyKey(key);
    if (existingExecution) {
      // Wait for existing execution to complete if it's still running
      if (existingExecution.status === 'running' || existingExecution.status === 'pending') {
        return await this.waitForExecution(existingExecution);
      }
      return this.getExecutionResult(existingExecution);
    }

    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: definition.id,
      sessionId: context.sessionId,
      status: 'pending',
      currentStepIndex: 0,
      startedAt: Date.now(),
      context,
      idempotencyKey: key,
      steps: JSON.parse(JSON.stringify(definition.steps)), // Deep copy
    };

    this.activeExecutions.set(executionId, execution);

    try {
      execution.status = 'running';
      const result = await this.executeSteps(execution, definition);
      execution.status = 'completed';
      execution.completedAt = Date.now();
      return result;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = Date.now();

      // Attempt compensation if configured
      if (definition.compensationSteps && definition.compensationSteps.length > 0) {
        try {
          await this.executeCompensation(execution, definition);
          execution.status = 'compensated';
        } catch (compensationError) {
          console.error('Compensation failed:', compensationError);
        }
      }

      throw error;
    } finally {
      // Clean up after some time
      setTimeout(() => {
        this.activeExecutions.delete(executionId);
      }, 300000); // 5 minutes
    }
  }

  // Execute workflow steps sequentially
  private async executeSteps(
    execution: WorkflowExecution,
    definition: WorkflowDefinition
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    let totalRetries = 0;

    for (let i = 0; i < execution.steps.length; i++) {
      execution.currentStepIndex = i;
      const step = execution.steps[i];
      const handler = this.stepHandlers.get(step.name);

      if (!handler) {
        throw new Error(`No handler registered for step: ${step.name}`);
      }

      // Validate input if handler supports it
      if (handler.validate && !handler.validate(step.input)) {
        throw new Error(`Invalid input for step ${step.name}`);
      }

      step.status = 'running';
      step.executedAt = Date.now();

      try {
        // Execute step with retry logic
        const result = await this.executeStepWithRetry(
          handler,
          step,
          execution.context,
          definition.retryConfig
        );

        step.output = result;
        step.status = 'completed';
        step.completedAt = Date.now();
        totalRetries += step.retryCount;

        // Update context variables with step output
        if (result && typeof result === 'object') {
          execution.context.variables = {
            ...execution.context.variables,
            [`step_${step.id}_output`]: result,
          };
        }
      } catch (error) {
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : String(error);
        step.completedAt = Date.now();
        totalRetries += step.retryCount;
        throw error;
      }
    }

    return {
      success: true,
      executionId: execution.id,
      result: execution.steps[execution.steps.length - 1]?.output,
      metadata: {
        duration: Date.now() - startTime,
        stepsCompleted: execution.steps.length,
        retriesUsed: totalRetries,
      },
    };
  }

  // Execute a single step with retry logic
  private async executeStepWithRetry(
    handler: StepHandler,
    step: WorkflowStep,
    context: WorkflowContext,
    retryConfig: RetryConfig
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Calculate delay with backoff and jitter
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          await this.sleep(delay);
        }

        step.retryCount = attempt;
        return await handler.execute(step.input, context);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError, retryConfig);
        
        if (!isRetryable || attempt >= step.maxRetries) {
          step.retryCount = attempt;
          throw lastError;
        }

        console.warn(`Step ${step.name} failed (attempt ${attempt + 1}):`, lastError.message);
      }
    }

    throw lastError || new Error('Unknown error during step execution');
  }

  // Execute compensation steps in reverse order
  private async executeCompensation(
    execution: WorkflowExecution,
    definition: WorkflowDefinition
  ): Promise<void> {
    if (!definition.compensationSteps) return;

    console.log(`Starting compensation for execution ${execution.id}`);

    // Execute compensation steps in reverse order of completed steps
    const completedSteps = execution.steps.filter(step => step.status === 'completed');
    
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i];
      const handler = this.stepHandlers.get(step.name);

      if (handler?.compensate) {
        try {
          step.status = 'compensating';
          await handler.compensate(step.output, execution.context);
          console.log(`Compensated step: ${step.name}`);
        } catch (error) {
          console.error(`Failed to compensate step ${step.name}:`, error);
          // Continue with other compensation steps
        }
      }
    }
  }

  // Helper methods
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    let delay: number;

    switch (config.backoffStrategy) {
      case 'exponential':
        delay = config.baseDelay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = config.baseDelay * attempt;
        break;
      case 'fixed':
      default:
        delay = config.baseDelay;
        break;
    }

    // Apply jitter
    if (config.jitterFactor > 0) {
      const jitter = delay * config.jitterFactor * Math.random();
      delay += jitter;
    }

    return Math.min(delay, config.maxDelay);
  }

  private isRetryableError(error: Error, config: RetryConfig): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();
    
    return config.retryableErrors.some(pattern => 
      errorMessage.includes(pattern.toLowerCase()) || errorName.includes(pattern.toLowerCase())
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateExecutionId(): string {
    return `wf_exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private findExecutionByIdempotencyKey(key: string): WorkflowExecution | undefined {
    for (const execution of this.activeExecutions.values()) {
      if (execution.idempotencyKey === key) {
        return execution;
      }
    }
    return undefined;
  }

  private async waitForExecution(execution: WorkflowExecution): Promise<WorkflowResult> {
    // Poll for completion with timeout
    const maxWaitTime = 30000; // 30 seconds
    const pollInterval = 100; // 100ms
    const startTime = Date.now();

    while (execution.status === 'running' || execution.status === 'pending') {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Timeout waiting for existing workflow execution');
      }
      await this.sleep(pollInterval);
    }

    return this.getExecutionResult(execution);
  }

  private getExecutionResult(execution: WorkflowExecution): WorkflowResult {
    const completedSteps = execution.steps.filter(s => s.status === 'completed').length;
    const totalRetries = execution.steps.reduce((sum, s) => sum + s.retryCount, 0);

    return {
      success: execution.status === 'completed',
      executionId: execution.id,
      result: execution.steps[execution.steps.length - 1]?.output,
      error: execution.error,
      compensated: execution.status === 'compensated',
      metadata: {
        duration: (execution.completedAt || Date.now()) - execution.startedAt,
        stepsCompleted: completedSteps,
        retriesUsed: totalRetries,
      },
    };
  }

  // Register built-in step handlers
  private registerBuiltInHandlers(): void {
    // Tool execution handler
    this.registerStepHandler({
      name: 'execute_tool',
      async execute(input: { toolCall: ToolCall }, context: WorkflowContext): Promise<ToolResult> {
        // This would integrate with the existing tool system
        // For now, return a mock result
        return {
          success: true,
          data: { message: `Tool ${input.toolCall.name} executed successfully` },
          metadata: { executedAt: Date.now() },
        };
      },
      validate(input: any): boolean {
        return input && input.toolCall && typeof input.toolCall.name === 'string';
      },
    });

    // AI query handler
    this.registerStepHandler({
      name: 'ai_query',
      async execute(input: { query: string; model?: string }, context: WorkflowContext): Promise<any> {
        // This would integrate with the AI system
        return {
          response: `AI response to: ${input.query}`,
          model: input.model || 'llama-3.3-70b',
          timestamp: Date.now(),
        };
      },
      validate(input: any): boolean {
        return input && typeof input.query === 'string';
      },
    });

    // Data persistence handler
    this.registerStepHandler({
      name: 'persist_data',
      async execute(input: { key: string; data: any }, context: WorkflowContext): Promise<any> {
        // This would integrate with KV/R2 storage
        return {
          stored: true,
          key: input.key,
          timestamp: Date.now(),
        };
      },
      async compensate(input: { key: string }, context: WorkflowContext): Promise<void> {
        // Remove the stored data
        console.log(`Compensating: removing data for key ${input.key}`);
      },
      validate(input: any): boolean {
        return input && typeof input.key === 'string' && input.data !== undefined;
      },
    });
  }
}

// Default retry configuration
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffStrategy: 'exponential',
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  retryableErrors: ['timeout', 'network', 'temporary', 'rate_limit', 'unavailable', 'service'],
  jitterFactor: 0.1,
};
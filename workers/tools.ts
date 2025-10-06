// Tool integration system for AI Support Bot

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute(params: any, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  sessionId: string;
  userId?: string;
  conversationContext?: any;
  bindings: any; // Worker bindings for accessing external services
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

export class ToolRouter {
  private tools: Map<string, Tool> = new Map();
  private retryConfig: RetryConfig;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = {
      maxAttempts: 3,
      backoffStrategy: 'exponential',
      baseDelay: 1000,
      maxDelay: 10000,
      retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'SERVICE_UNAVAILABLE'],
      ...retryConfig
    };
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  async executeTool(
    toolName: string, 
    params: any, 
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found`,
        metadata: { availableTools: Array.from(this.tools.keys()) }
      };
    }

    return this.executeWithRetry(tool, params, context);
  }

  private async executeWithRetry(
    tool: Tool, 
    params: any, 
    context: ToolContext
  ): Promise<ToolResult> {
    let lastError: string = '';
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await tool.execute(params, context);
        
        // If successful or non-retryable error, return immediately
        if (result.success || !this.isRetryableError(result.error)) {
          return result;
        }
        
        lastError = result.error || 'Unknown error';
        
        // If this isn't the last attempt, wait before retrying
        if (attempt < this.retryConfig.maxAttempts) {
          await this.delay(this.calculateDelay(attempt));
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        
        // If this isn't the last attempt and error is retryable, wait before retrying
        if (attempt < this.retryConfig.maxAttempts && this.isRetryableError(lastError)) {
          await this.delay(this.calculateDelay(attempt));
        } else if (!this.isRetryableError(lastError)) {
          // Non-retryable error, fail immediately
          break;
        }
      }
    }

    return {
      success: false,
      error: `Tool execution failed after ${this.retryConfig.maxAttempts} attempts: ${lastError}`,
      metadata: { 
        attempts: this.retryConfig.maxAttempts,
        lastError 
      }
    };
  }

  private isRetryableError(error?: string): boolean {
    if (!error) return false;
    return this.retryConfig.retryableErrors.some(retryableError => 
      error.includes(retryableError)
    );
  }

  private calculateDelay(attempt: number): number {
    let delay: number;
    
    switch (this.retryConfig.backoffStrategy) {
      case 'exponential':
        delay = this.retryConfig.baseDelay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = this.retryConfig.baseDelay * attempt;
        break;
      case 'fixed':
      default:
        delay = this.retryConfig.baseDelay;
        break;
    }
    
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
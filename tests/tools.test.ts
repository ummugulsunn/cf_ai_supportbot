// Unit tests for tool integration system

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRouter, Tool, ToolContext, ToolResult } from '../workers/tools.js';

describe('ToolRouter', () => {
  let router: ToolRouter;
  let mockTool: Tool;
  let mockContext: ToolContext;

  beforeEach(() => {
    router = new ToolRouter({
      maxAttempts: 2,
      backoffStrategy: 'fixed',
      baseDelay: 100,
      maxDelay: 1000,
      retryableErrors: ['NETWORK_ERROR', 'TIMEOUT']
    });

    mockTool = {
      name: 'test-tool',
      description: 'A test tool',
      parameters: { type: 'object' },
      execute: vi.fn()
    };

    mockContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      bindings: {}
    };
  });

  describe('Tool Registration', () => {
    it('should register a tool successfully', () => {
      router.registerTool(mockTool);
      expect(router.getTool('test-tool')).toBe(mockTool);
    });

    it('should list all registered tools', () => {
      router.registerTool(mockTool);
      const tools = router.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(mockTool);
    });

    it('should return undefined for non-existent tool', () => {
      expect(router.getTool('non-existent')).toBeUndefined();
    });
  });

  describe('Tool Execution', () => {
    beforeEach(() => {
      router.registerTool(mockTool);
    });

    it('should execute tool successfully', async () => {
      const expectedResult: ToolResult = { success: true, data: 'test-data' };
      vi.mocked(mockTool.execute).mockResolvedValue(expectedResult);

      const result = await router.executeTool('test-tool', { param: 'value' }, mockContext);

      expect(result).toEqual(expectedResult);
      expect(mockTool.execute).toHaveBeenCalledWith({ param: 'value' }, mockContext);
    });

    it('should return error for non-existent tool', async () => {
      const result = await router.executeTool('non-existent', {}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool \'non-existent\' not found');
      expect(result.metadata?.availableTools).toEqual(['test-tool']);
    });

    it('should retry on retryable errors', async () => {
      const failureResult: ToolResult = { success: false, error: 'NETWORK_ERROR: Connection failed' };
      const successResult: ToolResult = { success: true, data: 'success' };

      vi.mocked(mockTool.execute)
        .mockResolvedValueOnce(failureResult)
        .mockResolvedValueOnce(successResult);

      const result = await router.executeTool('test-tool', {}, mockContext);

      expect(result).toEqual(successResult);
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const failureResult: ToolResult = { success: false, error: 'VALIDATION_ERROR: Invalid input' };
      vi.mocked(mockTool.execute).mockResolvedValue(failureResult);

      const result = await router.executeTool('test-tool', {}, mockContext);

      expect(result).toEqual(failureResult);
      expect(mockTool.execute).toHaveBeenCalledTimes(1);
    });

    it('should fail after max attempts', async () => {
      const failureResult: ToolResult = { success: false, error: 'NETWORK_ERROR: Connection failed' };
      vi.mocked(mockTool.execute).mockResolvedValue(failureResult);

      const result = await router.executeTool('test-tool', {}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution failed after 2 attempts');
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('Retry Logic', () => {
    it('should calculate exponential backoff delay correctly', () => {
      const exponentialRouter = new ToolRouter({
        backoffStrategy: 'exponential',
        baseDelay: 100,
        maxDelay: 1000
      });

      // Access private method through type assertion for testing
      const calculateDelay = (exponentialRouter as any).calculateDelay.bind(exponentialRouter);
      
      expect(calculateDelay(1)).toBe(100);  // 100 * 2^0
      expect(calculateDelay(2)).toBe(200);  // 100 * 2^1
      expect(calculateDelay(3)).toBe(400);  // 100 * 2^2
      expect(calculateDelay(10)).toBe(1000); // Capped at maxDelay
    });

    it('should calculate linear backoff delay correctly', () => {
      const linearRouter = new ToolRouter({
        backoffStrategy: 'linear',
        baseDelay: 100,
        maxDelay: 1000
      });

      const calculateDelay = (linearRouter as any).calculateDelay.bind(linearRouter);
      
      expect(calculateDelay(1)).toBe(100);  // 100 * 1
      expect(calculateDelay(2)).toBe(200);  // 100 * 2
      expect(calculateDelay(3)).toBe(300);  // 100 * 3
      expect(calculateDelay(15)).toBe(1000); // Capped at maxDelay
    });

    it('should use fixed delay for fixed strategy', () => {
      const fixedRouter = new ToolRouter({
        backoffStrategy: 'fixed',
        baseDelay: 100
      });

      const calculateDelay = (fixedRouter as any).calculateDelay.bind(fixedRouter);
      
      expect(calculateDelay(1)).toBe(100);
      expect(calculateDelay(5)).toBe(100);
      expect(calculateDelay(10)).toBe(100);
    });
  });
});
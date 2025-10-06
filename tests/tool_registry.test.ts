// Unit tests for Tool Registry

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../workers/tool_registry.js';
import { ToolContext } from '../workers/tools.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let mockContext: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    mockContext = {
      sessionId: 'test-session-123',
      userId: 'test-user',
      conversationContext: {},
      bindings: {
        AI: {},
        MEMORY_DO: {},
        CHAT_KV: {},
        ARCHIVE_R2: {}
      }
    };
  });

  describe('Tool Registration', () => {
    it('should have knowledge base tool registered', () => {
      const tools = registry.getAvailableTools();
      const kbTool = tools.find(tool => tool.name === 'kb.search');
      
      expect(kbTool).toBeDefined();
      expect(kbTool?.description).toContain('knowledge base');
    });

    it('should have ticketing tool registered', () => {
      const tools = registry.getAvailableTools();
      const ticketingTool = tools.find(tool => tool.name === 'ticketing');
      
      expect(ticketingTool).toBeDefined();
      expect(ticketingTool?.description).toContain('support tickets');
    });

    it('should return all available tools', () => {
      const tools = registry.getAvailableTools();
      
      expect(tools.length).toBeGreaterThanOrEqual(2);
      expect(tools.every(tool => 
        tool.hasOwnProperty('name') && 
        tool.hasOwnProperty('description') && 
        tool.hasOwnProperty('parameters')
      )).toBe(true);
    });
  });

  describe('Tool Schema Generation', () => {
    it('should generate OpenAI-compatible tool schema', () => {
      const schema = registry.getToolSchema();
      
      expect(Array.isArray(schema)).toBe(true);
      expect(schema.length).toBeGreaterThanOrEqual(2);
      
      schema.forEach((tool: any) => {
        expect(tool).toHaveProperty('type', 'function');
        expect(tool).toHaveProperty('function');
        expect(tool.function).toHaveProperty('name');
        expect(tool.function).toHaveProperty('description');
        expect(tool.function).toHaveProperty('parameters');
      });
    });

    it('should include knowledge base tool in schema', () => {
      const schema = registry.getToolSchema();
      const kbTool = schema.find((tool: any) => tool.function.name === 'kb.search');
      
      expect(kbTool).toBeDefined();
      expect(kbTool.function.parameters).toHaveProperty('properties');
      expect(kbTool.function.parameters.properties).toHaveProperty('query');
    });

    it('should include ticketing tool in schema', () => {
      const schema = registry.getToolSchema();
      const ticketingTool = schema.find((tool: any) => tool.function.name === 'ticketing');
      
      expect(ticketingTool).toBeDefined();
      expect(ticketingTool.function.parameters).toHaveProperty('properties');
      expect(ticketingTool.function.parameters.properties).toHaveProperty('action');
    });
  });

  describe('Tool Execution', () => {
    it('should execute knowledge base search successfully', async () => {
      const result = await registry.executeTool(
        'kb.search',
        { query: 'cloudflare workers' },
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('query', 'cloudflare workers');
      expect(result.data).toHaveProperty('results');
    });

    it('should execute ticket creation successfully', async () => {
      const result = await registry.executeTool(
        'ticketing',
        {
          action: 'create',
          ticketData: {
            title: 'Test Issue',
            description: 'Test description',
            priority: 'medium',
            category: 'technical'
          }
        },
        mockContext
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('ticketId');
      expect(result.data).toHaveProperty('status');
    });

    it('should return error for non-existent tool', async () => {
      const result = await registry.executeTool(
        'non-existent-tool',
        {},
        mockContext
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool \'non-existent-tool\' not found');
      expect(result.metadata?.availableTools).toContain('kb.search');
      expect(result.metadata?.availableTools).toContain('ticketing');
    });

    it('should handle tool execution errors gracefully', async () => {
      const result = await registry.executeTool(
        'kb.search',
        { query: '' }, // Invalid query
        mockContext
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid query parameter');
    });
  });

  describe('Tool Context Creation', () => {
    it('should create tool context with all required fields', () => {
      const bindings = { AI: {}, KV: {} };
      const context = ToolRegistry.createToolContext(
        'session-123',
        bindings,
        'user-456',
        { some: 'context' }
      );
      
      expect(context).toEqual({
        sessionId: 'session-123',
        userId: 'user-456',
        conversationContext: { some: 'context' },
        bindings
      });
    });

    it('should create tool context with minimal required fields', () => {
      const bindings = { AI: {} };
      const context = ToolRegistry.createToolContext('session-123', bindings);
      
      expect(context).toEqual({
        sessionId: 'session-123',
        userId: undefined,
        conversationContext: undefined,
        bindings
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete knowledge base search workflow', async () => {
      // Search for articles
      const searchResult = await registry.executeTool(
        'kb.search',
        { 
          query: 'workers',
          maxResults: 3,
          filters: { category: 'documentation' }
        },
        mockContext
      );
      
      expect(searchResult.success).toBe(true);
      expect(searchResult.data.results.length).toBeLessThanOrEqual(3);
      
      if (searchResult.data.results.length > 0) {
        searchResult.data.results.forEach((article: any) => {
          expect(article).toHaveProperty('id');
          expect(article).toHaveProperty('title');
          expect(article).toHaveProperty('relevanceScore');
        });
      }
    });

    it('should handle complete ticketing workflow', async () => {
      // Create ticket
      const createResult = await registry.executeTool(
        'ticketing',
        {
          action: 'create',
          ticketData: {
            title: 'Integration Test Issue',
            description: 'This is a test issue for integration testing',
            priority: 'high',
            category: 'technical',
            userEmail: 'test@example.com'
          }
        },
        mockContext
      );
      
      expect(createResult.success).toBe(true);
      const ticketId = createResult.data.ticketId;
      
      // Check status
      const statusResult = await registry.executeTool(
        'ticketing',
        {
          action: 'status',
          ticketId
        },
        mockContext
      );
      
      expect(statusResult.success).toBe(true);
      expect(statusResult.data.status.id).toBe(ticketId);
      expect(statusResult.data.status.status).toBe('open');
      
      // Update ticket
      const updateResult = await registry.executeTool(
        'ticketing',
        {
          action: 'update',
          ticketId,
          updateData: {
            status: 'resolved',
            resolution: 'Issue resolved during integration test'
          }
        },
        mockContext
      );
      
      expect(updateResult.success).toBe(true);
      expect(updateResult.data.status.status).toBe('resolved');
      expect(updateResult.data.status.resolution).toBe('Issue resolved during integration test');
    });
  });
});
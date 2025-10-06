// Unit tests for Knowledge Base Tool

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeBaseTool } from '../workers/knowledge_base_tool.js';
import { ToolContext } from '../workers/tools.js';

describe('KnowledgeBaseTool', () => {
  let tool: KnowledgeBaseTool;
  let mockContext: ToolContext;

  beforeEach(() => {
    tool = new KnowledgeBaseTool();
    mockContext = {
      sessionId: 'test-session-123',
      userId: 'test-user',
      bindings: {}
    };
  });

  describe('Tool Properties', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('kb.search');
      expect(tool.description).toBe('Search the knowledge base for relevant articles and documentation');
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters).toHaveProperty('type', 'object');
      expect(tool.parameters.properties).toHaveProperty('query');
      expect(tool.parameters.required).toContain('query');
    });
  });

  describe('Parameter Validation', () => {
    it('should reject empty query', async () => {
      const result = await tool.execute({ query: '' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid query parameter');
    });

    it('should reject non-string query', async () => {
      const result = await tool.execute({ query: 123 as any }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid query parameter');
    });

    it('should reject invalid maxResults', async () => {
      const result = await tool.execute({ 
        query: 'test', 
        maxResults: 25 
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid maxResults parameter');
    });

    it('should accept valid parameters', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare workers',
        maxResults: 5
      }, mockContext);
      
      expect(result.success).toBe(true);
    });
  });

  describe('Search Functionality', () => {
    it('should return search results for valid query', async () => {
      const result = await tool.execute({ 
        query: 'workers' 
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('query', 'workers');
      expect(result.data).toHaveProperty('results');
      expect(Array.isArray(result.data.results)).toBe(true);
      expect(result.data).toHaveProperty('totalFound');
    });

    it('should filter results by category', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare',
        filters: { category: 'documentation' }
      }, mockContext);
      
      expect(result.success).toBe(true);
      if (result.data.results.length > 0) {
        result.data.results.forEach((article: any) => {
          expect(article.category).toBe('documentation');
        });
      }
    });

    it('should filter results by tags', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare',
        filters: { tags: ['workers'] }
      }, mockContext);
      
      expect(result.success).toBe(true);
      if (result.data.results.length > 0) {
        result.data.results.forEach((article: any) => {
          expect(article.tags).toContain('workers');
        });
      }
    });

    it('should filter results by relevance threshold', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare',
        filters: { relevanceThreshold: 0.9 }
      }, mockContext);
      
      expect(result.success).toBe(true);
      result.data.results.forEach((article: any) => {
        expect(article.relevanceScore).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should limit results to maxResults', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare',
        maxResults: 2
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data.results.length).toBeLessThanOrEqual(2);
    });

    it('should sort results by relevance score', async () => {
      const result = await tool.execute({ 
        query: 'cloudflare' 
      }, mockContext);
      
      expect(result.success).toBe(true);
      const scores = result.data.results.map((article: any) => article.relevanceScore);
      
      // Check if scores are in descending order
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });

    it('should include metadata in response', async () => {
      const result = await tool.execute({ 
        query: 'workers' 
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('searchTime');
      expect(result.metadata).toHaveProperty('sessionId', 'test-session-123');
    });
  });

  describe('Search Results Structure', () => {
    it('should return properly structured search results', async () => {
      const result = await tool.execute({ 
        query: 'workers' 
      }, mockContext);
      
      expect(result.success).toBe(true);
      
      if (result.data.results.length > 0) {
        const article = result.data.results[0];
        expect(article).toHaveProperty('id');
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('content');
        expect(article).toHaveProperty('relevanceScore');
        expect(article).toHaveProperty('lastUpdated');
        expect(typeof article.relevanceScore).toBe('number');
        expect(article.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(article.relevanceScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing query parameter', async () => {
      const result = await tool.execute({} as any, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid query parameter');
    });

    it('should handle null parameters', async () => {
      const result = await tool.execute(null as any, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid query parameter');
    });
  });

  describe('Date Range Filtering', () => {
    it('should filter results by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      
      const result = await tool.execute({ 
        query: 'cloudflare',
        filters: { 
          dateRange: { 
            start: startDate, 
            end: endDate 
          } 
        }
      }, mockContext);
      
      expect(result.success).toBe(true);
      result.data.results.forEach((article: any) => {
        const articleDate = new Date(article.lastUpdated);
        expect(articleDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());
        expect(articleDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
      });
    });
  });
});
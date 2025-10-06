// Knowledge Base Tool implementation

import { Tool, ToolContext, ToolResult } from './tools.js';

export interface SearchFilters {
  category?: string;
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  relevanceThreshold?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  relevanceScore: number;
  category?: string;
  tags?: string[];
  lastUpdated: Date;
  url?: string;
}

export interface KnowledgeBaseSearchParams {
  query: string;
  filters?: SearchFilters;
  maxResults?: number;
}

export class KnowledgeBaseTool implements Tool {
  name = 'kb.search';
  description = 'Search the knowledge base for relevant articles and documentation';
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant knowledge base articles'
      },
      filters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by article category'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by article tags'
          },
          relevanceThreshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Minimum relevance score (0-1)'
          }
        }
      },
      maxResults: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        default: 5,
        description: 'Maximum number of results to return'
      }
    },
    required: ['query']
  };

  async execute(params: KnowledgeBaseSearchParams, context: ToolContext): Promise<ToolResult> {
    try {
      // Validate parameters
      if (!params || !params.query || typeof params.query !== 'string') {
        return {
          success: false,
          error: 'Invalid query parameter: must be a non-empty string'
        };
      }

      const maxResults = params.maxResults || 5;
      if (maxResults < 1 || maxResults > 20) {
        return {
          success: false,
          error: 'Invalid maxResults parameter: must be between 1 and 20'
        };
      }

      // Perform the search
      const searchResults = await this.performSearch(params, context);

      return {
        success: true,
        data: {
          query: params.query,
          results: searchResults,
          totalFound: searchResults.length,
          filters: params.filters
        },
        metadata: {
          searchTime: Date.now(),
          sessionId: context.sessionId
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      // Determine if this is a retryable error
      const isRetryable = this.isRetryableError(error);
      
      return {
        success: false,
        error: isRetryable ? `NETWORK_ERROR: ${errorMessage}` : errorMessage,
        metadata: {
          retryable: isRetryable,
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError'
        }
      };
    }
  }

  private async performSearch(
    params: KnowledgeBaseSearchParams, 
    context: ToolContext
  ): Promise<SearchResult[]> {
    // In a real implementation, this would connect to an actual knowledge base
    // For now, we'll simulate a search with mock data
    
    const mockKnowledgeBase: SearchResult[] = [
      {
        id: 'kb_001',
        title: 'Getting Started with Cloudflare Workers',
        content: 'Cloudflare Workers is a serverless platform that allows you to run JavaScript at the edge...',
        relevanceScore: 0.95,
        category: 'documentation',
        tags: ['workers', 'getting-started', 'serverless'],
        lastUpdated: new Date('2024-01-15'),
        url: 'https://developers.cloudflare.com/workers/get-started/'
      },
      {
        id: 'kb_002',
        title: 'Durable Objects Overview',
        content: 'Durable Objects provide low-latency coordination and consistent storage for the Workers platform...',
        relevanceScore: 0.88,
        category: 'documentation',
        tags: ['durable-objects', 'storage', 'state'],
        lastUpdated: new Date('2024-01-10'),
        url: 'https://developers.cloudflare.com/durable-objects/'
      },
      {
        id: 'kb_003',
        title: 'Troubleshooting Common Issues',
        content: 'This guide covers common issues and their solutions when working with Cloudflare services...',
        relevanceScore: 0.82,
        category: 'troubleshooting',
        tags: ['troubleshooting', 'common-issues', 'support'],
        lastUpdated: new Date('2024-01-12'),
        url: 'https://support.cloudflare.com/troubleshooting/'
      }
    ];

    // Filter results based on query relevance (simple keyword matching for demo)
    const queryLower = params.query.toLowerCase();
    let filteredResults = mockKnowledgeBase.filter(article => {
      const titleMatch = article.title.toLowerCase().includes(queryLower);
      const contentMatch = article.content.toLowerCase().includes(queryLower);
      const tagMatch = article.tags?.some(tag => tag.toLowerCase().includes(queryLower));
      
      return titleMatch || contentMatch || tagMatch;
    });

    // Apply additional filters if provided
    if (params.filters) {
      if (params.filters.category) {
        filteredResults = filteredResults.filter(article => 
          article.category === params.filters!.category
        );
      }

      if (params.filters.tags && params.filters.tags.length > 0) {
        filteredResults = filteredResults.filter(article =>
          params.filters!.tags!.some(filterTag =>
            article.tags?.includes(filterTag)
          )
        );
      }

      if (params.filters.relevanceThreshold) {
        filteredResults = filteredResults.filter(article =>
          article.relevanceScore >= params.filters!.relevanceThreshold!
        );
      }

      if (params.filters.dateRange) {
        filteredResults = filteredResults.filter(article =>
          article.lastUpdated >= params.filters!.dateRange!.start &&
          article.lastUpdated <= params.filters!.dateRange!.end
        );
      }
    }

    // Sort by relevance score (descending)
    filteredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit results
    const maxResults = params.maxResults || 5;
    return filteredResults.slice(0, maxResults);
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network-related errors that should be retried
      const retryableErrors = [
        'NetworkError',
        'TimeoutError',
        'AbortError',
        'fetch failed',
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT'
      ];
      
      return retryableErrors.some(retryableError =>
        error.message.includes(retryableError) || error.name.includes(retryableError)
      );
    }
    
    return false;
  }
}
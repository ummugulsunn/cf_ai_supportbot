// Ticketing Tool implementation

import { Tool, ToolContext, ToolResult } from './tools.js';

export interface IssueData {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  userEmail?: string;
  attachments?: string[];
}

export interface TicketResult {
  ticketId: string;
  status: TicketStatus;
  createdAt: Date;
  estimatedResolution?: Date;
  assignedTo?: string;
}

export interface TicketStatus {
  id: string;
  status: 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  assignedTo?: string;
  resolution?: string;
  estimatedResolution?: Date;
}

export interface TicketUpdate {
  status?: TicketStatus['status'];
  priority?: TicketStatus['priority'];
  assignedTo?: string;
  resolution?: string;
  comment?: string;
}

export class TicketingTool implements Tool {
  name = 'ticketing';
  description = 'Create support tickets and check ticket status';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'status', 'update'],
        description: 'The action to perform: create a new ticket, check status, or update existing ticket'
      },
      ticketData: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Ticket title' },
          description: { type: 'string', description: 'Detailed description of the issue' },
          priority: { 
            type: 'string', 
            enum: ['low', 'medium', 'high', 'urgent'],
            description: 'Issue priority level'
          },
          category: { type: 'string', description: 'Issue category' },
          userEmail: { type: 'string', description: 'User email address' }
        },
        required: ['title', 'description', 'priority', 'category']
      },
      ticketId: {
        type: 'string',
        description: 'Ticket ID for status checks or updates'
      },
      updateData: {
        type: 'object',
        properties: {
          status: { 
            type: 'string', 
            enum: ['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed']
          },
          priority: { 
            type: 'string', 
            enum: ['low', 'medium', 'high', 'urgent']
          },
          assignedTo: { type: 'string' },
          resolution: { type: 'string' },
          comment: { type: 'string' }
        }
      }
    },
    required: ['action']
  };

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      // Validate action parameter
      if (!params || !params.action || !['create', 'status', 'update'].includes(params.action)) {
        return {
          success: false,
          error: 'Invalid action parameter: must be "create", "status", or "update"'
        };
      }

      switch (params.action) {
        case 'create':
          return await this.createTicket(params.ticketData, context);
        case 'status':
          return await this.fetchStatus(params.ticketId, context);
        case 'update':
          return await this.updateTicket(params.ticketId, params.updateData, context);
        default:
          return {
            success: false,
            error: `Unsupported action: ${params.action}`
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const isRetryable = this.isRetryableError(error);
      
      return {
        success: false,
        error: isRetryable ? `SERVICE_UNAVAILABLE: ${errorMessage}` : errorMessage,
        metadata: {
          retryable: isRetryable,
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError'
        }
      };
    }
  }

  private async createTicket(issueData: IssueData, context: ToolContext): Promise<ToolResult> {
    // Validate required fields
    if (!issueData || typeof issueData !== 'object') {
      return {
        success: false,
        error: 'Invalid ticket data: must be an object'
      };
    }

    const requiredFields = ['title', 'description', 'priority', 'category'];
    for (const field of requiredFields) {
      if (!issueData[field as keyof IssueData]) {
        return {
          success: false,
          error: `Missing required field: ${field}`
        };
      }
    }

    if (!['low', 'medium', 'high', 'urgent'].includes(issueData.priority)) {
      return {
        success: false,
        error: 'Invalid priority: must be low, medium, high, or urgent'
      };
    }

    // Simulate ticket creation (in real implementation, this would call external API)
    const ticketId = this.generateTicketId();
    const now = new Date();
    
    // Calculate estimated resolution based on priority
    const estimatedResolution = this.calculateEstimatedResolution(issueData.priority, now);

    const ticketResult: TicketResult = {
      ticketId,
      status: {
        id: ticketId,
        status: 'open',
        priority: issueData.priority,
        title: issueData.title,
        description: issueData.description,
        createdAt: now,
        updatedAt: now,
        estimatedResolution
      },
      createdAt: now,
      estimatedResolution
    };

    // Store ticket in mock storage (in real implementation, this would be persistent)
    await this.storeTicket(ticketResult, context);

    return {
      success: true,
      data: ticketResult,
      metadata: {
        sessionId: context.sessionId,
        createdAt: now.toISOString()
      }
    };
  }

  private async fetchStatus(ticketId: string, context: ToolContext): Promise<ToolResult> {
    if (!ticketId || typeof ticketId !== 'string') {
      return {
        success: false,
        error: 'Invalid ticket ID: must be a non-empty string'
      };
    }

    // Simulate fetching ticket status (in real implementation, this would query external system)
    const ticketStatus = await this.getTicketFromStorage(ticketId, context);

    if (!ticketStatus) {
      return {
        success: false,
        error: `Ticket not found: ${ticketId}`
      };
    }

    return {
      success: true,
      data: ticketStatus,
      metadata: {
        sessionId: context.sessionId,
        fetchedAt: new Date().toISOString()
      }
    };
  }

  private async updateTicket(
    ticketId: string, 
    updateData: TicketUpdate, 
    context: ToolContext
  ): Promise<ToolResult> {
    if (!ticketId || typeof ticketId !== 'string') {
      return {
        success: false,
        error: 'Invalid ticket ID: must be a non-empty string'
      };
    }

    if (!updateData || typeof updateData !== 'object') {
      return {
        success: false,
        error: 'Invalid update data: must be an object'
      };
    }

    // Fetch existing ticket
    const existingTicket = await this.getTicketFromStorage(ticketId, context);
    if (!existingTicket) {
      return {
        success: false,
        error: `Ticket not found: ${ticketId}`
      };
    }

    // Validate update fields
    if (updateData.status && !['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'].includes(updateData.status)) {
      return {
        success: false,
        error: 'Invalid status: must be open, in_progress, waiting_for_customer, resolved, or closed'
      };
    }

    if (updateData.priority && !['low', 'medium', 'high', 'urgent'].includes(updateData.priority)) {
      return {
        success: false,
        error: 'Invalid priority: must be low, medium, high, or urgent'
      };
    }

    // Update ticket
    const updatedTicket: TicketResult = {
      ...existingTicket,
      status: {
        ...existingTicket.status,
        ...updateData,
        updatedAt: new Date()
      }
    };

    // Store updated ticket
    await this.storeTicket(updatedTicket, context);

    return {
      success: true,
      data: updatedTicket,
      metadata: {
        sessionId: context.sessionId,
        updatedAt: new Date().toISOString(),
        updatedFields: Object.keys(updateData)
      }
    };
  }

  private generateTicketId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `TKT-${timestamp}-${random}`.toUpperCase();
  }

  private calculateEstimatedResolution(priority: string, createdAt: Date): Date {
    const resolutionHours = {
      urgent: 4,
      high: 24,
      medium: 72,
      low: 168 // 1 week
    };

    const hours = resolutionHours[priority as keyof typeof resolutionHours] || 72;
    return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  }

  private async storeTicket(ticket: TicketResult, context: ToolContext): Promise<void> {
    // In a real implementation, this would store in a database or external system
    // For now, we'll simulate storage using the session context
    if (!context.conversationContext) {
      context.conversationContext = {};
    }
    
    if (!context.conversationContext.tickets) {
      context.conversationContext.tickets = {};
    }
    
    context.conversationContext.tickets[ticket.ticketId] = ticket;
  }

  private async getTicketFromStorage(ticketId: string, context: ToolContext): Promise<TicketResult | null> {
    // In a real implementation, this would fetch from a database or external system
    if (!context.conversationContext?.tickets) {
      return null;
    }
    
    return context.conversationContext.tickets[ticketId] || null;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Service-related errors that should be retried
      const retryableErrors = [
        'NetworkError',
        'TimeoutError',
        'ServiceUnavailable',
        'InternalServerError',
        'BadGateway',
        'GatewayTimeout',
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
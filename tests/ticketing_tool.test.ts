// Unit tests for Ticketing Tool

import { describe, it, expect, beforeEach } from 'vitest';
import { TicketingTool } from '../workers/ticketing_tool.js';
import { ToolContext } from '../workers/tools.js';

describe('TicketingTool', () => {
  let tool: TicketingTool;
  let mockContext: ToolContext;

  beforeEach(() => {
    tool = new TicketingTool();
    mockContext = {
      sessionId: 'test-session-123',
      userId: 'test-user',
      conversationContext: {},
      bindings: {}
    };
  });

  describe('Tool Properties', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('ticketing');
      expect(tool.description).toBe('Create support tickets and check ticket status');
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters).toHaveProperty('type', 'object');
      expect(tool.parameters.properties).toHaveProperty('action');
      expect(tool.parameters.required).toContain('action');
    });
  });

  describe('Action Validation', () => {
    it('should reject invalid action', async () => {
      const result = await tool.execute({ action: 'invalid' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action parameter');
    });

    it('should reject missing action', async () => {
      const result = await tool.execute({}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action parameter');
    });

    it('should accept valid actions', async () => {
      const validActions = ['create', 'status', 'update'];
      
      for (const action of validActions) {
        // For status and update, we need a ticketId, so we'll create a ticket first
        if (action === 'create') {
          const result = await tool.execute({
            action,
            ticketData: {
              title: 'Test Issue',
              description: 'Test description',
              priority: 'medium',
              category: 'technical'
            }
          }, mockContext);
          
          expect(result.success).toBe(true);
        }
      }
    });
  });

  describe('Create Ticket', () => {
    const validTicketData = {
      title: 'Test Issue',
      description: 'This is a test issue description',
      priority: 'high' as const,
      category: 'technical',
      userEmail: 'test@example.com'
    };

    it('should create ticket with valid data', async () => {
      const result = await tool.execute({
        action: 'create',
        ticketData: validTicketData
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('ticketId');
      expect(result.data).toHaveProperty('status');
      expect(result.data).toHaveProperty('createdAt');
      expect(result.data.status.title).toBe(validTicketData.title);
      expect(result.data.status.priority).toBe(validTicketData.priority);
      expect(result.data.status.status).toBe('open');
    });

    it('should generate unique ticket IDs', async () => {
      const result1 = await tool.execute({
        action: 'create',
        ticketData: validTicketData
      }, mockContext);
      
      const result2 = await tool.execute({
        action: 'create',
        ticketData: validTicketData
      }, mockContext);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.data.ticketId).not.toBe(result2.data.ticketId);
    });

    it('should reject missing required fields', async () => {
      const requiredFields = ['title', 'description', 'priority', 'category'];
      
      for (const field of requiredFields) {
        const incompleteData = { ...validTicketData };
        delete incompleteData[field as keyof typeof incompleteData];
        
        const result = await tool.execute({
          action: 'create',
          ticketData: incompleteData
        }, mockContext);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain(`Missing required field: ${field}`);
      }
    });

    it('should reject invalid priority', async () => {
      const result = await tool.execute({
        action: 'create',
        ticketData: {
          ...validTicketData,
          priority: 'invalid'
        }
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid priority');
    });

    it('should calculate estimated resolution based on priority', async () => {
      const priorities = ['urgent', 'high', 'medium', 'low'] as const;
      
      for (const priority of priorities) {
        const result = await tool.execute({
          action: 'create',
          ticketData: {
            ...validTicketData,
            priority
          }
        }, mockContext);
        
        expect(result.success).toBe(true);
        expect(result.data.estimatedResolution).toBeDefined();
        
        const createdAt = new Date(result.data.createdAt);
        const estimatedResolution = new Date(result.data.estimatedResolution);
        expect(estimatedResolution.getTime()).toBeGreaterThan(createdAt.getTime());
      }
    });

    it('should include metadata in response', async () => {
      const result = await tool.execute({
        action: 'create',
        ticketData: validTicketData
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('sessionId', 'test-session-123');
      expect(result.metadata).toHaveProperty('createdAt');
    });
  });

  describe('Fetch Status', () => {
    let ticketId: string;

    beforeEach(async () => {
      // Create a ticket first
      const createResult = await tool.execute({
        action: 'create',
        ticketData: {
          title: 'Test Issue',
          description: 'Test description',
          priority: 'medium',
          category: 'technical'
        }
      }, mockContext);
      
      ticketId = createResult.data.ticketId;
    });

    it('should fetch existing ticket status', async () => {
      const result = await tool.execute({
        action: 'status',
        ticketId
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('ticketId', ticketId);
      expect(result.data).toHaveProperty('status');
      expect(result.data.status).toHaveProperty('id', ticketId);
    });

    it('should return error for non-existent ticket', async () => {
      const result = await tool.execute({
        action: 'status',
        ticketId: 'non-existent-ticket'
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Ticket not found');
    });

    it('should reject invalid ticket ID', async () => {
      const result = await tool.execute({
        action: 'status',
        ticketId: ''
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ticket ID');
    });

    it('should include metadata in response', async () => {
      const result = await tool.execute({
        action: 'status',
        ticketId
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('sessionId', 'test-session-123');
      expect(result.metadata).toHaveProperty('fetchedAt');
    });
  });

  describe('Update Ticket', () => {
    let ticketId: string;

    beforeEach(async () => {
      // Create a ticket first
      const createResult = await tool.execute({
        action: 'create',
        ticketData: {
          title: 'Test Issue',
          description: 'Test description',
          priority: 'medium',
          category: 'technical'
        }
      }, mockContext);
      
      ticketId = createResult.data.ticketId;
    });

    it('should update ticket status', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId,
        updateData: {
          status: 'in_progress',
          assignedTo: 'agent@example.com'
        }
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data.status.status).toBe('in_progress');
      expect(result.data.status.assignedTo).toBe('agent@example.com');
      expect(result.data.status.updatedAt).toBeDefined();
    });

    it('should update ticket priority', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId,
        updateData: {
          priority: 'urgent'
        }
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data.status.priority).toBe('urgent');
    });

    it('should reject invalid status', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId,
        updateData: {
          status: 'invalid_status'
        }
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('should reject invalid priority', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId,
        updateData: {
          priority: 'invalid_priority'
        }
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid priority');
    });

    it('should return error for non-existent ticket', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId: 'non-existent-ticket',
        updateData: {
          status: 'resolved'
        }
      }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Ticket not found');
    });

    it('should include updated fields in metadata', async () => {
      const result = await tool.execute({
        action: 'update',
        ticketId,
        updateData: {
          status: 'resolved',
          resolution: 'Issue resolved'
        }
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('updatedFields');
      expect(result.metadata.updatedFields).toContain('status');
      expect(result.metadata.updatedFields).toContain('resolution');
    });
  });

  describe('Error Handling', () => {
    it('should handle null parameters gracefully', async () => {
      const result = await tool.execute(null, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action parameter');
    });

    it('should handle undefined parameters gracefully', async () => {
      const result = await tool.execute(undefined, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action parameter');
    });
  });

  describe('Ticket ID Generation', () => {
    it('should generate ticket IDs with correct format', async () => {
      const result = await tool.execute({
        action: 'create',
        ticketData: {
          title: 'Test Issue',
          description: 'Test description',
          priority: 'medium',
          category: 'technical'
        }
      }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data.ticketId).toMatch(/^TKT-\d+-[A-Z0-9]+$/);
    });
  });
});
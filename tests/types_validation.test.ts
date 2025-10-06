import { describe, it, expect } from 'vitest';
import {
  validateChatMessage,
  validateSessionState,
  validateConversationMemory,
  validateToolCall,
  validateAPIRequest,
  validateWorkflowStep,
  generateMessageId,
  generateSessionId,
  generateRequestId,
  sanitizeMessage,
  createErrorResponse,
  createSuccessResponse,
  isValidSessionStatus,
  isValidMessageRole,
  type ChatMessage,
  type SessionState,
  type ConversationMemory,
  type ToolCall,
  type APIRequest,
  type WorkflowStep
} from '../workers/types';

describe('Data Model Validation', () => {
  describe('validateChatMessage', () => {
    it('should validate a valid chat message', () => {
      const validMessage: ChatMessage = {
        id: 'msg_123',
        sessionId: 'sess_456',
        content: 'Hello, world!',
        role: 'user',
        timestamp: Date.now()
      };

      expect(validateChatMessage(validMessage)).toBe(true);
    });

    it('should reject message with empty content', () => {
      const invalidMessage = {
        id: 'msg_123',
        sessionId: 'sess_456',
        content: '',
        role: 'user',
        timestamp: Date.now()
      };

      expect(validateChatMessage(invalidMessage)).toBe(false);
    });

    it('should reject message with invalid role', () => {
      const invalidMessage = {
        id: 'msg_123',
        sessionId: 'sess_456',
        content: 'Hello',
        role: 'invalid',
        timestamp: Date.now()
      };

      expect(validateChatMessage(invalidMessage)).toBe(false);
    });

    it('should validate message with metadata', () => {
      const messageWithMetadata: ChatMessage = {
        id: 'msg_123',
        sessionId: 'sess_456',
        content: 'Hello',
        role: 'user',
        timestamp: Date.now(),
        metadata: {
          voiceEnabled: true,
          voiceConfidence: 0.95,
          piiFiltered: false
        }
      };

      expect(validateChatMessage(messageWithMetadata)).toBe(true);
    });

    it('should reject message with invalid voice confidence', () => {
      const invalidMessage = {
        id: 'msg_123',
        sessionId: 'sess_456',
        content: 'Hello',
        role: 'user',
        timestamp: Date.now(),
        metadata: {
          voiceConfidence: 1.5 // Invalid: > 1
        }
      };

      expect(validateChatMessage(invalidMessage)).toBe(false);
    });
  });

  describe('validateSessionState', () => {
    it('should validate a valid session state', () => {
      const validSession: SessionState = {
        id: 'sess_123',
        status: 'active',
        createdAt: Date.now() - 1000,
        lastActivity: Date.now()
      };

      expect(validateSessionState(validSession)).toBe(true);
    });

    it('should reject session with invalid status', () => {
      const invalidSession = {
        id: 'sess_123',
        status: 'invalid',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      expect(validateSessionState(invalidSession)).toBe(false);
    });

    it('should reject session where lastActivity is before createdAt', () => {
      const invalidSession = {
        id: 'sess_123',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now() - 1000
      };

      expect(validateSessionState(invalidSession)).toBe(false);
    });
  });

  describe('validateConversationMemory', () => {
    it('should validate valid conversation memory', () => {
      const validMemory: ConversationMemory = {
        sessionId: 'sess_123',
        messages: [{
          id: 'msg_1',
          sessionId: 'sess_123',
          content: 'Hello',
          role: 'user',
          timestamp: Date.now()
        }],
        summary: 'User greeted',
        context: { topic: 'greeting' },
        lastSummaryAt: Date.now() - 1000,
        ttl: 3600
      };

      expect(validateConversationMemory(validMemory)).toBe(true);
    });

    it('should reject memory with invalid messages', () => {
      const invalidMemory = {
        sessionId: 'sess_123',
        messages: [{ invalid: 'message' }],
        summary: 'Test',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 3600
      };

      expect(validateConversationMemory(invalidMemory)).toBe(false);
    });
  });

  describe('validateToolCall', () => {
    it('should validate valid tool call', () => {
      const validToolCall: ToolCall = {
        id: 'tool_123',
        name: 'search',
        parameters: { query: 'test' }
      };

      expect(validateToolCall(validToolCall)).toBe(true);
    });

    it('should reject tool call with empty name', () => {
      const invalidToolCall = {
        id: 'tool_123',
        name: '',
        parameters: { query: 'test' }
      };

      expect(validateToolCall(invalidToolCall)).toBe(false);
    });
  });

  describe('validateAPIRequest', () => {
    it('should validate valid API request', () => {
      const validRequest: APIRequest = {
        sessionId: 'sess_123',
        message: 'Hello'
      };

      expect(validateAPIRequest(validRequest)).toBe(true);
    });

    it('should reject request with empty message', () => {
      const invalidRequest = {
        sessionId: 'sess_123',
        message: '   '
      };

      expect(validateAPIRequest(invalidRequest)).toBe(false);
    });
  });

  describe('validateWorkflowStep', () => {
    it('should validate valid workflow step', () => {
      const validStep: WorkflowStep = {
        id: 'step_1',
        name: 'process_query',
        input: { query: 'test' },
        retryCount: 0,
        status: 'pending'
      };

      expect(validateWorkflowStep(validStep)).toBe(true);
    });

    it('should reject step with negative retry count', () => {
      const invalidStep = {
        id: 'step_1',
        name: 'process_query',
        input: { query: 'test' },
        retryCount: -1,
        status: 'pending'
      };

      expect(validateWorkflowStep(invalidStep)).toBe(false);
    });
  });
});

describe('Utility Functions', () => {
  describe('ID Generation', () => {
    it('should generate unique message IDs', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      
      expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^msg_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      
      expect(id1).toMatch(/^sess_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^sess_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate unique request IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      
      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('sanitizeMessage', () => {
    it('should sanitize HTML characters', () => {
      const input = '<script>alert("xss")</script>';
      const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;';
      
      expect(sanitizeMessage(input)).toBe(expected);
    });

    it('should trim whitespace', () => {
      const input = '  hello world  ';
      const expected = 'hello world';
      
      expect(sanitizeMessage(input)).toBe(expected);
    });
  });

  describe('Response Creation', () => {
    it('should create error response', () => {
      const error = createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid input',
        'req_123',
        { field: 'message' },
        true,
        false
      );

      expect(error.error.code).toBe('VALIDATION_ERROR');
      expect(error.error.message).toBe('Invalid input');
      expect(error.error.retryable).toBe(true);
      expect(error.error.fallbackAvailable).toBe(false);
      expect(error.requestId).toBe('req_123');
      expect(error.timestamp).toBeTypeOf('number');
    });

    it('should create success response', () => {
      const response = createSuccessResponse({ result: 'ok' }, 'req_123');

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ result: 'ok' });
      expect(response.requestId).toBe('req_123');
      expect(response.timestamp).toBeTypeOf('number');
    });
  });

  describe('Type Guards', () => {
    it('should validate session status', () => {
      expect(isValidSessionStatus('active')).toBe(true);
      expect(isValidSessionStatus('idle')).toBe(true);
      expect(isValidSessionStatus('ended')).toBe(true);
      expect(isValidSessionStatus('invalid')).toBe(false);
    });

    it('should validate message role', () => {
      expect(isValidMessageRole('user')).toBe(true);
      expect(isValidMessageRole('assistant')).toBe(true);
      expect(isValidMessageRole('system')).toBe(false);
    });
  });
});
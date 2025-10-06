// Durable Object for session memory management
import {
  ChatMessage,
  SessionState,
  ConversationMemory,
  ConversationContext,
  MemoryOperations,
  validateChatMessage,
  validateSessionState,
  generateMessageId,
  WorkerBindings
} from './types';
import { DataPersistenceService } from './data_persistence';

export class SessionMemoryDO implements DurableObject, MemoryOperations {
  private state: DurableObjectState;
  private env: WorkerBindings;
  private sessionId: string;
  private persistenceService: DataPersistenceService;
  
  // Configuration constants
  private static readonly MAX_MESSAGES = 100;
  private static readonly SUMMARY_THRESHOLD = 20;
  private static readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor(state: DurableObjectState, env: WorkerBindings) {
    this.state = state;
    this.env = env;
    this.sessionId = '';
    this.persistenceService = new DataPersistenceService(env);
    
    // Set up periodic cleanup
    this.state.blockConcurrencyWhile(async () => {
      await this.initializeSession();
      this.scheduleCleanup();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    
    try {
      // Extract session ID from URL path
      const pathParts = url.pathname.split('/');
      this.sessionId = pathParts[pathParts.length - 1] || '';

      switch (method) {
        case 'POST':
          return await this.handlePost(request);
        case 'GET':
          return await this.handleGet(url);
        case 'DELETE':
          return await this.handleDelete();
        default:
          return new Response('Method not allowed', { status: 405 });
      }
    } catch (error) {
      console.error('SessionMemoryDO error:', error);
      return new Response(JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          retryable: true,
          fallbackAvailable: false
        },
        requestId: crypto.randomUUID(),
        timestamp: Date.now()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handlePost(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const action = body.action;

    switch (action) {
      case 'addMessage':
        await this.addMessage(body.message as any);
        return new Response(JSON.stringify({ success: true }));
      
      case 'generateSummary':
        const summary = await this.generateSummary();
        return new Response(JSON.stringify({ summary }));
      
      case 'updateSession':
        await this.updateSessionState(body.updates as any);
        return new Response(JSON.stringify({ success: true }));
      
      case 'archiveSession':
        const archiveKey = await this.archiveSession();
        return new Response(JSON.stringify({ archiveKey }));
      
      case 'restoreSession':
        const restored = await this.restoreSession(body.sessionId as any);
        return new Response(JSON.stringify({ restored }));
      
      default:
        return new Response('Invalid action', { status: 400 });
    }
  }

  private async handleGet(url: URL): Promise<Response> {
    const action = url.searchParams.get('action');

    switch (action) {
      case 'context':
        const context = await this.getContext();
        return new Response(JSON.stringify(context));
      
      case 'messages':
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const messages = await this.getRecentMessages(limit);
        return new Response(JSON.stringify({ messages }));
      
      case 'session':
        const session = await this.getSessionState();
        return new Response(JSON.stringify(session));
      
      case 'archives':
        const userId = url.searchParams.get('userId') || undefined;
        const archiveLimit = parseInt(url.searchParams.get('limit') || '50');
        const archives = await this.persistenceService.listArchivedConversations(userId, archiveLimit);
        return new Response(JSON.stringify({ archives }));
      
      default:
        return new Response('Invalid action', { status: 400 });
    }
  }

  private async handleDelete(): Promise<Response> {
    await this.cleanup();
    return new Response(JSON.stringify({ success: true }));
  }

  async addMessage(message: ChatMessage): Promise<void> {
    // Ensure message has an ID before validation
    if (!message.id) {
      message.id = generateMessageId();
    }

    if (!validateChatMessage(message)) {
      throw new Error('Invalid message format');
    }

    // Get current memory
    const memory = await this.getMemory();
    
    // Add message to history
    memory.messages.push(message);
    
    // Update last activity
    await this.updateLastActivity();
    
    // Check if we need to summarize
    if (memory.messages.length >= SessionMemoryDO.SUMMARY_THRESHOLD && 
        Date.now() - memory.lastSummaryAt > 10 * 60 * 1000) { // 10 minutes
      await this.performSummarization(memory);
    }
    
    // Trim messages if we exceed max
    if (memory.messages.length > SessionMemoryDO.MAX_MESSAGES) {
      const excessCount = memory.messages.length - SessionMemoryDO.MAX_MESSAGES;
      memory.messages = memory.messages.slice(excessCount);
    }
    
    // Save updated memory
    await this.state.storage.put('memory', memory);
  }

  async getContext(): Promise<ConversationContext> {
    const memory = await this.getMemory();
    const session = await this.getSessionState();
    
    return {
      sessionId: this.sessionId,
      summary: memory.summary,
      recentMessages: memory.messages.slice(-10), // Last 10 messages
      activeTopics: this.extractTopics(memory.messages),
      resolvedIssues: memory.context.resolvedIssues || []
    };
  }

  async generateSummary(): Promise<string> {
    const memory = await this.getMemory();
    
    if (memory.messages.length === 0) {
      return 'No conversation history available.';
    }

    // Simple summarization logic - in production, this would use AI
    const recentMessages = memory.messages.slice(-10);
    const userMessages = recentMessages.filter(m => m.role === 'user');
    const assistantMessages = recentMessages.filter(m => m.role === 'assistant');
    
    const topics = this.extractTopics(recentMessages);
    
    const summary = `Conversation summary: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses. ` +
                   `Active topics: ${topics.join(', ')}. ` +
                   `Last activity: ${new Date(memory.messages[memory.messages.length - 1]?.timestamp || Date.now()).toISOString()}`;
    
    // Update memory with new summary
    memory.summary = summary;
    memory.lastSummaryAt = Date.now();
    await this.state.storage.put('memory', memory);
    
    return summary;
  }

  async cleanup(): Promise<void> {
    const memory = await this.getMemory();
    const session = await this.getSessionState();
    
    // Check TTL
    const now = Date.now();
    if (now - session.lastActivity > memory.ttl) {
      // Archive conversation if needed
      if (memory.messages.length > 0) {
        await this.archiveConversation(memory);
      }
      
      // Clear storage
      await this.state.storage.deleteAll();
      
      // Mark session as ended
      session.status = 'ended';
      await this.state.storage.put('session', session);
    }
  }

  private async initializeSession(): Promise<void> {
    const existingSession = await this.state.storage.get<SessionState>('session');
    const existingMemory = await this.state.storage.get<ConversationMemory>('memory');
    
    if (!existingSession) {
      const session: SessionState = {
        id: this.sessionId || crypto.randomUUID(),
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      await this.state.storage.put('session', session);
    }
    
    if (!existingMemory) {
      const memory: ConversationMemory = {
        sessionId: existingSession?.id || this.sessionId || crypto.randomUUID(),
        messages: [],
        summary: '',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: SessionMemoryDO.DEFAULT_TTL
      };
      
      await this.state.storage.put('memory', memory);
    }
  }

  private async getMemory(): Promise<ConversationMemory> {
    const memory = await this.state.storage.get<ConversationMemory>('memory');
    
    if (!memory) {
      const defaultMemory: ConversationMemory = {
        sessionId: this.sessionId,
        messages: [],
        summary: '',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: SessionMemoryDO.DEFAULT_TTL
      };
      
      await this.state.storage.put('memory', defaultMemory);
      return defaultMemory;
    }
    
    return memory;
  }

  private async getSessionState(): Promise<SessionState> {
    let session = await this.state.storage.get<SessionState>('session');
    
    if (!session) {
      // Create a new session if none exists
      session = {
        id: this.sessionId || crypto.randomUUID(),
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      await this.state.storage.put('session', session);
    }
    
    return session;
  }

  private async updateSessionState(updates: Partial<SessionState>): Promise<void> {
    const session = await this.getSessionState();
    const updatedSession = { ...session, ...updates, lastActivity: Date.now() };
    
    if (!validateSessionState(updatedSession)) {
      throw new Error('Invalid session state update');
    }
    
    await this.state.storage.put('session', updatedSession);
  }

  private async updateLastActivity(): Promise<void> {
    const session = await this.getSessionState();
    session.lastActivity = Date.now();
    session.status = 'active';
    await this.state.storage.put('session', session);
  }

  private async getRecentMessages(limit: number = 50): Promise<ChatMessage[]> {
    const memory = await this.getMemory();
    return memory.messages.slice(-limit);
  }

  private extractTopics(messages: ChatMessage[]): string[] {
    // Simple topic extraction - in production, this would use NLP
    const topics = new Set<string>();
    
    messages.forEach(message => {
      const content = message.content.toLowerCase();
      
      // Basic keyword matching for common support topics
      if (content.includes('password') || content.includes('login')) topics.add('authentication');
      if (content.includes('billing') || content.includes('payment')) topics.add('billing');
      if (content.includes('bug') || content.includes('error')) topics.add('technical-issue');
      if (content.includes('feature') || content.includes('request')) topics.add('feature-request');
      if (content.includes('account') || content.includes('profile')) topics.add('account-management');
    });
    
    return Array.from(topics);
  }

  private async performSummarization(memory: ConversationMemory): Promise<void> {
    // In production, this would call the AI model for summarization
    // For now, we'll use a simple approach
    const oldMessages = memory.messages.slice(0, -10); // Keep last 10 messages
    const messagesToSummarize = memory.messages.slice(-20, -10); // Summarize middle 10
    
    if (messagesToSummarize.length > 0) {
      const topics = this.extractTopics(messagesToSummarize);
      const userQuestions = messagesToSummarize.filter(m => m.role === 'user').length;
      
      const summaryAddition = `Previous discussion covered ${topics.join(', ')} with ${userQuestions} user questions. `;
      memory.summary = memory.summary + summaryAddition;
      memory.lastSummaryAt = Date.now();
    }
  }

  private async archiveConversation(memory: ConversationMemory): Promise<string | null> {
    try {
      const session = await this.getSessionState();
      const archiveKey = await this.persistenceService.archiveConversation(memory, session);
      console.log(`Successfully archived conversation for session ${memory.sessionId} to ${archiveKey}`);
      return archiveKey;
    } catch (error) {
      console.error('Failed to archive conversation:', error);
      // Don't throw - archiving failure shouldn't prevent cleanup
      return null;
    }
  }

  async archiveSession(): Promise<string> {
    const memory = await this.getMemory();
    const session = await this.getSessionState();
    
    if (memory.messages.length === 0) {
      throw new Error('No messages to archive');
    }
    
    const archiveKey = await this.persistenceService.archiveConversation(memory, session);
    
    // Mark session as archived
    session.status = 'ended';
    await this.state.storage.put('session', session);
    
    return archiveKey;
  }

  async restoreSession(sessionId: string): Promise<boolean> {
    try {
      const archivedMemory = await this.persistenceService.retrieveArchivedConversation(sessionId);
      if (!archivedMemory) {
        return false;
      }
      
      // Restore the memory
      await this.state.storage.put('memory', archivedMemory);
      
      // Update session state
      const session = await this.getSessionState();
      session.status = 'active';
      session.lastActivity = Date.now();
      await this.state.storage.put('session', session);
      
      return true;
    } catch (error) {
      console.error('Failed to restore session:', error);
      return false;
    }
  }

  private scheduleCleanup(): void {
    // Schedule periodic cleanup
    setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        console.error('Scheduled cleanup failed:', error);
      }
    }, SessionMemoryDO.CLEANUP_INTERVAL);
  }
}
// Core data models and interfaces for the AI Support Bot

export interface ChatMessage {
  id: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: number;
  metadata?: {
    toolCalls?: ToolCall[];
    voiceEnabled?: boolean;
    voiceTranscript?: string;
    voiceConfidence?: number;
    ttsEnabled?: boolean;
    piiFiltered?: boolean;
    contentFiltered?: boolean;
  };
}

export interface SessionState {
  id: string;
  userId?: string;
  status: 'active' | 'idle' | 'ended';
  createdAt: number;
  lastActivity: number;
}

export interface ConversationMemory {
  sessionId: string;
  messages: ChatMessage[];
  summary: string;
  context: Record<string, any>;
  lastSummaryAt: number;
  ttl: number;
}

export interface ConversationContext {
  sessionId: string;
  summary: string;
  recentMessages: ChatMessage[];
  userProfile?: UserProfile;
  activeTopics: string[];
  resolvedIssues: string[];
}

export interface UserProfile {
  id?: string;
  preferences?: Record<string, any>;
  previousIssues?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, any>;
  result?: any;
}

// Tool system interfaces (re-exported from tools.ts for convenience)
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
  bindings: any;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface WorkerBindings {
  AI: Ai;
  MEMORY_DO: DurableObjectNamespace;
  CHAT_KV: KVNamespace;
  ARCHIVE_R2: R2Bucket;
  WORKFLOWS: any; // Cloudflare Workflows binding - type not yet available in @cloudflare/workers-types
  OPENAI_API_KEY?: string;
  MAX_TOKENS?: string;
}

// Memory operations interface
export interface MemoryOperations {
  addMessage(message: ChatMessage): Promise<void>;
  getContext(): Promise<ConversationContext>;
  generateSummary(): Promise<string>;
  cleanup(): Promise<void>;
}

// Extended Session types
export interface Session {
  id: string;
  userId?: string;
  createdAt: number;
  lastActivity: number;
  status: SessionStatus;
  metadata: SessionMetadata;
}

export type SessionStatus = 'active' | 'idle' | 'ended';

export interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
  referrer?: string;
  voiceEnabled: boolean;
  language: string;
}

// Workflow types
export interface WorkflowStep {
  id: string;
  name: string;
  input: any;
  output?: any;
  retryCount: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface WorkflowResult {
  success: boolean;
  data?: any;
  error?: string;
  steps: WorkflowStep[];
}

export interface SupportWorkflow {
  processComplexQuery(query: string, context: ConversationContext): Promise<WorkflowResult>;
  executeToolChain(tools: ToolCall[]): Promise<ToolResult[]>;
  handleEscalation(ticketData: TicketData): Promise<EscalationResult>;
}

// Message Processing types
export interface ProcessedMessage {
  original: ChatMessage;
  processed: {
    intent?: string;
    entities?: Entity[];
    sentiment?: number;
    toolCalls?: ToolCall[];
  };
  aiResponse: {
    content: string;
    reasoning?: string;
    confidence: number;
  };
}

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start: number;
  end: number;
}

// Tool-specific types
export interface SearchFilters {
  category?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  relevance: number;
  metadata?: Record<string, any>;
}

export interface IssueData {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  userId?: string;
  sessionId: string;
}

export interface TicketData extends IssueData {
  id?: string;
  status?: TicketStatus;
  assignee?: string;
  createdAt?: number;
  updatedAt?: number;
}

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface TicketResult {
  success: boolean;
  ticket?: TicketData;
  error?: string;
}

export interface TicketUpdate {
  status?: TicketStatus;
  assignee?: string;
  notes?: string;
}

export interface EscalationResult {
  success: boolean;
  ticketId?: string;
  escalationLevel: number;
  assignedTo?: string;
  error?: string;
}

// API Request/Response types
export interface APIRequest {
  sessionId: string;
  message: string;
  context?: ConversationContext;
  tools?: string[];
}

export interface APIResponse {
  success: boolean;
  data?: any;
  error?: ErrorResponse;
  requestId: string;
  timestamp: number;
}

// Error handling types
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    retryable: boolean;
    fallbackAvailable: boolean;
  };
  requestId: string;
  timestamp: number;
}

// Retry and Circuit Breaker types
export interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

export interface WorkflowRetry extends RetryConfig {
  idempotencyKey: string;
  compensationSteps?: WorkflowStep[];
}

export interface CircuitBreaker {
  state: 'closed' | 'open' | 'half-open';
  failureThreshold: number;
  recoveryTimeout: number;
  lastFailureTime: number;
  consecutiveFailures: number;
}

// Validation functions
export function validateChatMessage(message: any): message is ChatMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  // Required fields
  if (typeof message.content !== 'string' || message.content.trim().length === 0) {
    return false;
  }
  
  if (!['user', 'assistant'].includes(message.role)) {
    return false;
  }

  // Optional but typed fields
  if (message.timestamp !== undefined && typeof message.timestamp !== 'number') {
    return false;
  }
  
  if (message.sessionId !== undefined && typeof message.sessionId !== 'string') {
    return false;
  }
  
  if (message.id !== undefined && typeof message.id !== 'string') {
    return false;
  }

  // Validate metadata if present
  if (message.metadata !== undefined) {
    if (typeof message.metadata !== 'object' || message.metadata === null) {
      return false;
    }
    
    const metadata = message.metadata;
    if (metadata.voiceEnabled !== undefined && typeof metadata.voiceEnabled !== 'boolean') {
      return false;
    }
    if (metadata.voiceTranscript !== undefined && typeof metadata.voiceTranscript !== 'string') {
      return false;
    }
    if (metadata.voiceConfidence !== undefined && (typeof metadata.voiceConfidence !== 'number' || metadata.voiceConfidence < 0 || metadata.voiceConfidence > 1)) {
      return false;
    }
    if (metadata.ttsEnabled !== undefined && typeof metadata.ttsEnabled !== 'boolean') {
      return false;
    }
    if (metadata.piiFiltered !== undefined && typeof metadata.piiFiltered !== 'boolean') {
      return false;
    }
    if (metadata.contentFiltered !== undefined && typeof metadata.contentFiltered !== 'boolean') {
      return false;
    }
    if (metadata.toolCalls !== undefined && !Array.isArray(metadata.toolCalls)) {
      return false;
    }
  }

  return true;
}

export function validateSessionState(state: any): state is SessionState {
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.id === 'string' &&
    state.id.trim().length > 0 &&
    ['active', 'idle', 'ended'].includes(state.status) &&
    typeof state.createdAt === 'number' &&
    state.createdAt > 0 &&
    typeof state.lastActivity === 'number' &&
    state.lastActivity > 0 &&
    state.lastActivity >= state.createdAt &&
    (state.userId === undefined || typeof state.userId === 'string')
  );
}

export function validateConversationMemory(memory: any): memory is ConversationMemory {
  if (typeof memory !== 'object' || memory === null) {
    return false;
  }

  return (
    typeof memory.sessionId === 'string' &&
    memory.sessionId.trim().length > 0 &&
    Array.isArray(memory.messages) &&
    memory.messages.every((msg: any) => validateChatMessage(msg)) &&
    typeof memory.summary === 'string' &&
    typeof memory.context === 'object' &&
    memory.context !== null &&
    typeof memory.lastSummaryAt === 'number' &&
    memory.lastSummaryAt >= 0 &&
    typeof memory.ttl === 'number' &&
    memory.ttl > 0
  );
}

export function validateToolCall(toolCall: any): toolCall is ToolCall {
  return (
    typeof toolCall === 'object' &&
    toolCall !== null &&
    typeof toolCall.id === 'string' &&
    toolCall.id.trim().length > 0 &&
    typeof toolCall.name === 'string' &&
    toolCall.name.trim().length > 0 &&
    typeof toolCall.parameters === 'object' &&
    toolCall.parameters !== null
  );
}

export function validateAPIRequest(request: any): request is APIRequest {
  return (
    typeof request === 'object' &&
    request !== null &&
    typeof request.sessionId === 'string' &&
    request.sessionId.trim().length > 0 &&
    typeof request.message === 'string' &&
    request.message.trim().length > 0 &&
    (request.context === undefined || typeof request.context === 'object') &&
    (request.tools === undefined || Array.isArray(request.tools))
  );
}

export function validateWorkflowStep(step: any): step is WorkflowStep {
  return (
    typeof step === 'object' &&
    step !== null &&
    typeof step.id === 'string' &&
    step.id.trim().length > 0 &&
    typeof step.name === 'string' &&
    step.name.trim().length > 0 &&
    typeof step.retryCount === 'number' &&
    step.retryCount >= 0 &&
    ['pending', 'running', 'completed', 'failed'].includes(step.status)
  );
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function generateWorkflowId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// Data sanitization functions
export function sanitizeMessage(content: string): string {
  // Basic XSS prevention
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

export function createErrorResponse(
  code: string,
  message: string,
  requestId: string,
  details?: any,
  retryable: boolean = false,
  fallbackAvailable: boolean = false
): ErrorResponse {
  return {
    error: {
      code,
      message,
      details,
      retryable,
      fallbackAvailable
    },
    requestId,
    timestamp: Date.now()
  };
}

export function createSuccessResponse(data: any, requestId: string): APIResponse {
  return {
    success: true,
    data,
    requestId,
    timestamp: Date.now()
  };
}

export function createFailureResponse(error: ErrorResponse): APIResponse {
  return {
    success: false,
    error,
    requestId: error.requestId,
    timestamp: error.timestamp
  };
}

// Type guards for runtime type checking
export function isValidSessionStatus(status: string): status is SessionStatus {
  return ['active', 'idle', 'ended'].includes(status);
}

export function isValidTicketStatus(status: string): status is TicketStatus {
  return ['open', 'in_progress', 'resolved', 'closed'].includes(status);
}

export function isValidMessageRole(role: string): role is 'user' | 'assistant' {
  return ['user', 'assistant'].includes(role);
}

export function isValidWorkflowStepStatus(status: string): status is 'pending' | 'running' | 'completed' | 'failed' {
  return ['pending', 'running', 'completed', 'failed'].includes(status);
}

// Logging and Monitoring Types

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  requestId: string;
  sessionId?: string;
  userId?: string;
  component: string;
  metadata?: Record<string, any>;
  latency?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface MetricEntry {
  name: string;
  type: 'counter' | 'histogram' | 'gauge';
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
  requestId?: string;
}

export interface SystemMetrics {
  requestLatency: HistogramMetric;
  errorRate: CounterMetric;
  activeConnections: GaugeMetric;
  aiTokenUsage: CounterMetric;
  toolExecutionTime: HistogramMetric;
  memoryUsage: GaugeMetric;
  rateLimitHits: CounterMetric;
}

export interface HistogramMetric {
  name: string;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface CounterMetric {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface GaugeMetric {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: AlertCondition;
  threshold: number;
  duration: number; // in seconds
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  lastTriggered?: number;
}

export interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  aggregation: 'avg' | 'sum' | 'max' | 'min' | 'count';
  timeWindow: number; // in seconds
}

export interface Alert {
  id: string;
  ruleId: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  value: number;
  threshold: number;
  resolved: boolean;
  resolvedAt?: number;
}

export interface HealthCheck {
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  latency?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  components: HealthCheck[];
  uptime: number;
  version?: string;
}
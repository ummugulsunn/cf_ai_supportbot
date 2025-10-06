// Security and rate limiting module for AI Support Bot
import { WorkerBindings } from './types';

export interface SecurityConfig {
  rateLimiting: {
    requestsPerMinute: number;
    tokensPerHour: number;
    concurrentSessions: number;
    burstAllowance: number;
  };
  piiDetection: {
    enabled: boolean;
    patterns: PIIPattern[];
    redactionChar: string;
  };
  contentFiltering: {
    enabled: boolean;
    maxMessageLength: number;
    blockedPatterns: string[];
  };
}

export interface PIIPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  reason?: string;
}

export interface SecurityContext {
  requestId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

export interface PIIDetectionResult {
  hasPII: boolean;
  detectedTypes: string[];
  filteredContent: string;
  originalContent: string;
}

export interface ContentFilterResult {
  allowed: boolean;
  filteredContent: string;
  violations: string[];
}

// Default security configuration
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  rateLimiting: {
    requestsPerMinute: 30,
    tokensPerHour: 10000,
    concurrentSessions: 5,
    burstAllowance: 10
  },
  piiDetection: {
    enabled: true,
    patterns: [
      {
        name: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: '[EMAIL_REDACTED]'
      },
      {
        name: 'phone',
        pattern: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
        replacement: '[PHONE_REDACTED]'
      },
      {
        name: 'ssn',
        pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
        replacement: '[SSN_REDACTED]'
      },
      {
        name: 'credit_card',
        pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
        replacement: '[CARD_REDACTED]'
      },
      {
        name: 'ip_address',
        pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
        replacement: '[IP_REDACTED]'
      }
    ],
    redactionChar: '*'
  },
  contentFiltering: {
    enabled: true,
    maxMessageLength: 4000,
    blockedPatterns: [
      'prompt injection',
      'ignore previous instructions',
      'system prompt',
      'jailbreak',
      'roleplay as'
    ]
  }
};

export class SecurityManager {
  private config: SecurityConfig;
  private env: WorkerBindings;

  constructor(env: WorkerBindings, config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
    this.env = env;
    this.config = config;
  }

  /**
   * Check rate limits for a session
   */
  async checkRateLimit(
    sessionId: string,
    context: SecurityContext
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const minuteKey = `rate_limit:${sessionId}:${Math.floor(now / 60000)}`;
    const hourKey = `rate_limit:${sessionId}:${Math.floor(now / 3600000)}`;
    const sessionKey = `active_sessions:${sessionId}`;

    try {
      // Check requests per minute
      const minuteCount = await this.env.CHAT_KV.get(minuteKey);
      const currentMinuteRequests = minuteCount ? parseInt(minuteCount) : 0;

      if (currentMinuteRequests >= this.config.rateLimiting.requestsPerMinute) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: Math.ceil(now / 60000) * 60000,
          reason: 'Rate limit exceeded: too many requests per minute'
        };
      }

      // Check tokens per hour (approximate based on requests)
      const hourCount = await this.env.CHAT_KV.get(hourKey);
      const currentHourRequests = hourCount ? parseInt(hourCount) : 0;
      const estimatedTokens = currentHourRequests * 500; // Rough estimate

      if (estimatedTokens >= this.config.rateLimiting.tokensPerHour) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: Math.ceil(now / 3600000) * 3600000,
          reason: 'Rate limit exceeded: token limit reached'
        };
      }

      // Update counters
      await Promise.all([
        this.env.CHAT_KV.put(minuteKey, (currentMinuteRequests + 1).toString(), {
          expirationTtl: 120 // 2 minutes
        }),
        this.env.CHAT_KV.put(hourKey, (currentHourRequests + 1).toString(), {
          expirationTtl: 7200 // 2 hours
        }),
        this.env.CHAT_KV.put(sessionKey, now.toString(), {
          expirationTtl: 3600 // 1 hour
        })
      ]);

      return {
        allowed: true,
        remaining: this.config.rateLimiting.requestsPerMinute - currentMinuteRequests - 1,
        resetTime: Math.ceil(now / 60000) * 60000
      };

    } catch (error) {
      console.error('Rate limit check failed:', error);
      // Fail open - allow request if rate limiting fails
      return {
        allowed: true,
        remaining: this.config.rateLimiting.requestsPerMinute,
        resetTime: Math.ceil(now / 60000) * 60000
      };
    }
  }

  /**
   * Detect and filter PII from content
   */
  detectAndFilterPII(content: string): PIIDetectionResult {
    if (!this.config.piiDetection.enabled) {
      return {
        hasPII: false,
        detectedTypes: [],
        filteredContent: content,
        originalContent: content
      };
    }

    let filteredContent = content;
    const detectedTypes: string[] = [];

    for (const pattern of this.config.piiDetection.patterns) {
      if (pattern.pattern.test(content)) {
        detectedTypes.push(pattern.name);
        filteredContent = filteredContent.replace(pattern.pattern, pattern.replacement);
      }
    }

    return {
      hasPII: detectedTypes.length > 0,
      detectedTypes,
      filteredContent,
      originalContent: content
    };
  }

  /**
   * Filter content for security violations
   */
  filterContent(content: string): ContentFilterResult {
    if (!this.config.contentFiltering.enabled) {
      return {
        allowed: true,
        filteredContent: content,
        violations: []
      };
    }

    const violations: string[] = [];
    let filteredContent = content;

    // Check message length
    if (content.length > this.config.contentFiltering.maxMessageLength) {
      violations.push('Message too long');
      filteredContent = content.substring(0, this.config.contentFiltering.maxMessageLength);
    }

    // Check for blocked patterns
    for (const pattern of this.config.contentFiltering.blockedPatterns) {
      const regex = new RegExp(pattern, 'gi');
      if (regex.test(content)) {
        violations.push(`Blocked pattern: ${pattern}`);
        filteredContent = filteredContent.replace(regex, '[FILTERED]');
      }
    }

    return {
      allowed: violations.length === 0,
      filteredContent,
      violations
    };
  }

  /**
   * Sanitize input to prevent XSS and injection attacks
   */
  sanitizeInput(input: string): string {
    // Basic HTML entity encoding
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim();
  }

  /**
   * Log security events
   */
  async logSecurityEvent(
    event: string,
    context: SecurityContext,
    details?: Record<string, any>
  ): Promise<void> {
    const logEntry = {
      timestamp: Date.now(),
      requestId: context.requestId,
      sessionId: context.sessionId,
      event,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: details || {}
    };

    try {
      // Store in KV for short-term access
      const logKey = `security_log:${context.requestId}`;
      await this.env.CHAT_KV.put(logKey, JSON.stringify(logEntry), {
        expirationTtl: 86400 // 24 hours
      });

      // Also log to console for immediate visibility
      console.log('Security Event:', JSON.stringify(logEntry));
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  /**
   * Comprehensive security check for incoming requests
   */
  async performSecurityCheck(
    content: string,
    sessionId: string,
    context: SecurityContext
  ): Promise<{
    allowed: boolean;
    filteredContent: string;
    rateLimitResult: RateLimitResult;
    piiResult: PIIDetectionResult;
    contentResult: ContentFilterResult;
    violations: string[];
  }> {
    // Check rate limits
    const rateLimitResult = await this.checkRateLimit(sessionId, context);
    
    // Sanitize input
    const sanitizedContent = this.sanitizeInput(content);
    
    // Detect and filter PII
    const piiResult = this.detectAndFilterPII(sanitizedContent);
    
    // Filter content
    const contentResult = this.filterContent(piiResult.filteredContent);
    
    const violations: string[] = [];
    
    if (!rateLimitResult.allowed) {
      violations.push(rateLimitResult.reason || 'Rate limit exceeded');
    }
    
    if (!contentResult.allowed) {
      violations.push(...contentResult.violations);
    }
    
    const allowed = rateLimitResult.allowed && contentResult.allowed;
    
    // Log security events
    if (piiResult.hasPII) {
      await this.logSecurityEvent('PII_DETECTED', context, {
        detectedTypes: piiResult.detectedTypes
      });
    }
    
    if (!allowed) {
      await this.logSecurityEvent('REQUEST_BLOCKED', context, {
        violations,
        rateLimitExceeded: !rateLimitResult.allowed,
        contentViolations: contentResult.violations
      });
    }
    
    return {
      allowed,
      filteredContent: contentResult.filteredContent,
      rateLimitResult,
      piiResult,
      contentResult,
      violations
    };
  }
}

/**
 * Extract security context from request
 */
export function extractSecurityContext(
  request: Request,
  requestId: string,
  sessionId: string
): SecurityContext {
  return {
    requestId,
    sessionId,
    ipAddress: request.headers.get('CF-Connecting-IP') || 
               request.headers.get('X-Forwarded-For') || 
               'unknown',
    userAgent: request.headers.get('User-Agent') || 'unknown',
    timestamp: Date.now()
  };
}
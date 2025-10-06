// Example of how to integrate the tool system with the AI Support Bot

import { toolRegistry, ToolRegistry } from './tool_registry.js';
import { ToolContext } from './tools.js';

/**
 * Example function showing how to integrate tools with AI responses
 */
export async function processMessageWithTools(
  message: string,
  sessionId: string,
  bindings: any,
  userId?: string,
  conversationContext?: any
): Promise<{
  response: string;
  toolResults?: any[];
  updatedContext?: any;
}> {
  // Create tool context
  const toolContext: ToolContext = ToolRegistry.createToolContext(
    sessionId,
    bindings,
    userId,
    conversationContext
  );

  // Example: Detect if user is asking for knowledge base search
  if (message.toLowerCase().includes('search') || message.toLowerCase().includes('documentation')) {
    const searchQuery = extractSearchQuery(message);
    if (searchQuery) {
      const result = await toolRegistry.executeTool(
        'kb.search',
        { query: searchQuery, maxResults: 3 },
        toolContext
      );

      if (result.success) {
        const articles = result.data.results;
        const response = formatSearchResults(articles);
        return {
          response,
          toolResults: [result],
          updatedContext: toolContext.conversationContext
        };
      }
    }
  }

  // Example: Detect if user wants to create a ticket
  if (message.toLowerCase().includes('create ticket') || message.toLowerCase().includes('report issue')) {
    const issueData = extractIssueData(message);
    if (issueData) {
      const result = await toolRegistry.executeTool(
        'ticketing',
        {
          action: 'create',
          ticketData: issueData
        },
        toolContext
      );

      if (result.success) {
        const ticket = result.data;
        const response = `I've created ticket ${ticket.ticketId} for you. Your issue "${ticket.status.title}" has been assigned priority ${ticket.status.priority} and is currently ${ticket.status.status}. Estimated resolution: ${new Date(ticket.estimatedResolution).toLocaleDateString()}.`;
        return {
          response,
          toolResults: [result],
          updatedContext: toolContext.conversationContext
        };
      }
    }
  }

  // Example: Check ticket status
  const ticketIdMatch = message.match(/ticket\s+([A-Z0-9-]+)/i);
  if (ticketIdMatch) {
    const ticketId = ticketIdMatch[1];
    const result = await toolRegistry.executeTool(
      'ticketing',
      {
        action: 'status',
        ticketId
      },
      toolContext
    );

    if (result.success) {
      const ticket = result.data;
      const response = `Ticket ${ticket.status.id} status: ${ticket.status.status}. Priority: ${ticket.status.priority}. Last updated: ${new Date(ticket.status.updatedAt).toLocaleDateString()}.`;
      return {
        response,
        toolResults: [result],
        updatedContext: toolContext.conversationContext
      };
    } else {
      return {
        response: `I couldn't find ticket ${ticketId}. Please check the ticket ID and try again.`,
        toolResults: [result]
      };
    }
  }

  // Default response when no tools are needed
  return {
    response: "I understand your message. How can I help you further? I can search our knowledge base or help you create a support ticket if needed."
  };
}

/**
 * Get available tools for AI model function calling
 */
export function getToolsForAI(): any[] {
  return toolRegistry.getToolSchema();
}

/**
 * Execute a tool call from AI model
 */
export async function executeAIToolCall(
  toolName: string,
  parameters: any,
  sessionId: string,
  bindings: any,
  userId?: string,
  conversationContext?: any
): Promise<any> {
  const toolContext = ToolRegistry.createToolContext(
    sessionId,
    bindings,
    userId,
    conversationContext
  );

  return await toolRegistry.executeTool(toolName, parameters, toolContext);
}

// Helper functions for parsing user messages
function extractSearchQuery(message: string): string | null {
  // Simple extraction - in a real implementation, this would be more sophisticated
  const searchMatch = message.match(/search\s+(?:for\s+)?(.+)/i);
  if (searchMatch) {
    return searchMatch[1].trim();
  }
  
  // Look for question words that might indicate a search
  if (message.includes('how') || message.includes('what') || message.includes('where')) {
    return message;
  }
  
  return null;
}

function extractIssueData(message: string): any | null {
  // Simple extraction - in a real implementation, this would use NLP
  const titleMatch = message.match(/(?:issue|problem|error):\s*(.+)/i);
  const title = titleMatch ? titleMatch[1] : message.substring(0, 100);
  
  // Determine priority based on keywords
  let priority = 'medium';
  if (message.toLowerCase().includes('urgent') || message.toLowerCase().includes('critical')) {
    priority = 'urgent';
  } else if (message.toLowerCase().includes('high')) {
    priority = 'high';
  } else if (message.toLowerCase().includes('low')) {
    priority = 'low';
  }
  
  return {
    title: title.trim(),
    description: message,
    priority,
    category: 'general'
  };
}

function formatSearchResults(articles: any[]): string {
  if (articles.length === 0) {
    return "I couldn't find any relevant articles in our knowledge base. Would you like me to create a support ticket for you?";
  }
  
  let response = "I found these relevant articles:\n\n";
  articles.forEach((article, index) => {
    response += `${index + 1}. **${article.title}**\n`;
    response += `   ${article.content.substring(0, 150)}...\n`;
    if (article.url) {
      response += `   [Read more](${article.url})\n`;
    }
    response += '\n';
  });
  
  response += "Would you like me to search for something else or help you with a specific issue?";
  return response;
}
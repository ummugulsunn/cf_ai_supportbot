// Example of integrating workflows with the API worker
import { WorkflowService } from './workflow_service';
import { ConversationContext, ChatMessage, WorkerBindings } from './types';

// Example function showing how to integrate workflows into the API worker
export async function handleComplexUserQuery(
  message: ChatMessage,
  context: ConversationContext,
  bindings: WorkerBindings
): Promise<{ response: string; workflowExecuted?: boolean; executionId?: string }> {
  
  const workflowService = new WorkflowService(bindings);
  
  // Determine if the query requires workflow orchestration
  const requiresWorkflow = shouldUseWorkflow(message.content);
  
  if (requiresWorkflow) {
    try {
      console.log(`Executing workflow for complex query: ${message.content}`);
      
      // Execute the complex query workflow
      const workflowResult = await workflowService.processComplexQuery(
        message.content,
        context
      );
      
      if (workflowResult.success) {
        return {
          response: formatWorkflowResponse(workflowResult),
          workflowExecuted: true,
          executionId: workflowResult.executionId
        };
      } else {
        // Fallback to simple AI response if workflow fails
        console.warn(`Workflow failed: ${workflowResult.error}, falling back to simple AI`);
        return await handleSimpleQuery(message, bindings);
      }
    } catch (error) {
      console.error('Workflow execution error:', error);
      // Fallback to simple AI response
      return await handleSimpleQuery(message, bindings);
    }
  } else {
    // Handle simple queries without workflow
    return await handleSimpleQuery(message, bindings);
  }
}

// Example function for handling escalations
export async function handleEscalation(
  issue: string,
  context: ConversationContext,
  bindings: WorkerBindings,
  priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium'
): Promise<{ ticketId?: string; escalated: boolean; executionId?: string }> {
  
  const workflowService = new WorkflowService(bindings);
  
  try {
    console.log(`Escalating issue: ${issue} with priority: ${priority}`);
    
    const escalationResult = await workflowService.handleEscalation({
      issue,
      context,
      title: `Support Request: ${issue.substring(0, 50)}...`,
      description: issue,
      priority,
      category: 'general'
    });
    
    if (escalationResult.success && escalationResult.result) {
      return {
        ticketId: escalationResult.result.ticketId,
        escalated: true,
        executionId: escalationResult.executionId
      };
    } else {
      console.error(`Escalation workflow failed: ${escalationResult.error}`);
      return { escalated: false };
    }
  } catch (error) {
    console.error('Escalation error:', error);
    return { escalated: false };
  }
}

// Example function for executing tool chains
export async function executeToolChain(
  tools: Array<{ name: string; parameters: any }>,
  context: ConversationContext,
  bindings: WorkerBindings
): Promise<{ results: any[]; success: boolean; executionId?: string }> {
  
  const workflowService = new WorkflowService(bindings);
  
  try {
    const toolCalls = tools.map((tool, index) => ({
      id: `tool_${index}`,
      name: tool.name,
      parameters: tool.parameters
    }));
    
    console.log(`Executing tool chain with ${toolCalls.length} tools`);
    
    const chainResult = await workflowService.executeToolChain(toolCalls);
    
    if (chainResult.success) {
      return {
        results: extractToolResults(chainResult.result),
        success: true,
        executionId: chainResult.executionId
      };
    } else {
      console.error(`Tool chain workflow failed: ${chainResult.error}`);
      return { results: [], success: false };
    }
  } catch (error) {
    console.error('Tool chain execution error:', error);
    return { results: [], success: false };
  }
}

// Helper functions
function shouldUseWorkflow(query: string): boolean {
  const complexityIndicators = [
    'help me with',
    'i need to',
    'can you help',
    'multiple',
    'several',
    'both',
    'also',
    'and also',
    'as well as'
  ];
  
  const lowerQuery = query.toLowerCase();
  const wordCount = query.split(' ').length;
  
  // Use workflow for longer queries or those with complexity indicators
  return wordCount > 15 || complexityIndicators.some(indicator => 
    lowerQuery.includes(indicator)
  );
}

async function handleSimpleQuery(
  message: ChatMessage,
  bindings: WorkerBindings
): Promise<{ response: string; workflowExecuted: boolean }> {
  try {
    const aiResponse = await bindings.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8', {
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant. Provide clear, concise responses.'
        },
        {
          role: 'user',
          content: message.content
        }
      ],
      max_tokens: 500
    });
    
    return {
      response: aiResponse.response || 'I apologize, but I was unable to process your request.',
      workflowExecuted: false
    };
  } catch (error) {
    console.error('Simple AI query failed:', error);
    return {
      response: 'I apologize, but I\'m experiencing technical difficulties. Please try again later.',
      workflowExecuted: false
    };
  }
}

function formatWorkflowResponse(workflowResult: any): string {
  if (workflowResult.result && workflowResult.result.response) {
    return workflowResult.result.response;
  }
  
  // Fallback formatting
  return `I've processed your request using our advanced workflow system. ` +
         `The operation completed successfully in ${workflowResult.metadata.duration}ms ` +
         `with ${workflowResult.metadata.stepsCompleted} steps.`;
}

function extractToolResults(workflowResult: any): any[] {
  // Extract results from workflow execution
  if (Array.isArray(workflowResult)) {
    return workflowResult;
  }
  
  if (workflowResult && workflowResult.data) {
    return Array.isArray(workflowResult.data) ? workflowResult.data : [workflowResult.data];
  }
  
  return [workflowResult];
}

// Example usage in API worker
export async function processMessage(
  message: ChatMessage,
  context: ConversationContext,
  bindings: WorkerBindings
): Promise<ChatMessage> {
  
  // Handle the message with potential workflow execution
  const result = await handleComplexUserQuery(message, context, bindings);
  
  // Create response message
  const responseMessage: ChatMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    sessionId: message.sessionId,
    content: result.response,
    role: 'assistant',
    timestamp: Date.now(),
    metadata: {
      workflowExecuted: result.workflowExecuted,
      executionId: result.executionId
    }
  };
  
  return responseMessage;
}

// Example of workflow status checking
export async function getWorkflowStatus(
  executionId: string,
  bindings: WorkerBindings
): Promise<{ status: string; progress?: number; error?: string }> {
  
  // In a real implementation, this would query the workflow execution status
  // For now, return a mock status
  return {
    status: 'completed',
    progress: 100
  };
}

// Example of workflow cancellation
export async function cancelWorkflow(
  executionId: string,
  bindings: WorkerBindings
): Promise<{ cancelled: boolean; error?: string }> {
  
  // In a real implementation, this would cancel the workflow execution
  // For now, return a mock response
  console.log(`Cancelling workflow: ${executionId}`);
  
  return {
    cancelled: true
  };
}
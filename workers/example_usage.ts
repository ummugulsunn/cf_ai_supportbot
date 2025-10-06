// Example usage of the SessionMemoryDO
import { SessionMemoryDO } from './do_memory';
import { ChatMessage, generateMessageId, generateSessionId } from './types';

// Example of how to use the SessionMemoryDO in a Worker
export async function exampleUsage(memoryDO: SessionMemoryDO) {
  const sessionId = generateSessionId();
  
  // Example 1: Add a user message
  const userMessage: ChatMessage = {
    id: generateMessageId(),
    sessionId: sessionId,
    content: 'Hello, I need help with my billing account',
    role: 'user',
    timestamp: Date.now()
  };
  
  // Add message via HTTP request
  const addMessageRequest = new Request(`http://localhost/session/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'addMessage',
      message: userMessage
    })
  });
  
  await memoryDO.fetch(addMessageRequest);
  
  // Example 2: Add an assistant response
  const assistantMessage: ChatMessage = {
    id: generateMessageId(),
    sessionId: sessionId,
    content: 'I can help you with your billing questions. What specific issue are you experiencing?',
    role: 'assistant',
    timestamp: Date.now() + 1000
  };
  
  const addResponseRequest = new Request(`http://localhost/session/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'addMessage',
      message: assistantMessage
    })
  });
  
  await memoryDO.fetch(addResponseRequest);
  
  // Example 3: Get conversation context
  const contextRequest = new Request(`http://localhost/session/${sessionId}?action=context`, {
    method: 'GET'
  });
  
  const contextResponse = await memoryDO.fetch(contextRequest);
  const context = await contextResponse.json();
  
  console.log('Conversation context:', {
    sessionId: (context as any).sessionId,
    summary: (context as any).summary,
    messageCount: (context as any).recentMessages.length,
    topics: (context as any).activeTopics
  });
  
  // Example 4: Generate summary
  const summaryRequest = new Request(`http://localhost/session/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generateSummary'
    })
  });
  
  const summaryResponse = await memoryDO.fetch(summaryRequest);
  const summaryData = await summaryResponse.json();
  
  console.log('Generated summary:', (summaryData as any).summary);
  
  // Example 5: Get recent messages
  const messagesRequest = new Request(`http://localhost/session/${sessionId}?action=messages&limit=10`, {
    method: 'GET'
  });
  
  const messagesResponse = await memoryDO.fetch(messagesRequest);
  const messagesData = await messagesResponse.json();
  
  console.log('Recent messages:', (messagesData as any).messages);
  
  return {
    sessionId,
    context,
    summary: (summaryData as any).summary,
    messages: (messagesData as any).messages
  };
}

// Example of how this would be integrated into a main Worker
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    
    // Route to memory DO
    if (url.pathname.startsWith('/memory/')) {
      const sessionId = url.pathname.split('/')[2];
      const doId = env.MEMORY_DO.idFromName(sessionId);
      const doStub = env.MEMORY_DO.get(doId);
      
      // Forward request to DO
      return doStub.fetch(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
} satisfies ExportedHandler;
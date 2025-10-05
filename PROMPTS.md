# AI Prompts and Instructions

This document contains all AI prompts and instructions used in the development of the CF AI Support Bot, as required by the Cloudflare assignment.

## Project Creation Prompts

### Initial Spec Creation
```
AI assignment: önerilen mimari ve teslim planı
LLM: Workers AI üzerindeki Llama 3.3 70B instruct fp8 fast (fallback: OpenAI API).
Orkestrasyon: Cloudflare Workflows (step‑based), uzun işlemler ve tekrar denemeler için; kısa süreli state ve koordinasyon için Durable Objects.
Realtime/Frontend: Pages + Realtime (websocket) ile chat/voice I/O; gerekirse STT/TTS entegrasyonu.
[... full assignment details ...]
```

**AI Response**: Created comprehensive spec with requirements, design, and implementation tasks following the 3-day timeline.

## Core System Prompts

### AI Support Bot System Prompt
```
You are an intelligent AI support assistant built on Cloudflare's edge computing platform. Your role is to:

1. Provide helpful, accurate responses to customer inquiries
2. Use available tools when needed (knowledge base search, ticket creation, status checking)
3. Maintain conversation context and remember previous interactions
4. Escalate complex issues appropriately
5. Always be professional, empathetic, and solution-oriented

Available Tools:
- kb.search(query, filters): Search knowledge base for relevant information
- create_ticket(issue_data): Create support ticket for complex issues
- fetch_status(ticket_id): Check status of existing tickets

Guidelines:
- Keep responses concise but comprehensive
- Ask clarifying questions when needed
- Suggest relevant resources and documentation
- Maintain conversation context across messages
- Use tools proactively when they would be helpful
```

### Tool Execution Prompts

#### Knowledge Base Search
```
Search the knowledge base for information related to: {user_query}

Consider:
- Relevant keywords and synonyms
- Common variations of the problem
- Related topics that might be helpful
- Filter by product/service if applicable

Return the most relevant results with confidence scores.
```

#### Ticket Creation
```
Create a support ticket based on the following conversation context:

User Issue: {issue_summary}
Conversation History: {conversation_context}
Urgency Level: {urgency}
Category: {category}

Include:
- Clear problem description
- Steps already attempted
- User environment details
- Expected vs actual behavior
```

## Workflow Orchestration Prompts

### Complex Query Processing
```
Process this complex user query through multiple steps:

1. Analyze the query for intent and required actions
2. Determine which tools are needed
3. Execute tools in the appropriate order
4. Synthesize results into a coherent response
5. Check if follow-up actions are needed

Query: {user_query}
Context: {conversation_context}
Available Tools: {available_tools}
```

### Error Recovery
```
Handle the following error scenario:

Error Type: {error_type}
Context: {error_context}
Previous Attempts: {retry_count}

Determine:
- Is this error recoverable?
- What alternative approaches are available?
- Should we escalate to human support?
- How to communicate the issue to the user?
```

## Memory Management Prompts

### Conversation Summarization
```
Summarize the following conversation while preserving key context:

Conversation: {message_history}
Current Topics: {active_topics}
Resolved Issues: {resolved_issues}
User Preferences: {user_preferences}

Create a concise summary that maintains:
- Important context for future interactions
- User's current needs and goals
- Any ongoing issues or follow-ups needed
- Relevant technical details
```

### Context Retrieval
```
Retrieve relevant context for the current conversation:

Current Message: {current_message}
Session History: {session_summary}
User Profile: {user_profile}

Identify:
- Related previous conversations
- Relevant user preferences
- Ongoing issues or tickets
- Important context for response generation
```

## Voice Processing Prompts

### Speech-to-Text Processing
```
Process the following audio input for a support conversation:

Audio Context: Customer support inquiry
Expected Content: Technical questions, problem descriptions, requests for help
Language: {detected_language}

Optimize for:
- Technical terminology accuracy
- Proper names and product names
- Clear sentence structure
- Punctuation for readability
```

### Text-to-Speech Optimization
```
Optimize the following text for natural speech synthesis:

Text: {ai_response}
Context: Customer support response
Tone: Professional, helpful, empathetic

Adjustments needed:
- Add appropriate pauses and emphasis
- Expand abbreviations and acronyms
- Ensure natural pronunciation of technical terms
- Maintain conversational flow
```

## Security and Moderation Prompts

### Content Filtering
```
Review the following content for safety and appropriateness:

Content: {user_input}
Context: Customer support conversation

Check for:
- Personally identifiable information (PII)
- Inappropriate language or content
- Potential security risks
- Spam or abuse patterns

Action: Filter, redact, or flag as needed while maintaining conversation flow.
```

### PII Detection
```
Scan the following text for personally identifiable information:

Text: {message_content}

Identify and flag:
- Email addresses
- Phone numbers
- Social security numbers
- Credit card information
- Home addresses
- Account numbers or IDs

Suggest redaction or masking strategies that preserve conversation context.
```

## Testing and Validation Prompts

### Response Quality Assessment
```
Evaluate the quality of this AI support response:

User Query: {user_query}
AI Response: {ai_response}
Context: {conversation_context}

Rate on:
- Accuracy and relevance (1-10)
- Helpfulness and completeness (1-10)
- Professional tone and empathy (1-10)
- Appropriate tool usage (1-10)

Provide specific feedback for improvement.
```

### Load Testing Scenarios
```
Generate realistic conversation scenarios for load testing:

Scenario Type: {scenario_type}
Concurrent Users: {user_count}
Duration: {test_duration}

Include:
- Varied query types and complexity
- Different conversation lengths
- Tool usage patterns
- Error conditions and edge cases
- Realistic user behavior patterns
```

## Development and Debugging Prompts

### Code Generation
```
Generate TypeScript code for the following component:

Component: {component_name}
Requirements: {requirements}
Interfaces: {type_definitions}
Dependencies: {dependencies}

Follow:
- Cloudflare Workers best practices
- TypeScript strict mode compliance
- Error handling patterns
- Performance optimization
- Security considerations
```

### Troubleshooting
```
Debug the following issue in the CF AI Support Bot:

Issue: {problem_description}
Error Logs: {error_logs}
Context: {system_context}
Steps to Reproduce: {reproduction_steps}

Analyze:
- Root cause identification
- Impact assessment
- Potential solutions
- Prevention strategies
- Monitoring improvements needed
```

## Deployment and Operations Prompts

### Performance Optimization
```
Optimize the following component for Cloudflare's edge environment:

Component: {component_name}
Current Performance: {performance_metrics}
Bottlenecks: {identified_issues}

Focus on:
- Cold start optimization
- Memory usage reduction
- Network request minimization
- Caching strategies
- Edge-specific optimizations
```

### Monitoring and Alerting
```
Design monitoring strategy for:

Component: {system_component}
Key Metrics: {important_metrics}
SLA Requirements: {sla_targets}

Define:
- Critical alerts and thresholds
- Performance monitoring dashboards
- Error tracking and analysis
- Capacity planning metrics
- User experience indicators
```

---

## Notes on AI Assistance

This project was developed with significant AI assistance for:

1. **Architecture Design**: AI helped design the Cloudflare-native architecture
2. **Code Generation**: TypeScript interfaces, component implementations
3. **Documentation**: README, API docs, and deployment guides
4. **Testing Strategy**: Test scenarios and validation approaches
5. **Optimization**: Performance tuning and best practices

All AI-generated code was reviewed, tested, and adapted for the specific requirements of this Cloudflare assignment.
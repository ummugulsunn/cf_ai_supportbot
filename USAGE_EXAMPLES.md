# Usage Examples and Integration Guide

## Table of Contents

- [Quick Start Examples](#quick-start-examples)
- [Frontend Integration](#frontend-integration)
- [Backend Integration](#backend-integration)
- [Tool Development](#tool-development)
- [Workflow Integration](#workflow-integration)
- [Advanced Usage Patterns](#advanced-usage-patterns)
- [Testing Examples](#testing-examples)
- [Production Deployment](#production-deployment)

## Quick Start Examples

### 1. Basic Chat Integration

#### Simple HTML/JavaScript Client

```html
<!DOCTYPE html>
<html>
<head>
    <title>AI Support Bot - Simple Integration</title>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        <input type="text" id="message-input" placeholder="Type your message...">
        <button onclick="sendMessage()">Send</button>
    </div>

    <script>
        let sessionId = null;
        let ws = null;

        // Initialize chat session
        async function initializeChat() {
            try {
                const response = await fetch('/api/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        metadata: { language: 'en-US' }
                    })
                });
                
                const session = await response.json();
                sessionId = session.sessionId;
                
                // Connect WebSocket
                connectWebSocket();
            } catch (error) {
                console.error('Failed to initialize chat:', error);
            }
        }

        // WebSocket connection
        function connectWebSocket() {
            const wsUrl = `wss://${window.location.host}/ws?sessionId=${sessionId}`;
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                addMessage('System', 'Connected to AI Support Bot');
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected');
                // Implement reconnection logic
                setTimeout(connectWebSocket, 5000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        // Handle WebSocket messages
        function handleWebSocketMessage(data) {
            switch (data.type) {
                case 'ai_response':
                    addMessage('AI', data.data.content);
                    if (data.data.toolCalls) {
                        showToolCalls(data.data.toolCalls);
                    }
                    break;
                case 'ai_typing':
                    showTypingIndicator(data.data.isTyping);
                    break;
                case 'error':
                    addMessage('Error', data.data.message);
                    break;
            }
        }

        // Send message
        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            
            if (!message || !ws) return;
            
            addMessage('You', message);
            
            ws.send(JSON.stringify({
                type: 'chat_message',
                data: {
                    content: message,
                    sessionId: sessionId
                }
            }));
            
            input.value = '';
        }

        // Add message to chat
        function addMessage(sender, content) {
            const messages = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.innerHTML = `<strong>${sender}:</strong> ${content}`;
            messages.appendChild(messageDiv);
            messages.scrollTop = messages.scrollHeight;
        }

        // Show tool calls
        function showToolCalls(toolCalls) {
            toolCalls.forEach(call => {
                addMessage('Tool', `Used ${call.tool}: ${JSON.stringify(call.result)}`);
            });
        }

        // Show typing indicator
        function showTypingIndicator(isTyping) {
            const indicator = document.getElementById('typing-indicator') || 
                             document.createElement('div');
            indicator.id = 'typing-indicator';
            indicator.textContent = isTyping ? 'AI is typing...' : '';
            
            if (isTyping && !indicator.parentNode) {
                document.getElementById('messages').appendChild(indicator);
            } else if (!isTyping && indicator.parentNode) {
                indicator.remove();
            }
        }

        // Initialize on page load
        window.onload = initializeChat;
        
        // Send message on Enter key
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    </script>
</body>
</html>
```

#### REST API Integration

```javascript
class AISupportBotClient {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.sessionId = null;
        this.options = {
            timeout: 30000,
            retries: 3,
            ...options
        };
    }

    // Create a new session
    async createSession(metadata = {}) {
        const response = await this.request('/api/session', {
            method: 'POST',
            body: JSON.stringify({ metadata })
        });
        
        this.sessionId = response.sessionId;
        return response;
    }

    // Send a chat message
    async sendMessage(message, options = {}) {
        if (!this.sessionId) {
            throw new Error('No active session. Call createSession() first.');
        }

        return await this.request('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                message,
                sessionId: this.sessionId,
                ...options
            })
        });
    }

    // Search knowledge base
    async searchKnowledgeBase(query, filters = {}) {
        return await this.request('/api/tools/search', {
            method: 'POST',
            body: JSON.stringify({
                query,
                filters,
                sessionId: this.sessionId
            })
        });
    }

    // Create support ticket
    async createTicket(ticketData) {
        return await this.request('/api/tools/ticket', {
            method: 'POST',
            body: JSON.stringify({
                action: 'create',
                ticketData,
                sessionId: this.sessionId
            })
        });
    }

    // Get session information
    async getSession() {
        if (!this.sessionId) return null;
        
        return await this.request(`/api/session/${this.sessionId}`);
    }

    // End session
    async endSession() {
        if (!this.sessionId) return;
        
        const response = await this.request(`/api/session/${this.sessionId}`, {
            method: 'DELETE'
        });
        
        this.sessionId = null;
        return response;
    }

    // Generic request method with retry logic
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        for (let attempt = 1; attempt <= this.options.retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
                
                const response = await fetch(url, {
                    ...config,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(`API Error: ${error.error?.message || response.statusText}`);
                }
                
                return await response.json();
            } catch (error) {
                if (attempt === this.options.retries) {
                    throw error;
                }
                
                // Exponential backoff
                await new Promise(resolve => 
                    setTimeout(resolve, Math.pow(2, attempt) * 1000)
                );
            }
        }
    }
}

// Usage example
const client = new AISupportBotClient('https://your-worker.your-subdomain.workers.dev');

async function example() {
    try {
        // Create session
        const session = await client.createSession({
            language: 'en-US',
            userAgent: navigator.userAgent
        });
        console.log('Session created:', session.sessionId);

        // Send message
        const response = await client.sendMessage('Hello, I need help with my account');
        console.log('AI Response:', response.response);

        // Search knowledge base
        const searchResults = await client.searchKnowledgeBase('password reset');
        console.log('Search results:', searchResults.results);

        // Create ticket if needed
        const ticket = await client.createTicket({
            title: 'Account access issue',
            description: 'Cannot log in after password reset',
            priority: 'medium',
            category: 'account'
        });
        console.log('Ticket created:', ticket.ticketId);

    } catch (error) {
        console.error('Error:', error);
    }
}
```

### 2. React Integration

```jsx
import React, { useState, useEffect, useRef } from 'react';

const AIChatBot = ({ baseUrl }) => {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    
    const wsRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Initialize session and WebSocket
    useEffect(() => {
        initializeSession();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const initializeSession = async () => {
        try {
            const response = await fetch(`${baseUrl}/api/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadata: { language: 'en-US' }
                })
            });
            
            const session = await response.json();
            setSessionId(session.sessionId);
            connectWebSocket(session.sessionId);
        } catch (error) {
            console.error('Failed to initialize session:', error);
            addMessage('system', 'Failed to connect to AI support bot');
        }
    };

    const connectWebSocket = (sessionId) => {
        const wsUrl = `${baseUrl.replace('http', 'ws')}/ws?sessionId=${sessionId}`;
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
            setIsConnected(true);
            addMessage('system', 'Connected to AI Support Bot');
        };

        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        };

        wsRef.current.onclose = () => {
            setIsConnected(false);
            setIsTyping(false);
            // Implement reconnection logic
            setTimeout(() => connectWebSocket(sessionId), 5000);
        };

        wsRef.current.onerror = (error) => {
            console.error('WebSocket error:', error);
            setIsConnected(false);
        };
    };

    const handleWebSocketMessage = (data) => {
        switch (data.type) {
            case 'ai_response':
                setIsTyping(false);
                addMessage('assistant', data.data.content, {
                    toolCalls: data.data.toolCalls,
                    processingTime: data.data.metadata?.processingTime
                });
                break;
            case 'ai_typing':
                setIsTyping(data.data.isTyping);
                break;
            case 'error':
                setIsTyping(false);
                addMessage('error', data.data.message);
                break;
        }
    };

    const addMessage = (role, content, metadata = {}) => {
        const message = {
            id: Date.now() + Math.random(),
            role,
            content,
            timestamp: new Date(),
            metadata
        };
        setMessages(prev => [...prev, message]);
    };

    const sendMessage = () => {
        if (!inputValue.trim() || !wsRef.current || !isConnected) return;

        const message = inputValue.trim();
        addMessage('user', message);
        setInputValue('');
        setIsTyping(true);

        wsRef.current.send(JSON.stringify({
            type: 'chat_message',
            data: {
                content: message,
                sessionId: sessionId
            }
        }));
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="ai-chatbot">
            <div className="chat-header">
                <h3>AI Support Bot</h3>
                <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
            </div>
            
            <div className="messages-container">
                {messages.map(message => (
                    <MessageBubble key={message.id} message={message} />
                ))}
                {isTyping && <TypingIndicator />}
                <div ref={messagesEndRef} />
            </div>
            
            <div className="input-container">
                <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message..."
                    disabled={!isConnected}
                    rows={1}
                />
                <button 
                    onClick={sendMessage}
                    disabled={!isConnected || !inputValue.trim()}
                >
                    Send
                </button>
            </div>
        </div>
    );
};

const MessageBubble = ({ message }) => {
    const { role, content, timestamp, metadata } = message;
    
    return (
        <div className={`message ${role}`}>
            <div className="message-content">
                {content}
                {metadata.toolCalls && (
                    <div className="tool-calls">
                        {metadata.toolCalls.map((call, index) => (
                            <div key={index} className="tool-call">
                                <span className="tool-name">{call.tool}</span>
                                <span className="tool-result">
                                    {call.result.success ? '✅' : '❌'}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="message-timestamp">
                {timestamp.toLocaleTimeString()}
                {metadata.processingTime && (
                    <span className="processing-time">
                        ({metadata.processingTime}ms)
                    </span>
                )}
            </div>
        </div>
    );
};

const TypingIndicator = () => (
    <div className="typing-indicator">
        <div className="typing-dots">
            <span></span>
            <span></span>
            <span></span>
        </div>
        <span>AI is typing...</span>
    </div>
);

export default AIChatBot;
```

## Frontend Integration

### 1. Voice Integration

```javascript
class VoiceManager {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isSupported = this.checkSupport();
    }

    checkSupport() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }

    initializeRecognition() {
        if (!this.isSupported) return false;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isListening = true;
            this.onListeningStart?.();
        };

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            this.onTranscript?.(finalTranscript, interimTranscript);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.onListeningEnd?.();
        };

        this.recognition.onerror = (event) => {
            this.isListening = false;
            this.onError?.(event.error);
        };

        return true;
    }

    startListening() {
        if (!this.recognition && !this.initializeRecognition()) {
            this.onError?.('Speech recognition not supported');
            return false;
        }

        try {
            this.recognition.start();
            return true;
        } catch (error) {
            this.onError?.(error.message);
            return false;
        }
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    speak(text, options = {}) {
        if (!this.synthesis) {
            this.onError?.('Speech synthesis not supported');
            return false;
        }

        // Cancel any ongoing speech
        this.synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = options.rate || 1;
        utterance.pitch = options.pitch || 1;
        utterance.volume = options.volume || 1;
        utterance.lang = options.lang || 'en-US';

        utterance.onstart = () => this.onSpeechStart?.();
        utterance.onend = () => this.onSpeechEnd?.();
        utterance.onerror = (event) => this.onError?.(event.error);

        this.synthesis.speak(utterance);
        return true;
    }

    stopSpeaking() {
        if (this.synthesis) {
            this.synthesis.cancel();
        }
    }

    // Event handlers (set these from outside)
    onListeningStart = null;
    onListeningEnd = null;
    onTranscript = null;
    onSpeechStart = null;
    onSpeechEnd = null;
    onError = null;
}

// Usage in React component
const VoiceChatBot = () => {
    const [voiceManager] = useState(() => new VoiceManager());
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');

    useEffect(() => {
        voiceManager.onListeningStart = () => setIsListening(true);
        voiceManager.onListeningEnd = () => setIsListening(false);
        voiceManager.onTranscript = (final, interim) => {
            if (final) {
                sendMessage(final);
                setTranscript('');
            } else {
                setTranscript(interim);
            }
        };
        voiceManager.onSpeechStart = () => setIsSpeaking(true);
        voiceManager.onSpeechEnd = () => setIsSpeaking(false);
        voiceManager.onError = (error) => console.error('Voice error:', error);
    }, []);

    const toggleListening = () => {
        if (isListening) {
            voiceManager.stopListening();
        } else {
            voiceManager.startListening();
        }
    };

    const speakResponse = (text) => {
        voiceManager.speak(text);
    };

    return (
        <div className="voice-chat-bot">
            <button 
                className={`voice-button ${isListening ? 'listening' : ''}`}
                onClick={toggleListening}
                disabled={isSpeaking}
            >
                {isListening ? '🎤 Listening...' : '🎤 Click to speak'}
            </button>
            
            {transcript && (
                <div className="transcript-preview">
                    {transcript}
                </div>
            )}
            
            {isSpeaking && (
                <div className="speaking-indicator">
                    🔊 AI is speaking...
                </div>
            )}
        </div>
    );
};
```

### 2. Advanced WebSocket Management

```javascript
class WebSocketManager {
    constructor(url, options = {}) {
        this.url = url;
        this.options = {
            reconnectInterval: 1000,
            maxReconnectAttempts: 5,
            heartbeatInterval: 30000,
            messageTimeout: 10000,
            ...options
        };
        
        this.ws = null;
        this.reconnectAttempts = 0;
        this.isConnected = false;
        this.messageQueue = [];
        this.pendingMessages = new Map();
        this.heartbeatTimer = null;
        
        this.eventHandlers = {
            open: [],
            message: [],
            close: [],
            error: [],
            reconnect: []
        };
    }

    connect() {
        try {
            this.ws = new WebSocket(this.url);
            this.setupEventHandlers();
        } catch (error) {
            this.handleError(error);
        }
    }

    setupEventHandlers() {
        this.ws.onopen = (event) => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.flushMessageQueue();
            this.emit('open', event);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
                this.emit('message', data);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        this.ws.onclose = (event) => {
            this.isConnected = false;
            this.stopHeartbeat();
            this.emit('close', event);
            
            if (!event.wasClean && this.reconnectAttempts < this.options.maxReconnectAttempts) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            this.handleError(error);
            this.emit('error', error);
        };
    }

    handleMessage(data) {
        // Handle pong responses
        if (data.type === 'pong') {
            return;
        }

        // Handle message acknowledgments
        if (data.requestId && this.pendingMessages.has(data.requestId)) {
            const { resolve } = this.pendingMessages.get(data.requestId);
            this.pendingMessages.delete(data.requestId);
            resolve(data);
        }
    }

    send(message, waitForResponse = false) {
        const messageWithId = {
            ...message,
            requestId: this.generateRequestId(),
            timestamp: Date.now()
        };

        if (!this.isConnected) {
            this.messageQueue.push(messageWithId);
            return waitForResponse ? Promise.reject(new Error('Not connected')) : Promise.resolve();
        }

        if (waitForResponse) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.pendingMessages.delete(messageWithId.requestId);
                    reject(new Error('Message timeout'));
                }, this.options.messageTimeout);

                this.pendingMessages.set(messageWithId.requestId, {
                    resolve: (response) => {
                        clearTimeout(timeout);
                        resolve(response);
                    },
                    reject
                });

                this.ws.send(JSON.stringify(messageWithId));
            });
        } else {
            this.ws.send(JSON.stringify(messageWithId));
            return Promise.resolve();
        }
    }

    flushMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            this.ws.send(JSON.stringify(message));
        }
    }

    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected) {
                this.send({ type: 'ping' });
            }
        }, this.options.heartbeatInterval);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    scheduleReconnect() {
        const delay = this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        
        setTimeout(() => {
            this.emit('reconnect', { attempt: this.reconnectAttempts });
            this.connect();
        }, delay);
    }

    close() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
        }
    }

    on(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(handler);
        }
    }

    off(event, handler) {
        if (this.eventHandlers[event]) {
            const index = this.eventHandlers[event].indexOf(handler);
            if (index > -1) {
                this.eventHandlers[event].splice(index, 1);
            }
        }
    }

    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    handleError(error) {
        console.error('WebSocket error:', error);
    }
}
```

## Backend Integration

### 1. Custom Tool Development

```typescript
// Custom tool example: Weather API integration
import { Tool, ToolContext, ToolResult } from './tools';

interface WeatherParams {
    location: string;
    units?: 'metric' | 'imperial';
}

interface WeatherData {
    temperature: number;
    description: string;
    humidity: number;
    windSpeed: number;
}

export class WeatherTool implements Tool {
    name = 'weather';
    description = 'Get current weather information for a location';
    
    parameters = {
        type: 'object',
        properties: {
            location: {
                type: 'string',
                description: 'City name or coordinates'
            },
            units: {
                type: 'string',
                enum: ['metric', 'imperial'],
                description: 'Temperature units',
                default: 'metric'
            }
        },
        required: ['location']
    };

    async execute(params: WeatherParams, context: ToolContext): Promise<ToolResult> {
        try {
            const { location, units = 'metric' } = params;
            
            // Validate input
            if (!location || location.trim().length === 0) {
                return {
                    success: false,
                    error: 'Location is required',
                    metadata: { tool: this.name }
                };
            }

            // Call weather API
            const weatherData = await this.fetchWeatherData(location, units, context);
            
            // Format response
            const response = this.formatWeatherResponse(weatherData, units);
            
            return {
                success: true,
                data: {
                    location,
                    weather: weatherData,
                    formatted: response
                },
                metadata: {
                    tool: this.name,
                    units,
                    timestamp: Date.now()
                }
            };
        } catch (error) {
            console.error('Weather tool error:', error);
            
            return {
                success: false,
                error: `Failed to get weather data: ${error.message}`,
                metadata: { 
                    tool: this.name,
                    error: error.message 
                }
            };
        }
    }

    private async fetchWeatherData(
        location: string, 
        units: string, 
        context: ToolContext
    ): Promise<WeatherData> {
        // Example API call (replace with actual weather service)
        const apiKey = context.bindings.WEATHER_API_KEY;
        if (!apiKey) {
            throw new Error('Weather API key not configured');
        }

        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${units}&appid=${apiKey}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Weather API error: ${response.statusText}`);
        }

        const data = await response.json();
        
        return {
            temperature: data.main.temp,
            description: data.weather[0].description,
            humidity: data.main.humidity,
            windSpeed: data.wind.speed
        };
    }

    private formatWeatherResponse(weather: WeatherData, units: string): string {
        const tempUnit = units === 'metric' ? '°C' : '°F';
        const speedUnit = units === 'metric' ? 'm/s' : 'mph';
        
        return `Current weather: ${weather.description}. ` +
               `Temperature: ${weather.temperature}${tempUnit}. ` +
               `Humidity: ${weather.humidity}%. ` +
               `Wind speed: ${weather.windSpeed} ${speedUnit}.`;
    }
}

// Register the tool
import { toolRegistry } from './tool_registry';
toolRegistry.registerTool(new WeatherTool());
```

### 2. Advanced Workflow Implementation

```typescript
// Complex workflow example: Customer onboarding
import { WorkflowStep, WorkflowDefinition } from './workflow';

interface OnboardingData {
    userId: string;
    email: string;
    preferences: {
        language: string;
        notifications: boolean;
        theme: string;
    };
}

export class CustomerOnboardingWorkflow implements WorkflowDefinition {
    name = 'customer_onboarding';
    description = 'Complete customer onboarding process';
    
    steps: WorkflowStep[] = [
        {
            id: 'validate_user',
            name: 'Validate User Information',
            timeout: 5000,
            retryPolicy: {
                maxAttempts: 3,
                backoffStrategy: 'exponential'
            }
        },
        {
            id: 'create_profile',
            name: 'Create User Profile',
            timeout: 10000,
            dependencies: ['validate_user']
        },
        {
            id: 'setup_preferences',
            name: 'Configure User Preferences',
            timeout: 5000,
            dependencies: ['create_profile']
        },
        {
            id: 'send_welcome_email',
            name: 'Send Welcome Email',
            timeout: 15000,
            dependencies: ['setup_preferences']
        },
        {
            id: 'create_initial_session',
            name: 'Create Initial Chat Session',
            timeout: 5000,
            dependencies: ['send_welcome_email']
        }
    ];

    async executeStep(
        stepId: string, 
        input: any, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        
        switch (stepId) {
            case 'validate_user':
                return await this.validateUser(input, context);
            
            case 'create_profile':
                return await this.createProfile(input, context);
            
            case 'setup_preferences':
                return await this.setupPreferences(input, context);
            
            case 'send_welcome_email':
                return await this.sendWelcomeEmail(input, context);
            
            case 'create_initial_session':
                return await this.createInitialSession(input, context);
            
            default:
                return {
                    success: false,
                    error: `Unknown step: ${stepId}`
                };
        }
    }

    private async validateUser(
        data: OnboardingData, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        try {
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.email)) {
                return {
                    success: false,
                    error: 'Invalid email format'
                };
            }

            // Check if user already exists
            const existingUser = await context.bindings.USER_KV.get(`user:${data.userId}`);
            if (existingUser) {
                return {
                    success: false,
                    error: 'User already exists'
                };
            }

            return {
                success: true,
                output: { validated: true, userId: data.userId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Validation failed: ${error.message}`
            };
        }
    }

    private async createProfile(
        data: OnboardingData, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        try {
            const profile = {
                userId: data.userId,
                email: data.email,
                createdAt: Date.now(),
                status: 'active',
                onboardingCompleted: false
            };

            await context.bindings.USER_KV.put(
                `user:${data.userId}`, 
                JSON.stringify(profile),
                { expirationTtl: 86400 * 365 } // 1 year
            );

            return {
                success: true,
                output: { profile }
            };
        } catch (error) {
            return {
                success: false,
                error: `Profile creation failed: ${error.message}`
            };
        }
    }

    private async setupPreferences(
        data: OnboardingData, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        try {
            const preferences = {
                ...data.preferences,
                updatedAt: Date.now()
            };

            await context.bindings.USER_KV.put(
                `preferences:${data.userId}`,
                JSON.stringify(preferences)
            );

            return {
                success: true,
                output: { preferences }
            };
        } catch (error) {
            return {
                success: false,
                error: `Preferences setup failed: ${error.message}`
            };
        }
    }

    private async sendWelcomeEmail(
        data: OnboardingData, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        try {
            // Simulate email sending (replace with actual email service)
            const emailData = {
                to: data.email,
                subject: 'Welcome to AI Support Bot!',
                template: 'welcome',
                variables: {
                    userId: data.userId,
                    language: data.preferences.language
                }
            };

            // In a real implementation, you would call an email service API
            console.log('Sending welcome email:', emailData);

            return {
                success: true,
                output: { emailSent: true, emailId: `email_${Date.now()}` }
            };
        } catch (error) {
            return {
                success: false,
                error: `Email sending failed: ${error.message}`
            };
        }
    }

    private async createInitialSession(
        data: OnboardingData, 
        context: any
    ): Promise<{ success: boolean; output?: any; error?: string }> {
        try {
            const sessionId = `sess_${data.userId}_${Date.now()}`;
            
            // Create initial session in Durable Object
            const doId = context.bindings.MEMORY_DO.idFromName(sessionId);
            const doStub = context.bindings.MEMORY_DO.get(doId);
            
            const initRequest = new Request(`http://localhost/session/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'initialize',
                    userId: data.userId,
                    metadata: {
                        onboarding: true,
                        language: data.preferences.language
                    }
                })
            });

            await doStub.fetch(initRequest);

            return {
                success: true,
                output: { sessionId, initialized: true }
            };
        } catch (error) {
            return {
                success: false,
                error: `Session creation failed: ${error.message}`
            };
        }
    }

    // Compensation steps for rollback
    async compensateStep(
        stepId: string, 
        input: any, 
        context: any
    ): Promise<{ success: boolean; error?: string }> {
        
        switch (stepId) {
            case 'create_profile':
                // Delete created profile
                await context.bindings.USER_KV.delete(`user:${input.userId}`);
                return { success: true };
            
            case 'setup_preferences':
                // Delete preferences
                await context.bindings.USER_KV.delete(`preferences:${input.userId}`);
                return { success: true };
            
            case 'create_initial_session':
                // Clean up session
                // Implementation depends on your session cleanup logic
                return { success: true };
            
            default:
                return { success: true }; // No compensation needed
        }
    }
}
```

## Tool Development

### 1. Database Integration Tool

```typescript
// Database integration tool example
import { Tool, ToolContext, ToolResult } from './tools';

interface DatabaseQuery {
    table: string;
    operation: 'select' | 'insert' | 'update' | 'delete';
    conditions?: Record<string, any>;
    data?: Record<string, any>;
    limit?: number;
}

export class DatabaseTool implements Tool {
    name = 'database';
    description = 'Execute database operations';
    
    parameters = {
        type: 'object',
        properties: {
            table: {
                type: 'string',
                description: 'Database table name'
            },
            operation: {
                type: 'string',
                enum: ['select', 'insert', 'update', 'delete'],
                description: 'Database operation to perform'
            },
            conditions: {
                type: 'object',
                description: 'Query conditions (for select, update, delete)'
            },
            data: {
                type: 'object',
                description: 'Data to insert or update'
            },
            limit: {
                type: 'number',
                description: 'Maximum number of records to return',
                default: 100
            }
        },
        required: ['table', 'operation']
    };

    async execute(params: DatabaseQuery, context: ToolContext): Promise<ToolResult> {
        try {
            // Validate permissions
            if (!this.hasPermission(params.table, params.operation, context)) {
                return {
                    success: false,
                    error: 'Insufficient permissions for this operation',
                    metadata: { tool: this.name }
                };
            }

            // Execute operation
            const result = await this.executeQuery(params, context);
            
            return {
                success: true,
                data: result,
                metadata: {
                    tool: this.name,
                    operation: params.operation,
                    table: params.table,
                    recordCount: Array.isArray(result) ? result.length : 1
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Database operation failed: ${error.message}`,
                metadata: { tool: this.name }
            };
        }
    }

    private hasPermission(table: string, operation: string, context: ToolContext): boolean {
        // Implement your permission logic here
        const allowedTables = ['users', 'sessions', 'conversations'];
        const readOnlyTables = ['system_config'];
        
        if (!allowedTables.includes(table)) {
            return false;
        }
        
        if (readOnlyTables.includes(table) && operation !== 'select') {
            return false;
        }
        
        return true;
    }

    private async executeQuery(params: DatabaseQuery, context: ToolContext): Promise<any> {
        // This is a simplified example - replace with your actual database client
        const { table, operation, conditions, data, limit } = params;
        
        switch (operation) {
            case 'select':
                return await this.select(table, conditions, limit, context);
            case 'insert':
                return await this.insert(table, data, context);
            case 'update':
                return await this.update(table, data, conditions, context);
            case 'delete':
                return await this.delete(table, conditions, context);
            default:
                throw new Error(`Unsupported operation: ${operation}`);
        }
    }

    private async select(
        table: string, 
        conditions: Record<string, any> = {}, 
        limit: number = 100,
        context: ToolContext
    ): Promise<any[]> {
        // Example using KV storage as a simple database
        const keys = await context.bindings.DATABASE_KV.list({ prefix: `${table}:` });
        const results = [];
        
        for (const key of keys.keys.slice(0, limit)) {
            const record = await context.bindings.DATABASE_KV.get(key.name);
            if (record) {
                const data = JSON.parse(record);
                if (this.matchesConditions(data, conditions)) {
                    results.push(data);
                }
            }
        }
        
        return results;
    }

    private async insert(
        table: string, 
        data: Record<string, any>, 
        context: ToolContext
    ): Promise<any> {
        const id = `${table}:${Date.now()}_${Math.random().toString(36).substring(2)}`;
        const record = {
            id,
            ...data,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        await context.bindings.DATABASE_KV.put(id, JSON.stringify(record));
        return record;
    }

    private async update(
        table: string, 
        data: Record<string, any>, 
        conditions: Record<string, any>, 
        context: ToolContext
    ): Promise<any[]> {
        const records = await this.select(table, conditions, 1000, context);
        const updated = [];
        
        for (const record of records) {
            const updatedRecord = {
                ...record,
                ...data,
                updatedAt: Date.now()
            };
            
            await context.bindings.DATABASE_KV.put(record.id, JSON.stringify(updatedRecord));
            updated.push(updatedRecord);
        }
        
        return updated;
    }

    private async delete(
        table: string, 
        conditions: Record<string, any>, 
        context: ToolContext
    ): Promise<number> {
        const records = await this.select(table, conditions, 1000, context);
        
        for (const record of records) {
            await context.bindings.DATABASE_KV.delete(record.id);
        }
        
        return records.length;
    }

    private matchesConditions(record: any, conditions: Record<string, any>): boolean {
        for (const [key, value] of Object.entries(conditions)) {
            if (record[key] !== value) {
                return false;
            }
        }
        return true;
    }
}
```

### 2. External API Integration Tool

```typescript
// External API integration tool
export class ExternalAPITool implements Tool {
    name = 'external_api';
    description = 'Make requests to external APIs';
    
    parameters = {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'API endpoint URL'
            },
            method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE'],
                default: 'GET'
            },
            headers: {
                type: 'object',
                description: 'Request headers'
            },
            body: {
                type: 'object',
                description: 'Request body (for POST/PUT)'
            },
            timeout: {
                type: 'number',
                description: 'Request timeout in milliseconds',
                default: 10000
            }
        },
        required: ['url']
    };

    async execute(params: any, context: ToolContext): Promise<ToolResult> {
        try {
            // Validate URL
            if (!this.isAllowedURL(params.url)) {
                return {
                    success: false,
                    error: 'URL not in allowed list',
                    metadata: { tool: this.name }
                };
            }

            // Make API request with timeout
            const response = await this.makeRequest(params);
            
            return {
                success: true,
                data: response,
                metadata: {
                    tool: this.name,
                    url: params.url,
                    method: params.method || 'GET',
                    statusCode: response.status
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `API request failed: ${error.message}`,
                metadata: { tool: this.name }
            };
        }
    }

    private isAllowedURL(url: string): boolean {
        const allowedDomains = [
            'api.example.com',
            'jsonplaceholder.typicode.com',
            'httpbin.org'
        ];
        
        try {
            const urlObj = new URL(url);
            return allowedDomains.some(domain => urlObj.hostname.endsWith(domain));
        } catch {
            return false;
        }
    }

    private async makeRequest(params: any): Promise<any> {
        const { url, method = 'GET', headers = {}, body, timeout = 10000 } = params;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            const data = await response.json();
            
            return {
                status: response.status,
                statusText: response.statusText,
                data
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
}
```

## Testing Examples

### 1. Unit Testing

```typescript
// Example unit tests for tools
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WeatherTool } from '../workers/weather_tool';
import { ToolContext } from '../workers/tools';

describe('WeatherTool', () => {
    let weatherTool: WeatherTool;
    let mockContext: ToolContext;

    beforeEach(() => {
        weatherTool = new WeatherTool();
        mockContext = {
            sessionId: 'test-session',
            bindings: {
                WEATHER_API_KEY: 'test-api-key'
            },
            userId: 'test-user',
            conversationContext: {}
        };
    });

    it('should return weather data for valid location', async () => {
        // Mock fetch
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                main: { temp: 20, humidity: 65 },
                weather: [{ description: 'clear sky' }],
                wind: { speed: 3.5 }
            })
        });

        const result = await weatherTool.execute(
            { location: 'London', units: 'metric' },
            mockContext
        );

        expect(result.success).toBe(true);
        expect(result.data.weather.temperature).toBe(20);
        expect(result.data.formatted).toContain('clear sky');
    });

    it('should handle API errors gracefully', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            statusText: 'Not Found'
        });

        const result = await weatherTool.execute(
            { location: 'InvalidCity' },
            mockContext
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Weather API error');
    });

    it('should validate required parameters', async () => {
        const result = await weatherTool.execute(
            { location: '' },
            mockContext
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Location is required');
    });
});
```

### 2. Integration Testing

```typescript
// Integration test example
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('AI Support Bot Integration', () => {
    let sessionId: string;
    let wsConnection: WebSocket;
    const baseUrl = 'http://localhost:8787';

    beforeAll(async () => {
        // Create test session
        const response = await fetch(`${baseUrl}/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: { test: true }
            })
        });
        
        const session = await response.json();
        sessionId = session.sessionId;
    });

    afterAll(async () => {
        // Clean up test session
        if (sessionId) {
            await fetch(`${baseUrl}/api/session/${sessionId}`, {
                method: 'DELETE'
            });
        }
        
        if (wsConnection) {
            wsConnection.close();
        }
    });

    it('should handle complete conversation flow', async () => {
        // Test REST API
        const chatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Hello, I need help',
                sessionId
            })
        });

        const chatResult = await chatResponse.json();
        expect(chatResult.response).toBeDefined();
        expect(chatResult.sessionId).toBe(sessionId);

        // Test WebSocket
        return new Promise((resolve, reject) => {
            const wsUrl = `ws://localhost:8787/ws?sessionId=${sessionId}`;
            wsConnection = new WebSocket(wsUrl);

            wsConnection.onopen = () => {
                wsConnection.send(JSON.stringify({
                    type: 'chat_message',
                    data: {
                        content: 'Test WebSocket message',
                        sessionId
                    }
                }));
            };

            wsConnection.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'ai_response') {
                    expect(data.data.content).toBeDefined();
                    resolve(data);
                }
            };

            wsConnection.onerror = reject;
            
            setTimeout(() => reject(new Error('WebSocket test timeout')), 10000);
        });
    });

    it('should handle tool integration', async () => {
        const response = await fetch(`${baseUrl}/api/tools/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'test search',
                sessionId
            })
        });

        const result = await response.json();
        expect(result.results).toBeDefined();
        expect(Array.isArray(result.results)).toBe(true);
    });
});
```

### 3. Load Testing with k6

```javascript
// k6 load test script
import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const wsErrorRate = new Rate('ws_errors');

export let options = {
    stages: [
        { duration: '2m', target: 20 },   // Ramp up
        { duration: '5m', target: 50 },   // Stay at 50 users
        { duration: '2m', target: 100 },  // Ramp up to 100
        { duration: '5m', target: 100 },  // Stay at 100
        { duration: '2m', target: 0 },    // Ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
        errors: ['rate<0.05'],             // Error rate under 5%
        ws_errors: ['rate<0.02'],          // WebSocket error rate under 2%
    },
};

const BASE_URL = 'https://your-worker.your-subdomain.workers.dev';

export function setup() {
    // Create test sessions for load testing
    const sessions = [];
    for (let i = 0; i < 10; i++) {
        const response = http.post(`${BASE_URL}/api/session`, 
            JSON.stringify({ metadata: { loadTest: true } }),
            { headers: { 'Content-Type': 'application/json' } }
        );
        
        if (response.status === 201) {
            sessions.push(response.json().sessionId);
        }
    }
    return { sessions };
}

export default function(data) {
    const sessionId = data.sessions[Math.floor(Math.random() * data.sessions.length)];
    
    // Test REST API
    testRestAPI(sessionId);
    
    // Test WebSocket (25% of users)
    if (Math.random() < 0.25) {
        testWebSocket(sessionId);
    }
    
    sleep(1);
}

function testRestAPI(sessionId) {
    const messages = [
        'Hello, I need help with my account',
        'How do I reset my password?',
        'I want to create a support ticket',
        'What are your business hours?',
        'Can you help me with billing?'
    ];
    
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    const response = http.post(`${BASE_URL}/api/chat`,
        JSON.stringify({ message, sessionId }),
        { 
            headers: { 'Content-Type': 'application/json' },
            timeout: '30s'
        }
    );
    
    const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'response time < 5s': (r) => r.timings.duration < 5000,
        'has response content': (r) => r.json().response !== undefined,
    });
    
    errorRate.add(!success);
}

function testWebSocket(sessionId) {
    const wsUrl = `${BASE_URL.replace('https', 'wss')}/ws?sessionId=${sessionId}`;
    
    const response = ws.connect(wsUrl, function(socket) {
        socket.on('open', function() {
            socket.send(JSON.stringify({
                type: 'chat_message',
                data: {
                    content: 'WebSocket load test message',
                    sessionId: sessionId
                }
            }));
        });
        
        socket.on('message', function(message) {
            const data = JSON.parse(message);
            const success = check(data, {
                'received valid response': (d) => d.type === 'ai_response',
                'has content': (d) => d.data && d.data.content !== undefined,
            });
            
            wsErrorRate.add(!success);
        });
        
        socket.on('error', function(error) {
            wsErrorRate.add(true);
        });
        
        // Keep connection open for 10-30 seconds
        sleep(Math.random() * 20 + 10);
    });
}

export function teardown(data) {
    // Clean up test sessions
    data.sessions.forEach(sessionId => {
        http.del(`${BASE_URL}/api/session/${sessionId}`);
    });
}
```

## Production Deployment

### 1. Environment Configuration

```bash
#!/bin/bash
# production-deploy.sh

set -e

echo "🚀 Starting production deployment..."

# Environment variables
ENVIRONMENT="production"
WORKER_NAME="cf-ai-supportbot"
PAGES_PROJECT="cf-ai-supportbot-frontend"

# Pre-deployment checks
echo "📋 Running pre-deployment checks..."

# Check authentication
wrangler whoami || {
    echo "❌ Not authenticated with Cloudflare"
    exit 1
}

# Check required secrets
REQUIRED_SECRETS=("OPENAI_API_KEY" "KNOWLEDGE_BASE_API_KEY" "TICKETING_API_KEY")
for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! wrangler secret list --name $WORKER_NAME | grep -q $secret; then
        echo "❌ Missing required secret: $secret"
        exit 1
    fi
done

# Run tests
echo "🧪 Running test suite..."
npm run test:run || {
    echo "❌ Tests failed"
    exit 1
}

# Build project
echo "🔨 Building project..."
npm run build
npm run build:frontend

# Deploy Worker
echo "🚀 Deploying Worker..."
wrangler deploy --env $ENVIRONMENT --name $WORKER_NAME

# Deploy Pages
echo "🌐 Deploying Pages..."
wrangler pages deploy pages/dist --project-name $PAGES_PROJECT

# Verify deployment
echo "✅ Verifying deployment..."
./scripts/verify-deployment.sh $ENVIRONMENT

# Monitor for 5 minutes
echo "📊 Monitoring deployment..."
./scripts/monitor-deployment.sh $ENVIRONMENT 5

echo "🎉 Production deployment completed successfully!"
```

### 2. Monitoring Setup

```typescript
// Production monitoring configuration
export const productionMonitoringConfig = {
    // Logging configuration
    logging: {
        level: 'info',
        structuredLogging: true,
        includeStackTrace: true,
        maxLogSize: 1024 * 1024, // 1MB
        retention: {
            error: 7 * 24 * 60 * 60 * 1000,    // 7 days
            warn: 3 * 24 * 60 * 60 * 1000,     // 3 days
            info: 1 * 24 * 60 * 60 * 1000,     // 1 day
        }
    },

    // Metrics configuration
    metrics: {
        collection: {
            interval: 60000, // 1 minute
            batchSize: 100,
            retention: 30 * 24 * 60 * 60 * 1000, // 30 days
        },
        alerts: [
            {
                name: 'high_error_rate',
                condition: 'error_rate > 0.05',
                duration: 300000, // 5 minutes
                severity: 'critical',
                channels: ['slack', 'email']
            },
            {
                name: 'high_latency',
                condition: 'p95_latency > 5000',
                duration: 120000, // 2 minutes
                severity: 'warning',
                channels: ['slack']
            },
            {
                name: 'low_availability',
                condition: 'availability < 0.99',
                duration: 60000, // 1 minute
                severity: 'critical',
                channels: ['slack', 'email', 'pagerduty']
            }
        ]
    },

    // Performance monitoring
    performance: {
        sampling: {
            rate: 0.1, // 10% sampling
            minDuration: 1000, // Only sample requests > 1s
        },
        thresholds: {
            p50: 500,   // 500ms
            p95: 2000,  // 2s
            p99: 5000,  // 5s
        }
    },

    // Health checks
    healthChecks: {
        interval: 30000, // 30 seconds
        timeout: 5000,   // 5 seconds
        endpoints: [
            '/health',
            '/api/status',
            '/api/session'
        ],
        dependencies: [
            'workers_ai',
            'durable_objects',
            'kv_storage',
            'r2_storage'
        ]
    }
};
```

This comprehensive usage guide provides practical examples for integrating and extending the AI Support Bot system. Each example includes error handling, best practices, and production considerations to help developers build robust applications on top of the Cloudflare platform.
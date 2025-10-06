// Main React Chat Application Component
const { useState, useEffect, useRef, useCallback } = React;

function ChatApp() {
    // State management
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [voiceState, setVoiceState] = useState('idle');
    const [error, setError] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    
    // Refs
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const wsManagerRef = useRef(null);
    const voiceManagerRef = useRef(null);
    
    // Initialize WebSocket and Voice managers
    useEffect(() => {
        // Initialize WebSocket Manager
        wsManagerRef.current = new WebSocketManager(
            handleWebSocketMessage,
            handleConnectionStatusChange
        );
        
        // Initialize Voice Manager
        voiceManagerRef.current = new VoiceManager(
            handleVoiceInput,
            handleVoiceStateChange
        );
        
        // Connect WebSocket
        connectWebSocket();
        
        // Cleanup on unmount
        return () => {
            if (wsManagerRef.current) {
                wsManagerRef.current.disconnect();
            }
        };
    }, []);
    
    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);
    
    // WebSocket connection handler
    const connectWebSocket = useCallback(async () => {
        try {
            await wsManagerRef.current.connect();
            setSessionId(wsManagerRef.current.getSessionId());
            setError(null);
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            setError('Failed to connect to chat server');
        }
    }, []);
    
    // Handle WebSocket messages
    const handleWebSocketMessage = useCallback((data) => {
        if (data.type === 'typing') {
            setIsTyping(data.isTyping);
        } else if (data.type === 'error') {
            setError(data.error.message || 'An error occurred');
            setIsTyping(false);
        } else if (data.id) {
            // Regular chat message
            setMessages(prev => [...prev, data]);
            setIsTyping(false);
            
            // Auto-speak AI responses if voice is enabled and supported
            if (data.role === 'assistant' && voiceManagerRef.current?.isVoiceSupported()) {
                // Only auto-speak if user has used voice input recently
                const hasRecentVoiceActivity = messages.some(msg => 
                    msg.metadata?.voiceEnabled && 
                    Date.now() - msg.timestamp < 30000 // Within last 30 seconds
                );
                
                if (hasRecentVoiceActivity || voiceState === 'speaking') {
                    voiceManagerRef.current.speak(data.content).catch(error => {
                        console.warn('TTS failed:', error);
                        // Don't show error to user for TTS failures
                    });
                }
            }
        }
    }, []);
    
    // Handle connection status changes
    const handleConnectionStatusChange = useCallback((status) => {
        setConnectionStatus(status);
        
        if (status === 'connected') {
            setError(null);
        } else if (status === 'error') {
            setError('Connection error occurred');
        }
    }, []);
    
    // Handle voice input
    const handleVoiceInput = useCallback((transcript) => {
        setInputValue(transcript);
        // Auto-send voice input after a short delay to allow for corrections
        setTimeout(() => {
            if (transcript.trim()) {
                sendMessage(transcript);
            }
        }, 1000);
    }, []);
    
    // Handle voice state changes
    const handleVoiceStateChange = useCallback((state, errorMessage) => {
        setVoiceState(state);
        
        if (state === 'error') {
            setError(`Voice error: ${errorMessage}`);
            // Clear error after a few seconds for non-critical errors
            setTimeout(() => {
                if (errorMessage && !errorMessage.includes('permission')) {
                    setError(null);
                }
            }, 5000);
        } else if (state === 'processing') {
            // Show interim results
            setInputValue(errorMessage || ''); // errorMessage contains interim transcript
        }
    }, []);
    
    // Send message function
    const sendMessage = useCallback((content = inputValue) => {
        if (!content.trim() || connectionStatus !== 'connected') {
            return;
        }
        
        // Create user message
        const userMessage = {
            id: generateMessageId(),
            sessionId: sessionId,
            content: content.trim(),
            role: 'user',
            timestamp: Date.now(),
            metadata: {
                voiceEnabled: voiceState === 'recording' || voiceState === 'processing',
                ttsEnabled: voiceManagerRef.current?.isVoiceSupported() || false
            }
        };
        
        // Add to messages immediately for better UX
        setMessages(prev => [...prev, userMessage]);
        
        // Send via WebSocket
        const sent = wsManagerRef.current.sendMessage(content.trim());
        
        if (sent) {
            setInputValue('');
            setIsTyping(true);
            setError(null);
        } else {
            setError('Failed to send message. Please check your connection.');
        }
    }, [inputValue, connectionStatus, sessionId]);
    
    // Handle input key press
    const handleKeyPress = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);
    
    // Handle voice button click
    const handleVoiceClick = useCallback(async () => {
        if (!voiceManagerRef.current?.isVoiceSupported()) {
            setError('Voice input is not supported in your browser. Please type your message instead.');
            return;
        }
        
        if (voiceState === 'recording') {
            voiceManagerRef.current.stopRecording();
        } else {
            // Test microphone permission before starting
            const hasPermission = await voiceManagerRef.current.requestMicrophonePermission();
            if (!hasPermission) {
                setError('Microphone access is required for voice input. Please enable microphone permissions and try again.');
                return;
            }
            
            const started = await voiceManagerRef.current.startRecording();
            if (!started) {
                setError('Failed to start voice recording. Falling back to text input.');
            }
        }
    }, [voiceState]);
    
    // Handle TTS toggle
    const handleTTSToggle = useCallback(() => {
        if (voiceState === 'speaking') {
            voiceManagerRef.current?.stopSpeaking();
        }
    }, [voiceState]);
    
    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    
    // Generate message ID
    const generateMessageId = () => {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    };
    
    // Format timestamp
    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };
    
    // Get connection status display
    const getConnectionStatusDisplay = () => {
        switch (connectionStatus) {
            case 'connected':
                return { text: 'Connected', class: '' };
            case 'connecting':
            case 'reconnecting':
                return { text: 'Connecting...', class: 'connecting' };
            case 'disconnected':
                return { text: 'Disconnected', class: 'disconnected' };
            case 'error':
                return { text: 'Connection Error', class: 'disconnected' };
            default:
                return { text: 'Unknown', class: 'disconnected' };
        }
    };
    
    const statusDisplay = getConnectionStatusDisplay();
    
    return (
        <div className="chat-container">
            {/* Header */}
            <div className="chat-header">
                <div className="chat-title">AI Support Bot</div>
                <div className="status-indicators">
                    <div className="connection-status">
                        <div className={`status-indicator ${statusDisplay.class}`}></div>
                        <span>{statusDisplay.text}</span>
                    </div>
                    {voiceManagerRef.current?.isVoiceSupported() && (
                        <div className="voice-status">
                            <div className={`voice-indicator ${voiceState}`}></div>
                            <span>
                                {voiceState === 'recording' ? 'Listening...' :
                                 voiceState === 'processing' ? 'Processing...' :
                                 voiceState === 'speaking' ? 'Speaking...' :
                                 voiceState === 'error' ? 'Voice Error' :
                                 'Voice Ready'}
                            </span>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Reconnection Banner */}
            {connectionStatus === 'disconnected' && (
                <div className="reconnect-banner">
                    Connection lost. 
                    <button 
                        className="reconnect-button" 
                        onClick={connectWebSocket}
                    >
                        Reconnect
                    </button>
                </div>
            )}
            
            {/* Error Message */}
            {error && (
                <div className="error-message">
                    {error}
                    <button 
                        style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={() => setError(null)}
                    >
                        ×
                    </button>
                </div>
            )}
            
            {/* Messages */}
            <div className="chat-messages">
                {messages.length === 0 && (
                    <div style={{ 
                        textAlign: 'center', 
                        color: '#6b7280', 
                        padding: '2rem',
                        fontStyle: 'italic'
                    }}>
                        Welcome! Start a conversation with the AI support bot.
                    </div>
                )}
                
                {messages.map((message) => (
                    <div key={message.id} className={`message ${message.role}`}>
                        <div className="message-avatar">
                            {message.role === 'user' ? 'U' : 'AI'}
                        </div>
                        <div className="message-content">
                            <div className="message-text">{message.content}</div>
                            <div className="message-timestamp">
                                {formatTimestamp(message.timestamp)}
                            </div>
                            {message.metadata?.toolCalls && (
                                <div className="message-tools">
                                    {message.metadata.toolCalls.map((tool, index) => (
                                        <div key={index} className="tool-call">
                                            🔧 {tool.name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Typing Indicator */}
                {isTyping && (
                    <div className="typing-indicator">
                        <div className="message-avatar" style={{ background: '#10b981', color: 'white' }}>
                            AI
                        </div>
                        <div>
                            AI is typing
                            <div className="typing-dots">
                                <div className="typing-dot"></div>
                                <div className="typing-dot"></div>
                                <div className="typing-dot"></div>
                            </div>
                        </div>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>
            
            {/* Input */}
            <div className="chat-input-container">
                <div className="chat-input-wrapper">
                    <textarea
                        ref={inputRef}
                        className="chat-input"
                        placeholder="Type your message..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        disabled={connectionStatus !== 'connected'}
                        rows={1}
                        style={{
                            height: 'auto',
                            minHeight: '44px',
                            maxHeight: '120px'
                        }}
                        onInput={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                        }}
                    />
                    
                    <div className="input-actions">
                        {voiceManagerRef.current?.isVoiceSupported() && (
                            <button
                                className={`voice-button ${voiceState === 'recording' ? 'active' : ''} ${voiceState === 'processing' ? 'processing' : ''}`}
                                onClick={handleVoiceClick}
                                title={
                                    voiceState === 'recording' ? 'Stop recording' : 
                                    voiceState === 'processing' ? 'Processing speech...' :
                                    'Start voice input'
                                }
                                disabled={voiceState === 'processing'}
                            >
                                {voiceState === 'recording' ? '🔴' : 
                                 voiceState === 'processing' ? '⏳' : '🎤'}
                            </button>
                        )}
                        
                        {voiceManagerRef.current?.isVoiceSupported() && voiceState === 'speaking' && (
                            <button
                                className="tts-button active"
                                onClick={handleTTSToggle}
                                title="Stop speaking"
                            >
                                🔊
                            </button>
                        )}
                        
                        <button
                            className="send-button"
                            onClick={() => sendMessage()}
                            disabled={!inputValue.trim() || connectionStatus !== 'connected'}
                            title="Send message"
                        >
                            ➤
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Render the app
ReactDOM.render(<ChatApp />, document.getElementById('chat-app'));
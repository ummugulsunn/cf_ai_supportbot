// Optimized WebSocket Manager for real-time chat communication
class WebSocketManager {
    constructor(onMessage, onStatusChange) {
        this.onMessage = onMessage;
        this.onStatusChange = onStatusChange;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.sessionId = null;
        this.isIntentionalClose = false;
        
        // Optimization: Message queuing and batching
        this.messageQueue = [];
        this.batchSize = 10;
        this.batchTimeout = 100; // ms
        this.batchTimer = null;
        
        // Optimization: Connection pooling and keep-alive
        this.heartbeatInterval = null;
        this.heartbeatTimeout = 30000; // 30 seconds
        this.lastPongReceived = Date.now();
        
        // Optimization: Memory management
        this.maxQueueSize = 100;
        this.messageHistory = [];
        this.maxHistorySize = 50;
        
        // Optimization: Compression support
        this.compressionEnabled = false;
        this.compressionThreshold = 1024; // bytes
        
        // Generate session ID
        this.sessionId = this.generateSessionId();
        
        // Set up cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }
    
    generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    
    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        
        return new Promise((resolve, reject) => {
            try {
                // Use wss for production, ws for development
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                let wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${this.sessionId}`;
                
                // Add compression support if available
                if (this.compressionEnabled) {
                    wsUrl += '&compression=true';
                }
                
                this.ws = new WebSocket(wsUrl);
                this.onStatusChange('connecting');
                
                // Optimization: Set binary type for potential binary message support
                this.ws.binaryType = 'arraybuffer';
                
                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.reconnectAttempts = 0;
                    this.onStatusChange('connected');
                    
                    // Start heartbeat mechanism
                    this.startHeartbeat();
                    
                    // Process queued messages
                    this.processMessageQueue();
                    
                    // Send optimized session initialization
                    this.sendImmediate({
                        type: 'init',
                        sessionId: this.sessionId,
                        timestamp: Date.now(),
                        capabilities: {
                            compression: this.compressionEnabled,
                            batching: true,
                            heartbeat: true
                        }
                    });
                    
                    resolve();
                };
                
                this.ws.onmessage = (event) => {
                    this.lastPongReceived = Date.now();
                    
                    try {
                        let data;
                        
                        // Handle both text and binary messages
                        if (typeof event.data === 'string') {
                            data = JSON.parse(event.data);
                        } else {
                            // Handle compressed binary data
                            data = this.decompressMessage(event.data);
                        }
                        
                        this.handleMessage(data);
                        
                        // Optimization: Manage message history
                        this.addToHistory(data);
                        
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                };
                
                this.ws.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason);
                    this.onStatusChange('disconnected');
                    
                    // Stop heartbeat
                    this.stopHeartbeat();
                    
                    if (!this.isIntentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.onStatusChange('error');
                    this.stopHeartbeat();
                    reject(error);
                };
                
            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                reject(error);
            }
        });
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'message':
                this.onMessage(data.message);
                break;
            case 'typing':
                this.onMessage({ type: 'typing', isTyping: data.isTyping });
                break;
            case 'error':
                this.onMessage({ type: 'error', error: data.error });
                break;
            case 'session_init':
                console.log('Session initialized:', data.sessionId);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return this.sendImmediate(data);
        } else {
            // Queue message for later sending
            return this.queueMessage(data);
        }
    }
    
    sendImmediate(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const serialized = JSON.stringify(data);
                
                // Use compression for large messages
                if (this.compressionEnabled && serialized.length > this.compressionThreshold) {
                    const compressed = this.compressMessage(serialized);
                    this.ws.send(compressed);
                } else {
                    this.ws.send(serialized);
                }
                
                return true;
            } catch (error) {
                console.error('Failed to send message:', error);
                return false;
            }
        } else {
            console.warn('WebSocket not connected, message not sent:', data);
            return false;
        }
    }
    
    queueMessage(data) {
        // Add to queue with size limit
        if (this.messageQueue.length >= this.maxQueueSize) {
            // Remove oldest message to make room
            this.messageQueue.shift();
            console.warn('Message queue full, dropping oldest message');
        }
        
        this.messageQueue.push({
            data,
            timestamp: Date.now()
        });
        
        // Try to process queue if connection becomes available
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.processMessageQueue();
        }
        
        return true;
    }
    
    sendMessage(content) {
        const message = {
            type: 'message',
            sessionId: this.sessionId,
            content: content,
            timestamp: Date.now(),
            id: this.generateMessageId()
        };
        
        return this.send(message);
    }
    
    // Batch sending for efficiency
    sendBatch(messages) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return false;
        }
        
        const batchMessage = {
            type: 'batch',
            sessionId: this.sessionId,
            messages: messages,
            timestamp: Date.now()
        };
        
        return this.sendImmediate(batchMessage);
    }
    
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
        this.onStatusChange('reconnecting');
        
        setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                this.connect().catch(() => {
                    // Reconnect failed, will try again if attempts remain
                });
            }
        }, delay);
    }
    
    reconnect() {
        this.reconnectAttempts = 0;
        return this.connect();
    }
    
    disconnect() {
        this.isIntentionalClose = true;
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
        }
    }
    
    getConnectionState() {
        if (!this.ws) return 'disconnected';
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting';
            case WebSocket.OPEN:
                return 'connected';
            case WebSocket.CLOSING:
                return 'disconnecting';
            case WebSocket.CLOSED:
                return 'disconnected';
            default:
                return 'unknown';
        }
    }
    
    getSessionId() {
        return this.sessionId;
    }
    
    // Optimization: Heartbeat mechanism
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing heartbeat
        
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Check if we received a pong recently
                if (Date.now() - this.lastPongReceived > this.heartbeatTimeout * 2) {
                    console.warn('Heartbeat timeout, reconnecting...');
                    this.reconnect();
                    return;
                }
                
                // Send ping
                this.sendImmediate({
                    type: 'ping',
                    timestamp: Date.now()
                });
            }
        }, this.heartbeatTimeout);
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    // Optimization: Message queue processing
    processMessageQueue() {
        if (this.messageQueue.length === 0) return;
        
        // Process messages in batches for efficiency
        while (this.messageQueue.length > 0) {
            const batch = this.messageQueue.splice(0, this.batchSize);
            const messages = batch.map(item => item.data);
            
            if (messages.length === 1) {
                this.sendImmediate(messages[0]);
            } else {
                this.sendBatch(messages);
            }
        }
    }
    
    // Optimization: Message history management
    addToHistory(message) {
        this.messageHistory.push({
            ...message,
            receivedAt: Date.now()
        });
        
        // Limit history size to prevent memory leaks
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }
    
    getMessageHistory(limit = 10) {
        return this.messageHistory.slice(-limit);
    }
    
    // Optimization: Compression helpers (placeholder implementations)
    compressMessage(message) {
        // In a real implementation, would use a compression library like pako
        // For now, just return the original message
        return message;
    }
    
    decompressMessage(compressedData) {
        // In a real implementation, would decompress the data
        // For now, assume it's JSON
        return JSON.parse(new TextDecoder().decode(compressedData));
    }
    
    // Optimization: Memory cleanup
    cleanup() {
        this.stopHeartbeat();
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        // Clear queues to free memory
        this.messageQueue = [];
        this.messageHistory = [];
        
        if (this.ws) {
            this.isIntentionalClose = true;
            this.ws.close(1000, 'Client cleanup');
        }
    }
    
    // Helper: Generate unique message ID
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    
    // Optimization: Connection statistics
    getConnectionStats() {
        return {
            sessionId: this.sessionId,
            connectionState: this.getConnectionState(),
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length,
            historySize: this.messageHistory.length,
            lastPong: this.lastPongReceived,
            compressionEnabled: this.compressionEnabled
        };
    }
    
    // Optimization: Adaptive reconnection strategy
    scheduleReconnect() {
        this.reconnectAttempts++;
        
        // Exponential backoff with jitter
        const baseDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        const jitter = Math.random() * 1000; // Add up to 1 second of jitter
        const delay = Math.min(baseDelay + jitter, 30000); // Cap at 30 seconds
        
        console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
        this.onStatusChange('reconnecting');
        
        setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                this.connect().catch(() => {
                    // Reconnect failed, will try again if attempts remain
                });
            } else {
                console.error('Max reconnection attempts reached');
                this.onStatusChange('failed');
            }
        }, delay);
    }
}

// Export for use in other modules
window.WebSocketManager = WebSocketManager;
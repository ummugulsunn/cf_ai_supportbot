// Voice Manager for speech-to-text and text-to-speech functionality
class VoiceManager {
    constructor(onVoiceInput, onVoiceStateChange) {
        this.onVoiceInput = onVoiceInput;
        this.onVoiceStateChange = onVoiceStateChange;
        this.isRecording = false;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        this.isSupported = this.checkSupport();
        this.fallbackMode = false;
        
        if (this.isSupported.recognition) {
            this.initializeSpeechRecognition();
        }
        
        // Initialize WebRTC audio capture
        this.initializeWebRTC();
    }
    
    checkSupport() {
        const hasRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
        const hasSynthesis = 'speechSynthesis' in window;
        const hasWebRTC = 'MediaRecorder' in window && 'getUserMedia' in navigator.mediaDevices;
        const hasAudioContext = 'AudioContext' in window || 'webkitAudioContext' in window;
        
        return {
            recognition: hasRecognition,
            synthesis: hasSynthesis,
            webrtc: hasWebRTC,
            audioContext: hasAudioContext,
            full: hasRecognition && hasSynthesis && hasWebRTC
        };
    }
    
    async initializeWebRTC() {
        if (!this.isSupported.webrtc) {
            console.warn('WebRTC not supported, falling back to basic speech recognition');
            this.fallbackMode = true;
            return;
        }

        try {
            // Request microphone access
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
                }
            });
            
            console.log('WebRTC audio stream initialized');
        } catch (error) {
            console.warn('Failed to initialize WebRTC audio:', error);
            this.fallbackMode = true;
            this.onVoiceStateChange('error', 'Microphone access denied or unavailable');
        }
    }

    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            this.fallbackMode = true;
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;
        
        this.recognition.onstart = () => {
            console.log('Speech recognition started');
            this.isRecording = true;
            this.onVoiceStateChange('recording');
        };
        
        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Provide interim results for better UX
            if (interimTranscript) {
                this.onVoiceStateChange('processing', interimTranscript);
            }
            
            if (finalTranscript) {
                this.onVoiceInput(finalTranscript.trim());
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.isRecording = false;
            
            // Handle specific error types
            switch (event.error) {
                case 'no-speech':
                    this.onVoiceStateChange('error', 'No speech detected. Please try again.');
                    break;
                case 'audio-capture':
                    this.onVoiceStateChange('error', 'Microphone not accessible. Please check permissions.');
                    this.fallbackMode = true;
                    break;
                case 'not-allowed':
                    this.onVoiceStateChange('error', 'Microphone permission denied.');
                    this.fallbackMode = true;
                    break;
                case 'network':
                    this.onVoiceStateChange('error', 'Network error. Voice input temporarily unavailable.');
                    break;
                default:
                    this.onVoiceStateChange('error', `Voice recognition error: ${event.error}`);
            }
        };
        
        this.recognition.onend = () => {
            console.log('Speech recognition ended');
            this.isRecording = false;
            this.onVoiceStateChange('idle');
        };
    }
    
    async startRecording() {
        if (this.fallbackMode && !this.isSupported.recognition) {
            this.onVoiceStateChange('error', 'Voice input not supported in this browser');
            return false;
        }
        
        if (this.isRecording) {
            this.stopRecording();
            return false;
        }
        
        // Initialize WebRTC if not already done
        if (!this.audioStream && this.isSupported.webrtc && !this.fallbackMode) {
            await this.initializeWebRTC();
        }
        
        try {
            // Use WebRTC MediaRecorder if available for better audio quality
            if (this.audioStream && !this.fallbackMode) {
                return this.startWebRTCRecording();
            } else {
                // Fallback to basic speech recognition
                return this.startBasicRecording();
            }
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.onVoiceStateChange('error', error.message);
            return false;
        }
    }

    startWebRTCRecording() {
        try {
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.processAudioBlob(audioBlob);
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                this.onVoiceStateChange('error', 'Recording failed');
                this.fallbackMode = true;
                // Fallback to basic speech recognition
                this.startBasicRecording();
            };
            
            this.mediaRecorder.start(100); // Collect data every 100ms
            this.isRecording = true;
            this.onVoiceStateChange('recording');
            
            // Also start speech recognition for real-time transcription
            if (this.recognition) {
                this.recognition.start();
            }
            
            return true;
        } catch (error) {
            console.error('WebRTC recording failed:', error);
            this.fallbackMode = true;
            return this.startBasicRecording();
        }
    }

    startBasicRecording() {
        if (!this.recognition) {
            this.onVoiceStateChange('error', 'Speech recognition not available');
            return false;
        }
        
        try {
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('Failed to start speech recognition:', error);
            this.onVoiceStateChange('error', error.message);
            return false;
        }
    }

    async processAudioBlob(audioBlob) {
        // For now, we rely on the speech recognition API
        // In a production environment, you might send this to a server-side STT service
        console.log('Audio blob processed:', audioBlob.size, 'bytes');
        
        // The speech recognition API handles the actual transcription
        // This method is here for future enhancement with server-side STT
    }
    
    stopRecording() {
        if (!this.isRecording) {
            return;
        }
        
        // Stop MediaRecorder if active
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        
        // Stop speech recognition if active
        if (this.recognition && this.isRecording) {
            this.recognition.stop();
        }
        
        this.isRecording = false;
    }
    
    speak(text, options = {}) {
        if (!this.isSupported.synthesis) {
            console.warn('Speech synthesis not supported');
            return Promise.reject(new Error('Speech synthesis not supported'));
        }
        
        // Don't speak if in fallback mode and user hasn't explicitly enabled TTS
        if (this.fallbackMode && !options.force) {
            console.log('Skipping TTS in fallback mode');
            return Promise.resolve();
        }
        
        return new Promise((resolve, reject) => {
            try {
                // Cancel any ongoing speech
                this.synthesis.cancel();
                
                // Split long text into chunks to avoid browser limitations
                const chunks = this.splitTextIntoChunks(text, 200);
                this.speakChunks(chunks, options, resolve, reject);
                
            } catch (error) {
                console.error('Speech synthesis setup failed:', error);
                this.onVoiceStateChange('error', error.message);
                reject(error);
            }
        });
    }

    splitTextIntoChunks(text, maxLength) {
        if (text.length <= maxLength) {
            return [text];
        }
        
        const chunks = [];
        const sentences = text.split(/[.!?]+/);
        let currentChunk = '';
        
        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length <= maxLength) {
                currentChunk += sentence + '. ';
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence + '. ';
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks.filter(chunk => chunk.length > 0);
    }

    speakChunks(chunks, options, resolve, reject, index = 0) {
        if (index >= chunks.length) {
            this.onVoiceStateChange('idle');
            resolve();
            return;
        }
        
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        
        // Set voice options
        utterance.rate = options.rate || 0.9; // Slightly slower for better comprehension
        utterance.pitch = options.pitch || 1;
        utterance.volume = options.volume || 0.8;
        
        // Select the best available voice
        const voice = this.selectBestVoice(options.preferredVoice);
        if (voice) {
            utterance.voice = voice;
        }
        
        utterance.onstart = () => {
            if (index === 0) {
                this.onVoiceStateChange('speaking');
            }
        };
        
        utterance.onend = () => {
            // Continue with next chunk
            setTimeout(() => {
                this.speakChunks(chunks, options, resolve, reject, index + 1);
            }, 100); // Small pause between chunks
        };
        
        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event.error);
            this.onVoiceStateChange('error', event.error);
            
            // Try to continue with remaining chunks on non-critical errors
            if (event.error === 'interrupted' || event.error === 'canceled') {
                resolve(); // User likely stopped intentionally
            } else {
                reject(new Error(event.error));
            }
        };
        
        this.synthesis.speak(utterance);
    }

    selectBestVoice(preferredVoiceName) {
        const voices = this.synthesis.getVoices();
        
        if (!voices.length) {
            // Voices might not be loaded yet
            return null;
        }
        
        // Try preferred voice first
        if (preferredVoiceName) {
            const preferred = voices.find(voice => voice.name === preferredVoiceName);
            if (preferred) return preferred;
        }
        
        // Look for high-quality English voices
        const qualityVoices = voices.filter(voice => 
            voice.lang.startsWith('en') && 
            (voice.name.includes('Natural') || 
             voice.name.includes('Enhanced') || 
             voice.name.includes('Premium') ||
             voice.name.includes('Neural'))
        );
        
        if (qualityVoices.length > 0) {
            return qualityVoices[0];
        }
        
        // Fallback to any English voice
        const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));
        return englishVoices.length > 0 ? englishVoices[0] : voices[0];
    }
    
    stopSpeaking() {
        if (this.synthesis) {
            this.synthesis.cancel();
            this.onVoiceStateChange('idle');
        }
    }
    
    getVoices() {
        if (!this.isSupported.synthesis) {
            return [];
        }
        
        return this.synthesis.getVoices();
    }
    
    isVoiceSupported() {
        return this.isSupported.recognition || this.isSupported.synthesis;
    }
    
    isFullVoiceSupported() {
        return this.isSupported.full && !this.fallbackMode;
    }
    
    getRecordingState() {
        return this.isRecording;
    }
    
    getSupportedFeatures() {
        return {
            ...this.isSupported,
            fallbackMode: this.fallbackMode,
            hasAudioStream: !!this.audioStream
        };
    }
    
    async requestMicrophonePermission() {
        if (!this.isSupported.webrtc) {
            return false;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately, just testing permission
            return true;
        } catch (error) {
            console.warn('Microphone permission denied:', error);
            return false;
        }
    }
    
    setLanguage(language) {
        if (this.recognition) {
            this.recognition.lang = language;
        }
    }
    
    cleanup() {
        // Stop any ongoing operations
        this.stopRecording();
        this.stopSpeaking();
        
        // Clean up audio stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        // Clean up media recorder
        if (this.mediaRecorder) {
            this.mediaRecorder = null;
        }
        
        this.audioChunks = [];
    }
    
    // Test voice functionality
    async testVoiceFeatures() {
        const results = {
            recognition: false,
            synthesis: false,
            webrtc: false,
            microphone: false
        };
        
        // Test speech recognition
        if (this.isSupported.recognition) {
            results.recognition = true;
        }
        
        // Test speech synthesis
        if (this.isSupported.synthesis) {
            try {
                await this.speak('Test', { force: true });
                results.synthesis = true;
            } catch (error) {
                console.warn('TTS test failed:', error);
            }
        }
        
        // Test WebRTC
        if (this.isSupported.webrtc) {
            results.webrtc = true;
        }
        
        // Test microphone access
        results.microphone = await this.requestMicrophonePermission();
        
        return results;
    }
}

// Export for use in other modules
window.VoiceManager = VoiceManager;
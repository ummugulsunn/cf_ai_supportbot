import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Global test setup for frontend tests
global.WebSocket = class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    // Mock implementation
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
  }
} as any;

// Mock speech APIs (only in browser-like environment)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
    },
  });
} else {
  // Create global mocks for Node.js environment
  (global as any).speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    writable: true,
    value: class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = 'en-US';
      onstart: ((event: Event) => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: ((event: Event) => void) | null = null;

      start() {}
      stop() {}
    },
  });

  // Mock location for WebSocket URL construction
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      protocol: 'http:',
      host: 'localhost:3000',
    },
  });
} else {
  // Create global mocks for Node.js environment
  (global as any).webkitSpeechRecognition = class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = 'en-US';
    onstart: ((event: Event) => void) | null = null;
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: ((event: Event) => void) | null = null;

    start() {}
    stop() {}
  };
  
  (global as any).location = {
    protocol: 'http:',
    host: 'localhost:3000',
  };
}
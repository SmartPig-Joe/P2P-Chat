// constants.js

// --- WebRTC & WebSocket Constants ---
export const SIGNALING_SERVER_URL = 'wss://signal.smartpig.top/ws';
export const PEER_CONNECTION_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Feature Constants ---
export const TYPING_TIMER_LENGTH = 1500; // ms
export const FILE_CHUNK_SIZE = 16 * 1024; // 16 KB

// --- Crypto Constants ---
export const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
export const AES_PARAMS = { name: 'AES-GCM', length: 256 };
export const KEY_USAGE_ECDH = ['deriveKey', 'deriveBits'];
export const KEY_USAGE_AES = ['encrypt', 'decrypt']; 
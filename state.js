// state.js

// Define the key for localStorage
const LOCAL_USER_ID_KEY = 'p2pChatLocalUserId';

// Function to get or generate the local user ID
function initializeLocalUserId() {
    let userId = localStorage.getItem(LOCAL_USER_ID_KEY);
    if (!userId) {
        // Generate a new ID if none exists
        userId = `user-${Math.random().toString(36).substring(2, 8)}`;
        try {
            // Save the newly generated ID to localStorage
            localStorage.setItem(LOCAL_USER_ID_KEY, userId);
            console.log('Generated and saved new local user ID:', userId);
        } catch (e) {
            console.error('Failed to save local user ID to localStorage:', e);
            // Proceed with the generated ID even if saving failed
        }
    } else {
        console.log('Retrieved local user ID from localStorage:', userId);
    }
    return userId;
}

// --- WebRTC & WebSocket Globals ---
export let ws = null;
export let peerConnection = null;
export let dataChannel = null;
// Initialize localUserId using the function
export let localUserId = initializeLocalUserId();
export let remoteUserId = null;
export let isConnected = false;
export let isConnecting = false;

// --- Crypto State ---
export let localKeyPair = null;
export let sharedKey = null;
export let peerPublicKey = null;

// --- Typing Indicator State ---
export let typingTimeout = null;
export let isTyping = false; // Track if *local* user is typing
export let peerIsTyping = false; // Track if *remote* user is typing

// --- File Transfer State ---
export let incomingFiles = {}; // Store incoming file chunks { transferId: { info: {}, chunks: [], receivedSize: 0 } }

// --- Functions to update state ---
export function setWs(newWs) { ws = newWs; }
export function setPeerConnection(newPc) { peerConnection = newPc; }
export function setDataChannel(newDc) { dataChannel = newDc; }
export function setRemoteUserId(newId) { remoteUserId = newId; }
export function setIsConnected(status) { isConnected = status; }
export function setIsConnecting(status) { isConnecting = status; }
export function setLocalKeyPair(keyPair) { localKeyPair = keyPair; }
export function setSharedKey(key) { sharedKey = key; }
export function setPeerPublicKey(key) { peerPublicKey = key; }
export function setTypingTimeout(timeoutId) { typingTimeout = timeoutId; }
export function setIsTyping(status) { isTyping = status; }
export function setPeerIsTyping(status) { peerIsTyping = status; }
export function setIncomingFiles(files) { incomingFiles = files; }

// Function to reset parts of the state related to a connection
export function resetConnectionState() {
    if (dataChannel) {
        try { dataChannel.close(); } catch (e) { console.warn("Error closing data channel:", e); }
    }
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) { console.warn("Error closing peer connection:", e); }
    }
    setDataChannel(null);
    setPeerConnection(null);
    let previousRemoteUserId = remoteUserId;
    setRemoteUserId(null);
    setIsConnected(false);
    setIsConnecting(false);
    setLocalKeyPair(null);
    setSharedKey(null);
    setPeerPublicKey(null);
    // Reset typing state
    clearTimeout(typingTimeout);
    setTypingTimeout(null);
    setIsTyping(false);
    setPeerIsTyping(false);
    // Reset file transfer state
    setIncomingFiles({});

    return previousRemoteUserId; // Return the previous remote user ID for logging purposes
} 
// state.js

// Define the key for localStorage
const LOCAL_USER_ID_KEY = 'p2pChatLocalUserId';
const CONTACTS_STORAGE_KEY = 'p2pChatContacts'; // Key for contacts in localStorage

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

// --- Contact List State ---
export let contacts = {}; // { peerId: { id: string, name: string, online: boolean } }

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
export function setContacts(newContacts) { contacts = newContacts; }
export function setLocalKeyPair(keyPair) { localKeyPair = keyPair; }
export function setSharedKey(key) { sharedKey = key; }
export function setPeerPublicKey(key) { peerPublicKey = key; }
export function setTypingTimeout(timeoutId) { typingTimeout = timeoutId; }
export function setIsTyping(status) { isTyping = status; }
export function setPeerIsTyping(status) { peerIsTyping = status; }
export function setIncomingFiles(files) { incomingFiles = files; }

// --- Contact Management Functions ---

export function loadContacts() {
    try {
        const storedContacts = localStorage.getItem(CONTACTS_STORAGE_KEY);
        if (storedContacts) {
            const parsedContacts = JSON.parse(storedContacts);
            // Ensure all loaded contacts have the 'online' property (default to false)
            Object.values(parsedContacts).forEach(contact => {
                if (contact.online === undefined) {
                    contact.online = false;
                }
                 // Use ID as default name if name is missing
                if (!contact.name) {
                    contact.name = contact.id;
                }
            });
            setContacts(parsedContacts);
            console.log("Loaded contacts from localStorage:", contacts);
        } else {
            console.log("No contacts found in localStorage.");
            setContacts({}); // Initialize empty if nothing is stored
        }
    } catch (e) {
        console.error("Failed to load contacts from localStorage:", e);
        setContacts({}); // Reset to empty on error
    }
}

export function saveContacts() {
    try {
        localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
        console.log("Saved contacts to localStorage:", contacts);
    } catch (e) {
        console.error("Failed to save contacts to localStorage:", e);
    }
}

export function addContact(peerId) {
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.warn("Attempted to add invalid peer ID:", peerId);
        return false;
    }
     const trimmedId = peerId.trim();
    if (trimmedId === localUserId) {
        console.warn("Cannot add yourself as a contact.");
        return false;
    }
    if (contacts[trimmedId]) {
        console.log(`Contact ${trimmedId} already exists.`);
        return true; // Already exists, consider it a success
    }
    const newContact = {
        id: trimmedId,
        name: trimmedId, // Default name to ID, can be changed later
        online: false    // Initially offline
    };
    const updatedContacts = { ...contacts, [trimmedId]: newContact };
    setContacts(updatedContacts);
    saveContacts(); // Save immediately after adding
    console.log(`Added new contact: ${trimmedId}`);
    return true;
}

export function updateContactStatus(peerId, isOnline) {
    if (contacts[peerId]) {
        const updatedContact = { ...contacts[peerId], online: isOnline };
        const updatedContacts = { ...contacts, [peerId]: updatedContact };
        setContacts(updatedContacts);
        // Note: We don't save to localStorage here, as status is transient.
        // Status will be reset to offline on next load unless re-established.
        console.log(`Updated status for ${peerId}: ${isOnline ? 'online' : 'offline'}`);
    } else {
         // This might happen if a connection occurs with a non-saved contact (e.g., direct link)
         // Optionally add them temporarily or ignore
         console.log(`Received status update for non-contact: ${peerId}`);
    }
}

// Function to reset parts of the state related to a connection
export function resetConnectionState() {
    if (dataChannel) {
        try { dataChannel.close(); } catch (e) { console.warn("Error closing data channel:", e); }
    }
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) { console.warn("Error closing peer connection:", e); }
    }
    let previousRemoteUserId = remoteUserId;
    setDataChannel(null);
    setPeerConnection(null);
    setRemoteUserId(null);
    setIsConnected(false);
    setIsConnecting(false);
    setSharedKey(null);
    setPeerPublicKey(null);
    clearTimeout(typingTimeout);
    setTypingTimeout(null);
    setIsTyping(false);
    setPeerIsTyping(false);
    setIncomingFiles({});

    // Update the status of the previously connected peer to offline
    if (previousRemoteUserId) {
        updateContactStatus(previousRemoteUserId, false);
        // Note: UI update for this status change should be triggered separately if needed
    }

    return previousRemoteUserId;
}

// ... 其他状态管理逻辑 ... 
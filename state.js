// state.js

// Define the key for localStorage
const LOCAL_USER_ID_KEY = 'p2pChatLocalUserId';
const CONTACTS_STORAGE_KEY = 'p2pChatContacts'; // Key for contacts in localStorage
const PENDING_INCOMING_REQUESTS_KEY = 'p2pChatPendingIncoming'; // Key for pending incoming requests (optional persistence)
const PENDING_OUTGOING_REQUESTS_KEY = 'p2pChatPendingOutgoing'; // Key for pending outgoing requests (optional persistence)

// Function to get or generate the local user ID
function initializeLocalUserId() {
    let userId = localStorage.getItem(LOCAL_USER_ID_KEY);
    if (!userId) {
        userId = `user-${Math.random().toString(36).substring(2, 8)}`;
        try {
            localStorage.setItem(LOCAL_USER_ID_KEY, userId);
            console.log('Generated and saved new local user ID:', userId);
        } catch (e) {
            console.error('Failed to save local user ID to localStorage:', e);
        }
    } else {
        console.log('Retrieved local user ID from localStorage:', userId);
    }
    return userId;
}

// --- Global State ---
export let ws = null; // Single WebSocket connection
export const localUserId = initializeLocalUserId(); // Unique ID for this client
export let localKeyPair = null; // Cryptographic key pair for this client
export let contacts = {}; // { peerId: { id: string, name: string, online: boolean | 'connecting' } }
export let activeChatPeerId = null; // Which peer's chat window is currently active

// --- Per-Peer State (Managed via Dictionaries/Maps) ---
const peerConnections = new Map(); // Map<peerId, RTCPeerConnection>
const dataChannels = new Map(); // Map<peerId, RTCDataChannel>
const connectionStates = new Map(); // Map<peerId, 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'>
const peerKeys = new Map(); // Map<peerId, { sharedKey: CryptoKey, peerPublicKey: CryptoKey }> // Store crypto keys per peer
const peerTypingStatus = new Map(); // Map<peerId, boolean>
const makingOfferFlags = new Map(); // Map<peerId, boolean> // True if we are initiating offer to peerId
const connectionTimeouts = new Map(); // Map<peerId, number> // Store setTimeout IDs

// --- Typing Indicator State (Local User) ---
export let typingTimeout = null; // Timeout for sending local "stopped typing" indicator
export let isTyping = false; // Track if *local* user is typing

// --- File Transfer State (Consider if needs per-peer isolation later) ---
export let incomingFiles = {}; // Store incoming file chunks { transferId: { info: {}, chunks: [], receivedSize: 0, peerId: string } }

// --- NEW: Friend Request State ---
// IDs of users we have sent a friend request to and are awaiting response
export let pendingOutgoingRequests = new Set();
// Map of users who have sent us a friend request { peerId: { id: string, name?: string, timestamp: number } }
export let pendingIncomingRequests = new Map();

// --- Functions to update global state ---
export function setWs(newWs) { ws = newWs; }
export function setLocalKeyPair(keyPair) { localKeyPair = keyPair; }
export function setContacts(newContacts) { contacts = newContacts; }
export function setActiveChat(peerId) {
    activeChatPeerId = peerId;
    console.log(`Active chat set to: ${peerId}`);
    // Optionally clear typing status for the new active chat immediately?
    setPeerIsTyping(peerId, false);
}
export function getActiveChatPeerId() { return activeChatPeerId; }
export function isActiveChat(peerId) { return activeChatPeerId === peerId; }
export function setTypingTimeout(timeoutId) { typingTimeout = timeoutId; }
export function setIsTyping(status) { isTyping = status; }
export function setIncomingFiles(files) { incomingFiles = files; } // Keep for now, may need rework

// --- NEW: Functions to manage Friend Request State ---

// Store outgoing request ID
export function addPendingOutgoingRequest(peerId) {
    pendingOutgoingRequests.add(peerId);
    savePendingRequests(); // Optional: Persist
    console.log(`Added pending outgoing request for: ${peerId}`);
}

export function removePendingOutgoingRequest(peerId) {
    const deleted = pendingOutgoingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests(); // Optional: Persist
        console.log(`Removed pending outgoing request for: ${peerId}`);
    }
    return deleted;
}

export function hasPendingOutgoingRequest(peerId) {
    return pendingOutgoingRequests.has(peerId);
}

// Store incoming request details
export function addPendingIncomingRequest(request) { // request: { id: string, name?: string, timestamp: number }
    if (!request || !request.id) return false;
    pendingIncomingRequests.set(request.id, request);
    savePendingRequests(); // Optional: Persist
    console.log(`Added pending incoming request from: ${request.id}`);
    return true;
}

export function removePendingIncomingRequest(peerId) {
    const deleted = pendingIncomingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests(); // Optional: Persist
        console.log(`Removed pending incoming request from: ${peerId}`);
    }
    return deleted;
}

export function getPendingIncomingRequest(peerId) {
    return pendingIncomingRequests.get(peerId);
}

export function hasPendingIncomingRequest(peerId) {
    return pendingIncomingRequests.has(peerId);
}

// --- Functions to manage Per-Peer State ---

// Peer Connections
export function getPeerConnection(peerId) { return peerConnections.get(peerId); }
export function setPeerConnection(peerId, pc) { peerConnections.set(peerId, pc); }
export function removePeerConnection(peerId) { peerConnections.delete(peerId); }

// Data Channels
export function getDataChannel(peerId) { return dataChannels.get(peerId); }
export function setDataChannel(peerId, dc) { dataChannels.set(peerId, dc); }
export function removeDataChannel(peerId) { dataChannels.delete(peerId); }

// Connection States (Consolidated)
export function getConnectionState(peerId) { return connectionStates.get(peerId) || 'new'; } // Default to 'new' if unknown
export function updateConnectionState(peerId, state) {
    console.log(`Updating connection state for ${peerId} to ${state}`);
    connectionStates.set(peerId, state);
    // Update contact online status based on connection state
    let onlineStatus;
    switch (state) {
        case 'connected':
             // Only truly 'online' if data channel is also open
            const dc = getDataChannel(peerId);
             onlineStatus = (dc && dc.readyState === 'open') ? true : 'connecting';
            break;
        case 'connecting':
            onlineStatus = 'connecting';
            break;
        case 'new':
        case 'disconnected':
        case 'failed':
        case 'closed':
        default:
            onlineStatus = false;
            break;
    }
     updateContactStatus(peerId, onlineStatus); // Update visual status
}

// Helper for connection.js checks
export function isPeerConnectionActiveOrPending(peerId) {
    const state = getConnectionState(peerId);
    return state === 'connected' || state === 'connecting';
}

// Crypto Keys (Per Peer)
export function getPeerKeys(peerId) { return peerKeys.get(peerId); }
export function setPeerKeys(peerId, keys) { peerKeys.set(peerId, keys); }
export function removePeerKeys(peerId) { peerKeys.delete(peerId); }

// Peer Typing Status
export function getPeerIsTyping(peerId) { return peerTypingStatus.get(peerId) || false; }
export function setPeerIsTyping(peerId, status) { peerTypingStatus.set(peerId, status); }
export function removePeerTypingStatus(peerId) { peerTypingStatus.delete(peerId); }

// Offer Flags
export function isMakingOffer(peerId) { return makingOfferFlags.get(peerId) || false; }
export function setIsMakingOffer(peerId, status) { makingOfferFlags.set(peerId, status); }
export function removeMakingOfferFlag(peerId) { makingOfferFlags.delete(peerId); }
// Helper for checking if we expect an answer
export function isExpectingAnswerFrom(peerId) { return isMakingOffer(peerId); }

// Connection Timeouts
export function setConnectionTimeout(peerId, timeoutId) { connectionTimeouts.set(peerId, timeoutId); }
export function clearConnectionTimeout(peerId) {
    const timeoutId = connectionTimeouts.get(peerId);
    if (timeoutId) {
        clearTimeout(timeoutId);
        connectionTimeouts.delete(peerId);
    }
}

// --- State Update Functions (Called by connection.js event handlers) ---
// These can call updateConnectionState or update contact status directly

export function updateIceConnectionState(peerId, iceState) {
    console.log(`ICE state for ${peerId}: ${iceState}`);
    // We might use the overall pc.connectionState more, but can track ICE state if needed
    // Example: If ICE fails, directly update overall state
    if (iceState === 'failed') {
        updateConnectionState(peerId, 'failed');
    } else if (iceState === 'closed' || iceState === 'disconnected') {
         // If already connected, mark as disconnected, otherwise could be failed/closed setup
         if (getConnectionState(peerId) === 'connected') {
             updateConnectionState(peerId, 'disconnected');
         } else if (getConnectionState(peerId) !== 'failed' && getConnectionState(peerId) !== 'closed'){
             updateConnectionState(peerId, iceState); // Reflect closed/disconnected early if not yet connected
         }
    }
    // Note: 'connected' and 'completed' ICE states don't guarantee usability, wait for overall state or data channel
}

export function updateOverallConnectionState(peerId, overallState) {
    console.log(`Overall connection state for ${peerId}: ${overallState}`);
    updateConnectionState(peerId, overallState);
}

export function updateSignalingState(peerId, signalingState) {
    console.log(`Signaling state for ${peerId}: ${signalingState}`);
    if (signalingState === 'closed') {
        // Ensure connection state reflects closure if not already failed/disconnected
        const currentState = getConnectionState(peerId);
        if (currentState !== 'failed' && currentState !== 'disconnected' && currentState !== 'closed') {
             updateConnectionState(peerId, 'closed');
        }
    }
    // Can track signaling state specifically if needed: signalingStates.set(peerId, signalingState);
}

export function updateDataChannelState(peerId, dcState) {
     console.log(`Data channel state for ${peerId}: ${dcState}`);
     if (dcState === 'open') {
         // If overall connection is also 'connected', mark as fully online
         if (getConnectionState(peerId) === 'connected') {
             updateContactStatus(peerId, true); // Now truly online
         }
     } else if (dcState === 'closed') {
         // If data channel closes, consider the connection closed/disconnected
          const currentState = getConnectionState(peerId);
          if (currentState !== 'failed' && currentState !== 'disconnected' && currentState !== 'closed') {
             updateConnectionState(peerId, 'closed'); // Treat DC close as connection end
         }
     }
     // Can track DC state specifically if needed: dataChannelStates.set(peerId, dcState);
}


// --- Contact Management Functions (Modified) ---

// NEW: Optional function to load pending requests from localStorage
export function loadPendingRequests() {
    try {
        const storedOutgoing = localStorage.getItem(PENDING_OUTGOING_REQUESTS_KEY);
        if (storedOutgoing) {
            pendingOutgoingRequests = new Set(JSON.parse(storedOutgoing));
            console.log("Loaded pending outgoing requests:", pendingOutgoingRequests);
        }
        const storedIncoming = localStorage.getItem(PENDING_INCOMING_REQUESTS_KEY);
        if (storedIncoming) {
            pendingIncomingRequests = new Map(JSON.parse(storedIncoming));
            console.log("Loaded pending incoming requests:", pendingIncomingRequests);
        }
    } catch (e) {
        console.error("Failed to load pending requests from localStorage:", e);
        pendingOutgoingRequests = new Set();
        pendingIncomingRequests = new Map();
    }
}

// NEW: Optional function to save pending requests to localStorage
function savePendingRequests() {
     // Note: Saving pending requests might lead to stale state if the app closes unexpectedly.
     // Consider if persistence is truly needed or if requests should be transient.
     // For now, let's implement saving but be aware of potential issues.
    try {
        localStorage.setItem(PENDING_OUTGOING_REQUESTS_KEY, JSON.stringify(Array.from(pendingOutgoingRequests)));
        localStorage.setItem(PENDING_INCOMING_REQUESTS_KEY, JSON.stringify(Array.from(pendingIncomingRequests.entries())));
    } catch (e) {
        console.error("Failed to save pending requests to localStorage:", e);
    }
}

export function loadContacts() {
    try {
        const storedContacts = localStorage.getItem(CONTACTS_STORAGE_KEY);
        if (storedContacts) {
            const parsedContacts = JSON.parse(storedContacts);
            const validatedContacts = {};
            Object.values(parsedContacts).forEach(contact => {
                if (contact && contact.id) { // Basic validation
                     validatedContacts[contact.id] = {
                        id: contact.id,
                        name: contact.name || contact.id, // Default name to ID
                        online: false // ALWAYS initialize as offline on load
                    };
                }
            });
            setContacts(validatedContacts);
            console.log("Loaded contacts from localStorage (status reset to offline):", contacts);
        } else {
            console.log("No contacts found in localStorage.");
            setContacts({});
        }
    } catch (e) {
        console.error("Failed to load contacts from localStorage:", e);
        setContacts({});
    }
}

export function saveContacts() {
    try {
        // Only save ID and name, not transient online status
        const contactsToSave = {};
        Object.values(contacts).forEach(contact => {
            contactsToSave[contact.id] = { id: contact.id, name: contact.name };
        });
        localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contactsToSave));
        console.log("Saved contacts (ID and name only) to localStorage:", contactsToSave);
    } catch (e) {
        console.error("Failed to save contacts to localStorage:", e);
    }
}

// Modified addContact: Now potentially called when accepting a request
// Need to ensure we don't re-add if already exists
export function addContact(peerId, name = null) {
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.warn("Attempted to add invalid peer ID:", peerId);
        return false;
    }
    const trimmedId = peerId.trim();
    if (trimmedId === localUserId) {
        console.warn("Cannot add yourself as a contact.");
        return false;
    }

    const existingContact = contacts[trimmedId];
    const nameToUse = name || trimmedId; // Use provided name or default to ID

    if (existingContact) {
        console.log(`Contact ${trimmedId} already exists.`);
        // Update name if a new one is provided and different
        if (existingContact.name !== nameToUse) {
             existingContact.name = nameToUse;
             saveContacts();
             console.log(`Updated name for contact ${trimmedId} to ${nameToUse}`);
             // TODO: Need UI update for name change
             // ui.updateContactName(trimmedId, name); // Needs implementation in ui.js
        }
        return true; // Indicate contact exists or was updated
    }

    // Contact doesn't exist, add new
    const newContact = {
        id: trimmedId,
        name: nameToUse,
        online: false // Initialize as offline, status updated by connection logic
    };
    const updatedContacts = { ...contacts, [trimmedId]: newContact };
    setContacts(updatedContacts);
    saveContacts();
    console.log(`Added new contact: ${trimmedId}`);
    // TODO: Need UI update to add contact to list
    // ui.addContactToList(newContact); // Needs implementation in ui.js
    return true; // Indicate new contact was added
}

export function updateContactStatus(peerId, status) { // status: boolean | 'connecting'
    if (!contacts[peerId]) {
         // If status update is for an unknown peer, maybe add them? Or ignore.
         console.log(`Received status update for non-contact: ${peerId}. Status: ${status}`);
         // Option: Add the contact temporarily if they are connecting/connected
         // if (status === 'connecting' || status === true) {
         //    addContact(peerId); // Adds with ID as name, marks offline initially
         // } else {
             return; // Ignore status updates for non-contacts otherwise
         // }
         // For now, only update known contacts
         return;
    }

    if (contacts[peerId].online !== status) {
        const updatedContact = { ...contacts[peerId], online: status };
        const updatedContacts = { ...contacts, [peerId]: updatedContact };
        setContacts(updatedContacts);
        // No saving here, status is transient.
        console.log(`Updated status for ${peerId}: ${status}`);
         // UI update should be triggered by the caller (e.g., updateConnectionState)
         // Or called directly here: ui.updateContactStatusUI(peerId, status);
    }
}

// 新增：删除联系人函数
export function removeContact(peerId) {
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.warn("Attempted to remove invalid peer ID:", peerId);
        return false;
    }
    const trimmedId = peerId.trim();
    if (!contacts[trimmedId]) {
        console.log(`Contact ${trimmedId} does not exist.`);
        return false; // Contact doesn't exist
    }

    console.log(`Attempting to remove contact: ${trimmedId}`);

    // 1. 从 contacts 对象中删除
    const updatedContacts = { ...contacts };
    delete updatedContacts[trimmedId];
    setContacts(updatedContacts);

    // 2. 保存更新后的联系人列表
    saveContacts(); // 保存变更

    // 3. 重置与该 peer 相关的所有连接状态 (重要!)
    resetPeerState(trimmedId); // 调用 resetPeerState 清理连接

    // 4. (可选) 如果当前活动聊天是此联系人，则清除活动聊天
    if (activeChatPeerId === trimmedId) {
        setActiveChat(null);
        // UI 更新应由调用者处理 (例如 ui.js 中的 renderContactList 和 updateChatHeader)
    }

    console.log(`Contact ${trimmedId} removed successfully.`);
    return true;
}

// --- Reset Functions ---

// Reset state for a *specific* peer
// --- MODIFIED: Only clear connection-related state, not keys or requests ---
export function resetPeerState(peerId) {
    if (!peerId) return;
    console.log(`[RESET] Resetting connection state for peer: ${peerId}`); // Keep log

    // Get PC and DC before removing from maps
    const pc = getPeerConnection(peerId);
    const dc = getDataChannel(peerId);

    // Close connections
    if (dc) {
        try { dc.close(); } catch (e) { console.warn(`Error closing data channel for ${peerId}:`, e); }
    }
    if (pc) {
        try { pc.close(); } catch (e) { console.warn(`Error closing PeerConnection for ${peerId}:`, e); }
    }

    // Clear connection-specific state maps
    removePeerConnection(peerId);
    removeDataChannel(peerId);
    connectionStates.delete(peerId);
    // removePeerKeys(peerId); // DO NOT REMOVE KEYS on simple connection reset
    removePeerTypingStatus(peerId);
    removeMakingOfferFlag(peerId);
    clearConnectionTimeout(peerId); // Ensure connection attempt timeout is cleared

    // --- DO NOT Clear pending requests related to this peer on simple reset ---
    // removePendingOutgoingRequest(peerId);
    // removePendingIncomingRequest(peerId);
    // --- END MODIFICATION ---

    // Update contact status to offline (or connecting if a new attempt starts immediately)
    // Let the calling function (like connectToPeer) handle setting the 'connecting' status if needed.
    // Setting to false here might cause a brief flicker. Let's just reset the *connection* state maps.
    // The UI update should reflect the connectionState.
    // updateContactStatus(peerId, false); // Maybe remove this direct call, rely on connectionState updates

    // If this was the active chat, DO NOT clear it just because connection resets
    // if (isActiveChat(peerId)) {
    //     setActiveChat(null);
    // }

     console.log(`Finished resetting connection-specific state for ${peerId}`); // Adjusted log message
}

// Reset state for *all* peers (e.g., on WebSocket disconnect)
// --- NOTE: This function *should* still clear everything, including keys and requests ---
export function resetAllConnections() {
     console.log("Resetting all peer connections and states.");
     const peerIds = Array.from(peerConnections.keys()); // Get all peers we had connections for
     peerIds.forEach(peerId => {
         // Call the original logic implicitly here, or redefine a full reset
         // For safety, let's explicitly clear everything this function intended to clear

         // Get PC and DC before removing from maps
         const pc = getPeerConnection(peerId);
         const dc = getDataChannel(peerId);

         // Close connections
         if (dc) {
             try { dc.close(); } catch (e) { console.warn(`Error closing data channel for ${peerId} during full reset:`, e); }
         }
         if (pc) {
             try { pc.close(); } catch (e) { console.warn(`Error closing PeerConnection for ${peerId} during full reset:`, e); }
         }

         // Clear ALL state maps for this peer
         removePeerConnection(peerId);
         removeDataChannel(peerId);
         connectionStates.delete(peerId);
         removePeerKeys(peerId); // Clear keys on full reset
         removePeerTypingStatus(peerId);
         removeMakingOfferFlag(peerId);
         clearConnectionTimeout(peerId);
         removePendingOutgoingRequest(peerId); // Clear outgoing requests on full reset
         removePendingIncomingRequest(peerId); // Clear incoming requests on full reset

         // Update contact status to offline
         updateContactStatus(peerId, false);

         // If this was the active chat, clear it
         if (isActiveChat(peerId)) {
             setActiveChat(null);
         }

     });
     // Also clear any other potentially relevant global state if needed
     setIncomingFiles({}); // Clear file transfer state
     // --- Clearing pending requests is now handled inside the loop ---
     // pendingOutgoingRequests.clear(); // Redundant
     // pendingIncomingRequests.clear(); // Redundant
     // savePendingRequests(); // Persist the cleared state - Maybe save after loop?

     // Persist cleared pending requests after the loop
     savePendingRequests();

     console.log("Finished resetting all connections.");
}


// REMOVE OLD Single-Connection state variables and reset function
/*
export let peerConnection = null;
export let dataChannel = null;
export let remoteUserId = null;
export let isConnected = false;
export let isConnecting = false;
export let sharedKey = null;
export let peerPublicKey = null;
export let peerIsTyping = false; // Track if *remote* user is typing

export function setPeerConnection(newPc) { peerConnection = newPc; }
export function setDataChannel(newDc) { dataChannel = newDc; }
export function setRemoteUserId(newId) { remoteUserId = newId; }
export function setIsConnected(status) { isConnected = status; }
export function setIsConnecting(status) { isConnecting = status; }
export function setSharedKey(key) { sharedKey = key; }
export function setPeerPublicKey(key) { peerPublicKey = key; }
export function setPeerIsTyping(status) { peerIsTyping = status; }

// OLD reset function - replaced by resetPeerState(peerId) and resetAllConnections()
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
    clearTimeout(typingTimeout); // Keep local typing timeout clear logic maybe? -> No, handled globally
    // setTypingTimeout(null); // Handled globally
    // setIsTyping(false); // Handled globally
    setPeerIsTyping(false); // Remove this
    setIncomingFiles({});

    // Update the status of the previously connected peer to offline
    if (previousRemoteUserId) {
        updateContactStatus(previousRemoteUserId, false);
        // Note: UI update for this status change should be triggered separately if needed
    }

    return previousRemoteUserId; // No longer needed
}
*/ 
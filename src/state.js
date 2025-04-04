// state.js

// Define the key for localStorage
const LOCAL_USER_ID_KEY = 'p2pChatLocalUserId';
const LOCAL_NICKNAME_KEY = 'p2pChatLocalNickname'; // New key for nickname
const LOCAL_AVATAR_KEY = 'p2pChatLocalAvatar';   // New key for avatar
const CONTACTS_STORAGE_KEY = 'p2pChatContacts'; // Key for contacts in localStorage
const PENDING_INCOMING_REQUESTS_KEY = 'p2pChatPendingIncoming'; // Key for pending incoming requests (optional persistence)
const PENDING_OUTGOING_REQUESTS_KEY = 'p2pChatPendingOutgoing'; // Key for pending outgoing requests (optional persistence)

// Function to get or generate the local user ID, nickname, and avatar
function initializeLocalProfile() {
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

    // Initialize nickname
    let nickname = localStorage.getItem(LOCAL_NICKNAME_KEY);
    if (!nickname) {
        nickname = userId; // Default nickname to user ID
        try {
            localStorage.setItem(LOCAL_NICKNAME_KEY, nickname);
            console.log('Initialized default nickname:', nickname);
        } catch (e) {
            console.error('Failed to save default nickname to localStorage:', e);
        }
    } else {
        console.log('Retrieved nickname from localStorage:', nickname);
    }

    // Initialize avatar (using a simple placeholder/default for now)
    let avatar = localStorage.getItem(LOCAL_AVATAR_KEY);
    if (!avatar) {
        avatar = 'default_avatar.png'; // You might want a better default or logic
        try {
            localStorage.setItem(LOCAL_AVATAR_KEY, avatar);
            console.log('Initialized default avatar:', avatar);
        } catch (e) {
            console.error('Failed to save default avatar to localStorage:', e);
        }
    } else {
        console.log('Retrieved avatar from localStorage:', avatar);
    }


    return { userId, nickname, avatar };
}

// --- Global State ---
export let ws = null; // Single WebSocket connection
const initialProfile = initializeLocalProfile(); // Initialize user profile
export const localUserId = initialProfile.userId; // Unique ID for this client (immutable)
export let localUserNickname = initialProfile.nickname; // User's chosen nickname (mutable)
export let localUserAvatar = initialProfile.avatar; // User's chosen avatar (mutable)
export let localKeyPair = null; // Cryptographic key pair for this client
// --- MODIFIED contacts structure ---
// { peerId: { id: string, name: string, online: boolean | 'connecting', avatar: string, friendStatus: 'confirmed' | 'pending_outgoing' | 'pending_incoming' | 'removed_by_peer' } }
export let contacts = {};
// --- END MODIFICATION ---
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
    // --- NEW: Update contact status if exists ---
    if (contacts[peerId]) {
        setContactFriendStatus(peerId, 'pending_outgoing');
    }
    // --- END NEW ---
    console.log(`Added pending outgoing request for: ${peerId}`);
}

export function removePendingOutgoingRequest(peerId) {
    const deleted = pendingOutgoingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests(); // Optional: Persist
        // --- NEW: Update contact status if exists (e.g., cancelled/declined) ---
        if (contacts[peerId]) {
            setContactFriendStatus(peerId, 'removed_by_peer');
        }
        // --- END NEW ---
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
    const peerId = request.id;
    pendingIncomingRequests.set(peerId, request);
    savePendingRequests(); // Optional: Persist
    // --- NEW: Update contact status if exists ---
    if (contacts[peerId]) {
        setContactFriendStatus(peerId, 'pending_incoming');
    }
    // --- END NEW ---
    console.log(`Added pending incoming request from: ${peerId}`);
    return true;
}

export function removePendingIncomingRequest(peerId) {
    const deleted = pendingIncomingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests(); // Optional: Persist
        // --- REMOVED: Status update logic moved to UI handlers --- //
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
                        online: false, // ALWAYS initialize as offline on load
                        avatar: contact.avatar || 'default_avatar.png', // Use provided avatar or default
                        // --- ADDED: Load friendStatus, default to 'confirmed' --- //
                        friendStatus: contact.friendStatus || 'confirmed' // Default existing contacts to confirmed
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
        // Save ID, name, avatar, and friendStatus
        const contactsToSave = {};
        Object.values(contacts).forEach(contact => {
            contactsToSave[contact.id] = {
                id: contact.id,
                name: contact.name,
                avatar: contact.avatar,
                friendStatus: contact.friendStatus // Include friendStatus
            };
        });
        localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contactsToSave));
        console.log("Saved contacts (ID, name, avatar, friendStatus) to localStorage:", contactsToSave);
    } catch (e) {
        console.error("Failed to save contacts to localStorage:", e);
    }
}

// --- NEW: Function to update details for an existing contact --- //
// Note: This function intentionally does NOT modify friendStatus
export function updateContactDetails(peerId, details) { // details: { nickname?: string, avatar?: string }
    console.log(`[State updateContactDetails] Called for peer: ${peerId} with details:`, details); // <-- ADD LOG

    if (!contacts[peerId]) {
        console.warn(`[State] Attempted to update details for non-existent contact: ${peerId}`);
        return false;
    }

    let changed = false;
    const contact = contacts[peerId];
    const oldContactState = { ...contact }; // <-- ADD LOG (Capture old state)

    // Update nickname if provided and different
    if (details.nickname && typeof details.nickname === 'string' && contact.name !== details.nickname.trim()) {
        contact.name = details.nickname.trim();
        console.log(`[State] Updated contact ${peerId} nickname to: ${contact.name}`);
        changed = true;
    }

    // Update avatar if provided and different
    // Ensure we handle null/undefined/empty string vs. 'default_avatar.png'
    const newAvatar = (details.avatar && typeof details.avatar === 'string') ? details.avatar.trim() : 'default_avatar.png';
    if (contact.avatar !== newAvatar) {
        contact.avatar = newAvatar;
        console.log(`[State] Updated contact ${peerId} avatar to: ${contact.avatar}`);
        changed = true;
    }

    if (changed) {
        console.log(`[State updateContactDetails] Changes detected for ${peerId}. Old state:`, oldContactState, "New state:", contact); // <-- ADD LOG
        // Save contacts if any details were actually updated
        saveContacts();
    } else {
         console.log(`[State updateContactDetails] No changes applied for ${peerId}.`); // <-- ADD LOG
    }
    return changed;
}
// --- END NEW --- //

// Modified addContact: Accepts optional initial friendStatus
export function addContact(peerId, name = null, initialFriendStatus = 'confirmed') {
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
        // Only update name if different, DO NOT change friendStatus here
        if (existingContact.name !== nameToUse) {
             existingContact.name = nameToUse;
             saveContacts();
             console.log(`Updated name for existing contact ${trimmedId} to ${nameToUse}`);
             // UI update should happen elsewhere
        }
        // Optionally update avatar too if a new one is implied?
        return true; // Indicate contact exists or was updated
    }

    // Contact doesn't exist, add new
    const newContact = {
        id: trimmedId,
        name: nameToUse,
        online: false, // Initialize as offline, status updated by connection logic
        avatar: 'default_avatar.png', // Use default avatar
        friendStatus: initialFriendStatus // Use provided initial status
    };
    const updatedContacts = { ...contacts, [trimmedId]: newContact };
    setContacts(updatedContacts);
    saveContacts();
    console.log(`Added new contact: ${trimmedId} with friendStatus: ${initialFriendStatus}`);
    // UI update should happen elsewhere
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


// NEW: Check WebSocket connection status
export function isSignalingConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
}

// --- NEW: Functions to update local user profile ---
export function setLocalNickname(newNickname) {
    if (newNickname && newNickname.trim()) {
        localUserNickname = newNickname.trim();
        try {
            localStorage.setItem(LOCAL_NICKNAME_KEY, localUserNickname);
            console.log('Updated and saved local nickname:', localUserNickname);
            // TODO: Notify peers about the nickname change
            // broadcastProfileUpdate(); // Example function call
        } catch (e) {
            console.error('Failed to save nickname to localStorage:', e);
        }
    }
}

export function setLocalAvatar(newAvatar) {
    // Basic validation, adjust as needed (e.g., check if it's a valid URL or identifier)
    if (newAvatar && newAvatar.trim()) {
        localUserAvatar = newAvatar.trim();
        try {
            localStorage.setItem(LOCAL_AVATAR_KEY, localUserAvatar);
            console.log('Updated and saved local avatar:', localUserAvatar);
            // TODO: Notify peers about the avatar change
            // broadcastProfileUpdate(); // Example function call
        } catch (e) {
            console.error('Failed to save avatar to localStorage:', e);
        }
    }
}

// --- NEW: Function to explicitly set friend status --- //
export function setContactFriendStatus(peerId, status) {
    if (contacts[peerId]) {
        if (contacts[peerId].friendStatus !== status) {
            contacts[peerId].friendStatus = status;
            console.log(`[State] Set friendStatus for ${peerId} to ${status}`);
            saveContacts(); // Save the change
            return true;
        }
    } else {
        console.warn(`[State] Cannot set friendStatus for non-existent contact: ${peerId}`);
    }
    return false;
}
// --- END NEW --- // 
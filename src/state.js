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
let _ws = null; // Internal WebSocket connection state
const initialProfile = initializeLocalProfile(); // Initialize user profile
export const localUserId = initialProfile.userId; // Unique ID for this client (immutable)
let _localUserNickname = initialProfile.nickname; // Internal nickname state
let _localUserAvatar = initialProfile.avatar; // Internal avatar state
let _localKeyPair = null; // Internal key pair state
// --- MODIFIED contacts structure --- (Internal state)
let _contacts = {}; // Internal contacts object
// --- END MODIFICATION ---
let _activeChatPeerId = null; // Internal active chat state

// --- Per-Peer State (Managed via Dictionaries/Maps) --- (These remain internal)
const peerConnections = new Map();
const dataChannels = new Map();
const connectionStates = new Map();
const peerKeys = new Map();
const peerTypingStatus = new Map();
const makingOfferFlags = new Map();
const connectionTimeouts = new Map();
const unreadMessages = new Map();

// --- Typing Indicator State (Local User) ---
let _typingTimeout = null; // Internal typing timeout state
let _isTyping = false; // Internal typing status state

// --- File Transfer State (Consider if needs per-peer isolation later) ---
let _incomingFiles = {}; // Internal incoming files state

// --- NEW: Friend Request State ---
let _pendingOutgoingRequests = new Set(); // Internal state
let _pendingIncomingRequests = new Map(); // Internal state

// --- Getters for Global State ---
export function getWs() { return _ws; }
export function getLocalUserNickname() { return _localUserNickname; }
export function getLocalUserAvatar() { return _localUserAvatar; }
export function getLocalKeyPair() { return _localKeyPair; }
export function getContacts() { return _contacts; } // Returns mutable reference - consumers MUST NOT mutate directly
export function getActiveChatPeerId() { return _activeChatPeerId; }
export function getTypingTimeout() { return _typingTimeout; }
export function getIsTyping() { return _isTyping; }
export function getIncomingFiles() { return _incomingFiles; } // Returns mutable reference - consumers MUST NOT mutate directly
// NOTE: No direct getters for pending request sets/maps - use hasPending.../getPending... functions

// --- Setters and Modifiers for Global State ---
export function setWs(newWs) { _ws = newWs; }
export function setLocalKeyPair(keyPair) { _localKeyPair = keyPair; }
export function setContacts(newContacts) { _contacts = newContacts; } // Used for initial load/full replacement
export function setActiveChat(peerId) {
    _activeChatPeerId = peerId;
    console.log(`Active chat set to: ${peerId}`);
    setPeerIsTyping(peerId, false);
}
// getActiveChatPeerId() already exported as getter
export function isActiveChat(peerId) { return _activeChatPeerId === peerId; } // Derived getter is fine
export function setTypingTimeout(timeoutId) { _typingTimeout = timeoutId; }
export function setIsTyping(status) { _isTyping = status; }
export function setIncomingFiles(files) { _incomingFiles = files; } // Used for full replacement

// --- Functions to manage Friend Request State (Operating on internal state) ---
export function addPendingOutgoingRequest(peerId) {
    _pendingOutgoingRequests.add(peerId);
    savePendingRequests();
    if (_contacts[peerId]) { // Use internal _contacts
        setContactFriendStatus(peerId, 'pending_outgoing');
    }
    console.log(`Added pending outgoing request for: ${peerId}`);
}

export function removePendingOutgoingRequest(peerId) {
    const deleted = _pendingOutgoingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests();
        // Rely on other functions to set final status if needed.
        // if (_contacts[peerId]) { ... }
        console.log(`Removed pending outgoing request for: ${peerId}`);
    }
    return deleted;
}

export function hasPendingOutgoingRequest(peerId) {
    return _pendingOutgoingRequests.has(peerId);
}

export function addPendingIncomingRequest(request) {
    if (!request || !request.id) return false;
    const peerId = request.id;
    _pendingIncomingRequests.set(peerId, request);
    savePendingRequests();
    if (_contacts[peerId]) { // Use internal _contacts
        setContactFriendStatus(peerId, 'pending_incoming');
    }
    console.log(`Added pending incoming request from: ${peerId}`);
    return true;
}

export function removePendingIncomingRequest(peerId) {
    const deleted = _pendingIncomingRequests.delete(peerId);
    if (deleted) {
        savePendingRequests();
        console.log(`Removed pending incoming request from: ${peerId}`);
    }
    return deleted;
}

export function getPendingIncomingRequest(peerId) {
    return _pendingIncomingRequests.get(peerId);
}

export function hasPendingIncomingRequest(peerId) {
    return _pendingIncomingRequests.has(peerId);
}

// --- Functions to manage Per-Peer State (Remain unchanged, operate on internal Maps) ---
export function getPeerConnection(peerId) { return peerConnections.get(peerId); }
export function setPeerConnection(peerId, pc) { peerConnections.set(peerId, pc); }
export function removePeerConnection(peerId) { peerConnections.delete(peerId); }

export function getDataChannel(peerId) { return dataChannels.get(peerId); }
export function setDataChannel(peerId, dc) { dataChannels.set(peerId, dc); }
export function removeDataChannel(peerId) { dataChannels.delete(peerId); }

export function getConnectionState(peerId) { return connectionStates.get(peerId) || 'new'; }
export function updateConnectionState(peerId, state) {
    console.log(`Updating connection state for ${peerId} to ${state}`);
    connectionStates.set(peerId, state);
    let onlineStatus;
    switch (state) {
        case 'connected':
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
     updateContactStatus(peerId, onlineStatus);
}

export function isPeerConnectionActiveOrPending(peerId) {
    const state = getConnectionState(peerId);
    return state === 'connected' || state === 'connecting';
}

export function getPeerKeys(peerId) { return peerKeys.get(peerId); }
export function setPeerKeys(peerId, keys) { peerKeys.set(peerId, keys); }
export function removePeerKeys(peerId) { peerKeys.delete(peerId); }

export function getPeerIsTyping(peerId) { return peerTypingStatus.get(peerId) || false; }
export function setPeerIsTyping(peerId, status) { peerTypingStatus.set(peerId, status); }
export function removePeerTypingStatus(peerId) { peerTypingStatus.delete(peerId); }

export function isMakingOffer(peerId) { return makingOfferFlags.get(peerId) || false; }
export function setIsMakingOffer(peerId, status) { makingOfferFlags.set(peerId, status); }
export function removeMakingOfferFlag(peerId) { makingOfferFlags.delete(peerId); }
export function isExpectingAnswerFrom(peerId) { return isMakingOffer(peerId); }

export function setConnectionTimeout(peerId, timeoutId) { connectionTimeouts.set(peerId, timeoutId); }
export function clearConnectionTimeout(peerId) {
    const timeoutId = connectionTimeouts.get(peerId);
    if (timeoutId) {
        clearTimeout(timeoutId);
        connectionTimeouts.delete(peerId);
    }
}

export function setHasUnreadMessages(peerId, hasUnread) {
    if (typeof hasUnread !== 'boolean') {
        console.warn(`setHasUnreadMessages called with non-boolean value for ${peerId}:`, hasUnread);
        return;
    }
    unreadMessages.set(peerId, hasUnread);
}

export function getHasUnreadMessages(peerId) {
    return unreadMessages.get(peerId) || false;
}

// --- State Update Functions (Remain unchanged, operate on internal Maps/call other state functions) ---
export function updateIceConnectionState(peerId, iceState) {
    console.log(`ICE state for ${peerId}: ${iceState}`);
    if (iceState === 'failed') {
        updateConnectionState(peerId, 'failed');
    } else if (iceState === 'closed' || iceState === 'disconnected') {
         if (getConnectionState(peerId) === 'connected') {
             updateConnectionState(peerId, 'disconnected');
         } else if (getConnectionState(peerId) !== 'failed' && getConnectionState(peerId) !== 'closed'){
             updateConnectionState(peerId, iceState);
         }
    }
}

export function updateOverallConnectionState(peerId, overallState) {
    console.log(`Overall connection state for ${peerId}: ${overallState}`);
    updateConnectionState(peerId, overallState);
}

export function updateSignalingState(peerId, signalingState) {
    console.log(`Signaling state for ${peerId}: ${signalingState}`);
    if (signalingState === 'closed') {
        const currentState = getConnectionState(peerId);
        if (currentState !== 'failed' && currentState !== 'disconnected' && currentState !== 'closed') {
             updateConnectionState(peerId, 'closed');
        }
    }
}

export function updateDataChannelState(peerId, dcState) {
     console.log(`Data channel state for ${peerId}: ${dcState}`);
     if (dcState === 'open') {
         if (getConnectionState(peerId) === 'connected') {
             updateContactStatus(peerId, true);
         }
     } else if (dcState === 'closed') {
          const currentState = getConnectionState(peerId);
          if (currentState !== 'failed' && currentState !== 'disconnected' && currentState !== 'closed') {
             updateConnectionState(peerId, 'closed');
         }
     }
}

// --- Contact Management Functions (Operating on internal _contacts) ---
export function loadPendingRequests() {
    try {
        const storedOutgoing = localStorage.getItem(PENDING_OUTGOING_REQUESTS_KEY);
        if (storedOutgoing) {
            _pendingOutgoingRequests = new Set(JSON.parse(storedOutgoing)); // Update internal
            console.log("Loaded pending outgoing requests:", _pendingOutgoingRequests);
        }
        const storedIncoming = localStorage.getItem(PENDING_INCOMING_REQUESTS_KEY);
        if (storedIncoming) {
            _pendingIncomingRequests = new Map(JSON.parse(storedIncoming)); // Update internal
            console.log("Loaded pending incoming requests:", _pendingIncomingRequests);
        }
    } catch (e) {
        console.error("Failed to load pending requests from localStorage:", e);
        _pendingOutgoingRequests = new Set(); // Reset internal
        _pendingIncomingRequests = new Map(); // Reset internal
    }
}

function savePendingRequests() {
    try {
        localStorage.setItem(PENDING_OUTGOING_REQUESTS_KEY, JSON.stringify(Array.from(_pendingOutgoingRequests))); // Read internal
        localStorage.setItem(PENDING_INCOMING_REQUESTS_KEY, JSON.stringify(Array.from(_pendingIncomingRequests.entries()))); // Read internal
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
                if (contact && contact.id) {
                     validatedContacts[contact.id] = {
                        id: contact.id,
                        name: contact.name || contact.id,
                        online: false,
                        avatar: contact.avatar || 'default_avatar.png',
                        friendStatus: contact.friendStatus || 'confirmed'
                    };
                }
            });
            setContacts(validatedContacts); // Uses setter which updates _contacts
            console.log("Loaded contacts from localStorage (status reset to offline):", _contacts); // Log internal
        } else {
            console.log("No contacts found in localStorage.");
            setContacts({}); // Calls setter which updates _contacts
        }
    } catch (e) {
        console.error("Failed to load contacts from localStorage:", e);
        setContacts({});
    }
}

export function saveContacts() {
    try {
        const contactsToSave = {};
        Object.values(_contacts).forEach(contact => { // Use internal _contacts
            contactsToSave[contact.id] = {
                id: contact.id,
                name: contact.name,
                avatar: contact.avatar,
                friendStatus: contact.friendStatus
            };
        });
        localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contactsToSave));
        console.log("Saved contacts (ID, name, avatar, friendStatus) to localStorage:", contactsToSave);
    } catch (e) {
        console.error("Failed to save contacts to localStorage:", e);
    }
}

export function updateContactDetails(peerId, details) {
    console.log(`[State updateContactDetails] Called for peer: ${peerId} with details:`, details);
    const contactsMap = getContacts(); // Use getter
    if (!contactsMap[peerId]) {
        console.warn(`[State] Attempted to update details for non-existent contact: ${peerId}`);
        return false;
    }

    let changed = false;
    const contact = contactsMap[peerId]; // Operate on the object obtained from the map
    const oldContactState = { ...contact };

    if (details.nickname && typeof details.nickname === 'string' && contact.name !== details.nickname.trim()) {
        contact.name = details.nickname.trim();
        console.log(`[State] Updated contact ${peerId} nickname to: ${contact.name}`);
        changed = true;
    }

    const newAvatar = (details.avatar && typeof details.avatar === 'string') ? details.avatar.trim() : 'default_avatar.png';
    if (contact.avatar !== newAvatar) {
        contact.avatar = newAvatar;
        console.log(`[State] Updated contact ${peerId} avatar to: ${contact.avatar}`);
        changed = true;
    }

    if (changed) {
        console.log(`[State updateContactDetails] Changes detected for ${peerId}. Old state:`, oldContactState, "New state:", contact);
        saveContacts(); // Reads internal _contacts
    } else {
         console.log(`[State updateContactDetails] No changes applied for ${peerId}.`);
    }
    return changed;
}

// --- MODIFIED: addContact operates on internal _contacts --- //
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
    const existingContact = _contacts[trimmedId]; // Check internal _contacts
    const nameToUse = name || trimmedId;

    if (existingContact) {
        console.log(`Contact ${trimmedId} already exists.`);
        if (existingContact.name !== nameToUse) {
             existingContact.name = nameToUse;
             saveContacts(); // Reads internal _contacts
             console.log(`Updated name for existing contact ${trimmedId} to ${nameToUse}`);
        }
        return true;
    }

    const newContact = {
        id: trimmedId,
        name: nameToUse,
        online: false,
        avatar: 'default_avatar.png',
        friendStatus: initialFriendStatus
    };
    _contacts[trimmedId] = newContact; // Modify internal state directly
    saveContacts(); // Reads internal _contacts
    console.log(`Added new contact: ${trimmedId} with friendStatus: ${initialFriendStatus}`);
    return true;
}

// --- MODIFIED: updateContactStatus operates on internal _contacts --- //
export function updateContactStatus(peerId, status) {
    const contactsMap = getContacts(); // Use getter
    if (!contactsMap[peerId]) {
         console.log(`Received status update for non-contact: ${peerId}. Status: ${status}`);
         return;
    }
    // Directly modify the object obtained from getContacts()
    // This relies on getContacts() returning a mutable reference
    if (contactsMap[peerId].online !== status) {
        contactsMap[peerId].online = status; // Modify object obtained via getter
        // No saving needed, status is transient
        console.log(`Updated status for ${peerId}: ${status}`);
    }
}

// --- MODIFIED: removeContact operates on internal _contacts --- //
export function removeContact(peerId) {
    if (!peerId || typeof peerId !== 'string' || peerId.trim() === '') {
        console.warn("Attempted to remove invalid peer ID:", peerId);
        return false;
    }
    const trimmedId = peerId.trim();
    const contactsMap = getContacts(); // Use getter
    if (!contactsMap[trimmedId]) {
        console.log(`Contact ${trimmedId} does not exist.`);
        return false;
    }
    console.log(`Attempting to remove contact: ${trimmedId}`);

    delete _contacts[trimmedId]; // Modify internal state directly
    saveContacts(); // Reads internal _contacts
    resetPeerState(trimmedId); // Calls functions operating on internal maps

    if (_activeChatPeerId === trimmedId) { // Use internal state for read
        setActiveChat(null); // Use setter
    }
    console.log(`Contact ${trimmedId} removed successfully.`);
    return true;
}

// --- Reset Functions (Operating on internal state/maps) ---
// --- MODIFIED: Operates on internal maps/state --- //
export function resetPeerState(peerId) {
    console.log(`[State Reset] Resetting state for peer: ${peerId}`);
    const pc = getPeerConnection(peerId);
    if (pc) {
        console.log(`[State Reset ${peerId}] Closing PeerConnection.`);
        pc.close();
        removePeerConnection(peerId);
    }
    const dc = getDataChannel(peerId);
    if (dc) {
        console.log(`[State Reset ${peerId}] Closing DataChannel.`);
        dc.close();
        removeDataChannel(peerId);
    }
    removePeerKeys(peerId);
    removePeerTypingStatus(peerId);
    removeMakingOfferFlag(peerId);
    clearConnectionTimeout(peerId);
    unreadMessages.delete(peerId);
    updateConnectionState(peerId, 'disconnected');
    Object.keys(_incomingFiles).forEach(transferId => { // Read internal
        if (_incomingFiles[transferId].peerId === peerId) {
            console.warn(`[State Reset ${peerId}] Found active incoming file transfer ${transferId}. Consider adding cleanup.`);
        }
    });
    console.log(`[State Reset ${peerId}] State reset complete.`);
}

// --- MODIFIED: Operates on internal maps/state --- //
export function resetAllConnections() {
    console.log("[State Reset] Resetting all peer connections and state.");
    const peerIds = Array.from(peerConnections.keys());
    peerIds.forEach(peerId => {
        resetPeerState(peerId);
    });

    peerConnections.clear();
    dataChannels.clear();
    connectionStates.clear();
    peerKeys.clear();
    peerTypingStatus.clear();
    makingOfferFlags.clear();
    connectionTimeouts.clear();
    unreadMessages.clear();

    setActiveChat(null); // Use setter
    setIncomingFiles({}); // Use setter
    _pendingOutgoingRequests.clear(); // Modify internal directly
    _pendingIncomingRequests.clear(); // Modify internal directly
    savePendingRequests(); // Persist cleared state

    console.log("[State Reset] All connections reset complete.");
    return peerIds;
}

// --- Utility Functions ---
export function isSignalingConnected() {
    const currentWs = getWs(); // Use getter
    return currentWs && currentWs.readyState === WebSocket.OPEN;
}

// --- Functions to update local user profile (Operating on internal state) ---
export function setLocalNickname(newNickname) {
    if (newNickname && newNickname.trim()) {
        _localUserNickname = newNickname.trim(); // Set internal
        try {
            localStorage.setItem(LOCAL_NICKNAME_KEY, _localUserNickname);
            console.log('Updated and saved local nickname:', _localUserNickname);
            // TODO: Notify peers
        } catch (e) {
            console.error('Failed to save nickname to localStorage:', e);
        }
    }
}

export function setLocalAvatar(newAvatar) {
    if (newAvatar && newAvatar.trim()) {
        _localUserAvatar = newAvatar.trim(); // Set internal
        try {
            localStorage.setItem(LOCAL_AVATAR_KEY, _localUserAvatar);
            console.log('Updated and saved local avatar:', _localUserAvatar);
            // TODO: Notify peers
        } catch (e) {
            console.error('Failed to save avatar to localStorage:', e);
        }
    }
}

// --- Function to explicitly set friend status (Operating on internal _contacts) ---
export function setContactFriendStatus(peerId, status) {
    const contactsMap = getContacts(); // Use getter
    if (contactsMap[peerId]) {
        if (contactsMap[peerId].friendStatus !== status) {
            contactsMap[peerId].friendStatus = status; // Modify object from getter
            console.log(`[State] Set friendStatus for ${peerId} to ${status}`);
            saveContacts(); // Reads internal _contacts
            return true;
        }
    } else {
        console.warn(`[State] Cannot set friendStatus for non-existent contact: ${peerId}`);
    }
    return false;
}

// --- addOrUpdateContact (Operating on internal _contacts) ---
export function addOrUpdateContact(contactData) {
    if (!contactData || !contactData.id) {
        console.error("addOrUpdateContact: Invalid contact data provided.", contactData);
        return null;
    }
    const peerId = contactData.id;
    const contactsMap = getContacts(); // Use getter
    const existingContact = contactsMap[peerId];

    const defaultContact = {
        id: peerId,
        name: peerId,
        online: false,
        avatar: 'default_avatar.png',
        friendStatus: 'confirmed',
        addedTimestamp: Date.now()
    };

    const updatedContact = {
        ...(existingContact || defaultContact),
        ...contactData,
        id: peerId,
        name: contactData.name || existingContact?.name || peerId,
        online: contactData.online ?? existingContact?.online ?? false,
        avatar: contactData.avatar || existingContact?.avatar || 'default_avatar.png',
        friendStatus: contactData.friendStatus || existingContact?.friendStatus || 'confirmed'
    };

    _contacts[peerId] = updatedContact; // Modify internal state directly
    if (!unreadMessages.has(peerId)) {
        unreadMessages.set(peerId, false);
        console.log(`[State] Initialized unread status for new contact ${peerId} to false.`);
    }
    saveContacts(); // Reads internal _contacts
    console.log(`[State] Contact ${peerId} added or updated:`, updatedContact);
    return updatedContact;
} 
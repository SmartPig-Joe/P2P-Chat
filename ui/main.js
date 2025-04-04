// ui/main.js
import * as dom from '/src/dom.js';
import * as state from '/src/state.js';
console.log("[ui/main.js] State module imported:", state);
import * as connection from '/src/connection.js'; // Needed for initializeUI -> loadAndDisplayHistory
import { escapeHTML, formatTime, getUserColorClass, formatBytes } from '/src/utils.js';
import { renderContactList, showUnreadIndicator } from './contactList.js'; // Removed addContactToList, removeIncomingRequestUI, updateRequestSectionHeaders
import { clearMessageList, scrollToBottom, addSystemMessage, displayMessage, updateFileMessageProgress, updateFileMessageStatusToReceived } from './messages.js';
import { updateChatHeader, updateChatInputVisibility, updateEmptyState, showTypingIndicator, hideActiveTypingIndicator } from './chatArea.js'; // Added chatArea functions
import { showContextMenu, hideContextMenu } from './contextMenu.js'; // Added hideContextMenu back
import { displayLocalUserInfo, createProfileEditSectionHTML, showProfileEditModal, hideProfileEditModal, handleProfileSave } from './profile.js';

// Store active ObjectURLs to revoke them later
const activeObjectURLs = new Set();

// --- NEW: Function to cleanup Object URLs ---
export function cleanupObjectURLs() {
    console.log(`[Cleanup] Cleaning up ${activeObjectURLs.size} Object URLs.`);
    activeObjectURLs.forEach(url => {
        console.log(`[Cleanup] Revoking ObjectURL: ${url}`);
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn(`[Cleanup] Error revoking ObjectURL ${url}:`, e);
        }
    });
    activeObjectURLs.clear();
    console.log("[Cleanup] Object URLs cleared.");
}

// Call this function when adding a URL that needs cleanup
export function addObjectURLToTrack(url) {
    if (url && url.startsWith('blob:')) {
        activeObjectURLs.add(url);
        console.log(`[UI Main] Tracking ObjectURL: ${url}`);
    }
}

// Call this when a URL is no longer needed (e.g., explicitly revoked elsewhere or link removed)
export function removeObjectURLFromTrack(url) {
     if (url && activeObjectURLs.has(url)) {
         activeObjectURLs.delete(url);
         console.log(`[UI Main] Untracked ObjectURL: ${url}`);
     }
}

// Call this before revoking a URL to ensure it's removed from the tracking set
export function untrackAndRevokeObjectURL(url) {
    if (url && activeObjectURLs.has(url)) {
        try {
            URL.revokeObjectURL(url);
            console.log(`[UI Main] Revoked ObjectURL: ${url}`);
        } catch (e) {
            console.warn(`[UI Main] Error revoking ObjectURL ${url}:`, e);
        } finally {
             activeObjectURLs.delete(url);
        }
    }
}


// Generates a placeholder avatar color based on User ID
// Moved here as it's used by multiple UI components (contacts, messages, profile)
export function getAvatarColor(userId) {
    // Add a check for invalid userId
    if (!userId || typeof userId !== 'string') {
        console.warn('getAvatarColor called with invalid userId:', userId);
        return '2c2f33'; // Return a default color (e.g., dark gray)
    }

    const colors = [
        '7289da', // Blurple
        '43b581', // Green
        'f04747', // Red
        'faa61a', // Yellow/Orange
        '3498db', // Blue
        '9b59b6', // Purple
        'e91e63', // Pink
        '1abc9c'  // Teal
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash % colors.length)];
}

// --- Initialization ---
export function initializeUI() {
    console.log("Initializing UI (from ui/main.js)...");
    // Initial render (will now include pending requests)
    renderContactList();
    // Set initial empty state message
    updateEmptyState();
    // Display local user info (This might run before DOM is ready, error handled inside)
    displayLocalUserInfo();
    // Set initial chat input visibility (hidden)
    updateChatInputVisibility(false);
    // Set initial chat header
     updateChatHeader(null);
    // Clear any leftover typing indicators
    hideActiveTypingIndicator();

    // Hide context menu initially
    hideContextMenu();

    // Inject and setup profile edit modal
    const profileEditHTML = createProfileEditSectionHTML();
    document.body.insertAdjacentHTML('beforeend', profileEditHTML); // Add modal to the body

    // Re-query DOM elements for the modal *after* injecting HTML
    const saveBtn = document.getElementById('save-profile-edit-btn');
    const cancelBtn = document.getElementById('cancel-profile-edit-btn');
    const modal = document.getElementById('profile-edit-modal');

    if (saveBtn) {
        saveBtn.addEventListener('click', handleProfileSave);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideProfileEditModal);
    }
     // Close modal if clicking outside the content
    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) { // Check if the click is on the background overlay
                hideProfileEditModal();
            }
        });
    }

    // Display initial user info AGAIN (This call should work if DOM is ready)
    displayLocalUserInfo();
    console.log("UI Initialized (from ui/main.js).");
}

// --- NEW: Function to switch the active chat view ---
export async function switchToChat(peerId) {
    console.log("[switchToChat] Function called. Value of state:", state);
    const currentActivePeerId = state.getActiveChatPeerId();
    if (!peerId || peerId === currentActivePeerId) {
        console.log(`switchToChat: Invalid peerId (${peerId}) or already active.`);
        return;
    }

    console.log(`[UI] Switching active chat to: ${peerId}`);
    state.setActiveChat(peerId);

    // Update UI Selection Highlight in contact list
    if (dom.contactsListContainer) {
        // Remove highlight from previous
        if (currentActivePeerId) {
            const previousElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${currentActivePeerId}"]`);
            if (previousElement) {
                previousElement.classList.remove('bg-discord-gray-4');
                if (previousElement.classList.contains('confirmed-contact')) { // Only add hover back to confirmed ones
                    previousElement.classList.add('hover:bg-discord-gray-3');
                }
            }
        }
        // Add highlight to new active contact
        const targetElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
        if (targetElement) {
            targetElement.classList.add('bg-discord-gray-4');
            targetElement.classList.remove('hover:bg-discord-gray-3');
        }
    }

    // Clear previous chat state
    clearMessageList();
    hideActiveTypingIndicator();

    // Update Chat Header
    updateChatHeader(peerId);

    // Load and Display History
    // Need connection module available here or move loadAndDisplayHistory to ui?
    // For now, assume connection is imported in ui/main.js (it is)
    await connection.loadAndDisplayHistory(peerId);

    // --- NEW: Attempt to connect if not already connected/connecting ---
    const connectionState = state.getConnectionState(peerId);
    console.log(`[UI Switch] Connection state for ${peerId}: ${connectionState}`);
    if (connectionState !== 'connected' && connectionState !== 'connecting') {
        console.log(`[UI Switch] Connection needed for ${peerId}. Attempting to connect...`);
        try {
            // Use await to ensure the connection attempt is initiated before proceeding,
            // though the connection itself is asynchronous.
            await connection.connectToPeer(peerId);
            console.log(`[UI Switch] connectToPeer called for ${peerId}.`);
            // Note: The UI update for "connecting" status should be handled
            // by the events triggered within connection.js (e.g., setConnectionState)
        } catch (error) {
            console.error(`[UI Switch] Error attempting to connect to ${peerId}:`, error);
            // Use addSystemMessage from messages.js (already imported)
            addSystemMessage(peerId, `Error trying to connect: ${escapeHTML(error.message)}`);
        }
    } else {
        console.log(`[UI Switch] No connection attempt needed for ${peerId} (State: ${connectionState}).`);
    }
    // --- END NEW ---

    // --- Mark messages as read ---
    const contacts = state.getContacts(); // USE GETTER
    if (contacts[peerId]) { // Use getter result
        // state.contacts[peerId].hasUnread = false; // Logic depends on state implementation
        // TODO: Call state function to mark as read
        state.setHasUnreadMessages(peerId, false); // Use the state function here
    }
    showUnreadIndicator(peerId, false); // Hide the red dot immediately

    // Update input visibility (should check connection status)
    updateChatInputVisibility();

    // Update empty state message (should be hidden now)
    updateEmptyState();

    // Focus input field? (Optional)
    // if (dom.chatInput) dom.chatInput.focus();

    console.log(`[UI] Finished switching chat view to ${peerId}`);
}
// --- END NEW ---
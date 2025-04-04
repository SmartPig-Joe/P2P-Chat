// ui/index.js - Public API for the UI module

// Import functions from specific UI modules
import {
    initializeUI,
    cleanupObjectURLs,
    getAvatarColor,
    addObjectURLToTrack,
    untrackAndRevokeObjectURL,
    // No need to export add/remove/untrack object URL utils publicly
} from './main.js';

import {
    getSelectedPeerId,
    scrollToBottom,
    clearMessageList,
    addSystemMessage,
    showNotFriendError,
    displayMessage,
    updateFileMessageProgress,
    updateFileMessageStatusToReceived,
    // No need to export createMessageHTML, createFileContentHTML etc. directly
} from './messages.js';

import {
    updateEmptyState,
    showTypingIndicator,
    hideActiveTypingIndicator,
    updateChatHeader,
    updateChatInputVisibility,
    clearChatInput,
} from './chatArea.js';

import {
    renderContactList,
    updateContactStatusUI,
    showUnreadIndicator,
    handleContactClick,
    updateContactName,
} from './contactList.js';

import {
    displayLocalUserInfo,
    // No need to export createProfileEditSectionHTML, show/hide/handle profile modal directly
} from './profile.js';

import {
     hideContextMenu, // Export hideContextMenu in case it needs to be called externally
    // No need to export showContextMenu or handlers if only triggered by internal events
} from './contextMenu.js';


// Re-export the public API
export {
    // Initialization & Main Utils
    initializeUI,
    cleanupObjectURLs,
    getAvatarColor,
    addObjectURLToTrack,
    untrackAndRevokeObjectURL,

    // Messages
    getSelectedPeerId,
    scrollToBottom,
    clearMessageList,
    addSystemMessage,
    showNotFriendError,
    displayMessage,
    updateFileMessageProgress,
    updateFileMessageStatusToReceived,

    // Chat Area
    updateEmptyState,
    showTypingIndicator,
    hideActiveTypingIndicator,
    updateChatHeader,
    updateChatInputVisibility,
    clearChatInput,

    // Contact List
    renderContactList,
    updateContactStatusUI,
    showUnreadIndicator,
    handleContactClick,
    updateContactName,

    // Profile
    displayLocalUserInfo,

    // Context Menu
    hideContextMenu,
};

console.log("UI Module (ui/index.js) loaded.");

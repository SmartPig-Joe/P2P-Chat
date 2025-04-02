// main.js
import * as dom from './dom.js';
import * as state from './state.js';
import * as ui from './ui.js';
import * as connection from './connection.js';
import * as fileTransfer from './fileTransfer.js';
import { TYPING_TIMER_LENGTH } from './constants.js';
import * as storage from './storage.js'; // Keep storage import if needed elsewhere
import * as crypto from './crypto.js'; // Import crypto module

// --- Event Handlers ---

// Handle Sending Text Messages
function handleSendMessage(event) {
    // Check if Enter key was pressed
    if (event.type === 'keypress' && event.key !== 'Enter') return;

    if (!dom.messageInput) {
        console.error('messageInput DOM element not found!');
        return;
    }

    const messageText = dom.messageInput.value.trim();

    // Stop typing indicator immediately if Enter is pressed
    if (event.type === 'keypress' && event.key === 'Enter') {
        stopLocalTypingIndicator(); // Stop indicator regardless of message content
        if (messageText === '') {
            return; // Don't send empty messages on Enter
        }
    }

    // Check connection status specific to the selected peer
    if (!state.isConnected || state.remoteUserId !== ui.getSelectedPeerId()) {
         console.warn(`Cannot send message: Not connected to the selected peer (${ui.getSelectedPeerId()}). Connected to: ${state.remoteUserId}`);
         ui.addSystemMessage("无法发送消息：未连接到当前选择的联系人。", true);
         return;
    }

    if (!state.sharedKey) {
         console.warn(`Cannot send message: Shared key not established with ${ui.getSelectedPeerId()}.`);
         ui.addSystemMessage("无法发送消息：端到端加密未就绪。", true);
         return;
    }

    // Proceed to send the message
    try {
        connection.sendChatMessage(messageText); // Use the dedicated function from connection.js
        dom.messageInput.value = '';
        dom.messageInput.focus();
    } catch (error) {
        console.error("Failed to send chat message:", error);
        // Error message is handled within sendChatMessage now
    }
}

// Handle Local User Typing
function handleLocalTyping() {
    // Send typing indicator only if connected to the selected peer
    if (!state.isConnected || state.remoteUserId !== ui.getSelectedPeerId() || !state.dataChannel || state.dataChannel.readyState !== 'open' || !state.sharedKey) {
        return;
    }

    if (!state.isTyping) {
        state.setIsTyping(true);
        connection.sendTypingIndicator(true); // Use connection.js function
    }

    // Clear the previous timer
    clearTimeout(state.typingTimeout);

    // Set a new timer
    const timeoutId = setTimeout(() => {
        stopLocalTypingIndicator(); // Call the function to handle state and sending
    }, TYPING_TIMER_LENGTH);
    state.setTypingTimeout(timeoutId);
}

// Helper to stop local typing and send update
function stopLocalTypingIndicator() {
    if (state.isTyping) {
        clearTimeout(state.typingTimeout);
        state.setTypingTimeout(null);
        state.setIsTyping(false);
        // Send stopped typing only if still connected to the selected peer
        if (state.isConnected && state.remoteUserId === ui.getSelectedPeerId() && state.dataChannel?.readyState === 'open' && state.sharedKey) {
            connection.sendTypingIndicator(false); // Use connection.js function
        }
    }
}

// Handle adding a new contact
function handleAddContact() {
    console.log('[Debug] handleAddContact function entered.');
    if (!dom.addContactInput || !dom.addContactButton) {
        console.warn('[Debug] handleAddContact returning early: addContactInput or addContactButton not found.');
        return;
    }
    const peerIdToAdd = dom.addContactInput.value.trim();
    console.log(`[Debug] Attempting to add contact: "${peerIdToAdd}"`);

    if (!peerIdToAdd) {
        ui.addSystemMessage("请输入要添加的 Peer ID。", true);
        return;
    }

    if (peerIdToAdd === state.localUserId) {
         ui.addSystemMessage("不能添加自己为联系人。", true);
         return;
    }

    const success = state.addContact(peerIdToAdd);
    if (success) {
        ui.addSystemMessage(`联系人 ${peerIdToAdd} 已添加。`);
        ui.renderContactList(); // Re-render the list
        dom.addContactInput.value = ''; // Clear input
    } else {
        // Error message handled within state.addContact (e.g., invalid ID)
         ui.addSystemMessage(`无法添加联系人 ${peerIdToAdd}。`, true); // Generic fallback
    }
}

// --- Initialization ---

async function initializeApp() {
    console.log("[Debug] initializeApp function started.");
    console.log("Initializing P2P Chat Application...");

    // Show loading state using the empty message area
    if (dom.emptyMessageListDiv) {
        dom.emptyMessageListDiv.innerHTML = `
            <div class="animate-pulse text-center">
                <span class="material-symbols-outlined text-6xl mb-4 text-discord-text-muted">hourglass_top</span>
                <h3 class="text-lg font-semibold text-discord-text-primary">正在初始化应用...</h3>
                <p class="text-sm text-discord-text-muted">请稍候</p>
            </div>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
    ui.updateChatInputVisibility(false); // Disable input during init

    // 0. Initialize Cryptography (Load/Generate Keys) - CRITICAL STEP
    let cryptoReady = false;
    try {
        await crypto.initializeCryptography(); // Call the new initialization function
        console.log("Cryptography module initialized successfully.");
        cryptoReady = true;
    } catch (error) {
        console.error("Critical Error: Cryptography initialization failed:", error);
        // Display persistent error message in the empty message area
        if (dom.emptyMessageListDiv) {
             dom.emptyMessageListDiv.innerHTML = `
                <div class="text-center text-discord-red">
                    <span class="material-symbols-outlined text-6xl mb-4">error</span>
                    <h3 class="text-lg font-semibold">加密模块初始化失败</h3>
                    <p class="text-sm">无法加载或生成安全密钥。安全聊天功能将不可用。</p>
                    <p class="text-xs mt-2">请检查浏览器控制台获取详细信息。</p>
                </div>
             `;
             dom.emptyMessageListDiv.classList.remove('hidden');
        }
        // Keep input disabled
        ui.updateChatInputVisibility(false);
        // Optionally add a system message too?
        // ui.addSystemMessage("错误：无法初始化加密模块。", true);
    }

    // 1. Initialize Database (optional, keep if chat history is needed)
    try {
        await storage.initDB();
        console.log("Database initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database:", error);
        ui.addSystemMessage("错误：无法初始化本地存储。聊天记录可能不会被保存。", true);
    }

    // 2. Load State & Initial UI Setup (Depends on crypto potentially, but usually loads IDs/contacts)
    state.loadContacts(); // Load contacts from localStorage
    ui.displayLocalUserInfo(); // Display local user ID/name/avatar
    ui.renderContactList(); // Render the initial contact list
    ui.updateEmptyState(); // Show initial empty state
    ui.populateMemberList(); // Initial population of member list (if used)

    // 3. Setup Event Listeners
    console.log('[Debug] Value of dom.addContactButton before check:', dom.addContactButton);
    // Add Contact Button
    if (dom.addContactButton) {
        console.log('[Debug] Found addContactButton, attaching click listener:', dom.addContactButton);
        dom.addContactButton.addEventListener('click', handleAddContact);
    } else {
        console.warn("Add contact button not found");
    }
    console.log('[Debug] Value of dom.addContactInput before check:', dom.addContactInput);
    // Add contact on Enter press in input field
    if (dom.addContactInput) {
         console.log('[Debug] Found addContactInput, attaching keypress listener:', dom.addContactInput);
         dom.addContactInput.addEventListener('keypress', (event) => {
             if (event.key === 'Enter') {
                 handleAddContact();
             }
         });
    }

    // Message Input
    if (dom.messageInput) {
        dom.messageInput.addEventListener('keypress', handleSendMessage);
        dom.messageInput.addEventListener('input', handleLocalTyping);
    } else {
         console.warn("Message input not found");
    }

    // File Upload
    if (dom.uploadButton && dom.fileInput) {
        dom.uploadButton.addEventListener('click', () => dom.fileInput.click());
        dom.fileInput.addEventListener('change', fileTransfer.handleFileSelect);
    } else {
        console.warn("Upload button or file input not found");
    }

    // Member List Toggle (REMOVED - Functionality not currently used)
    // // if (dom.memberListToggleButton) {
    // //     dom.memberListToggleButton.addEventListener('click', ui.toggleMemberList);
    // // } else {
    // //     console.warn("Member list toggle button not found");
    // // }

    // Note: Contact click listener is now added *within* ui.renderContactList

    // 3. Connect WebSocket to Signaling Server
    // Connect WebSocket regardless of crypto state, maybe server provides other info?
    connection.connectWebSocket();

    // Update UI based on crypto readiness
    if (cryptoReady) {
         // Clear loading message and show default empty state
         ui.updateEmptyState();
         console.log("Application Initialization Complete.");
         // Input remains hidden until a contact is selected and connected via ui.updateChatInputVisibility calls elsewhere
    } else {
        console.error("Application initialized with crypto module failed. Connection features might be disabled.");
        // The error message set in the catch block remains visible
    }
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', initializeApp); 
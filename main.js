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
    // Check if Enter key was pressed without Shift
    if (event.type === 'keypress' && (event.key !== 'Enter' || event.shiftKey)) return;
    if (event.type === 'keypress' && event.key === 'Enter') {
        event.preventDefault(); // Prevent default newline behavior on Enter
    }

    if (!dom.messageInput) {
        console.error('messageInput DOM element not found!');
        return;
    }

    const messageText = dom.messageInput.value.trim();

    // Stop typing indicator immediately if Enter is pressed
    if (event.type === 'keypress' && event.key === 'Enter') {
        stopLocalTypingIndicator(); // Stop indicator regardless of message content
    }

    if (messageText === '') {
        if (event.type === 'keypress') dom.messageInput.value = ''; // Clear input if only whitespace on Enter
        return; // Don't send empty messages
    }

    // Get the currently active peer
    const activePeerId = state.getActiveChatPeerId();
    if (!activePeerId) {
        console.warn("Cannot send message: No active chat selected.");
        ui.addSystemMessage("请先选择一个聊天对象。", null, true); // Use null peerId for global message
        return;
    }

    // Check connection status specific to the selected peer
    const connectionState = state.getConnectionState(activePeerId);
    const dataChannel = state.getDataChannel(activePeerId);

    if (connectionState !== 'connected' || !dataChannel || dataChannel.readyState !== 'open') {
         console.warn(`Cannot send message: Not connected or data channel not open for peer ${activePeerId}. State: ${connectionState}, DC: ${dataChannel?.readyState}`);
         ui.addSystemMessage(`无法发送消息：与 ${state.contacts[activePeerId]?.name || activePeerId} 的连接未建立或已断开。`, activePeerId, true); // Target message to active peer
         return;
    }

    // Proceed to send the message
    try {
        // connection.sendChatMessage calls ui.clearChatInput on success
        connection.sendChatMessage(messageText);
    } catch (error) {
        console.error("Failed to send chat message:", error);
        // Error message is handled within sendChatMessage now
    }
}

// Handle Local User Typing
function handleLocalTyping() {
    const activePeerId = state.getActiveChatPeerId();
    if (!activePeerId) return; // No active chat

    const connectionState = state.getConnectionState(activePeerId);
    const dataChannel = state.getDataChannel(activePeerId);

    // Send typing indicator only if connected to the selected peer and channel is open
    if (connectionState !== 'connected' || !dataChannel || dataChannel.readyState !== 'open') {
        return;
    }

    if (!state.isTyping) {
        state.setIsTyping(true);
        connection.sendTypingIndicator(true); // Use connection.js function (sends to active peer)
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

        const activePeerId = state.getActiveChatPeerId();
        if (activePeerId) {
             const connectionState = state.getConnectionState(activePeerId);
             const dataChannel = state.getDataChannel(activePeerId);
             // Send stopped typing only if still connected to the selected peer
             if (connectionState === 'connected' && dataChannel?.readyState === 'open') {
                 connection.sendTypingIndicator(false); // Use connection.js function (sends to active peer)
             }
        }
    }
}

// Handle adding a new contact
function handleAddContact() {
    console.log('[Debug] handleAddContact function entered.');
    if (!dom.addContactInput) { // Removed check for button as Enter works too
        console.warn('[Debug] handleAddContact returning early: addContactInput not found.');
        return;
    }
    const peerIdToAdd = dom.addContactInput.value.trim();
    const contactName = dom.addContactNameInput?.value.trim() || null; // Optional name input
    console.log(`[Debug] Attempting to add contact ID: "${peerIdToAdd}", Name: "${contactName}"`);

    if (!peerIdToAdd) {
        ui.addSystemMessage("请输入要添加的 Peer ID。", null, true); // Global system message
        return;
    }

    if (peerIdToAdd === state.localUserId) {
         ui.addSystemMessage("不能添加自己为联系人。", null, true); // Global system message
         return;
    }

    const success = state.addContact(peerIdToAdd, contactName); // Pass name to state function
    if (success) {
        // Display confirmation message - maybe global or specific to a settings area if exists
        // ui.addSystemMessage(`联系人 ${state.contacts[peerIdToAdd]?.name || peerIdToAdd} 已添加/更新。`);
        console.log(`Contact ${peerIdToAdd} added/updated successfully.`);
        ui.renderContactList(); // Re-render the list to show the new/updated contact
        dom.addContactInput.value = ''; // Clear ID input
        if (dom.addContactNameInput) dom.addContactNameInput.value = ''; // Clear name input
    } else {
        // Error messages should ideally be more specific from state.addContact if possible
         ui.addSystemMessage(`无法添加联系人 ${peerIdToAdd}。ID可能无效或已存在。`, null, true); // Generic fallback
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
        ui.addSystemMessage("错误：无法初始化本地存储。聊天记录可能不会被保存。", null, true); // Global message
    }

    // 2. Load State & Initial UI Setup
    state.loadContacts(); // Load contacts from localStorage
    ui.initializeUI(); // Call the consolidated UI initializer (this calls renderContactList, etc.)

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
    // Also listen for Enter in Name input if it exists
    if (dom.addContactNameInput) {
        dom.addContactNameInput.addEventListener('keypress', (event) => {
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

    // 4. Connect WebSocket to Signaling Server
    // Connect WebSocket regardless of crypto state, maybe server provides other info?
    connection.connectWebSocket();

    // Update UI based on crypto readiness
    if (cryptoReady) {
         // Clear loading message and show default empty state (now handled in initializeUI)
         // ui.updateEmptyState(); // Called within initializeUI
         console.log("Application Initialization Complete.");
         // Input remains hidden until a contact is selected and connected via ui.updateChatInputVisibility calls elsewhere
    } else {
        console.error("Application initialized with crypto module failed. Connection features might be disabled.");
        // The error message set in the catch block remains visible
    }
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', initializeApp); 
// main.js
import * as dom from './dom.js';
import * as state from './state.js';
import * as ui from './ui.js';
import * as connection from './connection.js';
import * as fileTransfer from './fileTransfer.js';
import { TYPING_TIMER_LENGTH } from './constants.js';
import * as storage from './storage.js'; // Import storage module

// --- Event Handlers ---

// Handle Connect/Disconnect Button Click
function handleConnectButtonClick() {
    const currentAction = dom.connectButton?.dataset.action;
    if (currentAction === 'connect') {
        const targetId = dom.remoteUserIdInput?.value.trim();
        if (targetId) {
            connection.initiateCall(targetId);
        } else {
            ui.addSystemMessage("请输入有效的目标用户 ID。", true);
            console.error("Remote user ID input is empty or not found.");
        }
    } else if (currentAction === 'disconnect') {
        connection.handleDisconnect();
    }
}

// Handle Sending Text Messages
async function handleSendMessage(event) {
    console.log(`[Debug] handleSendMessage triggered. Event type: ${event.type}, Key: ${event.key}`); // 添加日志
    if (event.type === 'keypress' && event.key !== 'Enter') return;
    console.log('[Debug] handleSendMessage: Enter key pressed or event type is not keypress.'); // 添加日志

    if (!dom.messageInput) {
        console.error('[Debug] handleSendMessage: messageInput DOM element not found!'); // 添加日志
        return;
    }

    const messageText = dom.messageInput.value.trim();
    console.log(`[Debug] handleSendMessage: Message text trimmed: "${messageText}"`); // 添加日志

    // Stop typing indicator immediately if Enter is pressed
    if (event.type === 'keypress' && event.key === 'Enter') {
        stopLocalTypingIndicator(); // Stop indicator regardless of message content
        if (messageText === '') {
            console.log('[Debug] handleSendMessage: Empty message on Enter, not sending.'); // 添加日志
            return; // Don't send empty messages on Enter
        }
    }

    // Prevent sending if connection/encryption is not ready
    if (!state.isConnected || !state.sharedKey || state.remoteUserId !== ui.getSelectedPeerId()) {
         console.warn(`[Debug] handleSendMessage: Cannot send, state check failed. isConnected: ${state.isConnected}, sharedKey: ${!!state.sharedKey}, remoteUserId: ${state.remoteUserId}, selectedPeerId: ${ui.getSelectedPeerId()}`); // 添加日志
         ui.addSystemMessage("无法发送消息：连接或加密未就绪，或未选择正确的联系人。", true);
         return;
    }

    const timestamp = Date.now();
    const messageData = {
        type: 'text', // Explicitly type as text
        text: messageText,
        timestamp: timestamp,
        peerId: state.remoteUserId, // Message is intended for the connected peer
        isLocal: true // This is a locally sent message
    };

    try {
        console.log('[Debug] handleSendMessage: Preparing to send encrypted chat message...'); // 添加日志
        await connection.sendEncryptedData('encryptedChat', { text: messageText, timestamp });
        console.log('[Debug] handleSendMessage: sendEncryptedData call successful.'); // 添加日志

        // Display the message locally immediately AFTER successful send attempt
        ui.addP2PMessageToList(messageData);

        // Save sent message to local storage AFTER UI update
        try {
             await storage.addMessage(messageData);
             console.log('[Debug] handleSendMessage: Sent message saved to local storage.'); // 添加日志
        } catch (storageError) {
             console.error("[Debug] handleSendMessage: Failed to save sent message to local storage:", storageError);
        }

        // Clear input and refocus
        dom.messageInput.value = '';
        dom.messageInput.focus();

    } catch (error) {
        console.error("[Debug] handleSendMessage: Failed to send message:", error);
        ui.addSystemMessage(`发送消息失败: ${error.message}`, true);
    }
}

// Handle Local User Typing
function handleLocalTyping() {
    // Send typing indicator only if connected to the selected peer
    if (!state.isConnected || state.remoteUserId !== ui.selectedPeerId || !state.dataChannel || state.dataChannel.readyState !== 'open' || !state.sharedKey) {
        return;
    }

    if (!state.isTyping) {
        state.setIsTyping(true);
        sendTypingState('typing');
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
        if (state.isConnected && state.remoteUserId === ui.selectedPeerId && state.dataChannel?.readyState === 'open' && state.sharedKey) {
            sendTypingState('stopped_typing');
        }
    }
}

// Send typing state update (encrypted)
async function sendTypingState(type) { // type = 'typing' or 'stopped_typing'
     // Double check connection state before sending
     if (!state.isConnected || state.remoteUserId !== ui.selectedPeerId || !state.dataChannel || state.dataChannel.readyState !== 'open' || !state.sharedKey) {
        return;
    }
    try {
        const typingPayload = { type: type }; // Simple payload
        // Use the sendEncryptedData from connection module
        await connection.sendEncryptedData('encryptedControl', typingPayload);
        // console.log(`Sent ${type} control message.`); // Keep logging minimal
    } catch (error) {
        // Error logging handled by sendEncryptedData
        // console.error(`Failed to send ${type} message:`, error);
    }
}


// --- Initialization ---

// Make initializeApp async to await DB initialization
async function initializeApp() {
    console.log("Initializing P2P Chat Application...");

    // 0. Initialize Database first
    try {
        await storage.initDB();
        console.log("Database initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database:", error);
        ui.addSystemMessage("错误：无法初始化本地存储。聊天记录将不会被保存。", true);
        // Depending on requirements, might want to halt app or proceed without storage
    }

    // 1. Initial UI Setup
    ui.updateConnectionStatus("未连接", 'neutral');
    if (dom.localUserIdSpan) {
        dom.localUserIdSpan.textContent = state.localUserId;
    } else {
        console.warn("local-user-id span not found in HTML");
    }
    // Populate member list initially
    ui.populateMemberList();
    // Hide member list on small screens initially
    if (dom.memberListSidebar && window.innerWidth < 768) {
        dom.memberListSidebar.classList.add('hidden');
    }
    // Check initial empty state for message list
    ui.updateEmptyState();
    // Initial system message
    ui.addSystemMessage('从左侧选择联系人查看记录，或在上方输入 ID 进行连接。');

    // Load and populate contacts list from storage
    try {
        const peerIds = await storage.getAllPeerIds();
        ui.populateContactsList(peerIds);
    } catch (error) {
        console.error("Failed to load contacts list:", error);
        ui.addSystemMessage("加载联系人列表失败。", true);
    }

    // 2. Setup Event Listeners
    if (dom.connectButton) {
        dom.connectButton.addEventListener('click', handleConnectButtonClick);
    } else {
        console.warn("Connect button not found in HTML");
    }

    if (dom.messageInput) {
        dom.messageInput.addEventListener('keypress', handleSendMessage);
        dom.messageInput.addEventListener('input', handleLocalTyping); // Typing indicator
    } else {
         console.warn("Message input not found in HTML");
    }

    if (dom.memberListToggleButton) {
        dom.memberListToggleButton.addEventListener('click', ui.toggleMemberList);
    } else {
        console.warn("Member list toggle button not found in HTML");
    }

    if (dom.uploadButton && dom.fileInput) {
        dom.uploadButton.addEventListener('click', () => dom.fileInput.click());
        dom.fileInput.addEventListener('change', fileTransfer.handleFileSelect);
    } else {
        console.warn("Upload button or file input not found in HTML");
    }

    // Add listener for clicks within the contacts list container
    if (dom.contactsListContainer) {
        dom.contactsListContainer.addEventListener('click', ui.handleContactClick);
    } else {
        console.warn("Contacts list container not found in HTML");
    }

    // 3. Connect WebSocket to Signaling Server
    connection.connectWebSocket();

    console.log("Application Initialization Complete.");
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', initializeApp); 
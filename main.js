// main.js
import * as dom from './dom.js';
import * as state from './state.js';
import * as ui from './ui.js';
import * as connection from './connection.js';
import * as fileTransfer from './fileTransfer.js';
import { TYPING_TIMER_LENGTH } from './constants.js';

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
    if (event.type === 'keypress' && event.key !== 'Enter') return;
    if (!dom.messageInput) return;

    const messageText = dom.messageInput.value.trim();

    // Stop typing indicator immediately if Enter is pressed
    if (event.type === 'keypress' && event.key === 'Enter') {
        stopLocalTypingIndicator(); // Stop indicator regardless of message content
        if (messageText === '') return; // Don't send empty messages on Enter
    }

    // If not Enter keypress, only proceed if text is not empty (e.g., for a send button click)
    if (event.type !== 'keypress' && messageText === '') {
        return;
    }

    if (state.isConnected && state.dataChannel?.readyState === 'open' && state.sharedKey) {
        const messagePayload = { text: messageText, timestamp: Date.now() };
        try {
            // Send the encrypted chat message
            await connection.sendEncryptedData('encryptedChat', messagePayload);

            // Add message locally AFTER successful send
            ui.addP2PMessageToList({ ...messagePayload, isLocal: true });

            // Clear input and reset state
            dom.messageInput.value = '';
            stopLocalTypingIndicator(); // Ensure indicator is stopped
            dom.messageInput.focus();

        } catch (e) {
            // Error already logged by sendEncryptedData
            // ui.addSystemMessage("发送消息失败。", true); // Potentially redundant
        }
    } else {
        let errorMsg = "无法发送消息：";
        if (!state.isConnected) errorMsg += "未连接。";
        else if (!state.dataChannel || state.dataChannel.readyState !== 'open') errorMsg += "数据通道未就绪。";
        else if (!state.sharedKey) errorMsg += "加密尚未建立。";
        else errorMsg += "未知错误。";
        ui.addSystemMessage(errorMsg, true);
    }
}

// Handle Local User Typing
function handleLocalTyping() {
    if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open' || !state.sharedKey) {
        // console.warn("Cannot send typing indicator: Not connected or encrypted.");
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
        sendTypingState('stopped_typing');
    }
}

// Send typing state update (encrypted)
async function sendTypingState(type) { // type = 'typing' or 'stopped_typing'
     if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open' || !state.sharedKey) {
        // console.warn(`Cannot send ${type} state: Not connected or encrypted.`);
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

function initializeApp() {
    console.log("Initializing P2P Chat Application...");

    // 1. Initial UI Setup
    ui.updateConnectionStatus("未连接", 'neutral');
    if (dom.localUserIdSpan) {
        dom.localUserIdSpan.textContent = state.localUserId;
    } else {
        console.warn("local-user-id span not found in HTML");
    }
    // Disable channel links (not implemented)
    if (dom.channelLinks.length > 0) {
        dom.channelLinks.forEach(link => {
            link.style.opacity = '0.5';
            link.style.pointerEvents = 'none';
        });
        ui.addSystemMessage("频道切换已禁用，请使用上方连接功能。");
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
    ui.addSystemMessage('输入对方的用户 ID，然后点击"连接"按钮发起 P2P 聊天。');


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

    // Other listeners (e.g., for message list clicks) can be added here if needed

    // 3. Connect WebSocket to Signaling Server
    connection.connectWebSocket();

    console.log("Application Initialization Complete.");
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', initializeApp); 
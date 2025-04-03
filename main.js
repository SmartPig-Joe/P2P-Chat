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

// --- MODIFIED: Handle Friend Request Logic ---
async function handleAddContact() {
    if (!dom.addContactInput) {
        console.warn('[Debug] handleAddContact returning early: addContactInput not found.');
        return;
    }
    const peerIdToAdd = dom.addContactInput.value.trim();
    console.log(`[Friend Request] Attempting to add/request contact ID: "${peerIdToAdd}"`);

    if (!peerIdToAdd) {
        ui.addSystemMessage("请输入要添加的 Peer ID。", null, true);
        return;
    }

    if (peerIdToAdd === state.localUserId) {
        ui.addSystemMessage("不能添加自己为联系人。", null, true);
        return;
    }

    // 1. Check if already a contact
    if (state.contacts[peerIdToAdd]) {
        ui.addSystemMessage(`用户 ${state.contacts[peerIdToAdd].name || peerIdToAdd} 已经是您的联系人。`, null);
        return;
    }

    // 2. Check if already sent a request
    console.log(`[Debug] Checking hasPendingOutgoingRequest for ${peerIdToAdd}. Current set:`, new Set(state.pendingOutgoingRequests)); // Log current state
    if (state.hasPendingOutgoingRequest(peerIdToAdd)) {
        console.log(`[Debug] Found existing outgoing request for ${peerIdToAdd}. Returning.`); // Log result
        ui.addSystemMessage(`您已向 ${peerIdToAdd} 发送过好友请求，请等待对方确认。`, null);
        return;
    }
    console.log(`[Debug] No existing outgoing request found for ${peerIdToAdd}. Proceeding.`); // Log result

    // 3. Check if there is an incoming request from this user
    if (state.hasPendingIncomingRequest(peerIdToAdd)) {
        ui.addSystemMessage(`用户 ${peerIdToAdd} 已向您发送好友请求，请在通知中处理。`, null);
        // TODO: Ideally, highlight the incoming request in the UI here
        return;
    }

    // 4. Attempt to connect to the peer
    ui.addSystemMessage(`正在尝试连接到 ${peerIdToAdd} 以发送好友请求...`, null);
    try {
        // connectToPeer now returns a Promise that resolves with the OPEN data channel
        // or rejects if connection fails/times out.
        const dc = await connection.connectToPeer(peerIdToAdd);

        console.log(`[Friend Request] Connection successful (DataChannel open) to ${peerIdToAdd}. Sending request.`);

        // Prepare request message
        const requestMessage = {
            type: 'friend_request',
            payload: {
                senderId: state.localUserId,
                senderName: state.contacts[state.localUserId]?.name || state.localUserId,
                timestamp: Date.now()
            }
        };

        // Send request via the now open DataChannel
        dc.send(JSON.stringify(requestMessage));

        // Update local state and UI *after* successful send
        state.addPendingOutgoingRequest(peerIdToAdd);
        ui.renderContactList(); // Re-render list to show pending state
        ui.addSystemMessage(`已向 ${peerIdToAdd} 发送好友请求。`, null);
        dom.addContactInput.value = ''; // Clear input
        if (dom.addContactNameInput) dom.addContactNameInput.value = '';

    } catch (connectError) {
        // Handle errors from connectToPeer (timeout, ICE failure, DC close/error, etc.)
        console.error(`[Friend Request] Failed to connect or send request to ${peerIdToAdd}:`, connectError);
        // Display a user-friendly error message based on the error
        let errorMessage = `无法向 ${peerIdToAdd} 发送好友请求。`;
        if (connectError instanceof Error) {
            if (connectError.message.includes('timed out')) {
                errorMessage += " 连接超时。对方可能不在线或网络不稳定。";
            } else if (connectError.message.includes('ICE')) {
                errorMessage += " 建立直接连接失败 (ICE)。";
            } else if (connectError.message.includes('closed') || connectError.message.includes('error')) {
                 errorMessage += " 数据通道关闭或发生错误。";
            } else {
                 errorMessage += ` 原因：${connectError.message}`; // General error
            }
        } else {
            errorMessage += " 未知错误。";
        }
        ui.addSystemMessage(errorMessage, null, true);

        // Ensure state is clean after failure (resetPeerConnection is called internally by connectToPeer on failure)
        // state.resetPeerState(peerIdToAdd); // Not needed here, handled by reject path in connectToPeer
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
    state.loadPendingRequests(); // <-- ADD THIS LINE TO LOAD PENDING REQUESTS
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

// --- NEW: Cleanup on page close ---
window.addEventListener('unload', () => {
    console.log("Page is unloading. Cleaning up resources...");

    // Cleanup Object URLs
    ui.cleanupObjectURLs();

    // Disconnect all peers (closes data channels and peer connections)
    // Ensure state reflects the disconnect for potential reconnect logic if needed
    Object.keys(state.peerConnections).forEach(peerId => {
        console.log(`Unload: Disconnecting from ${peerId}`);
        connection.disconnectFromPeer(peerId); // This should handle closing PC and DC
    });

    // Close WebSocket connection if open
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        console.log("Unload: Closing WebSocket connection.");
        state.ws.close(1000, "Page closed"); // Use 1000 for normal closure
    }

    // Stop any pending typing indicators
    stopLocalTypingIndicator();

    console.log("Resource cleanup on unload completed.");
});
// --- END NEW ---

// Start the application
initializeApp(); 
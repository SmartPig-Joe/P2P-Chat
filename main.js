import {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedKey,
    encryptMessage,
    decryptMessage
} from './crypto.js';
import {
    connectWebSocket,
    sendSignalingMessage,
    closeWebSocket,
    isWebSocketConnected
} from './signaling.js';
import {
    initializeWebRTC,
    closePeerConnection,
    resetWebRTCState,
    getDataChannel,
    getSharedKey,
    initiateCall,
    handleOfferAndCreateAnswer,
    handleAnswer,
    handleCandidate
} from './webrtc.js';
import {
    initializeFileTransfer,
    handleFileSelect,
    handleIncomingFileChunk,
    handleIncomingFileInfo,
    handleIncomingFileEnd,
    clearIncompleteTransfers
} from './fileTransfer.js';
import {
    initializeUI,
    elements,
    setupInitialUI,
    updateConnectionStatus,
    addSystemMessage,
    addP2PMessageToList,
    showTypingIndicator,
    hideTypingIndicator,
    updateEmptyState,
    toggleMemberList,
    addFileMessageToList,
    escapeHTML,
    populateMemberList
} from './ui.js';

// --- DOM 元素引用 ---
const channelLinks = document.querySelectorAll('.channel-link');
const messageInput = document.getElementById('message-input');
const messageList = document.getElementById('message-list');
const channelNameHeader = document.getElementById('channel-name');
const typingIndicator = document.getElementById('typing-indicator');
const typingUsersSpan = document.getElementById('typing-users');
const memberListSidebar = document.getElementById('member-list-sidebar');
const memberListToggleButton = document.getElementById('member-list-toggle-button');
const onlineCountSpan = document.getElementById('online-count');
const offlineCountSpan = document.getElementById('offline-count');
const connectionStatusSpan = document.getElementById('connection-status');
const localUserIdSpan = document.getElementById('local-user-id');
const remoteUserIdInput = document.getElementById('remote-user-id-input');
const connectButton = document.getElementById('connect-button');
const chatInputArea = document.querySelector('.px-4.pb-4');
const uploadButton = document.getElementById('upload-button');
const fileInput = document.getElementById('file-input');
const emptyMessageListDiv = document.getElementById('empty-message-list');


// --- WebRTC & WebSocket Globals ---
let localUserId = `user-${Math.random().toString(36).substring(2, 8)}`;
let remoteUserId = null;
let isConnected = false;
let isConnecting = false;
let typingTimeout = null;
const TYPING_TIMER_LENGTH = 1500;
let isTyping = false;
let peerIsTyping = false;

// --- 模拟数据 ---
const mockUsers = [
    { id: "user1", name: "用户名", avatar: "5865f2", status: "online" },
    { id: "user2", name: "用户B", avatar: "43b581", status: "offline", colorClass: "text-green-400" },
    { id: "user3", name: "用户C", avatar: "f04747", status: "offline", colorClass: "text-red-400" },
    { id: "user4", name: "用户D", avatar: "99aab5", status: "offline", colorClass: "text-discord-text-muted" },
    { id: "admin", name: "管理员", avatar: "f1c40f", status: "offline" },
];


// --- 功能函数 ---

// --- Connection Reset Logic ---
function resetConnection() {
    console.log("Resetting connection state (main.js trigger)...");

    closePeerConnection();
    resetWebRTCState();
    closeWebSocket();
    clearIncompleteTransfers();

    let previousRemoteUserId = remoteUserId;
    remoteUserId = null;
    isConnected = false;
    isConnecting = false;

    clearTimeout(typingTimeout);
    isTyping = false;
    peerIsTyping = false;
    hideTypingIndicator(); // Use imported UI function

    updateConnectionStatus("未连接", 'neutral'); // Use imported UI function
    if (previousRemoteUserId) {
        addSystemMessage(`与 ${previousRemoteUserId} 的连接已断开/重置。`); // Use imported UI function
    }

    updateEmptyState(); // Use imported UI function
}

function handleDisconnect() {
    console.log("Disconnect button clicked.");
    addSystemMessage("正在断开连接..."); // Use imported UI function
    resetConnection();
}

// --- Message Sending & Handling ---
async function handleSendMessage(event) {
    if (event.type === 'keypress' && event.key !== 'Enter') return;

    const input = elements.messageInput(); // Use elements from ui.js
    if (!input) return;
    const messageText = input.value.trim();

    const currentDataChannel = getDataChannel();
    const currentSharedKey = getSharedKey();

    if (event.type === 'keypress' && event.key === 'Enter') {
        if (isTyping) {
            clearTimeout(typingTimeout);
            isTyping = false;
            await sendTypingMessage('stopped_typing', currentDataChannel, currentSharedKey);
        }
        if (messageText === '') return;
    } else if (messageText === '') {
        return;
    }

    if (isConnected && currentDataChannel && currentDataChannel.readyState === 'open') {
        if (!currentSharedKey) { addSystemMessage("无法发送消息：加密未就绪。", true); return; }
        const messagePayload = { text: messageText, timestamp: Date.now() };
        try {
            if (isTyping) {
                clearTimeout(typingTimeout);
                isTyping = false;
                await sendTypingMessage('stopped_typing', currentDataChannel, currentSharedKey);
            }
            const encryptedData = await encryptMessage(currentSharedKey, messagePayload);
            const messageToSend = { type: 'encryptedChat', payload: encryptedData };
            currentDataChannel.send(JSON.stringify(messageToSend));
            addP2PMessageToList(messagePayload); // Use imported UI function
            input.value = '';
            input.focus();
        } catch (e) {
            console.error("Failed to encrypt or send message:", e);
            addSystemMessage(`发送消息失败: ${e.message}`, true); // Use imported UI function
        }
    } else {
        addSystemMessage("无法发送消息：未连接或数据通道未打开。", true); // Use imported UI function
    }
}

function handleTyping() {
    const currentDataChannel = getDataChannel();
    const currentSharedKey = getSharedKey();
    if (!isConnected || !currentDataChannel || currentDataChannel.readyState !== 'open' || !currentSharedKey) return;

    if (!isTyping) {
        isTyping = true;
        sendTypingMessage('typing', currentDataChannel, currentSharedKey);
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        if (isTyping) {
            isTyping = false;
            sendTypingMessage('stopped_typing', currentDataChannel, currentSharedKey);
        }
    }, TYPING_TIMER_LENGTH);
}

async function sendTypingMessage(type, channel, key) {
    // ... (logic remains same, uses imported encryptMessage) ...
}

// Central handler for messages received via the Data Channel
async function handleDataChannelMessage(msgData) {
    const currentSharedKey = getSharedKey();

    if (msgData.type === 'binary') {
        handleIncomingFileChunk(msgData.payload); // Delegate
        return;
    }

    switch (msgData.type) {
        case 'encryptedControl':
            if (!currentSharedKey) { /* ... */ return; }
            try {
                const decryptedPayload = await decryptMessage(currentSharedKey, msgData.payload);
                switch (decryptedPayload.type) {
                    case 'typing': peerIsTyping = true; showTypingIndicator(); break; // UI func
                    case 'stopped_typing': peerIsTyping = false; hideTypingIndicator(); break; // UI func
                    default: console.log("Unknown control type:", decryptedPayload.type);
                }
            } catch (error) { addSystemMessage(`解密控制消息失败: ${error.message}`, true); } // UI func
            break;
        case 'encryptedChat':
            if (!currentSharedKey) { /* ... */ return; }
            try {
                const decryptedPayload = await decryptMessage(currentSharedKey, msgData.payload);
                decryptedPayload.isLocal = false;
                if (!decryptedPayload.timestamp) decryptedPayload.timestamp = Date.now();
                addP2PMessageToList(decryptedPayload); // UI func
                if (peerIsTyping) {
                     peerIsTyping = false;
                     hideTypingIndicator(); // UI func
                }
            } catch (error) { addSystemMessage(`解密消息失败: ${error.message}`, true); } // UI func
            break;
        case 'file-info': handleIncomingFileInfo(msgData.payload); break; // Delegate
        case 'file-end': handleIncomingFileEnd(msgData.payload); break; // Delegate
        default:
            console.log(`Unhandled JSON message type via data channel: ${msgData.type}`);
    }
}

// --- File Transfer Logic (MOVED to fileTransfer.js) ---
/*
function handleFileSelect(event) { ... MOVED ... }
async function sendFileChunks(file, transferId, fileInfo, channel) { ... MOVED ... }
function handleIncomingFileChunk(arrayBuffer) { ... MOVED ... }
function handleIncomingFileInfo(fileInfo) { ... MOVED ... }
function handleIncomingFileEnd(payload) { ... MOVED ... }
*/

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded - main.js");
    if (localUserIdSpan) { localUserIdSpan.textContent = localUserId; } else { console.warn("local-user-id span not found in HTML"); }
    updateConnectionStatus("未连接", 'neutral');

    initializeUI(getStateAccessors());
    setupInitialUI();

    initializeWebRTC({
        onIceCandidate: (candidate, targetId) => {
            const candidateMsg = { type: 'candidate', payload: { targetUserId: targetId, candidate: candidate } };
            if (!sendSignalingMessage(candidateMsg)) {
                addSystemMessage("发送 ICE Candidate 失败：WebSocket 未连接。", true);
            }
        },
        onIceConnectionStateChange: (state) => {
            switch (state) {
                case 'connected':
                    updateConnectionStatus(`连接检查通过`, 'progress');
                    isConnecting = false;
                    break;
                case 'disconnected':
                     if (isWebSocketConnected()) {
                        addSystemMessage(`与 ${remoteUserId} 的连接中断。`, true);
                        updateConnectionStatus(`连接中断`, 'error');
                        resetConnection();
                     } else {
                         updateConnectionStatus(`连接中断`, 'error');
                     }
                    break;
                case 'failed':
                     addSystemMessage(`与 ${remoteUserId} 的连接失败。`, true);
                     updateConnectionStatus("连接失败", 'error');
                     resetConnection();
                     break;
                case 'closed':
                     if (isConnected || isConnecting) {
                         console.log("ICE state closed, but connection was active/connecting. Triggering reset.");
                         resetConnection();
                     }
                    break;
                case 'checking':
                    updateConnectionStatus(`正在检查连接...`, 'progress');
                    break;
                case 'completed':
                    console.log("ICE connection checks completed.");
                    updateConnectionStatus(`连接检查完成`, 'progress');
                    break;
                default:
                    updateConnectionStatus(`连接状态: ${state}`, 'neutral');
            }
        },
        handleDataChannelOpen: () => {
            console.log("Data Channel Open callback in main.js");
            isConnected = true;
            isConnecting = false;
            const currentSharedKey = getSharedKey();
            const statusMsg = currentSharedKey ? `已连接到 ${remoteUserId} (E2EE)` : `数据通道已连接 (等待加密)`;
            const statusType = currentSharedKey ? 'success' : 'progress';
            updateConnectionStatus(statusMsg, statusType);
            elements.messageInput()?.focus();
            updateEmptyState();
        },
        handleDataChannelClose: () => {
             console.log("Data Channel Close callback received in main.js");
             if (isWebSocketConnected() && isConnected) {
                 addSystemMessage(`与 ${remoteUserId} 的数据通道已关闭。`, false);
                 resetConnection();
             } else if (isConnected) {
                 isConnected = false;
                 updateConnectionStatus("连接已断开", 'error');
                 resetWebRTCState();
             }
        },
        handleDataChannelError: (error) => {
             console.error("Data Channel Error callback received in main.js:", error);
             addSystemMessage(`数据通道错误: ${error}`, true);
             updateConnectionStatus("连接错误", 'error');
             resetConnection();
        },
        handleDataChannelMessage: handleDataChannelMessage,
        addSystemMessage: addSystemMessage,
        updateConnectionStatus: updateConnectionStatus,
        resetAppConnectionState: resetConnection
    });

    // Setup Event Listeners
    const connectBtn = elements.connectButton();
    const remoteInput = elements.remoteUserIdInput();
    const msgInput = elements.messageInput();
    const memberToggleBtn = elements.memberListToggleButton();
    const uploadBtn = elements.uploadButton();
    const fileIn = elements.fileInput();

    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const currentAction = connectBtn.dataset.action;
            if (currentAction === 'connect') {
                if (remoteInput) {
                    const targetId = remoteInput.value.trim();
                    if (targetId) {
                        remoteUserId = targetId;
                        isConnecting = true;
                        updateConnectionStatus(`正在呼叫 ${targetId}...`, 'progress');
                        initiateCall(targetId); // Call webrtc func
                    } else {
                        addSystemMessage("请输入对方的用户 ID。", true);
                    }
                } else { /* ... */ }
            } else if (currentAction === 'disconnect') {
                handleDisconnect();
            }
        });
    }

    if (msgInput) {
        msgInput.addEventListener('keypress', handleSendMessage);
        msgInput.addEventListener('input', handleTyping);
    }

    if (memberToggleBtn) {
        memberToggleBtn.addEventListener('click', toggleMemberList); // UI func
    }

    if (uploadBtn && fileIn) {
        uploadBtn.addEventListener('click', () => fileIn.click());
        fileIn.addEventListener('change', handleFileSelect); // fileTransfer func
    }

    // Initialize WebSocket Connection
    updateConnectionStatus("正在连接信令服务器...", 'progress');
    connectWebSocket({
        localUserId: localUserId,
        onOpen: (id) => {
            updateConnectionStatus("信令服务器已连接", 'success');
            addSystemMessage(`已连接到信令服务器，您的 ID 是: ${id}`);
        },
        onMessage: (msg) => {
            // ... (logic uses imported handleOfferAndCreateAnswer, handleAnswer, handleCandidate, addSystemMessage, resetConnection, escapeHTML) ...
             switch (msg.type) {
                 // ... cases ...
                 case 'error':
                     console.error(`Received error from server: ${msg.payload.message}`);
                     addSystemMessage(`信令错误: ${msg.payload.message}`, true);
                     if (msg.payload.message.includes("not found")) {
                         const targetNotFound = remoteUserId || '目标用户';
                         addSystemMessage(`呼叫失败：用户 ${escapeHTML(targetNotFound)} 未找到或不在线。`, true); // Use imported escapeHTML
                         if (isConnecting) {
                             isConnecting = false;
                             resetConnection();
                         }
                     }
                     break;
                 // ... other cases ...
             }
        },
        onError: (error) => {
            updateConnectionStatus("信令服务器连接失败", 'error');
            addSystemMessage("无法连接到信令服务器。", true);
            isConnecting = false;
            resetConnection();
        },
        onClose: (graceful) => {
            // ... (logic uses imported resetConnection, updateConnectionStatus) ...
        }
    });

    addSystemMessage('输入对方的用户 ID，然后点击"连接"按钮发起 P2P 聊天。');

    // Initialize File Transfer Module
    initializeFileTransfer({
        getDataChannel: getDataChannel,
        getSharedKey: getSharedKey,
        addSystemMessage: addSystemMessage,
        addFileMessageToList: addFileMessageToList,
        escapeHTML: escapeHTML
    });

    populateMemberList();
    if (memberListSidebar && window.innerWidth < 768) { memberListSidebar.classList.add('hidden'); }
});

function handleMessageListClick(event) { /* Disabled */ }
function handleDeleteMessage(event) { /* Disabled */ }
function handleChannelSwitch(event) { /* Disabled */ }
function loadMockMessages(channelName) { /* Disabled */ }
function scrollToMessage(messageId) { const messageElement = document.getElementById(`message-${messageId}`); if (messageElement) { messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); messageElement.style.backgroundColor = 'rgba(88, 101, 242, 0.2)'; setTimeout(() => { messageElement.style.backgroundColor = ''; }, 1500); } else { console.warn(`Message with ID ${messageId} not found in current view.`); } }

// --- State Accessor Functions ---
const getStateAccessors = () => ({
    getRemoteUserId: () => remoteUserId,
    getIsConnected: () => isConnected,
    getIsConnecting: () => isConnecting,
    getSharedKey: getSharedKey, // From webrtc.js
    getLocalUserId: () => localUserId,
    getMockUsers: () => mockUsers,
    isWebSocketConnected: isWebSocketConnected // From signaling.js
}); 
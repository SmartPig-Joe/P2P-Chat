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
let ws = null;
let peerConnection = null;
let dataChannel = null;
let localUserId = `user-${Date.now().toString().slice(-6)}`;
let remoteUserId = null;
let isConnected = false;
let isConnecting = false;
const signalingServerUrl = 'ws://172.245.126.148:8080/ws';
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};
let localKeyPair = null;
let sharedKey = null;
let peerPublicKey = null;
// Typing indicator state
let typingTimeout = null;
const TYPING_TIMER_LENGTH = 1500; // ms
let isTyping = false; // Track if *local* user is typing
let peerIsTyping = false; // Track if *remote* user is typing
const FILE_CHUNK_SIZE = 16 * 1024; // 16 KB chunk size for DataChannel
let incomingFiles = {}; // Store incoming file chunks { transferId: { info: {}, chunks: [], receivedSize: 0 } }

// --- 模拟数据 ---
const mockUsers = [
    { id: "user1", name: "用户名", avatar: "5865f2", status: "online" },
    { id: "user2", name: "用户B", avatar: "43b581", status: "offline", colorClass: "text-green-400" },
    { id: "user3", name: "用户C", avatar: "f04747", status: "offline", colorClass: "text-red-400" },
    { id: "user4", name: "用户D", avatar: "99aab5", status: "offline", colorClass: "text-discord-text-muted" },
    { id: "admin", name: "管理员", avatar: "f1c40f", status: "offline" },
];


// --- 功能函数 ---

function escapeHTML(str) { if (!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

// --- New: Function to toggle empty state message ---
function updateEmptyState() {
    if (!messageList || !emptyMessageListDiv) return;

    // Check if messageList contains any actual message elements
    // We look for elements with class 'message-item' (both text and file messages use this)
    const hasMessages = messageList.querySelector('.message-item') !== null;

    if (hasMessages) {
        emptyMessageListDiv.classList.add('hidden');
    } else {
        emptyMessageListDiv.classList.remove('hidden');
    }
}

// 更新连接状态显示 (修改)
function updateConnectionStatus(statusText, statusType = 'neutral') { // statusType: 'neutral', 'success', 'error', 'progress'
    if (connectionStatusSpan) {
        connectionStatusSpan.textContent = statusText;
        let colorClass = 'text-discord-text-muted';
        if (statusType === 'success') colorClass = 'text-discord-green';
        else if (statusType === 'error') colorClass = 'text-discord-red';
        else if (statusType === 'progress') colorClass = 'text-yellow-400';
        connectionStatusSpan.className = `text-xs ml-2 font-semibold ${colorClass}`;
    }

    if (chatInputArea) {
        chatInputArea.style.display = isConnected && sharedKey ? '' : 'none';
    }

    if (connectButton) {
        connectButton.disabled = isConnecting;
        if (isConnected) {
            connectButton.textContent = '断开连接';
            connectButton.dataset.action = 'disconnect';
            connectButton.classList.remove('bg-discord-green', 'hover:bg-green-600');
            connectButton.classList.add('bg-discord-red', 'hover:bg-red-600');
            if (remoteUserIdInput) remoteUserIdInput.disabled = true;
        } else {
            connectButton.textContent = '连接';
            connectButton.dataset.action = 'connect';
            connectButton.classList.remove('bg-discord-red', 'hover:bg-red-600');
            connectButton.classList.add('bg-discord-green', 'hover:bg-green-600');
            if (remoteUserIdInput) remoteUserIdInput.disabled = !(ws?.readyState === WebSocket.OPEN);
            connectButton.disabled = !(ws?.readyState === WebSocket.OPEN) || isConnecting; // Also disable if connecting
        }
    }

    populateMemberList();
}

function addSystemMessage(text, isError = false) { const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted'; const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`; if (messageList) { messageList.insertAdjacentHTML('beforeend', messageHTML); messageList.scrollTop = messageList.scrollHeight; } }

function createP2PMessageHTML(msgData) { const sender = msgData.isLocal ? mockUsers[0] : (mockUsers.find(u => u.id === remoteUserId) || { name: remoteUserId || '远程用户', avatar: '99aab5' }); const avatarColor = sender?.avatar || '5865f2'; const userColorClass = msgData.isLocal ? getUserColorClass(sender.name) : 'text-yellow-400'; const timeString = formatTime(new Date(msgData.timestamp)); const lockIcon = sharedKey ? '<span class="lucide text-xs ml-1 text-discord-green" title="端到端加密">&#xe297;</span>' : ''; return `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded"><img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'"><div class="flex-1"><div class="flex items-baseline space-x-2"><span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span><span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(msgData.timestamp).toLocaleString('zh-CN')}">${timeString}</span>${lockIcon}</div><p class="text-discord-text-primary text-sm message-content">${renderMessageContent(msgData.text)}</p></div></div>`; }

function addP2PMessageToList(msgData) { if (messageList) { const messageElement = document.createElement('div'); messageElement.innerHTML = createP2PMessageHTML(msgData); if (messageElement.firstElementChild) { messageList.appendChild(messageElement.firstElementChild); } messageList.scrollTop = messageList.scrollHeight; updateEmptyState(); } }

function renderMessageContent(text) { const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig; return escapeHTML(text).replace(urlRegex, function(url) { return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`; }); }

function getUserColorClass(username) { const user = mockUsers.find(u => u.name === username); if (user && user.colorClass) return user.colorClass; const colors = ['text-white', 'text-green-400', 'text-red-400', 'text-yellow-400', 'text-blue-400', 'text-purple-400', 'text-pink-400']; let hash = 0; for (let i = 0; i < username.length; i++) { hash = username.charCodeAt(i) + ((hash << 5) - hash); } return colors[Math.abs(hash % colors.length)]; }

function formatTime(date) { return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }

// --- Crypto Functions ---
const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS = { name: 'AES-GCM', length: 256 };
const KEY_USAGE_ECDH = ['deriveKey', 'deriveBits'];
const KEY_USAGE_AES = ['encrypt', 'decrypt'];

async function generateAndStoreKeyPair() { try { localKeyPair = await window.crypto.subtle.generateKey( ECDH_PARAMS, true, KEY_USAGE_ECDH ); console.log("ECDH key pair generated:", localKeyPair); } catch (error) { console.error("Error generating key pair:", error); addSystemMessage("生成密钥对失败。", true); resetConnection(); } }
async function exportPublicKey(key) { if (!key) return null; try { const exported = await window.crypto.subtle.exportKey( "jwk", key ); return exported; } catch (error) { console.error("Error exporting public key:", error); return null; } }
async function importPublicKey(jwk) { if (!jwk) return null; try { const importedKey = await window.crypto.subtle.importKey( "jwk", jwk, ECDH_PARAMS, true, [] ); console.log("Peer public key imported successfully."); return importedKey; } catch (error) { console.error("Error importing public key:", error); return null; } }
async function deriveSharedKey(localPrivateKey, peerPublicKey) { if (!localPrivateKey || !peerPublicKey) return null; try { const derived = await window.crypto.subtle.deriveKey( { name: ECDH_PARAMS.name, public: peerPublicKey }, localPrivateKey, AES_PARAMS, true, KEY_USAGE_AES ); console.log("Shared AES key derived:", derived); return derived; } catch (error) { console.error("Error deriving shared key:", error); return null; } }
async function encryptMessage(key, data) { if (!key) throw new Error("Encryption key is not available."); try { const iv = window.crypto.getRandomValues(new Uint8Array(12)); const encodedData = new TextEncoder().encode(JSON.stringify(data)); const ciphertext = await window.crypto.subtle.encrypt( { name: AES_PARAMS.name, iv: iv }, key, encodedData ); return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) }; } catch (error) { console.error("Encryption error:", error); throw error; } }
async function decryptMessage(key, encryptedData) { if (!key) throw new Error("Decryption key is not available."); if (!encryptedData || !encryptedData.iv || !encryptedData.ciphertext) { throw new Error("Invalid encrypted data format."); } try { const iv = new Uint8Array(encryptedData.iv); const ciphertext = new Uint8Array(encryptedData.ciphertext); const decrypted = await window.crypto.subtle.decrypt( { name: AES_PARAMS.name, iv: iv }, key, ciphertext ); const decodedData = new TextDecoder().decode(decrypted); return JSON.parse(decodedData); } catch (error) { console.error("Decryption error:", error); throw new Error("Decryption failed."); } }

// --- WebSocket Logic ---
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    console.log(`Attempting to connect to signaling server: ${signalingServerUrl}`);
    updateConnectionStatus("正在连接信令服务器...", 'progress');
    isConnecting = true;
    ws = new WebSocket(signalingServerUrl);

    ws.onopen = () => {
        console.log("WebSocket connection established.");
        updateConnectionStatus("信令服务器已连接", 'success');
        isConnecting = false;
        const registerMsg = { type: "register", payload: { userId: localUserId } };
        ws.send(JSON.stringify(registerMsg));
        console.log(`Sent register message for user: ${localUserId}`);
        if (localUserIdSpan) localUserIdSpan.textContent = localUserId;
        addSystemMessage(`已连接到信令服务器，您的 ID 是: ${localUserId}`);
        if (connectButton) connectButton.disabled = false;
        if(remoteUserIdInput) remoteUserIdInput.disabled = false; // Enable input after WS connect
    };

    ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); console.log("Received message:", msg); } catch (e) { console.error("Failed to parse message:", event.data, e); return; }
        if (msg.from && msg.from !== localUserId && !remoteUserId) { console.log(`Received message from new peer: ${msg.from}`); }

        switch (msg.type) {
            case 'offer':
                if (isConnected || isConnecting) { console.warn(`Ignoring offer, already connected/connecting to ${remoteUserId}`); return; }
                remoteUserId = msg.from;
                console.log(`Received offer from ${remoteUserId}`);
                addSystemMessage(`收到来自 ${remoteUserId} 的连接请求...`);
                updateConnectionStatus(`正在连接 ${remoteUserId}...`, 'progress');
                isConnecting = true;
                handleOffer(msg.payload.sdp);
                break;
            case 'answer':
                if (msg.from !== remoteUserId) { console.warn(`Received answer from unexpected peer ${msg.from}. Ignoring.`); return; }
                console.log(`Received answer from ${remoteUserId}`);
                handleAnswer(msg.payload.sdp);
                break;
            case 'candidate':
                if (msg.from !== remoteUserId && remoteUserId != null) { console.warn(`Received candidate from unexpected peer ${msg.from}. Current remote: ${remoteUserId}. Ignoring.`); return; }
                console.log(`Received ICE candidate from ${msg.from}`);
                handleCandidate(msg.payload.candidate);
                break;
            case 'error':
                console.error(`Received error from server: ${msg.payload.message}`);
                addSystemMessage(`信令错误: ${msg.payload.message}`, true);
                if (msg.payload.message.includes("not found")) { resetConnection(); }
                break;
            case 'user_disconnected':
                if (msg.payload.userId === remoteUserId) { addSystemMessage(`${remoteUserId} 已断开连接。`); resetConnection(); }
                break;
            default:
                console.log("Received unhandled message type:", msg.type);
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        updateConnectionStatus("信令服务器连接失败", 'error');
        addSystemMessage("无法连接到信令服务器，请检查服务器状态和网络连接。", true);
        isConnecting = false;
        isConnected = false;
        resetConnection();
    };

    ws.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        if (!isConnected && !isConnecting && event.code !== 1000) {
            updateConnectionStatus("信令服务器连接已断开", 'error');
            addSystemMessage("与信令服务器的连接已断开。", true);
        } else if (!isConnected) {
            updateConnectionStatus("未连接", 'neutral');
        }
        ws = null;
        isConnecting = false;
        resetConnection();
    };
}

function sendSignalingMessage(payload) { if (ws && ws.readyState === WebSocket.OPEN) { try { const messageString = JSON.stringify(payload); console.log("Sending message:", payload); ws.send(messageString); } catch (e) { console.error("Failed to send message:", e); } } else { console.error("WebSocket is not connected."); addSystemMessage("无法发送信令：WebSocket 未连接。", true); } }

// --- WebRTC Logic ---

function createPeerConnection() {
    if (peerConnection) { console.log("Closing existing PeerConnection"); peerConnection.close(); }
    console.log("Creating new PeerConnection");
    try { peerConnection = new RTCPeerConnection(peerConnectionConfig); } catch (e) { console.error("Failed to create PeerConnection:", e); addSystemMessage("创建 PeerConnection 失败。", true); resetConnection(); return; }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && remoteUserId) {
            console.log(`Generated ICE candidate:`, event.candidate);
            const candidateMsg = { type: 'candidate', payload: { targetUserId: remoteUserId, candidate: event.candidate } };
            sendSignalingMessage(candidateMsg);
        } else {
            console.log("ICE gathering finished or no remote user ID set.");
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) return;
        console.log(`ICE connection state changed: ${peerConnection.iceConnectionState}`);
        switch (peerConnection.iceConnectionState) {
            case 'connected':
                updateConnectionStatus(`连接已建立，等待数据通道...`, 'progress');
                isConnected = true; // Mark as connected at ICE level
                isConnecting = false;
                break;
            case 'disconnected':
                addSystemMessage(`与 ${remoteUserId} 的连接中断，尝试重连...`);
                updateConnectionStatus(`连接中断`, 'error');
                break;
            case 'failed':
                addSystemMessage(`与 ${remoteUserId} 的连接失败。`, true);
                updateConnectionStatus("连接失败", 'error');
                resetConnection();
                break;
            case 'closed':
                if (isConnected || isConnecting) { addSystemMessage(`与 ${remoteUserId} 的连接已关闭。`); }
                resetConnection();
                break;
            case 'checking':
                updateConnectionStatus(`正在检查与 ${remoteUserId} 的连接...`, 'progress');
                break;
            case 'completed':
                console.log("ICE connection completed.");
                break;
            default:
                updateConnectionStatus(`ICE 状态: ${peerConnection.iceConnectionState}`, 'neutral');
        }
    };

    peerConnection.ondatachannel = (event) => {
        console.log('ondatachannel event received');
        dataChannel = event.channel;
        setupDataChannelEvents(dataChannel);
        addSystemMessage(`收到来自 ${remoteUserId} 的数据通道。`);
    };
}

async function setupDataChannelEvents(channel) {
    if (!channel) return;
    console.log(`Setting up data channel: ${channel.label}, State: ${channel.readyState}`);

    // Override binaryType for ArrayBuffer handling
    channel.binaryType = 'arraybuffer';

    channel.onopen = async () => {
        console.log(`Data channel opened with ${remoteUserId}`);
        isConnected = true; // Confirmed P2P
        isConnecting = false;
        updateConnectionStatus(`数据通道开启 (等待加密...)`, 'progress');
        await generateAndStoreKeyPair();
        if (localKeyPair && localKeyPair.publicKey) {
            const exportedKey = await exportPublicKey(localKeyPair.publicKey);
            if (exportedKey) {
                const publicKeyMessage = { type: 'publicKey', payload: exportedKey };
                try {
                    channel.send(JSON.stringify(publicKeyMessage));
                    console.log("Sent public key over data channel.");
                    addSystemMessage("已发送公钥，等待对方公钥...");
                } catch (e) {
                    console.error("Failed to send public key:", e);
                    addSystemMessage("发送公钥失败。", true);
                    resetConnection();
                    return; // Stop processing on error
                }

                if (peerPublicKey) {
                    sharedKey = await deriveSharedKey(localKeyPair.privateKey, peerPublicKey);
                    if (sharedKey) {
                        console.log("E2EE established!");
                        addSystemMessage("端到端加密已建立！可以开始聊天。");
                        updateConnectionStatus(`已连接到 ${remoteUserId} (E2EE)`, 'success');
                    } else {
                        addSystemMessage("共享密钥派生失败！", true);
                        resetConnection();
                    }
                }
            } else {
                addSystemMessage("导出公钥失败。", true);
                resetConnection();
            }
        } else {
            addSystemMessage("生成本地密钥对失败。", true);
            resetConnection();
        }
        messageInput.focus();
        updateEmptyState(); // Check empty state when channel opens
    };

    channel.onmessage = async (event) => {
        // --- Start: File Transfer Handling ---
        if (event.data instanceof ArrayBuffer) {
            // Received a binary chunk (file data)
            handleIncomingFileChunk(event.data);
            return; // Handled binary data
        }
        // --- End: File Transfer Handling ---

        console.log(`Raw data channel message received from ${remoteUserId}:`, event.data);
        let msgData;
        try { msgData = JSON.parse(event.data); } catch (e) { console.error("Failed to parse message (might be text, but not JSON):", event.data, e); /* Maybe handle plain text? For now, ignore. */ return; }

        // Handle Non-Binary Messages (JSON)
        switch (msgData.type) {
            case 'encryptedControl':
                if (!sharedKey) { console.warn("Received encrypted control message, but shared key is not ready. Ignoring."); return; }
                try {
                    const decryptedPayload = await decryptMessage(sharedKey, msgData.payload);
                    console.log("Decrypted control payload:", decryptedPayload);

                    switch (decryptedPayload.type) {
                        case 'typing':
                            showTypingIndicator();
                            break;
                        case 'stopped_typing':
                            hideTypingIndicator();
                            break;
                        default:
                            console.log("Received unknown encrypted control type:", decryptedPayload.type);
                    }
                } catch (error) {
                    console.error("Failed to decrypt control message:", error);
                    addSystemMessage("解密收到的控制消息失败！", true);
                }
                return; // Processed control message
            case 'publicKey':
                console.log("Received peer public key.");
                addSystemMessage("收到对方公钥，正在设置加密...");
                peerPublicKey = await importPublicKey(msgData.payload);
                if (peerPublicKey) {
                    if (localKeyPair && localKeyPair.privateKey) {
                        sharedKey = await deriveSharedKey(localKeyPair.privateKey, peerPublicKey);
                        if (sharedKey) {
                            console.log("E2EE established!");
                            addSystemMessage("端到端加密已建立！可以开始聊天。");
                            updateConnectionStatus(`已连接到 ${remoteUserId} (E2EE)`, 'success');
                        } else {
                            addSystemMessage("共享密钥派生失败！", true);
                            resetConnection();
                        }
                    } else {
                        console.log("Received peer key, but local keys not ready yet. Waiting.");
                    }
                } else {
                    addSystemMessage("导入对方公钥失败。", true);
                    resetConnection();
                }
                return;
            case 'encryptedChat':
                if (!sharedKey) { console.warn("Received encrypted message, but shared key is not ready. Ignoring."); addSystemMessage("收到加密消息，但加密尚未就绪。"); return; }
                try {
                    const decryptedPayload = await decryptMessage(sharedKey, msgData.payload);
                    console.log("Decrypted message payload:", decryptedPayload);
                    if (!decryptedPayload.timestamp) decryptedPayload.timestamp = Date.now();
                    decryptedPayload.isLocal = false;
                    addP2PMessageToList(decryptedPayload);
                } catch (error) {
                    console.error("Failed to decrypt message:", error);
                    addSystemMessage("解密收到的消息失败！可能密钥不匹配或消息已损坏。", true);
                }
                return;
            // --- Start: File Transfer Metadata Handling ---
            case 'file-info':
                handleIncomingFileInfo(msgData.payload);
                break;
            case 'file-end':
                handleIncomingFileEnd(msgData.payload);
                break;
            // --- End: File Transfer Metadata Handling ---
            default:
                console.log(`Received unhandled message type via data channel: ${msgData.type}`);
        }
    };

    channel.onclose = () => {
        console.log(`Data channel closed with ${remoteUserId}`);
        addSystemMessage(`与 ${remoteUserId} 的数据通道已关闭。`);
        if (isConnected) {
            updateConnectionStatus("连接已断开", 'error');
            resetConnection();
        }
        // Clear any incomplete file transfers on disconnect
        incomingFiles = {};
    };

    channel.onerror = (error) => {
        console.error("Data channel error:", error);
        addSystemMessage(`数据通道错误: ${error}`, true);
        updateConnectionStatus("连接错误", 'error');
        resetConnection();
        // Clear any incomplete file transfers on disconnect
        incomingFiles = {};
    };
}

function initiateCall(targetUserId) {
    if (!targetUserId) { addSystemMessage("请输入目标用户 ID。", true); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { addSystemMessage("信令服务器未连接，无法发起呼叫。", true); return; }
    if (isConnected || isConnecting) { addSystemMessage(`已经连接或正在连接 ${remoteUserId}，请先断开。`, true); return; }

    remoteUserId = targetUserId;
    console.log(`Initiating call to ${remoteUserId}`);
    addSystemMessage(`正在尝试连接 ${remoteUserId}...`);
    updateConnectionStatus(`呼叫 ${remoteUserId}...`, 'progress');
    isConnecting = true;
    createPeerConnection();
    try {
        dataChannel = peerConnection.createDataChannel("chatChannel", { reliable: true });
        console.log("Data channel created");
        setupDataChannelEvents(dataChannel);
    } catch (e) {
        console.error("Failed to create data channel:", e);
        addSystemMessage("创建数据通道失败。", true);
        resetConnection();
        return;
    }

    peerConnection.createOffer()
        .then(offer => { console.log("Offer created"); return peerConnection.setLocalDescription(offer); })
        .then(() => {
            console.log("Local description set");
            const offerMsg = { type: 'offer', payload: { targetUserId: remoteUserId, sdp: peerConnection.localDescription } };
            sendSignalingMessage(offerMsg);
            console.log("Offer sent to signaling server");
            updateConnectionStatus(`Offer 已发送至 ${remoteUserId}`, 'progress');
        })
        .catch(error => { console.error("Error creating/sending offer:", error); addSystemMessage(`创建或发送 Offer 失败: ${error}`, true); resetConnection(); });
}

function handleOffer(offerSdp) {
    if (!peerConnection) { createPeerConnection(); }
    peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp))
        .then(() => {
            console.log("Remote description (offer) set");
            updateConnectionStatus(`收到 Offer，正在创建 Answer...`, 'progress');
            return peerConnection.createAnswer();
        })
        .then(answer => { console.log("Answer created"); return peerConnection.setLocalDescription(answer); })
        .then(() => {
            console.log("Local description (answer) set");
            const answerMsg = { type: 'answer', payload: { targetUserId: remoteUserId, sdp: peerConnection.localDescription } };
            sendSignalingMessage(answerMsg);
            console.log("Answer sent to signaling server");
            updateConnectionStatus(`Answer 已发送至 ${remoteUserId}`, 'progress');
            isConnecting = false;
        })
        .catch(error => { console.error("Error handling offer/creating answer:", error); addSystemMessage(`处理 Offer 或创建 Answer 失败: ${error}`, true); resetConnection(); });
}

function handleAnswer(answerSdp) {
    if (!peerConnection || !peerConnection.localDescription) { console.error("Received answer but PeerConnection or local description is missing."); return; }
    updateConnectionStatus(`收到 ${remoteUserId} 的 Answer...`, 'progress');
    peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp))
        .then(() => {
            console.log("Remote description (answer) set");
            updateConnectionStatus(`应答已处理，等待连接...`, 'progress');
            isConnecting = false;
        })
        .catch(error => { console.error("Error setting remote description (answer):", error); addSystemMessage(`设置远程 Answer 失败: ${error}`, true); resetConnection(); });
}

function handleCandidate(candidate) {
    if (!peerConnection || !peerConnection.remoteDescription) { console.warn("Received candidate but PeerConnection or remote description is not ready yet."); }
    const rtcCandidate = new RTCIceCandidate(candidate);
    peerConnection.addIceCandidate(rtcCandidate)
        .then(() => { console.log("ICE candidate added successfully"); })
        .catch(error => { console.warn("Error adding ICE candidate:", error); });
}

function resetConnection(notifyPeer = false) {
    console.log("Resetting connection state.");
    if (dataChannel) { dataChannel.close(); }
    if (peerConnection) { peerConnection.close(); }
    dataChannel = null;
    peerConnection = null;
    let previousRemoteUserId = remoteUserId;
    remoteUserId = null;
    isConnected = false;
    isConnecting = false;
    localKeyPair = null;
    sharedKey = null;
    peerPublicKey = null;
    // Reset typing state
    clearTimeout(typingTimeout);
    isTyping = false;
    peerIsTyping = false;
    hideTypingIndicator(); // Ensure indicator is hidden

    updateConnectionStatus("未连接", 'neutral');
    if (previousRemoteUserId) {
        addSystemMessage(`与 ${previousRemoteUserId} 的连接已断开/重置。`);
    } else {
        addSystemMessage("连接已重置。");
    }
    if(remoteUserIdInput) remoteUserIdInput.disabled = !(ws?.readyState === WebSocket.OPEN);
    // Clear any incomplete file transfers
    incomingFiles = {};
    // Clear the message list visually (optional, could leave old messages)
    // if (messageList) messageList.innerHTML = '';
    updateEmptyState(); // Check empty state after resetting
}

function handleDisconnect() {
    console.log("Disconnect button clicked.");
    addSystemMessage("正在断开连接...");
    resetConnection(true);
}

// --- Message Sending ---
async function handleSendMessage(event) {
    if (event.type === 'keypress' && event.key !== 'Enter') return;
    if (!messageInput) return; // Safety check

    const messageText = messageInput.value.trim();

    if (event.type === 'keypress' && event.key === 'Enter') {
        // Clear potential pending typing state when Enter is pressed, even if message is empty
        if (isTyping) {
            clearTimeout(typingTimeout);
            isTyping = false;
            sendTypingMessage('stopped_typing');
        }
        if (messageText === '') return; // Don't send empty messages
    } else if (messageText === '') {
        return; // Don't process if not Enter keypress and text is empty
    }


    if (isConnected && dataChannel && dataChannel.readyState === 'open') {
        if (!sharedKey) { addSystemMessage("无法发送消息：端到端加密尚未建立。", true); return; }
        const messagePayload = { text: messageText, timestamp: Date.now() };
        try {
            // Ensure local typing indicator stops immediately after sending
            if (isTyping) {
                clearTimeout(typingTimeout);
                isTyping = false;
                await sendTypingMessage('stopped_typing'); // Make sure it's sent before the chat message potentially
            }

            const encryptedData = await encryptMessage(sharedKey, messagePayload);
            const messageToSend = { type: 'encryptedChat', payload: encryptedData };
            dataChannel.send(JSON.stringify(messageToSend));
            console.log("Sent encrypted message via data channel.");
            addP2PMessageToList({ ...messagePayload, isLocal: true });
            messageInput.value = '';
            messageInput.focus();
        } catch (e) {
            console.error("Failed to encrypt or send message:", e);
            addSystemMessage("发送加密消息失败。", true);
        }
    } else {
        addSystemMessage("无法发送消息：未连接到对等方或数据通道未打开。", true);
    }
}

// --- Typing Indicator Logic ---
function handleTyping() {
    if (!isConnected || !dataChannel || dataChannel.readyState !== 'open' || !sharedKey) return; // Ensure connection and encryption

    if (!isTyping) {
        isTyping = true;
        sendTypingMessage('typing'); // Send typing indicator start
    }

    // Clear the previous timer
    clearTimeout(typingTimeout);

    // Set a new timer
    typingTimeout = setTimeout(() => {
        if (isTyping) { // Check if still typing, might have been cleared by sending msg
            isTyping = false;
            sendTypingMessage('stopped_typing'); // Send typing indicator stop
        }
    }, TYPING_TIMER_LENGTH);
}

async function sendTypingMessage(type) { // type = 'typing' or 'stopped_typing'
    if (!isConnected || !dataChannel || dataChannel.readyState !== 'open' || !sharedKey) return;

    try {
        const typingPayload = { type: type }; // Simple payload, type indicates state
        const encryptedData = await encryptMessage(sharedKey, typingPayload);
        const messageToSend = { type: 'encryptedControl', payload: encryptedData }; // Use new type for control messages

        dataChannel.send(JSON.stringify(messageToSend));
        console.log(`Sent ${type} message.`);
    } catch (error) {
        console.error(`Failed to send ${type} message:`, error);
        // Avoid flooding UI with system messages for typing errors
    }
}

function showTypingIndicator() {
    if (!typingIndicator || !typingUsersSpan || !isConnected) return; // Don't show if disconnected
    const remoteName = mockUsers.find(u => u.id === remoteUserId)?.name || remoteUserId || '对方';
    typingUsersSpan.textContent = escapeHTML(remoteName);
    typingIndicator.classList.remove('hidden');
    typingIndicator.classList.add('flex'); // Use flex to align items
    peerIsTyping = true;
    // Optional: Scroll to bottom if indicator appears and might push content
    // messageList.scrollTop = messageList.scrollHeight;
}

function hideTypingIndicator() {
    if (!typingIndicator) return;
    typingIndicator.classList.add('hidden');
    typingIndicator.classList.remove('flex');
    peerIsTyping = false;
}

// --- File Transfer Logic ---

function handleFileSelect(event) {
    if (!isConnected || !dataChannel || dataChannel.readyState !== 'open') {
        addSystemMessage("无法发送文件：未连接或数据通道未就绪。", true);
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    console.log(`Selected file: ${file.name}, Size: ${file.size}, Type: ${file.type}`);

    // Reset the file input so the same file can be selected again
    event.target.value = null;

    // Generate a unique ID for this transfer
    const transferId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const fileInfo = {
        transferId: transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: Date.now()
    };

    // 1. Send file metadata
    try {
        const messageToSend = { type: 'file-info', payload: fileInfo };
        dataChannel.send(JSON.stringify(messageToSend));
        console.log("Sent file-info:", fileInfo);
        // Display message locally (showing progress)
        addFileMessageToList(fileInfo, true, null, 0);
    } catch (e) {
        console.error("Failed to send file-info:", e);
        addSystemMessage(`发送文件 ${file.name} 的信息失败。`, true);
        return;
    }

    // 2. Send file chunks
    sendFileChunks(file, transferId, fileInfo);
}

async function sendFileChunks(file, transferId, fileInfo) {
    let offset = 0;
    const fileReader = new FileReader();
    let chunkCount = 0;
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);

    // Function to read the next chunk
    const readNextChunk = () => {
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
        const chunk = e.target.result;
        chunkCount++;
        console.log(`Sending chunk ${chunkCount}/${totalChunks} for ${transferId}`);

        try {
            // Prepend transferId to the ArrayBuffer chunk for identification on the receiving side
            const idBuffer = new TextEncoder().encode(transferId + '|'); // Separator '|'
            const combinedBuffer = new ArrayBuffer(idBuffer.byteLength + chunk.byteLength);
            const combinedView = new Uint8Array(combinedBuffer);
            combinedView.set(new Uint8Array(idBuffer), 0);
            combinedView.set(new Uint8Array(chunk), idBuffer.byteLength);

            // Check dataChannel buffer before sending
            const BUFFER_THRESHOLD = 512 * 1024; // 512KB threshold
            while (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`DataChannel buffer full (${dataChannel.bufferedAmount}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Wait briefly
            }

            dataChannel.send(combinedBuffer);
            offset += chunk.byteLength;

            // Update local progress - Now fileInfo is accessible
            const progress = offset / file.size;
            addFileMessageToList(fileInfo, true, null, progress);

            if (offset < file.size) {
                // Read the next chunk immediately
                 readNextChunk();
            } else {
                // All chunks sent, send the end signal
                console.log(`Finished sending all chunks for ${transferId}`);
                const endMessage = { type: 'file-end', payload: { transferId: transferId } };
                dataChannel.send(JSON.stringify(endMessage));
                console.log("Sent file-end message.");
                // Update local message to 'Sent' status after sending file-end
                addFileMessageToList(fileInfo, true, null, 1); // Progress 1 signals completion for sender
            }
        } catch (error) {
            console.error(`Error sending chunk for ${transferId}:`, error);
            // Display more specific error in UI
            const errorMsg = error instanceof Error ? error.message : String(error);
            addSystemMessage(`发送文件 ${file.name} 的块失败: ${errorMsg}`, true);
            // TODO: Implement cancellation or retry?
            // delete incomingFiles[transferId]; // BUG: Sender should not delete receiver state
        }
    };

    fileReader.onerror = (error) => {
        console.error("FileReader error:", error);
        addSystemMessage(`读取文件 ${file.name} 时出错。`, true);
    };

    // Start reading the first chunk
    readNextChunk();
}

// --- New: Handle Incoming File Chunks (Binary Data) ---
function handleIncomingFileChunk(arrayBuffer) {
    try {
         // Separate the transferId from the chunk data
        const view = new Uint8Array(arrayBuffer);
        let separatorIndex = -1;
        for (let i = 0; i < Math.min(view.length, 50); i++) { // Search for '|' in the first 50 bytes
            if (view[i] === 124) { // ASCII code for '|'
                separatorIndex = i;
                break;
            }
        }

        if (separatorIndex === -1) {
            console.error("Received binary chunk without valid transferId separator.");
            return;
        }

        const idBuffer = arrayBuffer.slice(0, separatorIndex);
        const chunkData = arrayBuffer.slice(separatorIndex + 1);
        const transferId = new TextDecoder().decode(idBuffer);

        const fileData = incomingFiles[transferId];
        if (!fileData) {
            console.warn(`Received chunk for unknown transfer ID: ${transferId}`);
            return;
        }

        fileData.chunks.push(chunkData);
        fileData.receivedSize += chunkData.byteLength;

        const progress = fileData.receivedSize / fileData.info.size;
        console.log(`Received chunk for ${transferId}. Progress: ${Math.round(progress * 100)}%`);

        // Update UI progress
        addFileMessageToList(fileData.info, false, null, progress);

    } catch (error) {
        console.error("Error processing incoming file chunk:", error);
    }
}

// --- New: Handle Incoming File Info (Metadata) ---
function handleIncomingFileInfo(fileInfo) {
    if (!fileInfo || !fileInfo.transferId || !fileInfo.name || typeof fileInfo.size !== 'number') {
        console.error("Received invalid file-info:", fileInfo);
        addSystemMessage("收到无效的文件信息。", true);
        return;
    }
    const transferId = fileInfo.transferId;
    console.log(`Received file-info for ${transferId}:`, fileInfo);

    if (incomingFiles[transferId]) {
        console.warn(`Received duplicate file-info for transfer ID: ${transferId}. Ignoring.`);
        return;
    }

    incomingFiles[transferId] = {
        info: fileInfo,
        chunks: [],
        receivedSize: 0
    };

    // Display message locally (showing progress)
    addFileMessageToList(fileInfo, false, null, 0);
    addSystemMessage(`正在接收文件: ${escapeHTML(fileInfo.name)}`);
}

// --- New: Handle Incoming File End Signal ---
function handleIncomingFileEnd(payload) {
     if (!payload || !payload.transferId) {
        console.error("Received invalid file-end payload:", payload);
        return;
    }
    const transferId = payload.transferId;
    console.log(`Received file-end for ${transferId}`);

    const fileData = incomingFiles[transferId];
    if (!fileData) {
        console.warn(`Received file-end for unknown or already completed transfer ID: ${transferId}`);
        return;
    }

    if (fileData.receivedSize !== fileData.info.size) {
        console.error(`File transfer incomplete for ${transferId}. Expected ${fileData.info.size}, got ${fileData.receivedSize}.`);
        addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收不完整。`, true);
        addFileMessageToList(fileData.info, false, null, fileData.receivedSize / fileData.info.size); // Update final progress shown
         // Keep the partial data for potential debugging or future retry logic? For now, just delete.
        delete incomingFiles[transferId];
        return;
    }

    console.log(`File ${transferId} received completely. Assembling...`);
    try {
        const fileBlob = new Blob(fileData.chunks, { type: fileData.info.type });
        const downloadUrl = URL.createObjectURL(fileBlob);

        console.log(`File ${transferId} assembled. Download URL: ${downloadUrl}`);

        // Update the message in the list to show the download link
        addFileMessageToList(fileData.info, false, downloadUrl);
        addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收完成。`);

    } catch (error) {
        console.error(`Error creating Blob or Object URL for ${transferId}:`, error);
        addSystemMessage(`处理接收到的文件 ${escapeHTML(fileData.info.name)} 时出错。`, true);
    } finally {
         // Clean up stored chunks for this transfer ID
         delete incomingFiles[transferId];
    }
}

// --- New: Create HTML for File Messages ---
function createFileMessageHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    const sender = isLocal ? mockUsers[0] : (mockUsers.find(u => u.id === remoteUserId) || { name: remoteUserId || '远程用户', avatar: '99aab5' });
    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = isLocal ? getUserColorClass(sender.name) : 'text-yellow-400';
    const timeString = formatTime(new Date(fileInfo.timestamp || Date.now()));
    const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    let fileContentHTML;
    if (downloadUrl) {
        // Receiver's completed state with download link
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord flex items-center space-x-3">
                <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                <div class="flex-1">
                    <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-link hover:underline font-medium">${fileNameEscaped}</a>
                    <div class="text-xs text-discord-text-muted">${fileSizeMB} MB</div>
                </div>
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white" title="下载">
                    <span class="lucide text-xl">&#xe195;</span> <!-- Download icon -->
                </a>
            </div>`;
    } else if (isLocal && progress >= 1) {
        // Sender's completed state
         fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3">
                    <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已发送</div>
                    </div>
                     <span class="lucide text-xl text-discord-green">&#xe07a;</span> <!-- Check icon for sent -->
                </div>
            </div>`;
    } else {
        // Progress indicator state (sender or receiver)
        const progressPercent = Math.round(progress * 100);
        const statusText = isLocal ? '发送中...' : '接收中...';
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3 mb-1">
                    <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - ${statusText}</div>
                    </div>
                </div>
                <div class="w-full bg-discord-gray-1 rounded-full h-1.5">
                    <div class="bg-discord-blurple h-1.5 rounded-full" style="width: ${progressPercent}%" id="progress-${transferId}"></div>
                </div>
            </div>`;
    }

    return `
        <div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded" id="file-msg-${transferId}">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(fileInfo.timestamp || Date.now()).toLocaleString('zh-CN')}">${timeString}</span>
                </div>
                ${fileContentHTML}
            </div>
        </div>`;
}

// --- New: Add File Message to List ---
function addFileMessageToList(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    if (messageList) {
        const transferId = fileInfo.transferId;
        const existingElement = document.getElementById(`file-msg-${transferId}`);

        if (existingElement) {
            // Update existing message
            if (downloadUrl) {
                // Receiver completed: Replace with download link version
                 existingElement.outerHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl);
            } else if (isLocal && progress >= 1) {
                 // Sender completed: Replace with "Sent" version
                 existingElement.outerHTML = createFileMessageHTML(fileInfo, isLocal, null, progress); // progress = 1 here
            } else {
                // Progress update (sender or receiver): Only update the progress bar width
                const progressBar = document.getElementById(`progress-${transferId}`);
                if (progressBar) {
                    const progressPercent = Math.round(progress * 100);
                    progressBar.style.width = `${progressPercent}%`;
                    // Optional: Could update status text here too if needed
                }
            }
        } else {
            // Add new message (initial display)
            const messageElement = document.createElement('div');
            messageElement.innerHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
            if (messageElement.firstElementChild) {
                messageList.appendChild(messageElement.firstElementChild);
            }
        }
        // Scroll to bottom only if adding a new element initially?
        // Or maybe always scroll? Let's keep it always for now.
        messageList.scrollTop = messageList.scrollHeight;
        updateEmptyState(); // Update empty state after adding/updating a file message
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded.");
    if (localUserIdSpan) { localUserIdSpan.textContent = localUserId; } else { console.warn("local-user-id span not found in HTML"); }
    updateConnectionStatus("未连接", 'neutral');

    if (connectButton) {
        connectButton.addEventListener('click', () => {
            const currentAction = connectButton.dataset.action;
            if (currentAction === 'connect') {
                if (remoteUserIdInput) {
                    const targetId = remoteUserIdInput.value.trim();
                    initiateCall(targetId);
                } else {
                    console.error("Remote user ID input field not found.");
                    addSystemMessage("无法找到目标用户 ID 输入框。", true);
                }
            } else if (currentAction === 'disconnect') {
                handleDisconnect();
            }
        });
    } else {
        console.warn("connect-button not found in HTML");
    }

    if (messageInput) {
        messageInput.addEventListener('keypress', handleSendMessage);
        messageInput.addEventListener('input', handleTyping); // Listen for input changes for typing indicator
    } else {
         console.warn("message-input not found in HTML");
    }
    if (memberListToggleButton) { memberListToggleButton.addEventListener('click', toggleMemberList); } else { console.warn("member-list-toggle-button not found in HTML"); }
    if (channelLinks.length > 0) { channelLinks.forEach(link => { link.style.opacity = '0.5'; link.style.pointerEvents = 'none'; }); addSystemMessage("频道切换已禁用，请使用上方连接功能。") }

    populateMemberList();
    if (memberListSidebar && window.innerWidth < 768) { memberListSidebar.classList.add('hidden'); }
    connectWebSocket();
    addSystemMessage('输入对方的用户 ID，然后点击"连接"按钮发起 P2P 聊天。');
    updateEmptyState(); // Initial check when DOM is loaded

    // Add listeners for file input
    if (uploadButton && fileInput) {
        uploadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);
    } else {
        console.warn("Upload button or file input not found in HTML");
    }
});

// --- Utility Functions (Existing) ---
function toggleMemberList() { if (memberListSidebar) { memberListSidebar.classList.toggle('hidden'); memberListToggleButton?.classList.toggle('text-white'); } }
function populateMemberList() { const onlineList = memberListSidebar?.querySelector('.space-y-2:nth-of-type(1)'); const offlineList = memberListSidebar?.querySelector('.space-y-2:nth-of-type(2)'); if (!onlineList || !offlineList || !onlineCountSpan || !offlineCountSpan) { console.warn("Member list elements not found for population."); return; } onlineList.innerHTML = ''; offlineList.innerHTML = ''; let onlineCount = 0; let offlineCount = 0; mockUsers[0].id = localUserId; mockUsers[0].name = localUserId; mockUsers[0].status = 'online'; const remoteMockUser = mockUsers.find(u => u.id === remoteUserId); if (isConnected && remoteMockUser) { remoteMockUser.status = 'online'; } else if (remoteMockUser) { remoteMockUser.status = 'offline'; } mockUsers.forEach(user => { const isOnline = user.id === localUserId || (user.id === remoteUserId && isConnected); const statusIndicatorClass = isOnline ? 'bg-discord-green' : 'bg-gray-500'; const listToAdd = isOnline ? onlineList : offlineList; const opacityClass = isOnline ? '' : 'opacity-50'; const nameColorClass = user.colorClass || getUserColorClass(user.name); const userHTML = ` <div class="flex items-center space-x-2 group cursor-pointer p-1 rounded-discord hover:bg-discord-gray-4 ${opacityClass}"> <div class="relative"> <img src="https://placehold.co/32x32/${user.avatar}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}" alt="${escapeHTML(user.name)} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'"> <span class="absolute bottom-0 right-0 block h-3 w-3 ${statusIndicatorClass} border-2 border-discord-gray-2 rounded-full"></span> </div> <span class="text-sm ${nameColorClass} font-medium group-hover:text-white truncate" title="${escapeHTML(user.name)}">${escapeHTML(user.name)}</span> </div>`; listToAdd.innerHTML += userHTML; if (isOnline) onlineCount++; else offlineCount++; }); onlineCountSpan.textContent = onlineCount; offlineCountSpan.textContent = offlineCount; }
function handleMessageListClick(event) { /* Disabled */ }
function handleDeleteMessage(event) { /* Disabled */ }
function handleChannelSwitch(event) { /* Disabled */ }
function loadMockMessages(channelName) { /* Disabled */ }
function scrollToMessage(messageId) { const messageElement = document.getElementById(`message-${messageId}`); if (messageElement) { messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); messageElement.style.backgroundColor = 'rgba(88, 101, 242, 0.2)'; setTimeout(() => { messageElement.style.backgroundColor = ''; }, 1500); } else { console.warn(`Message with ID ${messageId} not found in current view.`); } } 
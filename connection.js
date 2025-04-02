// connection.js
import * as state from './state.js';
import { SIGNALING_SERVER_URL, PEER_CONNECTION_CONFIG } from './constants.js';
import * as ui from './ui.js';
import * as crypto from './crypto.js';
import * as fileTransfer from './fileTransfer.js';
import * as dom from './dom.js'; // Needed for updating UI elements based on WS state

// --- WebSocket Logic ---

function sendSignalingMessage(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(payload);
            console.log("Sending signaling message:", payload);
            state.ws.send(messageString);
        } catch (e) {
            console.error("Failed to stringify or send signaling message:", e);
            ui.addSystemMessage("无法发送信令：数据错误。", true);
        }
    } else {
        console.error("Cannot send signaling message: WebSocket is not connected.");
        ui.addSystemMessage("无法发送信令：WebSocket 未连接。", true);
        // Should we attempt to reconnect or just inform the user?
        // For now, just informing.
    }
}

function handleWebSocketMessage(event) {
    let msg;
    try {
        msg = JSON.parse(event.data);
        console.log("Received signaling message:", msg);
    } catch (e) {
        console.error("Failed to parse signaling message:", event.data, e);
        return;
    }

    // Basic validation
    if (!msg.type) {
         console.warn("Received signaling message without type:", msg);
         return;
    }

    // Ignore messages from self, except for potential server confirmation messages
    // if (msg.from === state.localUserId && msg.type !== 'register_confirm' /* example */) {
    //     return;
    // }

    switch (msg.type) {
        case 'offer':
            if (state.isConnected || state.isConnecting) {
                console.warn(`Ignoring offer from ${msg.from}, already connected/connecting to ${state.remoteUserId}`);
                // Maybe send a busy signal?
                sendSignalingMessage({ type: 'busy', payload: { targetUserId: msg.from } });
                return;
            }
            if (!msg.from || !msg.payload?.sdp) {
                console.warn("Invalid offer received:", msg);
                return;
            }
            state.setRemoteUserId(msg.from);
            console.log(`Received offer from ${state.remoteUserId}`);
            ui.addSystemMessage(`收到来自 ${state.remoteUserId} 的连接请求...`);
            ui.updateConnectionStatus(`正在连接 ${state.remoteUserId}...`, 'progress');
            state.setIsConnecting(true);
            handleOffer(msg.payload.sdp); // Let WebRTC logic handle the SDP
            break;

        case 'answer':
            if (!msg.from || msg.from !== state.remoteUserId) {
                console.warn(`Received answer from unexpected peer ${msg.from}. Current remote: ${state.remoteUserId}. Ignoring.`);
                return;
            }
             if (!msg.payload?.sdp) {
                console.warn("Invalid answer received:", msg);
                return;
            }
            console.log(`Received answer from ${state.remoteUserId}`);
            handleAnswer(msg.payload.sdp); // Let WebRTC logic handle the SDP
            break;

        case 'candidate':
             // Allow candidates before remoteUserId is set if it's from the potential peer (during offer/answer exchange)
             // But strictly check once connection is established or remoteUserId is known.
            if (!msg.from || (state.remoteUserId && msg.from !== state.remoteUserId)) {
                 console.warn(`Received candidate from unexpected peer ${msg.from}. Current remote: ${state.remoteUserId}. Ignoring.`);
                 return;
            }
            if (!msg.payload?.candidate) {
                console.warn("Invalid candidate received:", msg);
                return;
            }
            console.log(`Received ICE candidate from ${msg.from}`);
            handleCandidate(msg.payload.candidate); // Let WebRTC logic handle the candidate
            break;

        case 'error':
            const errorMsg = msg.payload?.message || '未知错误';
            console.error(`Received error from signaling server: ${errorMsg}`);
            ui.addSystemMessage(`信令服务器错误: ${errorMsg}`, true);
            // If the error indicates the target user is not found, reset the connection attempt
            if (errorMsg.includes("not found") || errorMsg.includes("offline")) {
                ui.addSystemMessage(`目标用户 ${state.remoteUserId || ''} 未找到或离线。`, true);
                resetConnection();
            }
            // Other errors might just be warnings or require specific handling
            break;

        case 'user_disconnected':
             if (msg.payload?.userId === state.remoteUserId) {
                 console.log(`Signaling server indicated ${state.remoteUserId} disconnected.`);
                 ui.addSystemMessage(`${state.remoteUserId} 已断开连接。`);
                 resetConnection(); // Reset the P2P connection state
             }
            break;

        // Example: Handle a potential 'busy' signal
        case 'busy':
             if (msg.from === state.remoteUserId) {
                 console.log(`${state.remoteUserId} is busy.`);
                 ui.addSystemMessage(`${state.remoteUserId} 当前正忙，请稍后再试。`, true);
                 resetConnection(); // Reset the connection attempt state
             }
             break;

        // Example: Confirmation of registration
        // case 'register_confirm':
        //     console.log(`Registration confirmed with ID: ${msg.payload.userId}`);
        //     if (state.localUserId !== msg.payload.userId) {
        //          console.warn(`Received registered ID ${msg.payload.userId} differs from local ${state.localUserId}`);
        //          // Potentially update localUserId or handle discrepancy
        //     }
        //     break;

        default:
            console.log("Received unhandled signaling message type:", msg.type);
    }
}

export function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    console.log(`Attempting to connect to signaling server: ${SIGNALING_SERVER_URL}`);
    ui.updateConnectionStatus("正在连接信令服务器...", 'progress');
    state.setIsConnecting(true); // Indicate app is busy connecting (globally)

    const newWs = new WebSocket(SIGNALING_SERVER_URL);

    newWs.onopen = () => {
        console.log("WebSocket connection established.");
        state.setWs(newWs); // Store the active WebSocket connection in state
        ui.updateConnectionStatus("信令服务器已连接", 'success');
        state.setIsConnecting(false); // No longer connecting WS

        // Register user with the signaling server
        const registerMsg = { type: "register", payload: { userId: state.localUserId } };
        sendSignalingMessage(registerMsg); // Use the helper to send
        console.log(`Sent register message for user: ${state.localUserId}`);

        // Update UI
        if (dom.localUserIdSpan) dom.localUserIdSpan.textContent = state.localUserId;
        ui.addSystemMessage(`已连接到信令服务器，您的 ID 是: ${state.localUserId}`);
        // Enable the connect button and remote ID input now that WS is ready
        if (dom.connectButton) dom.connectButton.disabled = false;
        if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = false;
    };

    newWs.onmessage = handleWebSocketMessage;

    newWs.onerror = (error) => {
        console.error("WebSocket error:", error);
        ui.updateConnectionStatus("信令服务器连接失败", 'error');
        ui.addSystemMessage("无法连接到信令服务器，请检查服务器状态和网络连接。", true);
        state.setIsConnecting(false);
        state.setWs(null);
        // Consider implementing automatic reconnection attempts here
        resetConnection(); // Also reset P2P state if WS fails
        // Ensure buttons/inputs reflect the disconnected state
        if (dom.connectButton) dom.connectButton.disabled = true;
        if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = true;
    };

    newWs.onclose = (event) => {
        console.log(`WebSocket connection closed: Code=${event.code}, Reason='${event.reason}'`);
        // Avoid showing error if disconnect was intended (e.g., event.code === 1000 or 1005)
        // Or if we are already connected P2P (let P2P handle its state)
        if (!event.wasClean && !state.isConnected) {
             ui.updateConnectionStatus("信令服务器连接已断开", 'error');
             ui.addSystemMessage("与信令服务器的连接意外断开。", true);
        } else if (!state.isConnected) {
            // If closed cleanly and not connected P2P, show neutral status
            ui.updateConnectionStatus("未连接", 'neutral');
        }

        state.setIsConnecting(false);
        state.setWs(null);
        resetConnection(); // Reset P2P state when WS closes
        // Ensure buttons/inputs reflect the disconnected state
        if (dom.connectButton) dom.connectButton.disabled = true;
        if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = true;
    };
}

// --- WebRTC Logic ---

function createPeerConnection() {
    if (state.peerConnection) {
        console.log("Closing existing PeerConnection before creating new one.");
        try {
            state.peerConnection.close();
        } catch (e) { console.warn("Error closing existing PeerConnection:", e); }
        state.setPeerConnection(null);
    }

    console.log("Creating new PeerConnection with config:", PEER_CONNECTION_CONFIG);
    try {
        const newPc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
        state.setPeerConnection(newPc);
        setupPeerConnectionEvents(newPc);
    } catch (e) {
        console.error("Failed to create PeerConnection:", e);
        ui.addSystemMessage("创建 PeerConnection 失败。", true);
        resetConnection();
        throw new Error("PeerConnection creation failed"); // Propagate error
    }
}

function setupPeerConnectionEvents(pc) {
    pc.onicecandidate = (event) => {
        if (event.candidate && state.remoteUserId) {
            console.log(`Generated ICE candidate for ${state.remoteUserId}:`, event.candidate);
            const candidateMsg = {
                type: 'candidate',
                payload: {
                    targetUserId: state.remoteUserId,
                    candidate: event.candidate
                }
            };
            sendSignalingMessage(candidateMsg);
        } else {
            console.log("ICE gathering finished or no remote user ID set for candidate.");
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (!state.peerConnection) return; // Check if connection still exists
        const currentState = state.peerConnection.iceConnectionState;
        console.log(`ICE connection state changed: ${currentState}`);

        switch (currentState) {
            case 'checking':
                ui.updateConnectionStatus(`正在检查与 ${state.remoteUserId} 的连接...`, 'progress');
                break;
            case 'connected': // Connected implies ICE checks passed, transport is working.
                ui.updateConnectionStatus(`连接已建立，等待数据通道...`, 'progress');
                // P2P connection is up, but wait for DataChannel open for full 'isConnected' state.
                break;
            case 'completed': // All ICE checks done, connection established.
                 console.log("ICE connection completed.");
                 // Often equivalent to 'connected' in modern browsers for DataChannel-only use.
                 // We rely on DataChannel.onopen for the final readiness state.
                 break;
            case 'disconnected':
                // This means connectivity was lost temporarily. It might recover.
                console.warn(`ICE connection to ${state.remoteUserId} disconnected.`);
                ui.addSystemMessage(`与 ${state.remoteUserId} 的连接中断，尝试自动恢复...`, 'error');
                ui.updateConnectionStatus(`连接中断`, 'error');
                // Don't reset immediately, WebRTC might recover.
                // If it moves to 'failed', then reset.
                break;
            case 'failed':
                // Connection failed and won't recover automatically.
                console.error(`ICE connection to ${state.remoteUserId} failed.`);
                ui.addSystemMessage(`与 ${state.remoteUserId} 的连接失败。`, true);
                ui.updateConnectionStatus("连接失败", 'error');
                resetConnection();
                break;
            case 'closed':
                // Connection was closed explicitly (by us or potentially remotely).
                console.log(`ICE connection to ${state.remoteUserId} closed.`);
                // Only add system message if it wasn't an intended closure
                if (state.isConnected || state.isConnecting) {
                    ui.addSystemMessage(`与 ${state.remoteUserId} 的连接已关闭。`);
                }
                resetConnection(); // Ensure full state reset on close
                break;
            default:
                 ui.updateConnectionStatus(`ICE 状态: ${currentState}`, 'neutral');
        }
    };

    pc.ondatachannel = (event) => {
        console.log('ondatachannel event received.');
        const receiveChannel = event.channel;
        console.log(`Received data channel: ${receiveChannel.label}, State: ${receiveChannel.readyState}`);
        state.setDataChannel(receiveChannel);
        setupDataChannelEvents(receiveChannel);
        ui.addSystemMessage(`收到来自 ${state.remoteUserId} 的数据通道。`);
    };

    // Add handlers for other events if needed (e.g., onsignalingstatechange, ontrack)
     pc.onsignalingstatechange = () => {
         if (!state.peerConnection) return;
         console.log(`Signaling state changed: ${state.peerConnection.signalingState}`);
     };

}

async function setupDataChannelEvents(channel) {
    if (!channel) return;
    console.log(`Setting up data channel: ${channel.label}, State: ${channel.readyState}, ID: ${channel.id}`);

    // Ensure binaryType is set for receiving file chunks correctly
    channel.binaryType = 'arraybuffer';

    // --- onopen: Critical for establishing E2EE --- 
    channel.onopen = async () => {
        console.log(`Data channel [${channel.label}] opened with ${state.remoteUserId}`);
        state.setIsConnected(true); // Mark P2P connection as fully ready
        state.setIsConnecting(false);
        ui.updateConnectionStatus(`数据通道开启 (建立加密...)`, 'progress');

        try {
            // 1. Generate local keys if not already done (should be done once per session)
            if (!state.localKeyPair) {
                 await crypto.generateAndStoreKeyPair();
            }
            if (!state.localKeyPair || !state.localKeyPair.publicKey) {
                 throw new Error("Local key pair generation failed or not available.");
            }

            // 2. Export and send public key
            const exportedPublicKey = await crypto.exportPublicKey(state.localKeyPair.publicKey);
            if (!exportedPublicKey) {
                 throw new Error("Failed to export local public key.");
            }
            const publicKeyMessage = { type: 'publicKey', payload: exportedPublicKey };
            channel.send(JSON.stringify(publicKeyMessage));
            console.log("Sent local public key over data channel.");
            ui.addSystemMessage("已发送公钥，等待对方公钥...");

            // 3. If we have already received the peer's key, derive the shared key now
            if (state.peerPublicKey) {
                console.log("Peer key already received, attempting to derive shared key.");
                const derivedKey = await crypto.deriveSharedKey(state.localKeyPair.privateKey, state.peerPublicKey);
                if (derivedKey) {
                    console.log("E2EE established successfully! (onopen - peer key pre-received)");
                    ui.addSystemMessage("端到端加密已建立！可以开始聊天。");
                    ui.updateConnectionStatus(`已连接到 ${state.remoteUserId} (E2EE)`, 'success');
                } else {
                     throw new Error("Shared key derivation failed.");
                }
            }
            // If peer key not received yet, derivation will happen in onmessage when 'publicKey' arrives.

        } catch (error) {
            console.error("Error during data channel open and key exchange setup:", error);
            ui.addSystemMessage(`加密设置失败: ${error.message}`, true);
            resetConnection();
            return; // Stop further processing on error
        }

        // Focus input field and update UI
        if (dom.messageInput) dom.messageInput.focus();
        ui.updateEmptyState();
    };

    // --- onmessage: Handles incoming data --- 
    channel.onmessage = async (event) => {
        // --- Binary Data Handling (File Chunks) ---
        if (event.data instanceof ArrayBuffer) {
            // console.log(`Received binary data (ArrayBuffer) of size: ${event.data.byteLength}`);
            fileTransfer.handleIncomingFileChunk(event.data);
            return; // Binary data handled by fileTransfer module
        }

        // --- Text Data Handling (JSON Messages) ---
        // console.log(`Raw text data received: ${event.data}`); // Debugging
        let msgData;
        try {
            msgData = JSON.parse(event.data);
        } catch (e) {
            console.error("Failed to parse incoming JSON message:", event.data, e);
            // Handle non-JSON text messages if needed, or ignore
            ui.addSystemMessage("收到无法解析的消息。", true);
            return;
        }

        console.log(`Parsed data channel message from ${state.remoteUserId}:`, msgData);

        // Validate message structure
        if (!msgData.type) {
             console.warn("Received data channel message without type:", msgData);
             return;
        }

        // Handle different message types
        switch (msgData.type) {
            // --- Key Exchange --- 
            case 'publicKey':
                console.log("Received peer public key JWK:", msgData.payload);
                 ui.addSystemMessage("收到对方公钥，正在设置加密...");
                try {
                    const importedKey = await crypto.importPublicKey(msgData.payload);
                    if (!importedKey) {
                         throw new Error("Importing peer public key failed.");
                    }
                    state.setPeerPublicKey(importedKey); // Store the imported key

                    // If our local keys are ready, derive the shared key now
                    if (state.localKeyPair && state.localKeyPair.privateKey) {
                        console.log("Local key pair ready, deriving shared key.");
                         const derivedKey = await crypto.deriveSharedKey(state.localKeyPair.privateKey, importedKey);
                         if (derivedKey) {
                             console.log("E2EE established successfully! (onmessage - public key received)");
                            ui.addSystemMessage("端到端加密已建立！可以开始聊天。");
                            ui.updateConnectionStatus(`已连接到 ${state.remoteUserId} (E2EE)`, 'success');
                         } else {
                             throw new Error("Shared key derivation failed after receiving peer key.");
                         }
                    } else {
                        // This case should ideally not happen if onopen logic is correct
                        console.warn("Received peer key, but local keys are not ready yet. Waiting for local key generation?");
                        ui.addSystemMessage("收到对方公钥，但本地密钥尚未就绪。", true);
                        // Maybe trigger key generation again? Or rely on onopen?
                    }
                } catch (error) {
                     console.error("Error processing received public key or deriving shared key:", error);
                     ui.addSystemMessage(`处理对方公钥或建立加密失败: ${error.message}`, true);
                     resetConnection();
                }
                break; // End publicKey case

            // --- Encrypted Chat Messages --- 
            case 'encryptedChat':
                 if (!state.sharedKey) {
                     console.warn("Received encryptedChat message, but shared key is not ready. Ignoring.");
                     ui.addSystemMessage("收到加密消息，但加密尚未就绪。请稍候...", true);
                     return;
                 }
                 if (!msgData.payload) {
                     console.warn("Received encryptedChat message with no payload.");
                     return;
                 }
                 try {
                    const decryptedPayload = await crypto.decryptMessage(state.sharedKey, msgData.payload);
                    console.log("Decrypted chat message payload:", decryptedPayload);
                    // Basic validation of decrypted payload
                    if (typeof decryptedPayload.text !== 'string' || typeof decryptedPayload.timestamp !== 'number') {
                         console.warn("Decrypted chat payload has invalid format:", decryptedPayload);
                         throw new Error("Decrypted message format is incorrect.");
                    }
                    // Add message to UI
                    ui.addP2PMessageToList({ ...decryptedPayload, isLocal: false });
                 } catch (error) {
                     console.error("Failed to decrypt chat message:", error);
                     ui.addSystemMessage("解密收到的消息失败！可能密钥不匹配或消息已损坏。", true);
                     // Consider if resetting the connection is necessary on decryption failure
                 }
                 break; // End encryptedChat case

            // --- Encrypted Control Messages (Typing) --- 
            case 'encryptedControl':
                 if (!state.sharedKey) {
                     console.warn("Received encryptedControl message, but shared key is not ready. Ignoring.");
                     // Avoid system message spam for typing indicators
                     return;
                 }
                  if (!msgData.payload) {
                     console.warn("Received encryptedControl message with no payload.");
                     return;
                 }
                 try {
                     const decryptedPayload = await crypto.decryptMessage(state.sharedKey, msgData.payload);
                     // console.log("Decrypted control payload:", decryptedPayload); // Less verbose logging

                     // Handle different control types
                     switch (decryptedPayload.type) {
                         case 'typing':
                             ui.showTypingIndicator();
                             break;
                         case 'stopped_typing':
                             ui.hideTypingIndicator();
                             break;
                         default:
                             console.log("Received unknown encrypted control type:", decryptedPayload.type);
                     }
                 } catch (error) {
                     console.error("Failed to decrypt control message:", error);
                     // Avoid system message spam for typing indicators
                     // ui.addSystemMessage("解密收到的控制消息失败！", true);
                 }
                 break; // End encryptedControl case

             // --- File Transfer Metadata --- 
             case 'file-info':
                 console.log("Received file-info payload:", msgData.payload);
                 fileTransfer.handleIncomingFileInfo(msgData.payload);
                 break;
             case 'file-end':
                  console.log("Received file-end payload:", msgData.payload);
                  fileTransfer.handleIncomingFileEnd(msgData.payload);
                  break;

             // --- Unhandled Types --- 
             default:
                console.log(`Received unhandled message type [${msgData.type}] via data channel.`);
        }
    };

    // --- onclose --- 
    channel.onclose = () => {
        console.log(`Data channel [${channel.label}] closed with ${state.remoteUserId}`);
        // Only show message and reset if the connection was considered active
        if (state.isConnected) {
             ui.addSystemMessage(`与 ${state.remoteUserId} 的数据通道已关闭。`);
             ui.updateConnectionStatus("连接已断开", 'error');
             resetConnection(); // Reset the connection state fully
        } else {
             console.log("Data channel closed, but connection wasn't fully established or already reset.");
        }
        // Ensure typing indicator is hidden
        ui.hideTypingIndicator();
         // Cleanup any associated resources like file transfers? (State reset should handle incomingFiles)
    };

    // --- onerror --- 
    channel.onerror = (error) => {
        console.error(`Data channel [${channel.label}] error:`, error);
        ui.addSystemMessage(`数据通道错误: ${error.message || '未知错误'}`, true);
        ui.updateConnectionStatus("连接错误", 'error');
        resetConnection(); // Reset the connection state fully on error
        ui.hideTypingIndicator();
    };
}

// --- Public Connection Functions ---

export function initiateCall(targetUserId) {
    if (!targetUserId) {
        ui.addSystemMessage("请输入目标用户 ID。", true);
        return;
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        ui.addSystemMessage("信令服务器未连接，无法发起呼叫。", true);
        connectWebSocket(); // Try to reconnect WebSocket first
        return;
    }
    if (state.isConnected || state.isConnecting) {
        ui.addSystemMessage(`已经连接或正在连接 ${state.remoteUserId}，请先断开。`, true);
        return;
    }

    state.setRemoteUserId(targetUserId);
    console.log(`Initiating call to ${state.remoteUserId}`);
    ui.addSystemMessage(`正在尝试连接 ${state.remoteUserId}...`);
    ui.updateConnectionStatus(`呼叫 ${state.remoteUserId}...`, 'progress');
    state.setIsConnecting(true);

    try {
        createPeerConnection(); // Create the RTCPeerConnection
        if (!state.peerConnection) throw new Error("PeerConnection creation failed silently.");

        console.log("Creating data channel: chatChannel");
        const newDataChannel = state.peerConnection.createDataChannel("chatChannel", { reliable: true });
        state.setDataChannel(newDataChannel); // Store the created data channel
        setupDataChannelEvents(newDataChannel); // Setup handlers immediately

        // Now create and send the offer
        state.peerConnection.createOffer()
            .then(offer => {
                console.log("Offer created successfully");
                return state.peerConnection.setLocalDescription(offer);
            })
            .then(() => {
                console.log("Local description (offer) set successfully");
                if (!state.peerConnection.localDescription) {
                     throw new Error("Local description is unexpectedly null after set.");
                }
                const offerMsg = {
                    type: 'offer',
                    payload: {
                        targetUserId: state.remoteUserId,
                        sdp: state.peerConnection.localDescription
                    }
                };
                sendSignalingMessage(offerMsg);
                console.log("Offer sent to signaling server");
                ui.updateConnectionStatus(`Offer 已发送至 ${state.remoteUserId}`, 'progress');
            })
            .catch(error => {
                console.error("Error creating or sending offer:", error);
                ui.addSystemMessage(`创建或发送 Offer 失败: ${error.message}`, true);
                resetConnection();
            });

    } catch (error) {
         console.error("Error initiating call:", error);
         ui.addSystemMessage(`呼叫发起失败: ${error.message}`, true);
         resetConnection();
    }
}

function handleOffer(offerSdp) {
    try {
        if (!state.peerConnection) {
            createPeerConnection(); // Create PC if it doesn't exist (receiving call)
        }
        if (!state.peerConnection) throw new Error("PeerConnection not available after creation attempt.");

        const offerDesc = new RTCSessionDescription(offerSdp);
        state.peerConnection.setRemoteDescription(offerDesc)
            .then(() => {
                console.log("Remote description (offer) set successfully");
                ui.updateConnectionStatus(`收到 Offer，正在创建 Answer...`, 'progress');
                return state.peerConnection.createAnswer();
            })
            .then(answer => {
                console.log("Answer created successfully");
                return state.peerConnection.setLocalDescription(answer);
            })
            .then(() => {
                console.log("Local description (answer) set successfully");
                if (!state.peerConnection.localDescription) {
                     throw new Error("Local description (answer) is unexpectedly null after set.");
                }
                const answerMsg = {
                    type: 'answer',
                    payload: {
                        targetUserId: state.remoteUserId, // Send back to the offerer
                        sdp: state.peerConnection.localDescription
                    }
                };
                sendSignalingMessage(answerMsg);
                console.log("Answer sent to signaling server");
                ui.updateConnectionStatus(`Answer 已发送至 ${state.remoteUserId}`, 'progress');
                // Connection is progressing, but not fully established yet
                state.setIsConnecting(false); // No longer in the initial "connecting" phase from offer receipt
            })
            .catch(error => {
                console.error("Error handling offer or creating/sending answer:", error);
                ui.addSystemMessage(`处理 Offer 或创建 Answer 失败: ${error.message}`, true);
                resetConnection();
            });
    } catch (error) {
         console.error("Error in handleOffer function:", error);
         ui.addSystemMessage(`处理连接请求失败: ${error.message}`, true);
         resetConnection();
    }
}

function handleAnswer(answerSdp) {
    if (!state.peerConnection || !state.peerConnection.localDescription) {
        console.error("Received answer but PeerConnection or local description is missing. State:", state.peerConnection?.signalingState);
        ui.addSystemMessage("收到 Answer 但连接状态异常，无法处理。", true);
        // Might need reset, or perhaps the connection is already closing
        return;
    }

    console.log("Setting remote description (answer)");
    ui.updateConnectionStatus(`收到 ${state.remoteUserId} 的 Answer...`, 'progress');
    const answerDesc = new RTCSessionDescription(answerSdp);
    state.peerConnection.setRemoteDescription(answerDesc)
        .then(() => {
            console.log("Remote description (answer) set successfully");
            ui.updateConnectionStatus(`应答已处理，等待连接稳定...`, 'progress');
            state.setIsConnecting(false); // Connecting phase is done, now waiting for ICE/DataChannel
        })
        .catch(error => {
            console.error("Error setting remote description (answer):", error);
            ui.addSystemMessage(`设置远程 Answer 失败: ${error.message}`, true);
            resetConnection();
        });
}

function handleCandidate(candidate) {
    if (!state.peerConnection) {
        console.warn("Received ICE candidate but PeerConnection does not exist.");
        return;
    }
    // Only add candidate if remote description is set (or setting)
    if (!state.peerConnection.remoteDescription && state.peerConnection.signalingState === 'stable') {
        console.warn(`Received ICE candidate but remote description not set and signaling state is stable. Buffering? Ignoring for now. Candidate:`, candidate);
        // TODO: Implement buffering if necessary, though usually candidates arrive after offer/answer exchange initiated
        return;
    }

    try {
        const rtcCandidate = new RTCIceCandidate(candidate);
        state.peerConnection.addIceCandidate(rtcCandidate)
            .then(() => {
                // console.log("ICE candidate added successfully"); // Can be very verbose
            })
            .catch(error => {
                 // It's common to get errors here if candidates arrive out of order or are duplicates
                console.warn("Error adding received ICE candidate:", error.message, "Candidate:", candidate);
                 // Don't necessarily reset the connection for this
            });
    } catch (error) {
        // Errors can happen if the candidate format is invalid
        console.warn("Error creating RTCIceCandidate object:", error.message, "Candidate:", candidate);
    }
}

// --- Connection Reset --- 

// This function now primarily resets the state and updates the UI.
// It relies on the state module's resetConnectionState for actual cleanup.
export function resetConnection() {
    console.log("Executing connection reset logic.");

    const previousRemoteUserId = state.resetConnectionState(); // Perform state cleanup

    ui.hideTypingIndicator(); // Ensure typing indicator is hidden
    ui.updateConnectionStatus("未连接", 'neutral'); // Update UI to disconnected status

    if (previousRemoteUserId) {
        ui.addSystemMessage(`与 ${previousRemoteUserId} 的连接已断开/重置。`);
    } else {
        // Avoid redundant message if WS just closed
        if (!state.ws) {
             ui.addSystemMessage("连接已重置。", false);
        }
    }

    // Ensure input fields and buttons reflect the state
    if (dom.remoteUserIdInput) {
        dom.remoteUserIdInput.disabled = !(state.ws?.readyState === WebSocket.OPEN);
        // Optionally clear the input: dom.remoteUserIdInput.value = '';
    }
     if (dom.connectButton) {
        dom.connectButton.disabled = !(state.ws?.readyState === WebSocket.OPEN);
    }

    // Clear message list visually (optional)
    // if (dom.messageList) dom.messageList.innerHTML = '';
    ui.updateEmptyState(); // Check if message list became empty

    // Attempt to clean up any lingering blob URLs (best effort)
    fileTransfer.cleanupFileBlobs();
}

// Function to be called when the user explicitly clicks disconnect
export function handleDisconnect() {
    console.log("Disconnect button clicked by user.");
    ui.addSystemMessage("正在断开连接...");
    // Maybe send a 'bye' message over data channel if connected?
    // if (state.dataChannel && state.dataChannel.readyState === 'open') {
    //     try { state.dataChannel.send(JSON.stringify({ type: 'bye' })); } catch (e) {}
    // }
    resetConnection();
}


// --- Message Sending & Typing (Moved to main.js or handlers.js) --- 
// These functions depend heavily on UI elements and state, 
// making them better suited for the main script or a dedicated handlers module 
// that orchestrates UI, State, Crypto, and Connection.
// We export necessary components like sendTypingMessage logic if needed elsewhere.

// Example of exporting a function needed by other modules
export async function sendEncryptedData(type, payload) {
    if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
        throw new Error("Data channel not ready to send.");
    }
    if (!state.sharedKey) {
        throw new Error("Encryption key not available.");
    }

    try {
        const encryptedPayload = await crypto.encryptMessage(state.sharedKey, payload);
        const messageToSend = { type: type, payload: encryptedPayload };
        state.dataChannel.send(JSON.stringify(messageToSend));
        // console.log(`Sent encrypted ${type} message.`); // Keep logging minimal for frequent ops
    } catch (error) {
        console.error(`Failed to encrypt or send ${type} message:`, error);
        ui.addSystemMessage(`发送加密 ${type} 消息失败。`, true);
        throw error; // Re-throw for caller
    }
} 
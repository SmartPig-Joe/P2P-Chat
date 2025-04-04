// fileTransfer.js
// import * as dom from './dom.js';
// import * as storage from './storage.js';
import * as state from './state.js';
import * as ui from '../ui/index.js';
import { FILE_CHUNK_SIZE } from './constants.js';
import { escapeHTML, formatBytes } from './utils.js';
// import { getSelectedPeerId, updateFileMessageProgress } from '../ui/index.js'; // Corrected path (commented)
import { updateFileMessageProgress, addObjectURLToTrack, untrackAndRevokeObjectURL } from '../ui/index.js'; // Corrected path, Added addObjectURLToTrack, untrackAndRevokeObjectURL

// --- Sending Files ---

export function handleFileSelect(event) {
    console.log("[Debug] handleFileSelect triggered.");

    // NEW: Use active chat peer state
    const activePeerId = state.getActiveChatPeerId();
    if (!activePeerId) {
        console.warn("[Debug] handleFileSelect: No active chat selected.");
        ui.addSystemMessage("无法发送文件：请先选择一个聊天对象。", null, true);
        if (event.target) event.target.value = null;
        return;
    }

    const connectionStatus = state.getConnectionState(activePeerId);
    const dataChannel = state.getDataChannel(activePeerId);

    if (connectionStatus !== 'connected' || !dataChannel || dataChannel.readyState !== 'open') {
        const errorMsg = `Cannot send file to ${activePeerId}. State: ${connectionStatus}, DC exists: ${!!dataChannel}, DC state: ${dataChannel?.readyState}`;
        console.warn(`[Debug] handleFileSelect: ${errorMsg}`);
        const contacts = state.getContacts(); // USE GETTER
        ui.addSystemMessage(`无法发送文件：未连接到 ${contacts[activePeerId]?.name || activePeerId} 或数据通道未就绪。`, activePeerId, true); // Use getter result
        if (event.target) event.target.value = null;
        return;
    }
    // END NEW STATE CHECK

    const file = event.target.files[0];
    if (!file) {
        console.log("[Debug] handleFileSelect: No file selected.");
        return;
    }

    console.log(`[Debug] handleFileSelect: Selected file: ${file.name}, Size: ${file.size}, Type: ${file.type}`);
    event.target.value = null; // Clear file input immediately

    const transferId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const recipientPeerId = activePeerId; // Use activePeerId
    console.log(`[Debug] handleFileSelect: Generated transferId: ${transferId} for recipient: ${recipientPeerId}`);

    const fileInfo = {
        transferId: transferId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream', // Default type if unknown
        timestamp: Date.now(),
        senderId: state.localUserId, // Correctly identify sender
        peerId: recipientPeerId // Identify the intended recipient (relevant for storage/UI)
    };

    // --- Create local preview URL for images ---
    let localPreviewUrl = null;
    const isImage = fileInfo.type.startsWith('image/');
    if (isImage) {
        try {
            localPreviewUrl = URL.createObjectURL(file);
            console.log(`[Debug] Created local preview URL for ${transferId}: ${localPreviewUrl}`);
            // Add to fileInfo payload that goes to the UI
            fileInfo.localPreviewUrl = localPreviewUrl;
            // Track this URL for cleanup
            ui.addObjectURLToTrack(localPreviewUrl);
        } catch (e) {
            console.error(`[Debug] Failed to create local object URL for image:`, e);
            // Proceed without local preview if URL creation fails
        }
    }
    // --- End local preview URL creation ---

    try {
        const messageToSend = {
            type: 'fileMeta',
            // Don't send localPreviewUrl to the peer
            payload: { ...fileInfo, localPreviewUrl: undefined }
         };
        dataChannel.send(JSON.stringify(messageToSend)); // Use specific dataChannel
        console.log("Sent fileMeta:", messageToSend.payload);

        // Display placeholder/preview in UI immediately
        // Create a message object suitable for the UI layer
        const messageForUi = {
            id: transferId, // Use transferId as the message ID for UI tracking
            type: 'fileMeta',
            senderId: state.localUserId,
            peerId: recipientPeerId,
            timestamp: fileInfo.timestamp,
            // Pass the complete fileInfo (including localPreviewUrl if available) to the local UI
            payload: fileInfo
        };
        ui.displayMessage(recipientPeerId, messageForUi); // Pass the message with potential localPreviewUrl

        // Don't immediately set progress to 0 if we have a preview, let createFileContentHTML handle initial state
        // ui.updateFileMessageProgress(recipientPeerId, transferId, 0);

    } catch (e) {
        console.error("[Debug] handleFileSelect: Failed to send fileMeta or display message:", e);
        ui.addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的元信息或显示消息失败。`, recipientPeerId, true);
        // Clean up blob URL if created but sending failed
        if (localPreviewUrl) {
            ui.untrackAndRevokeObjectURL(localPreviewUrl);
        }
        return;
    }

    console.log(`[Debug] handleFileSelect: Calling sendFileChunks for ${transferId}`);
    // Pass the specific dataChannel to sendFileChunks
    sendFileChunks(file, transferId, fileInfo, dataChannel);
}

// Modified to accept dataChannel as a parameter
async function sendFileChunks(file, transferId, fileInfo, dataChannel) {
    console.log(`[Debug] sendFileChunks started for ${transferId}`);
    let offset = 0;
    const fileReader = new FileReader();
    let chunkCount = 0;
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);
    const recipientPeerId = fileInfo.peerId; // The recipient

    const checkConnection = () => {
        // Check if the connection to the *specific recipient* is still valid
        const currentDC = state.getDataChannel(recipientPeerId);
        const connectionStatus = state.getConnectionState(recipientPeerId);
        return connectionStatus === 'connected' && currentDC && currentDC.readyState === 'open' && currentDC === dataChannel;
    };

    const readNextChunk = () => {
        if (!checkConnection()) {
            console.warn(`[${transferId}] Connection lost or changed to ${recipientPeerId} during send. Aborting.`);
            ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断。`, recipientPeerId, true);
            ui.updateFileMessageProgress(recipientPeerId, transferId, -1); // Update UI to show failure
            return;
        }
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
        const chunk = e.target.result;
        if (!chunk) {
             console.error(`[${transferId}] FileReader returned null chunk.`);
             ui.addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错 (null chunk)。`, recipientPeerId, true);
             ui.updateFileMessageProgress(recipientPeerId, transferId, -1);
             return;
        }
        chunkCount++;
        console.log(`Sending chunk ${chunkCount}/${totalChunks} for ${transferId} to ${recipientPeerId}`);

        try {
            // Prepend transferId as before (assuming receiver handles this)
            const idBuffer = new TextEncoder().encode(transferId + '|');
            const combinedBuffer = new ArrayBuffer(idBuffer.byteLength + chunk.byteLength);
            const combinedView = new Uint8Array(combinedBuffer);
            combinedView.set(new Uint8Array(idBuffer), 0);
            combinedView.set(new Uint8Array(chunk), idBuffer.byteLength);

            const BUFFER_THRESHOLD = 1024 * 1024; // Increased buffer threshold (e.g., 1MB)
            while (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`[${transferId}] DataChannel buffer full (${dataChannel.bufferedAmount} > ${BUFFER_THRESHOLD}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 50));
                 if (!checkConnection()) {
                    console.warn(`[${transferId}] Connection lost while waiting for buffer. Aborting.`);
                    ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (缓冲区)。`, recipientPeerId, true);
                    ui.updateFileMessageProgress(recipientPeerId, transferId, -1);
                    return;
                }
            }

             if (!checkConnection()) {
                 console.warn(`[${transferId}] DataChannel closed or connection changed before sending chunk ${chunkCount}. Aborting.`);
                 ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (通道关闭/变更)。`, recipientPeerId, true);
                 ui.updateFileMessageProgress(recipientPeerId, transferId, -1);
                 return;
             }

            dataChannel.send(combinedBuffer); // Send on the specific dataChannel
            offset += chunk.byteLength;

            const progress = offset / file.size;
            // Use ui.updateFileMessageProgress which should handle finding the message
            ui.updateFileMessageProgress(recipientPeerId, transferId, progress);

            if (offset < file.size) {
                // Use requestAnimationFrame for potentially smoother UI during large transfers
                requestAnimationFrame(readNextChunk);
                // setTimeout(readNextChunk, 0); // Fallback if requestAnimationFrame causes issues
            } else {
                console.log(`[${transferId}] Finished sending all chunks.`);
                // No need for a separate file-end message if receiver detects completion by size
                // However, if receiver relies on it, send it:
                // const endMessage = { type: 'file-end', payload: { transferId: transferId } };
                // try {
                //     if (checkConnection()) {
                //         dataChannel.send(JSON.stringify(endMessage));
                //         console.log(`[${transferId}] Sent file-end message.`);
                //         ui.updateFileMessageProgress(recipientPeerId, transferId, 1); // Mark as complete
                //     } else { ... handle error ... }
                // } catch (endError) { ... handle error ... }

                // Assuming completion is detected by size on receiver side:
                ui.updateFileMessageProgress(recipientPeerId, transferId, 1); // Mark as complete locally
            }
        } catch (error) {
            console.error(`[${transferId}] Error sending chunk ${chunkCount}:`, error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            ui.addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的块 ${chunkCount} 失败: ${errorMsg}`, recipientPeerId, true);
            ui.updateFileMessageProgress(recipientPeerId, transferId, -1);
            // No return needed here, error is handled, loop won't continue
        }
    };

    fileReader.onerror = (error) => {
        console.error(`[${transferId}] FileReader error:`, error);
        ui.addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错。`, recipientPeerId, true);
        ui.updateFileMessageProgress(recipientPeerId, transferId, -1);
    };

    readNextChunk(); // Start the process
}

// --- Receiving Files ---

// Handles the 'fileMeta' message type
export function handleIncomingFileMeta(senderId, fileInfo) {
    if (!fileInfo || !fileInfo.transferId || !fileInfo.name || typeof fileInfo.size !== 'number') {
        console.error(`Received invalid fileMeta from ${senderId}:`, fileInfo);
        ui.addSystemMessage("收到无效的文件元信息。", senderId, true);
        return;
    }
    const transferId = fileInfo.transferId;
    console.log(`Received fileMeta for ${transferId} from ${senderId}:`, fileInfo);

    const currentIncomingFiles = state.getIncomingFiles(); // USE GETTER
    if (currentIncomingFiles[transferId]) {
        console.warn(`Received duplicate fileMeta for transfer ID: ${transferId}. Ignoring.`);
        return;
    }

    // Store necessary info, associate with senderId
    currentIncomingFiles[transferId] = {
        info: { ...fileInfo, senderId: senderId, peerId: senderId }, // Ensure senderId and peerId are set
        chunks: [],
        receivedSize: 0,
        peerId: senderId // Store peerId explicitly for easier lookup
    };
    state.setIncomingFiles({...currentIncomingFiles}); // Update state USING SETTER

    // Display placeholder/message in UI (ui.displayMessage handles this)
    // The 'fileMeta' message is already passed to ui.displayMessage in connection.js
    // We might just need to ensure progress starts at 0
    ui.updateFileMessageProgress(senderId, transferId, 0);

    // Show system message only if the sender is the active chat
    if (senderId === state.getActiveChatPeerId()) {
        ui.addSystemMessage(`开始接收文件: ${escapeHTML(fileInfo.name)} (${formatBytes(fileInfo.size)})`, senderId);
    }
}

// Modified to handle ArrayBuffer directly (assuming connection.js gives ArrayBuffer for binary)
export function handleIncomingDataChunk(peerId, arrayBuffer) {
    let transferComplete = false; // Flag to indicate completion
    let downloadUrl = null;
    let fileInfoForAck = null;
    try {
        const view = new Uint8Array(arrayBuffer);
        let separatorIndex = -1;
        // Optimize separator search slightly (check first ~60 bytes)
        for (let i = 0; i < Math.min(view.length, 60); i++) {
            // Pipe character '|' has UTF-8 code 124
            if (view[i] === 124) {
                separatorIndex = i;
                break;
            }
        }

        if (separatorIndex === -1 || separatorIndex === 0) {
            console.error(`Received binary chunk from ${peerId} without valid transferId separator.`);
            // Optional: Send error back to peer? Might be complex.
            return { completed: false }; // Return status
        }

        const idBuffer = arrayBuffer.slice(0, separatorIndex);
        const chunkData = arrayBuffer.slice(separatorIndex + 1);
        const transferId = new TextDecoder().decode(idBuffer);

        const currentIncomingFiles = state.getIncomingFiles(); // USE GETTER
        const fileData = currentIncomingFiles[transferId];

        // Check if transfer exists and is associated with the correct peer
        if (!fileData || fileData.peerId !== peerId) {
            console.warn(`[${transferId}] Received chunk for unknown, completed, or incorrect peer transfer (Sender: ${peerId}, Expected: ${fileData?.peerId}).`);
            return { completed: false }; // Return status
        }

        // Check connection state with the sender
        const connectionStatus = state.getConnectionState(peerId);
        const dataChannel = state.getDataChannel(peerId);
        if (connectionStatus !== 'connected' || !dataChannel || dataChannel.readyState !== 'open') {
             console.log(`[${transferId}] Ignoring chunk from ${peerId}, connection lost or closed.`);
             // Clean up partially received file
             if (currentIncomingFiles[transferId]) {
                 delete currentIncomingFiles[transferId];
                 state.setIncomingFiles({...currentIncomingFiles}); // USE SETTER
                 // Update UI to show failure only if it's the active chat
                 if (peerId === state.getActiveChatPeerId()) {
                    ui.updateFileMessageProgress(peerId, transferId, -1);
                 }
             }
             return { completed: false }; // Return status
        }

        fileData.chunks.push(chunkData);
        fileData.receivedSize += chunkData.byteLength;

        const progress = fileData.receivedSize / fileData.info.size;
        console.log(`[${transferId}] Received chunk ${fileData.chunks.length}. Size: ${chunkData.byteLength}. Total: ${fileData.receivedSize}/${fileData.info.size}. Progress: ${Math.round(progress * 100)}%`);

        // Update UI progress
        ui.updateFileMessageProgress(peerId, transferId, progress);

        // Check if transfer is complete
        if (fileData.receivedSize >= fileData.info.size) {
             if (fileData.receivedSize > fileData.info.size) {
                console.error(`[${transferId}] Received more data than expected size (${fileData.receivedSize} > ${fileData.info.size}). Aborting.`);
                ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收数据超出预期，已中止。`, peerId, true);
                ui.updateFileMessageProgress(peerId, transferId, -1); // Mark as failed
            } else {
                console.log(`[${transferId}] File received completely. Assembling...`);
                const assemblyResult = assembleFile(transferId, fileData);
                if (assemblyResult) {
                    transferComplete = true;
                    downloadUrl = assemblyResult.downloadUrl; // Get URL from result
                    fileInfoForAck = fileData.info; // Store info needed for ACK
                    console.log(`[${transferId}] Assembly successful. downloadUrl: ${downloadUrl}`);
                } else {
                     // Assembly failed, assembleFile handles UI update to failed
                }
            }
             // Clean up state regardless of assembly success/failure
             delete currentIncomingFiles[transferId];
             state.setIncomingFiles({...currentIncomingFiles}); // USE SETTER
             console.log(`[${transferId}] Cleaned up incoming file data from state.`);
        }

    } catch (error) {
        console.error(`Error processing incoming file chunk from ${peerId}:`, error);
        ui.addSystemMessage("处理接收到的文件块时出错。", peerId, true);
        // Potentially clean up the specific transfer if an error occurs?
        // const transferId = findTransferIdOnError(arrayBuffer); // Need a way to get ID if error happens early
        // if (transferId && state.incomingFiles[transferId]) { ... cleanup ... }
    }
    // Return completion status and URL if successful
    return { completed: transferComplete, downloadUrl: downloadUrl, fileInfo: fileInfoForAck };
}

// No longer need handleIncomingFileEnd if completion is based on size

// --- File Assembly ---
// Now returns an object { downloadUrl: string } on success, or null on failure
function assembleFile(transferId, fileData) {
    const peerId = fileData.peerId;
    try {
        console.log(`[${transferId}] Assembling Blob. Type: ${fileData.info.type}, Chunks: ${fileData.chunks.length}`);
        const fileBlob = new Blob(fileData.chunks, { type: fileData.info.type || 'application/octet-stream' });

        if (fileBlob.size !== fileData.info.size) {
             console.error(`[${transferId}] Assembled Blob size mismatch! Expected ${fileData.info.size}, got ${fileBlob.size}.`);
             ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 组装后大小不匹配。`, peerId, true);
             ui.updateFileMessageProgress(peerId, transferId, -1);
             return null; // Indicate failure
        }

        const downloadUrl = URL.createObjectURL(fileBlob);
        console.log(`[${transferId}] File assembled. Download URL created: ${downloadUrl}`);
        ui.updateFileMessageProgress(peerId, transferId, 1, downloadUrl); // Update UI here

        if (peerId === state.getActiveChatPeerId()) {
            ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收完成。`, peerId);
        }
        return { downloadUrl: downloadUrl }; // Indicate success and return URL

    } catch (error) {
        console.error(`[${transferId}] Error creating Blob or Object URL:`, error);
        ui.addSystemMessage(`处理接收到的文件 ${escapeHTML(fileData.info.name)} 时出错。`, peerId, true);
        ui.updateFileMessageProgress(peerId, transferId, -1); // Mark as failed
        return null; // Indicate failure
    }
    // Cleanup is now handled in handleIncomingDataChunk after calling assembleFile
}

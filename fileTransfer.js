// fileTransfer.js
import * as dom from './dom.js';
import * as state from './state.js';
import { FILE_CHUNK_SIZE } from './constants.js';
import { addSystemMessage, addFileMessageToList } from './ui.js';
import { escapeHTML } from './utils.js';

// --- Sending Files ---

export function handleFileSelect(event) {
    if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
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
        state.dataChannel.send(JSON.stringify(messageToSend));
        console.log("Sent file-info:", fileInfo);
        // Display message locally (showing progress)
        addFileMessageToList(fileInfo, true, null, 0);
    } catch (e) {
        console.error("Failed to send file-info:", e);
        addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的信息失败。`, true);
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
        if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
            console.warn(`[${transferId}] Connection lost during send. Aborting.`);
            addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断。`, true);
            // Clean up UI potentially? (Mark as failed?)
            addFileMessageToList(fileInfo, true, null, -1); // Use progress -1 to indicate failure
            return;
        }
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
        const chunk = e.target.result;
        if (!chunk) {
             console.error(`[${transferId}] FileReader returned null chunk.`);
             addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错 (null chunk)。`, true);
             addFileMessageToList(fileInfo, true, null, -1);
             return;
        }
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
            while (state.dataChannel && state.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`[${transferId}] DataChannel buffer full (${state.dataChannel.bufferedAmount}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Wait briefly
                 if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
                    console.warn(`[${transferId}] Connection lost while waiting for buffer. Aborting.`);
                    addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (缓冲区)。`, true);
                    addFileMessageToList(fileInfo, true, null, -1);
                    return;
                }
            }

             if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
                 console.warn(`[${transferId}] DataChannel closed before sending chunk ${chunkCount}. Aborting.`);
                 addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (通道关闭)。`, true);
                 addFileMessageToList(fileInfo, true, null, -1);
                 return;
             }

            state.dataChannel.send(combinedBuffer);
            offset += chunk.byteLength;

            // Update local progress
            const progress = offset / file.size;
            addFileMessageToList(fileInfo, true, null, progress);

            if (offset < file.size) {
                // Schedule the next chunk read
                 setTimeout(readNextChunk, 0); // Use setTimeout to avoid blocking UI thread
            } else {
                // All chunks sent, send the end signal
                console.log(`[${transferId}] Finished sending all chunks.`);
                const endMessage = { type: 'file-end', payload: { transferId: transferId } };
                try {
                    if (state.dataChannel && state.dataChannel.readyState === 'open') {
                        state.dataChannel.send(JSON.stringify(endMessage));
                         console.log(`[${transferId}] Sent file-end message.`);
                         // Update local message to 'Sent' status only AFTER sending file-end
                         addFileMessageToList(fileInfo, true, null, 1); // Progress 1 signals completion for sender
                    } else {
                         console.warn(`[${transferId}] Cannot send file-end, DataChannel closed.`);
                         addFileMessageToList(fileInfo, true, null, -1); // Mark as failed if cannot send end message
                    }
                } catch (endError) {
                     console.error(`[${transferId}] Error sending file-end message:`, endError);
                     addSystemMessage(`发送文件 ${escapeHTML(file.name)} 结束信号失败。`, true);
                     addFileMessageToList(fileInfo, true, null, -1); // Mark as failed
                }
            }
        } catch (error) {
            console.error(`[${transferId}] Error sending chunk ${chunkCount}:`, error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的块 ${chunkCount} 失败: ${errorMsg}`, true);
            addFileMessageToList(fileInfo, true, null, -1); // Mark as failed on chunk send error
            // Stop sending further chunks
            return;
        }
    };

    fileReader.onerror = (error) => {
        console.error(`[${transferId}] FileReader error:`, error);
        addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错。`, true);
        addFileMessageToList(fileInfo, true, null, -1); // Mark as failed on reader error
    };

    // Start reading the first chunk
    readNextChunk();
}

// --- Receiving Files ---

export function handleIncomingFileInfo(fileInfo) {
    if (!fileInfo || !fileInfo.transferId || !fileInfo.name || typeof fileInfo.size !== 'number') {
        console.error("Received invalid file-info:", fileInfo);
        addSystemMessage("收到无效的文件信息。", true);
        return;
    }
    const transferId = fileInfo.transferId;
    console.log(`Received file-info for ${transferId}:`, fileInfo);

    // Access state directly
    const currentIncomingFiles = state.incomingFiles;

    if (currentIncomingFiles[transferId]) {
        console.warn(`Received duplicate file-info for transfer ID: ${transferId}. Ignoring.`);
        return;
    }

    currentIncomingFiles[transferId] = {
        info: fileInfo,
        chunks: [],
        receivedSize: 0
    };
    state.setIncomingFiles({...currentIncomingFiles}); // Update state

    // Display message locally (showing progress)
    addFileMessageToList(fileInfo, false, null, 0);
    addSystemMessage(`正在接收文件: ${escapeHTML(fileInfo.name)}`);
}

export function handleIncomingFileChunk(arrayBuffer) {
    try {
         // Separate the transferId from the chunk data
        const view = new Uint8Array(arrayBuffer);
        let separatorIndex = -1;
        // Search for '|' (ASCII 124)
        for (let i = 0; i < Math.min(view.length, 60); i++) { // Check slightly more bytes for longer IDs
            if (view[i] === 124) {
                separatorIndex = i;
                break;
            }
        }

        if (separatorIndex === -1 || separatorIndex === 0) {
            console.error("Received binary chunk without valid transferId separator.");
            return;
        }

        const idBuffer = arrayBuffer.slice(0, separatorIndex);
        const chunkData = arrayBuffer.slice(separatorIndex + 1);
        const transferId = new TextDecoder().decode(idBuffer);

        // Access state directly
        const currentIncomingFiles = state.incomingFiles;
        const fileData = currentIncomingFiles[transferId];

        if (!fileData) {
            console.warn(`[${transferId}] Received chunk for unknown/completed transfer ID.`);
            // Maybe request file-info again? For now, just ignore.
            return;
        }

        // Check if file transfer was aborted (e.g., incomplete on file-end)
        if (!currentIncomingFiles[transferId]) {
             console.log(`[${transferId}] Ignoring chunk, transfer was likely aborted or completed.`);
             return;
        }

        fileData.chunks.push(chunkData);
        fileData.receivedSize += chunkData.byteLength;

        // Basic check against excessive size
        if (fileData.receivedSize > fileData.info.size * 1.1) { // Allow 10% buffer? No, should be exact.
             if (fileData.receivedSize > fileData.info.size) {
                console.error(`[${transferId}] Received more data than expected size. Expected ${fileData.info.size}, got ${fileData.receivedSize}. Aborting.`);
                addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收数据异常，已中止。`, true);
                delete currentIncomingFiles[transferId];
                state.setIncomingFiles({...currentIncomingFiles}); // Update state
                // Update UI to show failure
                addFileMessageToList(fileData.info, false, null, -1);
                return;
            }
        }

        const progress = fileData.receivedSize / fileData.info.size;
        console.log(`[${transferId}] Received chunk ${fileData.chunks.length}. Progress: ${Math.round(progress * 100)}%`);

        // Update UI progress
        addFileMessageToList(fileData.info, false, null, progress);

        // No need to explicitly update state here as we modified the object directly
        // But if state management required immutability: state.setIncomingFiles({...currentIncomingFiles});

    } catch (error) {
        console.error("Error processing incoming file chunk:", error);
        // Attempt to identify which transfer failed if possible, though transferId might be corrupt
        addSystemMessage("处理接收到的文件块时出错。", true);
    }
}

export function handleIncomingFileEnd(payload) {
     if (!payload || !payload.transferId) {
        console.error("Received invalid file-end payload:", payload);
        return;
    }
    const transferId = payload.transferId;
    console.log(`[${transferId}] Received file-end signal.`);

    // Access state directly
    const currentIncomingFiles = state.incomingFiles;
    const fileData = currentIncomingFiles[transferId];

    if (!fileData) {
        console.warn(`[${transferId}] Received file-end for unknown or already handled transfer.`);
        return;
    }

    // Final check: Did we receive the expected amount of data?
    if (fileData.receivedSize !== fileData.info.size) {
        console.error(`[${transferId}] File transfer incomplete. Expected ${fileData.info.size}, got ${fileData.receivedSize}.`);
        addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收不完整。`, true);
        // Update UI to show failure state
        addFileMessageToList(fileData.info, false, null, -1); // Use -1 for failure
        // Clean up
        delete currentIncomingFiles[transferId];
        state.setIncomingFiles({...currentIncomingFiles});
        return;
    }

    console.log(`[${transferId}] File received completely. Assembling...`);
    try {
        // Combine chunks into a Blob
        const fileBlob = new Blob(fileData.chunks, { type: fileData.info.type });

        // Verify Blob size as a final check
        if (fileBlob.size !== fileData.info.size) {
             console.error(`[${transferId}] Assembled Blob size mismatch! Expected ${fileData.info.size}, got ${fileBlob.size}.`);
             addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 组装后大小不匹配。`, true);
             addFileMessageToList(fileData.info, false, null, -1);
             delete currentIncomingFiles[transferId];
             state.setIncomingFiles({...currentIncomingFiles});
             return;
        }

        // Create a downloadable URL
        const downloadUrl = URL.createObjectURL(fileBlob);
        console.log(`[${transferId}] File assembled. Download URL created.`);

        // Update the message in the list to show the download link
        addFileMessageToList(fileData.info, false, downloadUrl, 1); // Progress 1 for completion
        addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收完成。`);

        // It's crucial to revoke the object URL when it's no longer needed to free memory.
        // However, we need the link to persist in the UI. A potential strategy:
        // 1. Store the URL with the message data.
        // 2. Add a click listener to the message/link that revokes the URL *after* the download theoretically starts (or fails).
        // For simplicity now, we are not revoking it, which can lead to memory leaks if many files are transferred.
        // Consider adding URL.revokeObjectURL(downloadUrl) in a cleanup function or event handler.

    } catch (error) {
        console.error(`[${transferId}] Error creating Blob or Object URL:`, error);
        addSystemMessage(`处理接收到的文件 ${escapeHTML(fileData.info.name)} 时出错。`, true);
        addFileMessageToList(fileData.info, false, null, -1); // Mark as failed
    } finally {
         // Clean up stored chunks and data for this transfer ID regardless of success/failure in assembly
         delete currentIncomingFiles[transferId];
         state.setIncomingFiles({...currentIncomingFiles});
         console.log(`[${transferId}] Cleaned up incoming file data.`);
    }
}

// --- Utility / Cleanup ---

// Function to potentially clean up blobs (needs careful implementation)
export function cleanupFileBlobs() {
    // Example: Iterate through completed file messages in the DOM
    // Find elements with download URLs (e.g., a specific class or data attribute)
    // Get the URL and revoke it if it hasn't been revoked yet.
    // This requires tracking which URLs have been generated and possibly revoked.
    console.warn("cleanupFileBlobs() is not fully implemented. Potential memory leaks from Object URLs.");
} 
// ui.js
import * as dom from './dom.js';
import * as state from './state.js';
import { escapeHTML, formatTime, getUserColorClass, formatBytes } from './utils.js';
import * as connection from './connection.js'; // Import connection to call loadAndDisplayHistory
import * as storage from './storage.js'; // Import storage for potential future use (e.g., removing contacts)

// Remove global selectedPeerId, use state.activeChatPeerId
// let selectedPeerId = null; // DEPRECATED

// Store active ObjectURLs to revoke them later
const activeObjectURLs = new Set();

// Store the peerId associated with the currently shown context menu
let contextMenuPeerId = null;

// --- NEW: Function to cleanup Object URLs ---
export function cleanupObjectURLs() {
    console.log(`[Cleanup] Cleaning up ${activeObjectURLs.size} Object URLs.`);
    activeObjectURLs.forEach(url => {
        console.log(`[Cleanup] Revoking ObjectURL: ${url}`);
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn(`[Cleanup] Error revoking ObjectURL ${url}:`, e);
        }
    });
    activeObjectURLs.clear();
    console.log("[Cleanup] Object URLs cleared.");
}
// --- END NEW ---

/**
 * Returns the currently selected peer ID from state.
 * @returns {string | null}
 */
export function getSelectedPeerId() {
    // return selectedPeerId; // DEPRECATED
    return state.getActiveChatPeerId();
}

// --- UI Helper Functions ---

/**
 * Scrolls the message list to the bottom.
 */
export function scrollToBottom() {
    if (dom.messageList) {
        setTimeout(() => {
             dom.messageList.scrollTop = dom.messageList.scrollHeight;
        }, 0);
    }
}

/**
 * Clears text, system, and file messages from the message list UI.
 * Revokes any active ObjectURLs associated with file messages.
 */
export function clearMessageList() { // Renamed from clearChatMessages for clarity
    if (dom.messageList) {
        dom.messageList.querySelectorAll('.file-message-container[data-download-url]').forEach(el => {
            const url = el.dataset.downloadUrl;
            if (url && activeObjectURLs.has(url)) {
                console.log(`[UI Cleanup] Revoking ObjectURL: ${url}`);
                URL.revokeObjectURL(url);
                activeObjectURLs.delete(url);
            }
        });
        dom.messageList.innerHTML = '';
        updateEmptyState();
    }
}

// --- Empty State ---
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    const hasMessages = dom.messageList.querySelector('.message-item, .file-message-container') !== null;
    // const hasSelectedContact = !!selectedPeerId; // DEPRECATED
    const hasSelectedContact = !!state.getActiveChatPeerId();

    if (hasMessages) {
        dom.emptyMessageListDiv.classList.add('hidden');
    } else if (hasSelectedContact) {
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">forum</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">还没有消息</h3>
             <p class="text-sm">看起来这里很安静。开始对话或发送一个文件吧！</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    } else {
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">chat</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">选择联系人</h3>
             <p class="text-sm">从左侧选择一个联系人以查看聊天记录。</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
}

// --- System Messages ---
// Modified to accept optional peerId. Only displays if peerId matches active chat or if peerId is null (global message).
export function addSystemMessage(text, peerId = null, isError = false) {
     const activePeerId = state.getActiveChatPeerId();

     // Display message only if it's global (peerId is null) or targets the active chat
     if (dom.messageList && (peerId === null || peerId === activePeerId)) {
         const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
         const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
         dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
         scrollToBottom();
     } else {
         // Log messages for non-active chats or if messageList isn't available
         console.log(`[System Message${peerId ? ` for ${peerId}` : ''}${isError ? ' ERROR' : ''}: ${text}`);
     }
}

// --- NEW: Show error when message sent to someone who removed you ---
export function showNotFriendError(peerId) {
    const contactName = state.contacts[peerId]?.name || peerId; // Get sender's name (who sent the error)
    const errorMessage = `您的消息未能发送，因为 ${escapeHTML(contactName)} 已将您从好友列表移除。`;
    addSystemMessage(errorMessage, peerId, true); // Show error in the specific chat window
}
// --- END NEW ---

// --- Chat Messages ---
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    // Basic markdown for bold and italics
    let processedText = escapeHTML(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics

    return processedText.replace(urlRegex, function(url) {
        // Make sure the URL inside <a> tag is not escaped
        return `<a href="${url.replace(/&amp;/g, '&')}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

// Generates a placeholder avatar color based on User ID
function getAvatarColor(userId) {
    // Add a check for invalid userId
    if (!userId || typeof userId !== 'string') {
        console.warn('getAvatarColor called with invalid userId:', userId);
        return '2c2f33'; // Return a default color (e.g., dark gray)
    }

    const colors = [
        '7289da', // Blurple
        '43b581', // Green
        'f04747', // Red
        'faa61a', // Yellow/Orange
        '3498db', // Blue
        '9b59b6', // Purple
        'e91e63', // Pink
        '1abc9c'  // Teal
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash % colors.length)];
}

// Renders HTML for a single message object (text or file meta)
function createMessageHTML(message) {
    // Add check for missing message or essential properties
    if (!message || !message.timestamp) {
        console.warn("createMessageHTML called with invalid message object:", message);
        return '<div class="text-discord-text-muted text-xs italic p-2">[无效或损坏的消息]</div>'; // Return placeholder HTML
    }

    // Robust handling for potentially missing senderId
    let senderId = message.senderId;
    let senderName = '未知用户'; // Default sender name
    let isLocal = false;

    if (senderId) {
        isLocal = senderId === state.localUserId;
        senderName = isLocal
            ? (state.contacts[state.localUserId]?.name || '我')
            : (state.contacts[senderId]?.name || senderId);
    } else {
        console.warn('Message object missing senderId:', message);
        senderId = 'unknown'; // Assign a default ID for color/avatar generation
    }

    // const peerId = isLocal ? state.getActiveChatPeerId() : senderId; // Context peer - may not be needed directly here

    const avatarColor = getAvatarColor(senderId); // Use potentially defaulted senderId
    const userColorClass = getUserColorClass(senderName); // Use potentially defaulted senderName
    const timeString = formatTime(new Date(message.timestamp));

    // TODO: Update lock icon logic based on per-peer crypto state if implemented
    const lockIcon = ''; // Placeholder for now

    const avatarText = escapeHTML(senderName.charAt(0).toUpperCase()); // Use potentially defaulted senderName
    const senderNameEscaped = escapeHTML(senderName); // Use potentially defaulted senderName

    let messageBodyHTML;

    if (message.type === 'text') {
        // Add check for missing payload or text
        if (message.payload && typeof message.payload.text === 'string') {
            messageBodyHTML = `<p class="text-discord-text-primary text-sm message-content">${renderMessageContent(message.payload.text)}</p>`;
        } else {
            console.warn('Text message missing payload or text content:', message);
            messageBodyHTML = '<p class="text-discord-text-muted text-xs italic">[消息内容丢失或损坏]</p>';
        }
    } else if (message.type === 'fileMeta') {
        // Add check for missing payload
        if (message.payload) {
            messageBodyHTML = createFileContentHTML(message.payload, isLocal);
        } else {
            console.warn('FileMeta message missing payload:', message);
            messageBodyHTML = '<p class="text-discord-text-muted text-xs italic">[文件信息丢失或损坏]</p>';
        }
    } else {
        messageBodyHTML = `<p class="text-discord-text-muted text-sm italic">[不支持的消息类型: ${escapeHTML(message.type)}]</p>`;
    }

    // Use data attributes for easy identification
    const dataAttributes = `data-message-id="${message.id}" data-sender-id="${senderId}" data-timestamp="${message.timestamp}"`;
    const messageClasses = `flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded ${message.type === 'fileMeta' ? 'file-message-container' : ''}`;

    return (
       `<div class="${messageClasses}" ${dataAttributes}>
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${avatarText}" alt="${senderNameEscaped} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${senderNameEscaped} (${senderId})" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${senderNameEscaped}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(message.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                ${messageBodyHTML}
            </div>
        </div>`
    );
}

// Displays a message object (text or file meta) in the chat window IF it belongs to the active chat.
export function displayMessage(peerId, message) {
    const activePeerId = state.getActiveChatPeerId();
    if (dom.messageList && peerId === activePeerId) {
        const messageElement = document.createElement('div');
        // createMessageHTML creates the outer div structure directly
        messageElement.innerHTML = createMessageHTML(message);
        if (messageElement.firstElementChild) {
            // Special handling for file messages: Check if placeholder exists
            if (message.type === 'fileMeta') {
                const existingElement = dom.messageList.querySelector(`[data-message-id="${message.id}"]`);
                if (existingElement) {
                     console.log(`Updating existing file message placeholder for ${message.id}`);
                     existingElement.outerHTML = messageElement.innerHTML; // Replace placeholder
                } else {
                     dom.messageList.appendChild(messageElement.firstElementChild);
                }
            } else {
                 dom.messageList.appendChild(messageElement.firstElementChild);
            }
        }
        scrollToBottom();
        updateEmptyState();
    } else if (peerId !== activePeerId) {
        // If message is for an inactive chat, just ensure the unread indicator is shown
         console.log(`Message received for inactive chat ${peerId}, showing indicator.`);
         showUnreadIndicator(peerId, true); // Ensure indicator is on
    }
}

// --- Typing Indicator (Modified for Multi-Peer) ---
export function showTypingIndicator(peerId, isTyping) {
    const activePeerId = state.getActiveChatPeerId();
    state.setPeerIsTyping(peerId, isTyping); // Update state regardless of active chat

    if (dom.typingIndicator && dom.typingUsersSpan) {
        // Only show indicator if the typing peer is the currently selected chat
        if (peerId === activePeerId && isTyping) {
            const typerName = state.contacts[peerId]?.name || peerId || '对方';
            dom.typingUsersSpan.textContent = escapeHTML(typerName);
            dom.typingIndicator.classList.remove('hidden');
            dom.typingIndicator.classList.add('flex');
        } else if (peerId === activePeerId && !isTyping) {
            // Hide if the active peer stopped typing
            dom.typingIndicator.classList.add('hidden');
            dom.typingIndicator.classList.remove('flex');
        }
        // If the typing indicator is for a non-active chat, do nothing visually here
    }
}

// Simplified hide function - called when switching chats or explicitly hiding
export function hideActiveTypingIndicator() {
     if (dom.typingIndicator) {
        dom.typingIndicator.classList.add('hidden');
        dom.typingIndicator.classList.remove('flex');
     }
}

// --- File Messages (Refactored) ---

// Renders just the content part of a file message (icon, name, size, status/action)
// Used by createMessageHTML and updateFileMessageProgress
function createFileContentHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    // Use formatBytes imported from utils.js
    const fileSizeFormatted = formatBytes(fileInfo.size);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;
    // Store original size and name as data attributes for later updates
    const dataAttrs = `data-transfer-id="${transferId}" data-file-size="${fileInfo.size}" data-file-name="${fileNameEscaped}"`;

    const fileIconClasses = "material-symbols-outlined text-3xl text-discord-text-muted flex-shrink-0 mr-3";
    const downloadIconClasses = "material-symbols-outlined text-xl";
    const checkIconClasses = "material-symbols-outlined text-xl text-discord-green";
    const errorIconClasses = "material-symbols-outlined text-xl text-discord-red";
    const progressIconClasses = "material-symbols-outlined text-xl text-discord-blurple animate-spin"; // Spinning icon for progress

    let statusText = '';
    let iconHTML = `<span class="${fileIconClasses}">description</span>`; // Default file icon
    let actionHTML = ''; // Initialize actionHTML, will be placed inside the container

    const isFailed = progress < 0;
    const isComplete = progress >= 1;

    // --- Logic to determine icon, statusText, actionHTML based on progress ---
    if (isFailed) {
        statusText = `<div class="text-xs text-discord-red">${fileSizeFormatted} - 传输失败</div>`;
        iconHTML = `<span class="${errorIconClasses} flex-shrink-0 mr-3">error</span>`;
        actionHTML = ''; // No action on failure
    } else if (isComplete) { // Handle completion actions
        if (downloadUrl) { // Receiver completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted}</div>`;
            // Generate download link HTML
            actionHTML = `
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white p-1 rounded hover:bg-discord-gray-3 download-link" title="下载">
                    <span class="${downloadIconClasses}">download</span>
                </a>`;
            activeObjectURLs.add(downloadUrl);
        } else if (isLocal) { // Sender completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已发送</div>`;
            iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
            actionHTML = ''; // No action needed for sender on completion
        } else { // Receiver completed (fallback if no URL)
             statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已接收</div>`;
             iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
             actionHTML = ''; // No action if download URL missing
        }
    } else { // In progress
        const progressPercent = Math.round(progress * 100);
        statusText = `
            <div class="text-xs text-discord-text-muted">${fileSizeFormatted} - ${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%</div>
            <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
            </div>`;
        iconHTML = `<span class="${progressIconClasses} flex-shrink-0 mr-3 animate-spin">sync</span>`; // Add animate-spin here directly
    }
    // --- End Status/Icon/Action Logic ---

    // Apply data attributes to the container
    return `
        <div class="mt-1 bg-discord-gray-3 p-3 rounded-lg flex items-center file-content" ${dataAttrs}>
            ${iconHTML}
            <div class="flex-1 min-w-0">
                 <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>
                 ${statusText}
            </div>
            <div class="file-action-container ml-auto flex-shrink-0 pl-2">
                ${actionHTML}
            </div>
        </div>
    `;
}

// Updates the progress/status of an existing file message in the UI
export function updateFileMessageProgress(peerId, transferId, progress, downloadUrl = null) {
    // --- BEGIN LOGGING ---
    console.log(`[UI Update] updateFileMessageProgress called for peer ${peerId}, transfer ${transferId}, progress ${progress}, url ${downloadUrl}`);
    // --- END LOGGING ---

    const activePeerId = state.getActiveChatPeerId();
    if (peerId !== activePeerId) {
        // --- BEGIN LOGGING ---
        console.log(`[UI Update] Skipping update for inactive peer ${peerId} (active: ${activePeerId})`);
        // --- END LOGGING ---
        return; // Only update visible chat
    }


    if (dom.messageList) {
        const messageElement = dom.messageList.querySelector(`.message-item[data-message-id="${transferId}"]`); // Select the outer message item
        if (messageElement) {
            const fileContentElement = messageElement.querySelector('.file-content');
            if (!fileContentElement) {
                 console.warn(`[UI Update] Could not find .file-content within message element for transfer ${transferId}`);
                 return;
            }
            // --- BEGIN LOGGING ---
            console.log(`[UI Update] Found messageElement and fileContentElement for ${transferId}`);
            // --- END LOGGING ---


            // Read static file info from data attributes
            const fileSize = parseInt(fileContentElement.dataset.fileSize || '0', 10);
            const fileName = fileContentElement.dataset.fileName || 'unknown_file';
            const fileSizeFormatted = formatBytes(fileSize); // Format the size read from attribute
            // --- BEGIN LOGGING ---
            console.log(`[UI Update] Read from data attributes - Size: ${fileSize}, Name: ${fileName}`);
            // --- END LOGGING ---


            const isLocal = messageElement.getAttribute('data-sender-id') === state.localUserId;

            // Find existing elements to update
            const iconElement = fileContentElement.querySelector('.material-symbols-outlined'); // First icon
            const statusContainer = fileContentElement.querySelector('.flex-1.min-w-0'); // Select the parent container holding name and status/progress
            const actionContainer = fileContentElement.querySelector('.file-action-container'); // Use the new specific class


            // --- BEGIN State Check using data attribute ---
            const hasReachedFinalState = messageElement.dataset.transferState === 'complete' || messageElement.dataset.transferState === 'failed';
            // Check if the new update attempts to set an in-progress state
            const isNewStateInProgress = progress >= 0 && progress < 1;

            if (hasReachedFinalState && isNewStateInProgress) {
                console.warn(`[UI Update ${transferId}] Ignoring attempt to set 'in progress' (progress: ${progress}) on an already completed/failed transfer.`);
                return; // Prevent resetting UI from final state back to in-progress
            }
            // --- END State Check using data attribute ---

            // --- Update Logic ---
            const isFailed = progress < 0;
            const isComplete = progress >= 1;
            let newIconClass = 'description'; // Default file icon
            let newIconColorClass = 'text-discord-text-muted';
            let newStatusHTML = ''; // Changed to hold full HTML for the status area
            let spinClass = false;

             // Determine new state based on progress
             if (isFailed) {
                 newIconClass = 'error';
                 newIconColorClass = 'text-discord-red';
                 const statusText = `${fileSizeFormatted} - 传输失败`;
                 newStatusHTML = `<div class="text-xs text-discord-red">${statusText}</div>`; // Just the text div
             } else if (isComplete) {
                 let statusText = fileSizeFormatted; // Default for receiver completed
                 newIconClass = 'description'; // Default icon for receiver
                 if (downloadUrl) { // Receiver completed with URL
                     // Status text remains just the size
                 } else if (isLocal) { // Sender completed
                     newIconClass = 'check_circle';
                     newIconColorClass = 'text-discord-green';
                     statusText = `${fileSizeFormatted} - 已发送`;
                 } else { // Receiver completed (fallback if no URL)
                     newIconClass = 'check_circle';
                     newIconColorClass = 'text-discord-green';
                     statusText = `${fileSizeFormatted} - 已接收`;
                 }
                 newStatusHTML = `<div class="text-xs text-discord-text-muted">${statusText}</div>`; // Just the text div
             } else { // In progress
                 const progressPercent = Math.round(progress * 100);
                 newIconClass = 'sync';
                 newIconColorClass = 'text-discord-blurple';
                 spinClass = true;
                 const statusText = `${fileSizeFormatted} - ${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%`;
                 // Generate HTML for text AND progress bar
                 newStatusHTML = `
                    <div class="text-xs text-discord-text-muted">${statusText}</div>
                    <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                        <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
                    </div>`;
             }
            // --- BEGIN LOGGING ---
             console.log(`[UI Update ${transferId}] Determined state: isFailed=${isFailed}, isComplete=${isComplete}, spinClass=${spinClass}, newStatusHTML='${newStatusHTML}'`);
            // --- END LOGGING ---

            // Apply Updates
            // 1. Update Icon
            if (iconElement) {
                // --- BEGIN LOGGING ---
                console.log(`[UI Update ${transferId}] Updating icon to: ${newIconClass}, Color: ${newIconColorClass}, Spin: ${spinClass}`);
                // --- END LOGGING ---
                iconElement.textContent = newIconClass;
                iconElement.classList.remove('text-discord-text-muted', 'text-discord-red', 'text-discord-green', 'text-discord-blurple', 'animate-spin'); // Remove all potential state classes
                iconElement.classList.add(newIconColorClass); // Add the correct color
                iconElement.classList.toggle('animate-spin', spinClass); // Use toggle for spin class
            }

            // 2. Update Status Area (Rebuild Content)
            if (statusContainer) {
                // --- MODIFICATION START: Use more specific selector for filename ---
                const filenameDiv = statusContainer.querySelector('.font-medium.text-discord-text-link');
                // --- MODIFICATION END ---

                if (filenameDiv) {
                    // --- MODIFICATION START: Rebuild status container content ---
                    console.log(`[UI Update ${transferId}] Rebuilding status container content.`);
                    // Store the filename element temporarily
                    const tempFilenameDiv = filenameDiv.cloneNode(true);
                    // Clear the container completely
                    statusContainer.innerHTML = '';
                    // Re-add the filename div
                    statusContainer.appendChild(tempFilenameDiv);
                    // Add the new status/progress HTML after the filename
                    statusContainer.insertAdjacentHTML('beforeend', newStatusHTML);
                    // --- MODIFICATION END ---
                } else {
                    // Fallback: If filename div is somehow missing, just set the whole container (less ideal)
                    console.warn(`[UI Update ${transferId}] Filename div not found in status container. Setting innerHTML directly.`);
                    // Construct the filename div HTML again for the fallback
                    const fallbackFilenameHTML = `<div class="font-medium text-discord-text-link truncate" title="${fileName}">${fileName}</div>`;
                    statusContainer.innerHTML = fallbackFilenameHTML + newStatusHTML;
                }
            } else {
                 console.warn(`[UI Update ${transferId}] Status container (.flex-1.min-w-0) not found.`);
            }


             // 3. Update Action Area (Download Link)
             if (actionContainer) {
                 if (isComplete && downloadUrl) {
                     // Receiver completed, update/show download link
                     console.log(`[UI Update ${transferId}] Transfer complete for receiver. Updating download link. URL: ${downloadUrl}`);
                     let linkElement = actionContainer.querySelector('a.download-link');
                     if (!linkElement) {
                         console.log(`[UI Update ${transferId}] Download link <a> not found, creating new one.`);
                         linkElement = document.createElement('a');
                         linkElement.className = 'text-discord-text-muted hover:text-white p-1 rounded hover:bg-discord-gray-3 download-link'; // Added p-1 for better click area
                         linkElement.title = '下载';
                         linkElement.innerHTML = '<span class="material-symbols-outlined text-xl">download</span>';
                         actionContainer.innerHTML = ''; // Clear previous actions if any
                         actionContainer.appendChild(linkElement);
                     }
                     linkElement.href = downloadUrl;
                     linkElement.download = fileName; // Set filename for download
                     linkElement.classList.remove('hidden'); // Ensure it's visible
                     console.log(`[UI Update ${transferId}] Download link href set to: ${linkElement.href}, download attribute to: ${linkElement.download}`);

                     // Add the URL to the active set if not already present
                     if (!activeObjectURLs.has(downloadUrl)) {
                         console.log(`[UI Update ${transferId}] Storing new ObjectURL in activeObjectURLs: ${downloadUrl}`);
                         activeObjectURLs.add(downloadUrl);
                     }

                 } else if (isComplete || isFailed) {
                     // Sender completed or transfer failed, hide/remove action container content
                     console.log(`[UI Update ${transferId}] Transfer complete for sender or failed. Clearing action container.`);
                     actionContainer.innerHTML = ''; // Remove download button or any previous content
                 }
                 // If in progress, actionContainer remains empty or unchanged
             } else {
                  console.warn(`[UI Update ${transferId}] Action container (.file-action-container) not found.`);
             }
             // --- END Download Link Logic ---

             // --- BEGIN Completion Logging ---
             if (isComplete) {
                 console.log(`[UI Update ${transferId}] Handling COMPLETE state (Progress: ${progress}). Final Status HTML: '${newStatusHTML}'.`);
             }
             // --- END Completion Logging ---

             // --- BEGIN Update data attribute for state tracking ---
             if (isComplete) {
                 messageElement.dataset.transferState = 'complete';
                 // console.log(`[UI Update ${transferId}] Set data-transfer-state to 'complete'.`);
             } else if (isFailed) {
                 messageElement.dataset.transferState = 'failed';
                 // console.log(`[UI Update ${transferId}] Set data-transfer-state to 'failed'.`);
             }
             // --- END Update data attribute ---

             // Revoke old URL if a new one is provided and different
             const oldUrl = messageElement.dataset.downloadUrl;
             if (oldUrl && downloadUrl && oldUrl !== downloadUrl && activeObjectURLs.has(oldUrl)) {
                 console.log(`[UI Update ${transferId}] Revoking old ObjectURL: ${oldUrl}`);
                 URL.revokeObjectURL(oldUrl);
                 activeObjectURLs.delete(oldUrl);
             }
             // Store new URL in dataset if provided
             if (downloadUrl) {
                 messageElement.dataset.downloadUrl = downloadUrl;
                 // Note: URL is added to activeObjectURLs when the link is created/updated now
             }
             else {
                 // Ensure data attribute is removed if no URL (e.g., sender completes or failed)
                 delete messageElement.dataset.downloadUrl;
             }
        } else {
             console.warn(`[UI Update] Could not find message element for transfer ID: ${transferId} to update progress.`);
        }
    }
}

// --- NEW: Update File Message Status to Received (on Sender Side) ---
/**
 * Updates the status of a sent file message to indicate it has been received by the peer.
 * This is called on the sender's side when a 'file_ack' message is received.
 * @param {string} peerId The ID of the peer who sent the acknowledgment (the original receiver).
 * @param {string} transferId The unique ID of the file transfer.
 */
export function updateFileMessageStatusToReceived(peerId, transferId) {
    // --- BEGIN LOGGING ---
    console.log(`[UI Update ACK] updateFileMessageStatusToReceived called for ack from peer ${peerId}, transfer ${transferId}`);
    // --- END LOGGING ---

    const activePeerId = state.getActiveChatPeerId();
    // Only update UI if the acknowledged message belongs to the currently active chat
    if (peerId !== activePeerId) {
        // --- BEGIN LOGGING ---
        console.log(`[UI Update ACK] Skipping update for inactive peer ${peerId} (active: ${activePeerId})`);
        // --- END LOGGING ---
        return;
    }

    if (dom.messageList && state.localUserId) {
        // Find the message element sent by the local user with the matching transferId
        // Note: data-message-id is used for transferId for file messages
        const messageElement = dom.messageList.querySelector(`.message-item[data-message-id="${transferId}"][data-sender-id="${state.localUserId}"]`);

        if (messageElement) {
            // --- BEGIN LOGGING ---
            console.log(`[UI Update ACK] Found message element for ${transferId} sent by local user.`);
            // --- END LOGGING ---

            // Check if the transfer is already marked as complete or failed
            const currentState = messageElement.dataset.transferState;
            if (currentState === 'failed') {
                console.log(`[UI Update ACK ${transferId}] Ignoring ACK update because transfer state is already 'failed'.`);
                return;
            }
            if (currentState === 'delivered') {
                console.log(`[UI Update ACK ${transferId}] Ignoring ACK update because transfer state is already 'delivered'.`);
                return;
            }


            const fileContentElement = messageElement.querySelector('.file-content');
            if (fileContentElement) {
                 // Read static file info from data attributes
                const fileSize = parseInt(fileContentElement.dataset.fileSize || '0', 10);
                const fileName = fileContentElement.dataset.fileName || 'unknown_file';
                const fileSizeFormatted = formatBytes(fileSize); // Format the size

                const statusContainer = fileContentElement.querySelector('.flex-1.min-w-0'); // Container holding name and status

                if (statusContainer) {
                    // --- BEGIN LOGGING ---
                    console.log(`[UI Update ACK ${transferId}] Updating status text to '已送达'.`);
                    // --- END LOGGING ---
                    // Rebuild the status text part
                    const filenameDiv = statusContainer.querySelector('.font-medium.text-discord-text-link');
                    // Add double check icon for delivered status
                    const newStatusTextHTML = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已送达 <span class="material-symbols-outlined text-xs align-middle text-discord-green">done_all</span></div>`;

                    if (filenameDiv) {
                        // Clear existing status/progress bar (everything after filename)
                        while (filenameDiv.nextSibling) {
                            statusContainer.removeChild(filenameDiv.nextSibling);
                        }
                        // Append the new "Delivered" status
                        statusContainer.insertAdjacentHTML('beforeend', newStatusTextHTML);

                         // Optionally update the main icon (e.g., keep check_circle or change?)
                         const iconElement = fileContentElement.querySelector('.material-symbols-outlined'); // First icon
                         if (iconElement && iconElement.textContent === 'check_circle') {
                            // Already shows completed, maybe just add tooltip? or keep as is.
                             iconElement.title = "文件已送达";
                         }


                         // Mark state as delivered to prevent further updates like reverting to "已发送"
                         messageElement.dataset.transferState = 'delivered';
                         console.log(`[UI Update ACK ${transferId}] Set data-transfer-state to 'delivered'.`);

                    } else {
                        console.warn(`[UI Update ACK ${transferId}] Filename div not found within status container.`);
                    }
                } else {
                    console.warn(`[UI Update ACK ${transferId}] Status container (.flex-1.min-w-0) not found.`);
                }
            } else {
                console.warn(`[UI Update ACK ${transferId}] Could not find .file-content within message element.`);
            }
        } else {
            console.warn(`[UI Update ACK] Could not find sent message element for transfer ID: ${transferId} to update status to received.`);
        }
    } else if (!state.localUserId) {
         console.error("[UI Update ACK] Cannot update file status: localUserId is not set.");
    }
}

// --- Contact List / Member List --- // Simplified - now only one list

// Re-renders the entire contact list based on state.contacts and pending requests
export function renderContactList() {
    console.log(`[Debug] renderContactList called. Current pendingOutgoingRequests:`, new Set(state.pendingOutgoingRequests)); // Log state at render time
    if (!dom.contactsListContainer) return;

    dom.contactsListContainer.innerHTML = ''; // Clear existing list

    // Separate sections or combined list with different styling
    const pendingIncomingContainer = document.createElement('div');
    pendingIncomingContainer.id = 'pending-incoming-requests';
    const pendingOutgoingContainer = document.createElement('div');
    pendingOutgoingContainer.id = 'pending-outgoing-requests';
    const confirmedContactsContainer = document.createElement('div');
    confirmedContactsContainer.id = 'confirmed-contacts';

    let hasIncoming = false;
    let hasOutgoing = false;
    let hasConfirmed = false;

    // 1. Render Pending Incoming Requests
    if (state.pendingIncomingRequests.size > 0) {
        hasIncoming = true;
        pendingIncomingContainer.innerHTML += `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">待处理的请求 - ${state.pendingIncomingRequests.size}</h3>`;
        state.pendingIncomingRequests.forEach(request => {
            const element = createPendingIncomingElement(request);
            pendingIncomingContainer.appendChild(element);
        });
    }

    // 2. Render Pending Outgoing Requests
    if (state.pendingOutgoingRequests.size > 0) {
         hasOutgoing = true;
        pendingOutgoingContainer.innerHTML += `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">已发送的请求 - ${state.pendingOutgoingRequests.size}</h3>`;
        state.pendingOutgoingRequests.forEach(peerId => {
            const element = createPendingOutgoingElement(peerId);
            pendingOutgoingContainer.appendChild(element);
        });
    }

    // 3. Render Confirmed Contacts
    const contactsArray = Object.values(state.contacts);
    contactsArray.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    if (contactsArray.length > 0) {
        hasConfirmed = true;
        confirmedContactsContainer.innerHTML += `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">好友</h3>`;
        contactsArray.forEach(contact => {
             // Only render if not also in pending outgoing (shouldn't happen with current logic, but safe check)
             // if (!state.hasPendingOutgoingRequest(contact.id)) {
                 const contactElement = createContactItemElement(contact); // Existing function for confirmed contacts
                 confirmedContactsContainer.appendChild(contactElement);
             // }
        });
    }

    // Append sections to the main container
    if (hasIncoming) dom.contactsListContainer.appendChild(pendingIncomingContainer);
    if (hasOutgoing) dom.contactsListContainer.appendChild(pendingOutgoingContainer);
    if (hasConfirmed) dom.contactsListContainer.appendChild(confirmedContactsContainer);

    // Handle empty state if nothing is rendered
    if (!hasIncoming && !hasOutgoing && !hasConfirmed) {
        dom.contactsListContainer.innerHTML = '<p class="text-discord-text-muted text-sm px-3 py-2">还没有联系人或请求。</p>';
    }
}

// Creates a single confirmed contact list item element (Existing function, slightly adjusted classes)
function createContactItemElement(contact) {
    const element = document.createElement('div');
    // Add data attribute to mark type
    element.className = 'flex items-center space-x-3 px-2 py-1.5 mx-2 rounded cursor-pointer hover:bg-discord-gray-3 group contact-item confirmed-contact';
    element.dataset.peerId = contact.id;
    element.dataset.contactType = 'confirmed'; // Mark as confirmed

    const avatarColor = getAvatarColor(contact.id);
    const avatarText = escapeHTML((contact.name || contact.id).charAt(0).toUpperCase());
    const nameEscaped = escapeHTML(contact.name || contact.id);

    // Status Indicator Logic (remains the same)
    let statusIndicatorHTML = '';
    let statusTitle = '状态未知'; // Default title
    if (contact.online === true) {
        statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-green ring-2 ring-discord-gray-1"></span>';
        statusTitle = '在线';
    } else if (contact.online === 'connecting') {
        statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-yellow ring-2 ring-discord-gray-1"></span>';
        statusTitle = '连接中...';
    } else {
        statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 opacity-50 group-hover:opacity-100"></span>';
        statusTitle = '离线';
    }

    // Unread Indicator Placeholder (remains the same)
    const unreadIndicatorHTML = '<span class="bg-discord-red w-2 h-2 rounded-full ml-auto hidden unread-indicator"></span>';

    element.innerHTML = `
        <div class="relative flex-shrink-0">
            <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="${nameEscaped} (${contact.id}) - ${statusTitle}">
            ${statusIndicatorHTML}
        </div>
        <span class="flex-1 text-discord-text-primary truncate font-medium text-sm contact-name">${nameEscaped}</span>
        ${unreadIndicatorHTML}
        <!-- Action buttons could be added via context menu -->
    `;

    // Add click listener to select chat (only for confirmed contacts)
    element.addEventListener('click', handleContactClick);

    // Add contextmenu listener (remains the same)
    element.addEventListener('contextmenu', (event) => {
        showContextMenu(event, contact.id);
    });

    return element;
}

// --- NEW: Create element for Pending Incoming Request ---
function createPendingIncomingElement(request) {
    const element = document.createElement('div');
    element.className = 'flex items-center justify-between px-2 py-1.5 mx-2 rounded group contact-item incoming-request'; // No hover background change by default
    element.dataset.peerId = request.id;
    element.dataset.contactType = 'incoming'; // Mark type

    const avatarColor = getAvatarColor(request.id);
    const avatarText = escapeHTML((request.name || request.id).charAt(0).toUpperCase());
    const nameEscaped = escapeHTML(request.name || request.id);

    element.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0">
            <div class="relative flex-shrink-0">
                <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="${nameEscaped} (${request.id})">
                <!-- No status indicator for incoming requests -->
            </div>
            <span class="flex-1 text-discord-text-primary truncate font-medium text-sm contact-name" title="${nameEscaped} (${request.id})">${nameEscaped}</span>
        </div>
        <div class="flex items-center space-x-1 flex-shrink-0">
            <button class="accept-request-btn p-1 rounded text-discord-green hover:bg-discord-gray-3" title="接受">
                <span class="material-symbols-outlined text-lg">check</span>
            </button>
            <button class="decline-request-btn p-1 rounded text-discord-red hover:bg-discord-gray-3" title="拒绝">
                <span class="material-symbols-outlined text-lg">close</span>
            </button>
        </div>
    `;

    // Add event listeners for accept/decline buttons
    element.querySelector('.accept-request-btn').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent potential parent click handlers
        handleAcceptRequest(request.id);
    });
    element.querySelector('.decline-request-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeclineRequest(request.id);
    });

    // No click listener for selecting chat on incoming requests
    // No context menu for incoming requests (or define a specific one)

    return element;
}

// --- NEW: Create element for Pending Outgoing Request ---
function createPendingOutgoingElement(peerId) {
    const element = document.createElement('div');
    element.className = 'flex items-center justify-between px-2 py-1.5 mx-2 rounded group contact-item outgoing-request opacity-70'; // Dimmed, no hover, no cursor pointer
    element.dataset.peerId = peerId;
    element.dataset.contactType = 'outgoing'; // Mark type

    const avatarColor = getAvatarColor(peerId);
    const avatarText = escapeHTML(peerId.charAt(0).toUpperCase()); // Use ID for text initially
    const nameEscaped = escapeHTML(peerId); // Show ID

    element.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0">
            <div class="relative flex-shrink-0">
                <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="已发送请求给 ${nameEscaped}">
                 <!-- Maybe a specific icon? -->
                 <span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 flex items-center justify-center" title="等待确认">
                    <span class="material-symbols-outlined text-[9px] text-discord-gray-1">hourglass_empty</span>
                 </span>
            </div>
            <span class="flex-1 text-discord-text-muted truncate italic font-medium text-sm contact-name" title="等待 ${nameEscaped} 确认">${nameEscaped}</span>
        </div>
        <div class="flex-shrink-0">
             <button class="cancel-request-btn p-1 rounded text-discord-red hover:bg-discord-gray-3 opacity-0 group-hover:opacity-100" title="取消请求">
                 <span class="material-symbols-outlined text-lg">cancel</span>
             </button>
        </div>
    `;

     // Add event listener for cancel button
    element.querySelector('.cancel-request-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        handleCancelRequest(peerId);
    });

    // No click listener for selecting chat
    // No context menu (or a specific one to cancel)

    return element;
}


// --- NEW: Handlers for Request Actions ---

async function handleAcceptRequest(peerId) {
    console.log(`[Friend Request] Accepting request from ${peerId}`);
    const request = state.getPendingIncomingRequest(peerId);
    if (!request) return;

    // 1. Send accept message via P2P
    const sent = await connection.sendFriendAccept(peerId); // Ensure await here if sendFriendAccept becomes truly async
    if (!sent) {
        addSystemMessage(`向 ${request.name || peerId} 发送接受消息失败。`, null, true);
        return; // Don't proceed if sending failed
    }

    // --- NEW: Explicitly reset connection state before adding contact ---
    console.log(`[Friend Request] Resetting connection state for ${peerId} after sending accept.`);
    connection.resetPeerConnection(peerId, "Friend Request Accepted");
    // --- END NEW ---

    // 2. Add contact locally
    const addedOrUpdated = state.addContact(peerId, request.name);

    // 3. Remove pending incoming request state
    state.removePendingIncomingRequest(peerId);

    // 4. Update UI - More granularly
    // Find and remove the pending incoming request element
    const requestElement = dom.contactsListContainer?.querySelector(`.contact-item.incoming-request[data-peer-id="${peerId}"]`);
    if (requestElement) {
        requestElement.remove();
        console.log(`Removed incoming request UI for ${peerId}`);
        updateRequestSectionHeaders(); // <-- Add this call
    } else {
         console.warn(`Could not find incoming request UI element for ${peerId} to remove.`);
         renderContactList(); // Re-render as fallback (Consider removing if update logic below is robust)
         return; // Exit early if the request element wasn't found, preventing potential issues below
    }

    // --- MODIFICATION START ---
    // Instead of adding, find the *existing* confirmed contact element and update it.
    if (addedOrUpdated) {
        const contactData = state.contacts[peerId]; // Get the final contact data
        if (contactData) {
            const existingContactElement = dom.contactsListContainer?.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`);

            if (existingContactElement) {
                // Update existing element (e.g., name, ensure no pending styles)
                const nameElement = existingContactElement.querySelector('.flex-grow span'); // Adjust selector if needed
                if (nameElement) {
                    nameElement.textContent = contactData.name || contactData.id;
                }
                // Optionally update avatar/status if needed, though status should update separately
                console.log(`Updated existing contact element UI for ${peerId}`);
            } else {
                 // Fallback: If somehow the existing element wasn't found, add it (shouldn't normally happen)
                 console.warn(`Could not find existing confirmed contact element for ${peerId}. Adding new one.`);
                 addContactToList(contactData);
            }
        } else {
             // Handle case where contactData is unexpectedly missing after addContact succeeded
             console.error(`Contact data for ${peerId} is missing after state.addContact call.`);
             renderContactList(); // Re-render as a safety measure
        }
    } else {
         // This case means state.addContact itself failed, log it.
         console.warn(`state.addContact returned false for ${peerId}, UI might be inconsistent.`);
         // Maybe renderContactList() here too? Or log the inconsistency.
         renderContactList();
    }
    // --- MODIFICATION END ---

    addSystemMessage(`您已接受 ${request.name || peerId} 的好友请求。`, null);

    // --- REMOVE/COMMENT OUT: Optional connection initiation block ---
    // The connection should now be reliably initiated by handleContactClick
    /*
    if (state.getConnectionState(peerId) !== 'connected') {
        connection.connectToPeer(peerId);
    }
    */
    // --- END REMOVAL ---
}

async function handleDeclineRequest(peerId) {
    console.log(`[Friend Request] Declining request from ${peerId}`);
    const request = state.getPendingIncomingRequest(peerId);
    if (!request) return;

    // 1. Send decline message via P2P
    const sent = connection.sendFriendDecline(peerId);
    if (!sent) {
         addSystemMessage(`向 ${request.name || peerId} 发送拒绝消息失败（可能已离线）。`, null, true);
    }

    // 2. Remove pending incoming request state
    state.removePendingIncomingRequest(peerId);

    // 3. Update UI - More granularly
    // Find and remove the pending incoming request element
    const requestElement = dom.contactsListContainer?.querySelector(`.contact-item.incoming-request[data-peer-id="${peerId}"]`);
    if (requestElement) {
        requestElement.remove();
        console.log(`Removed incoming request UI for ${peerId}`);
        updateRequestSectionHeaders(); // <-- Add this call
    } else {
        console.warn(`Could not find incoming request UI element for ${peerId} to remove.`);
        // Fallback to re-render if element removal fails?
        renderContactList(); // Re-render as fallback
    }
    // No longer calling renderContactList() here.
    addSystemMessage(`您已拒绝 ${request.name || peerId} 的好友请求。`, null);

    // 4. Optional: Disconnect if connected
    if (state.getConnectionState(peerId) === 'connected') {
        connection.disconnectFromPeer(peerId);
    }
}
// --- NEW: Function to remove incoming request UI ---
/**
 * Removes the UI element for a pending incoming friend request.
 * @param {string} peerId The ID of the peer whose incoming request UI should be removed.
 */
export function removeIncomingRequestUI(peerId) {
    if (!dom.contactsListContainer) return;

    const requestElement = dom.contactsListContainer.querySelector(`.contact-item.incoming-request[data-peer-id="${peerId}"]`);
    if (requestElement) {
        requestElement.remove();
        console.log(`[UI Update] Removed incoming request UI for ${peerId}`);
        updateRequestSectionHeaders(); // <-- Add this call
    } else {
        console.warn(`[UI Update] Could not find incoming request UI element for ${peerId} to remove.`);
        // Optionally re-render the list as a fallback if granular removal fails
        // renderContactList();
    }
}
// --- END NEW ---
async function handleCancelRequest(peerId) {
    console.log(`[Friend Request] Cancelling outgoing request to ${peerId}`);
    if (!state.hasPendingOutgoingRequest(peerId)) {
        console.warn(`[Friend Request] Attempted to cancel non-existent outgoing request to ${peerId}`);
        return; // Request doesn't exist in state
    }

    // --- NEW: Attempt to send cancellation notification ---
    console.log(`[Friend Request] Attempting to send cancellation notification to ${peerId}`);
    const sent = await connection.sendFriendCancel(peerId); // Use await as sendP2PMessage is async
    if (!sent) {
        // Log the failure but proceed with local cancellation anyway.
        // The peer will eventually figure it out or the request might remain on their side if they were offline.
        console.warn(`[Friend Request] Failed to send cancellation notification to ${peerId} (likely offline or connection issue). Proceeding with local cancellation.`);
        // Optionally, add a system message indicating the notification might not have been sent?
        // addSystemMessage(`未能通知 ${peerId} 请求已取消（对方可能离线）。`, null, true);
    } else {
        console.log(`[Friend Request] Successfully sent cancellation notification to ${peerId}.`);
    }
    // --- END NEW ---

    // 1. Remove pending outgoing request state (Locally)
    const removedFromState = state.removePendingOutgoingRequest(peerId);
    if (!removedFromState) {
        console.error(`[Friend Request] Failed to remove outgoing request for ${peerId} from local state, though it was expected to exist.`);
        // UI might become inconsistent. Consider re-rendering as a fallback.
        renderContactList();
        return;
    }

    // 2. Update UI - More granularly
    const requestElement = dom.contactsListContainer?.querySelector(`.contact-item.outgoing-request[data-peer-id="${peerId}"]`);
    if (requestElement) {
        requestElement.remove();
        console.log(`Removed outgoing request UI for ${peerId}`);
        updateRequestSectionHeaders(); // <-- Add this call
    } else {
        console.warn(`Could not find outgoing request UI element for ${peerId} to remove.`);
        // Fallback to re-render if element removal fails?
        renderContactList(); // Re-render as fallback
    }

    // Display local confirmation message
    addSystemMessage(`您已取消发送给 ${peerId} 的好友请求。`, null);

    // 4. Optional: Disconnect if connected (connection might exist from initial request attempt)
    if (state.getConnectionState(peerId) === 'connected') {
        console.log(`[Friend Request] Disconnecting from ${peerId} after cancelling request.`);
        connection.disconnectFromPeer(peerId);
    }
}

// Updates the online status indicator and title for a specific contact in the list
export function updateContactStatusUI(peerId, status) { // status: boolean | 'connecting'
    if (!dom.contactsListContainer) return;
     // Find only confirmed contacts for status updates
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const img = contactElement.querySelector('img');
        const statusIndicatorContainer = contactElement.querySelector('.relative'); // Container for avatar + status
        if (!statusIndicatorContainer) return;

        // Remove existing status span
        const existingStatusSpan = statusIndicatorContainer.querySelector('span.absolute');
        if (existingStatusSpan) existingStatusSpan.remove();

        let statusIndicatorHTML = '';
        let statusTitle = '';

        if (status === true) {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-green ring-2 ring-discord-gray-1"></span>';
            statusTitle = '在线';
        } else if (status === 'connecting') {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-yellow ring-2 ring-discord-gray-1"></span>';
            statusTitle = '连接中...';
        } else {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 opacity-50 group-hover:opacity-100"></span>';
            statusTitle = '离线';
        }

        statusIndicatorContainer.insertAdjacentHTML('beforeend', statusIndicatorHTML);
        if (img) {
             // Update title attribute on the image
             const name = contactElement.querySelector('.contact-name')?.textContent || peerId;
             img.title = `${name} (${peerId}) - ${statusTitle}`;
        }
        console.log(`Updated UI status for ${peerId} to ${status}`);
    } else {
         console.warn(`Contact element not found for peerId: ${peerId} during status UI update.`);
    }
}

// Shows or hides the unread message indicator for a contact
export function showUnreadIndicator(peerId, show) {
    if (!dom.contactsListContainer) return;
    // Find only confirmed contacts to show unread indicator
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const indicator = contactElement.querySelector('.unread-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', !show);
            console.log(`Set unread indicator for ${peerId} to ${show}`);
        }
    }
}

// Handles clicking on a contact in the list
// --- MODIFIED: Only allow clicking confirmed contacts ---
export async function handleContactClick(event) {
    const targetElement = event.currentTarget; // The div.contact-item

    // Check if the clicked item is a confirmed contact
    if (!targetElement.classList.contains('confirmed-contact')) {
        console.log("Clicked on a non-confirmed contact (request). Ignoring chat switch.");
        return;
    }

    const clickedPeerId = targetElement.dataset.peerId;
    const currentActivePeerId = state.getActiveChatPeerId();

    if (!clickedPeerId) {
        console.warn("Clicked invalid target element with no peerId.");
        return;
    }

    // If clicking the already active peer, do nothing.
    if (clickedPeerId === currentActivePeerId) {
         console.log(`Clicked same peer (${clickedPeerId}) or invalid target.`);
        return;
    }

    console.log(`Contact clicked: ${clickedPeerId}`);

    // --- MODIFICATION START: Check connection and signaling state BEFORE changing active chat ---
    const connectionStatus = state.getConnectionState(clickedPeerId);
    const needsConnectionAttempt = (connectionStatus !== 'connected' && connectionStatus !== 'connecting');

    if (needsConnectionAttempt && !state.isSignalingConnected()) {
        // If we need to connect but signaling is down, warn and exit without changing active chat
        console.warn(`Cannot switch to ${clickedPeerId} and connect: Signaling server disconnected.`);
        addSystemMessage(`暂时无法连接到 ${state.contacts[clickedPeerId]?.name || clickedPeerId}：信令服务器未连接。`, null, true); // Global message might be better here
        return;
    }
    // --- MODIFICATION END ---

    // --- Proceed with switching the chat UI ---

    // 1. Update State
    state.setActiveChat(clickedPeerId);

    // 2. Update UI Selection Highlight
    // Remove highlight from previously selected contact
    if (currentActivePeerId && dom.contactsListContainer) {
        const previousElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${currentActivePeerId}"]`);
        if (previousElement) {
            previousElement.classList.remove('bg-discord-gray-4');
            previousElement.classList.add('hover:bg-discord-gray-3');
        }
    }
    // Add highlight to the newly selected contact
    targetElement.classList.add('bg-discord-gray-4');
    targetElement.classList.remove('hover:bg-discord-gray-3');

    // 3. Clear previous chat state (messages, typing indicator)
    clearMessageList();
    hideActiveTypingIndicator();

    // 4. Update Chat Header
    updateChatHeader(clickedPeerId);

    // 5. Load and Display History for the selected peer
    await connection.loadAndDisplayHistory(clickedPeerId);

    // 6. Mark chat as read (hide unread indicator)
    showUnreadIndicator(clickedPeerId, false);

    // 7. Update input visibility based on the *new* peer's connection status
    updateChatInputVisibility();

    // 8. Update empty state message
    updateEmptyState();

    // 9. Focus input field? (Optional)
    // if (dom.chatInput) dom.chatInput.focus();

    // 10. Initiate connection if needed (we already checked signaling state earlier)
    if (needsConnectionAttempt) {
         console.log(`Contact ${clickedPeerId} is ${connectionStatus}. Attempting to connect (signaling check passed earlier)...`);
         try {
             // connectToPeer returns a Promise, but we don't need to await it here
             // as the connection process runs in the background.
             connection.connectToPeer(clickedPeerId);
         } catch (e) { // Note: connectToPeer itself doesn't throw sync errors typically, promise handles errors
              console.error(`Failed to initiate connection via click to ${clickedPeerId}:`, e);
              addSystemMessage(`无法发起与 ${state.contacts[clickedPeerId]?.name || clickedPeerId} 的连接。`, clickedPeerId, true);
         }
     }
     // No 'else' needed here, if connection wasn't needed or already connected, we just proceed with UI updates.
}

// Updates the header of the chat area
function updateChatHeader(peerId) {
    if (!dom.chatHeaderName || !dom.chatHeaderStatus) return;

    if (!peerId) {
        // No active chat
        dom.chatHeaderName.textContent = '选择对话';
        dom.chatHeaderStatus.textContent = '从左侧列表选择一个联系人开始聊天';
        dom.chatHeaderStatus.className = 'text-xs text-discord-text-muted'; // Reset class
        return;
    }

    const contact = state.contacts[peerId];
    const name = contact?.name || peerId;
    let statusText = '';
    let statusClass = 'text-xs text-discord-text-muted';

    const connectionState = state.getConnectionState(peerId);
    const contactOnlineStatus = contact?.online;

    if (contactOnlineStatus === true) {
        statusText = '在线';
        statusClass = 'text-xs text-discord-green';
    } else if (contactOnlineStatus === 'connecting' || connectionState === 'connecting') {
         statusText = '连接中...';
         statusClass = 'text-xs text-discord-yellow';
    } else {
        statusText = '离线';
        // Could add last seen later if tracked
    }

    dom.chatHeaderName.textContent = name;
    dom.chatHeaderStatus.textContent = statusText;
    dom.chatHeaderStatus.className = statusClass;
}

// --- Input Area Visibility ---
export function updateChatInputVisibility(forceVisible = null) {
    if (!dom.chatInputContainer) {
        console.error("UI Error: dom.chatInputContainer is null or undefined in updateChatInputVisibility!");
        return; // Exit if the element doesn't exist
    }
    let shouldBeVisible = false;

    if (forceVisible !== null) {
        shouldBeVisible = forceVisible;
    } else {
        const activePeerId = state.getActiveChatPeerId();
        // Show the input container if *any* contact is selected
        shouldBeVisible = !!activePeerId; // Changed: Now depends only on whether a chat is active
    }

    console.log(`[UI Debug] Updating input visibility. Element:`, dom.chatInputContainer, `Should be visible: ${shouldBeVisible}`); // Added log
    dom.chatInputContainer.classList.toggle('hidden', !shouldBeVisible);

    // Also update chat header when input visibility changes
    updateChatHeader(state.getActiveChatPeerId());
}

// --- Other UI Updates ---

// Display local user ID (e.g., in settings or profile area)
export function displayLocalUserInfo() {
    if (dom.localUserIdSpan) {
        dom.localUserIdSpan.textContent = state.localUserId;
        dom.localUserIdSpan.title = '这是您的唯一ID，分享给朋友以添加您为联系人';
    }
    // Optionally display local user name if configurable
    // const localName = state.contacts[state.localUserId]?.name || state.localUserId;
    // if (dom.localUserNameSpan) { dom.localUserNameSpan.textContent = localName; }

    // Add copy functionality
    const copyButton = dom.localUserIdSpan?.parentElement?.querySelector('button');
    if (dom.localUserIdSpan && copyButton) {
        copyButton.onclick = () => {
            navigator.clipboard.writeText(state.localUserId).then(() => {
                 console.log('Local user ID copied to clipboard!');
                 // Simple visual feedback
                 const originalText = copyButton.innerHTML;
                 copyButton.innerHTML = '<span class="material-symbols-outlined text-sm">check</span>';
                 setTimeout(() => { copyButton.innerHTML = originalText; }, 1500);
            }).catch(err => {
                 console.error('Failed to copy local user ID: ', err);
                 // Show error feedback?
            });
        };
    }
}

/**
 * Clears the chat input field.
 */
export function clearChatInput() {
    if (dom.chatInput) {
        dom.chatInput.value = '';
        dom.chatInput.dispatchEvent(new Event('input')); // Trigger input event for potential autosize adjustments
    }
}

// --- Context Menu Logic ---

/**
 * Shows the custom context menu for a contact item.
 * @param {MouseEvent} event The contextmenu event.
 * @param {string} peerId The ID of the contact.
 */
function showContextMenu(event, peerId) {
    event.preventDefault(); // Prevent the default browser context menu

    // Find the element to check its type
    const targetElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (!targetElement || !targetElement.classList.contains('confirmed-contact')) {
         console.log("Context menu attempt on non-confirmed contact. Ignoring.");
         hideContextMenu(); // Ensure any previous menu is hidden
        return;
    }

    contextMenuPeerId = peerId; // Store the peer ID for the action

    if (!dom.contactContextMenu) return;

    const contact = state.contacts[peerId];
    const name = contact?.name || peerId;

    // Populate the menu (currently only delete)
    dom.contactContextMenu.innerHTML = `
        <a href="#" id="delete-contact-action" class="block px-4 py-1.5 text-discord-red hover:bg-discord-gray-3">
            <span class="material-symbols-outlined text-sm mr-2 align-middle">delete</span>删除 "${escapeHTML(name)}"
        </a>
        <a href="#" id="clear-history-action" class="block px-4 py-1.5 text-discord-text-muted hover:bg-discord-gray-3">
             <span class="material-symbols-outlined text-sm mr-2 align-middle">delete_sweep</span>清空聊天记录
        </a>
        <!-- Add more menu items here if needed -->
    `;

    // Add event listener for the delete action
    const deleteAction = dom.contactContextMenu.querySelector('#delete-contact-action');
    if (deleteAction) {
        deleteAction.addEventListener('click', (e) => {
            e.preventDefault();
            handleDeleteContact(contextMenuPeerId);
            hideContextMenu();
        });
    }

    // --- NEW: Add event listener for clear history action ---
    const clearHistoryAction = dom.contactContextMenu.querySelector('#clear-history-action');
    if (clearHistoryAction) {
         clearHistoryAction.addEventListener('click', (e) => {
             e.preventDefault();
             handleClearHistory(contextMenuPeerId);
             hideContextMenu();
         });
    }
    // --- End NEW ---

    // Position the menu
    // Basic positioning: place near the cursor
    // Improvement: Check bounds to ensure menu stays within viewport
    const menuWidth = dom.contactContextMenu.offsetWidth;
    const menuHeight = dom.contactContextMenu.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = event.clientY;
    let left = event.clientX;

    // Adjust if menu goes off-screen horizontally
    if (left + menuWidth > viewportWidth) {
        left = viewportWidth - menuWidth - 5; // Add some padding
    }
    // Adjust if menu goes off-screen vertically
    if (top + menuHeight > viewportHeight) {
        top = viewportHeight - menuHeight - 5; // Add some padding
    }

    dom.contactContextMenu.style.top = `${top}px`;
    dom.contactContextMenu.style.left = `${left}px`;

    // Show the menu
    dom.contactContextMenu.classList.remove('hidden');

    // Add a one-time click listener to the window to hide the menu
    // Use setTimeout to prevent the same click from immediately hiding it
    setTimeout(() => {
        window.addEventListener('click', hideContextMenuOnClickOutside, { once: true });
        window.addEventListener('contextmenu', hideContextMenuOnClickOutside, { once: true }); // Also hide on another context menu click
    }, 0);
}

/**
 * Hides the custom context menu.
 */
function hideContextMenu() {
    if (dom.contactContextMenu) {
        dom.contactContextMenu.classList.add('hidden');
    }
    contextMenuPeerId = null; // Clear stored peer ID
    // Ensure the global listeners are removed if they weren't triggered
    window.removeEventListener('click', hideContextMenuOnClickOutside);
    window.removeEventListener('contextmenu', hideContextMenuOnClickOutside);
}

/**
 * Event listener callback to hide the context menu if the click is outside it.
 * @param {MouseEvent} event
 */
function hideContextMenuOnClickOutside(event) {
    if (dom.contactContextMenu && !dom.contactContextMenu.contains(event.target)) {
        hideContextMenu();
    } else {
        // Re-attach listener if click was inside, because 'once' removes it
         setTimeout(() => {
            window.addEventListener('click', hideContextMenuOnClickOutside, { once: true });
             window.addEventListener('contextmenu', hideContextMenuOnClickOutside, { once: true });
        }, 0);
    }
}

/**
 * Handles the deletion of a contact after confirmation.
 * Also deletes associated chat history.
 * @param {string} peerId The ID of the contact to delete.
 */
async function handleDeleteContact(peerId) {
    if (!peerId) return;

    // Double-check it's actually a contact
    const contact = state.contacts[peerId];
    if (!contact) {
         console.warn(`handleDeleteContact called for non-contact ID: ${peerId}`);
         return;
    }

    const name = contact.name || peerId;

    // Confirmation dialog
    if (confirm(`您确定要删除联系人 "${escapeHTML(name)}" 吗？\n相关的聊天记录和连接状态将被清除。`)) {
        console.log(`Confirmed deletion for ${peerId}`);

        // --- Begin Deletion Process ---
        let historyDeleted = false;
        try {
            // 1. Attempt to delete chat history first
            await storage.deleteMessagesForPeer(peerId);
            console.log(`Successfully initiated deletion of history for ${peerId}.`);
            historyDeleted = true; // Mark history deletion as successful (or at least initiated without error)

            // 2. Remove contact from state and localStorage (which also resets peer state)
            const success = state.removeContact(peerId);

            if (success) {
                console.log(`Contact ${peerId} removed from state.`);
                renderContactList(); // Re-render the list to reflect removal

                // If the deleted contact was the active chat, update the main panel
                if (state.getActiveChatPeerId() === null) {
                    clearMessageList();
                    hideActiveTypingIndicator();
                    updateChatHeader(null);
                    updateChatInputVisibility(false);
                    updateEmptyState();
                }
                addSystemMessage(`联系人 ${escapeHTML(name)} 已删除。`, null); // Global confirmation
            } else {
                // This case might be less likely if removeContact is robust, but handle it
                console.error(`Failed to remove contact ${peerId} from state after history deletion.`);
                addSystemMessage(`删除联系人 ${escapeHTML(name)} 的聊天记录时出错。联系人本身可能未被删除。`, null, true);
            }

        } catch (error) {
            // Catch errors from either deleteMessagesForPeer or potentially removeContact if it threw
            console.error(`Error during deletion process for ${peerId}:`, error);
            if (!historyDeleted) {
                 addSystemMessage(`删除联系人 ${escapeHTML(name)} 的聊天记录时出错。联系人本身可能未被删除。`, null, true);
            } else {
                 // History was likely deleted, but removing contact from state failed
                 addSystemMessage(`删除联系人 ${escapeHTML(name)} 时发生错误（联系人状态或记录未能完全清除）。`, null, true);
                 // Consider attempting to re-render the contact list anyway, though state might be inconsistent
                 renderContactList();
            }
        }
        // --- End Deletion Process ---

    } else {
        console.log(`Deletion cancelled for ${peerId}`);
    }
}

// --- Handle clearing chat history (remains the same, but should only be callable for confirmed contacts via context menu) ---
async function handleClearHistory(peerId) {
    if (!peerId) {
        console.warn("handleClearHistory called without peerId.");
        return;
    }

    const contact = state.contacts[peerId];
    const name = contact?.name || peerId;

    // Confirmation dialog
    if (confirm(`您确定要清空与 "${escapeHTML(name)}" 的本地聊天记录吗？\n此操作不可恢复。`)) {
        console.log(`Confirmed clearing history for ${peerId}`);

        try {
            // Call storage function to delete messages
            await storage.deleteMessagesForPeer(peerId);
            console.log(`Successfully initiated deletion of history for ${peerId}.`);

            // If the cleared chat is currently active, update the UI
            if (state.getActiveChatPeerId() === peerId) {
                console.log(`Chat history for active peer ${peerId} cleared. Updating UI.`);
                clearMessageList(); // Clear messages from the UI
                updateEmptyState(); // Show the appropriate empty state message
            }

            // Show confirmation message
            addSystemMessage(`与 ${escapeHTML(name)} 的本地聊天记录已清空。`, null); // Global message

        } catch (error) {
            console.error(`Error clearing history for ${peerId}:`, error);
            addSystemMessage(`清空 ${escapeHTML(name)} 的聊天记录时出错。`, null, true); // Global error message
        }
    } else {
        console.log(`Clearing history cancelled for ${peerId}`);
    }
}

// --- NEW: Function to update a contact's name in the list ---
/**
 * Updates the display name of a contact in the contact list UI.
 * @param {string} peerId The ID of the contact.
 * @param {string} newName The new name for the contact.
 */
export function updateContactName(peerId, newName) {
    if (!dom.contactsListContainer) return;
    // Find the specific contact item (only confirmed contacts have names updated this way)
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const nameSpan = contactElement.querySelector('.contact-name');
        const avatarImg = contactElement.querySelector('img');
        const nameEscaped = escapeHTML(newName);

        if (nameSpan) {
            nameSpan.textContent = nameEscaped;
            nameSpan.title = nameEscaped; // Update tooltip as well
        }
        if (avatarImg) {
            const avatarText = escapeHTML(newName.charAt(0).toUpperCase());
            // Update avatar text (assuming placeholder image URL structure)
            // Extract existing color from src
            const match = avatarImg.src.match(/\/([0-9a-fA-F]{6})\//);
            const avatarColor = match ? match[1] : '2c2f33'; // Default color if regex fails
            avatarImg.src = `https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}`;
            // Update avatar title to include the new name
            const statusTitle = avatarImg.title.split(' - ').pop() || '状态未知'; // Try to preserve status part of title
            avatarImg.title = `${nameEscaped} (${peerId}) - ${statusTitle}`;
        }
        console.log(`Updated contact name UI for ${peerId} to ${nameEscaped}`);
    } else {
        console.warn(`Contact element not found for peerId: ${peerId} during name UI update.`);
    }
}

// --- NEW: Function to add a single contact item to the list ---
/**
 * Adds a single confirmed contact item to the UI list in alphabetical order.
 * @param {object} contact The contact object { id, name, online }.
 */
export function addContactToList(contact) {
    if (!dom.contactsListContainer) return;

    const newElement = createContactItemElement(contact);
    if (!newElement) return;

    let confirmedContactsContainer = dom.contactsListContainer.querySelector('#confirmed-contacts');

    // If the confirmed contacts section doesn't exist, create it
    if (!confirmedContactsContainer) {
        confirmedContactsContainer = document.createElement('div');
        confirmedContactsContainer.id = 'confirmed-contacts';
        confirmedContactsContainer.innerHTML = `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">好友</h3>`;
        // Insert it before pending requests if they exist, otherwise append
        const firstRequestSection = dom.contactsListContainer.querySelector('#pending-incoming-requests, #pending-outgoing-requests');
        if (firstRequestSection) {
             dom.contactsListContainer.insertBefore(confirmedContactsContainer, firstRequestSection);
        } else {
             dom.contactsListContainer.appendChild(confirmedContactsContainer);
        }
        // Remove potential "empty" message
        const emptyMsg = dom.contactsListContainer.querySelector('p.text-discord-text-muted');
        if (emptyMsg) emptyMsg.remove();
    }

    // Find the correct position to insert the new element alphabetically
    const existingContactElements = confirmedContactsContainer.querySelectorAll('.contact-item.confirmed-contact');
    let inserted = false;
    for (const existingElement of existingContactElements) {
        const existingName = existingElement.querySelector('.contact-name').textContent;
        const newName = newElement.querySelector('.contact-name').textContent;
        if (newName.localeCompare(existingName) < 0) {
            confirmedContactsContainer.insertBefore(newElement, existingElement);
            inserted = true;
            break;
        }
    }

    // If not inserted (it's the last one alphabetically or the only one), append it
    if (!inserted) {
        confirmedContactsContainer.appendChild(newElement);
    }

    console.log(`Added contact ${contact.id} to UI list.`);
}

// --- Initialization ---
export function initializeUI() {
    console.log("Initializing UI...");
    // Initial render (will now include pending requests)
    renderContactList();
    // Set initial empty state message
    updateEmptyState();
    // Display local user info
    displayLocalUserInfo();
    // Set initial chat input visibility (hidden)
    updateChatInputVisibility(false);
    // Set initial chat header
     updateChatHeader(null);
    // Clear any leftover typing indicators
    hideActiveTypingIndicator();

    // Hide context menu initially
    hideContextMenu();

    console.log("UI Initialized.");
}

// Call initialization function once DOM is ready (usually done in main.js)
// initializeUI(); 

// --- NEW: Update Request Section Headers ---
/**
 * Updates the text content of the request section headers (H3 tags)
 * based on the current counts in the state. Removes sections if count is zero.
 * Also checks if the entire list becomes empty and shows a placeholder.
 */
function updateRequestSectionHeaders() {
    if (!dom.contactsListContainer) return;

    let listHasContent = false; // Flag to check if any section remains

    // Incoming Requests Section
    const incomingSection = dom.contactsListContainer.querySelector('#pending-incoming-requests');
    if (incomingSection) {
        const incomingCount = state.pendingIncomingRequests.size;
        if (incomingCount > 0) {
            const header = incomingSection.querySelector('h3');
            if (header) {
                header.textContent = `待处理的请求 - ${incomingCount}`;
            }
            listHasContent = true;
        } else {
            // If count is 0, remove the entire section
            incomingSection.remove();
        }
    }

    // Outgoing Requests Section
    const outgoingSection = dom.contactsListContainer.querySelector('#pending-outgoing-requests');
    if (outgoingSection) {
        const outgoingCount = state.pendingOutgoingRequests.size;
        if (outgoingCount > 0) {
            const header = outgoingSection.querySelector('h3');
            if (header) {
                header.textContent = `已发送的请求 - ${outgoingCount}`;
            }
            listHasContent = true;
        } else {
            // If count is 0, remove the entire section
            outgoingSection.remove();
        }
    }

    // Check if confirmed contacts section still exists
    if (dom.contactsListContainer.querySelector('#confirmed-contacts')) {
        listHasContent = true;
    }

    // If the list is now totally empty, show the placeholder message
    // Avoid adding duplicate empty messages
    if (!listHasContent && !dom.contactsListContainer.querySelector('p.text-discord-text-muted')) {
         dom.contactsListContainer.innerHTML = '<p class="text-discord-text-muted text-sm px-3 py-2">还没有联系人或请求。</p>';
    }
}
// --- END NEW ---
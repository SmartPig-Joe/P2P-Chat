// ui.js
import * as dom from './dom.js';
import * as state from './state.js';
import { escapeHTML, formatTime, mockUsers, getUserColorClass } from './utils.js';
import * as connection from './connection.js'; // Import connection to call loadAndDisplayHistory
import * as storage from './storage.js'; // Import storage for potential future use (e.g., removing contacts)

let selectedPeerId = null; // Track the currently selected contact in the UI

// --- Add this new exported function ---
/**
 * Returns the currently selected peer ID.
 * @returns {string | null}
 */
export function getSelectedPeerId() {
    return selectedPeerId;
}
// -------------------------------------

// --- UI Helper Functions ---

/**
 * Scrolls the message list to the bottom.
 */
export function scrollToBottom() {
    if (dom.messageList) {
        // Use setTimeout to ensure scrolling happens after DOM updates
        setTimeout(() => {
             dom.messageList.scrollTop = dom.messageList.scrollHeight;
        }, 0);
    }
}

/**
 * Clears text, system, and file messages from the message list UI.
 */
export function clearMessageList() {
    if (dom.messageList) {
        dom.messageList.innerHTML = ''; // Clear all messages
        updateEmptyState(); // Update the empty state indicator
    }
}

// --- Empty State ---
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    const hasMessages = dom.messageList.querySelector('.message-item') !== null;
    const hasSelectedContact = !!selectedPeerId;

    if (hasMessages) {
        dom.emptyMessageListDiv.classList.add('hidden');
    } else if (hasSelectedContact) {
        // No messages, but a contact is selected - show "no messages yet" state
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">forum</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">还没有消息</h3>
             <p class="text-sm">看起来这里很安静。开始对话或发送一个文件吧！</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    } else {
        // No contact selected - show initial "select contact" state
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">chat</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">选择联系人</h3>
             <p class="text-sm">从左侧选择一个联系人以查看聊天记录。</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
}

// --- Connection Status ---
export function updateConnectionStatus(statusText, statusType = 'neutral') {
    if (dom.connectionStatusSpan) {
        dom.connectionStatusSpan.textContent = statusText;
        let colorClass = 'text-discord-text-muted';
        if (statusType === 'success') colorClass = 'text-discord-green';
        else if (statusType === 'error') colorClass = 'text-discord-red';
        else if (statusType === 'progress') colorClass = 'text-yellow-400';
        dom.connectionStatusSpan.className = `text-xs ml-2 font-semibold ${colorClass}`;
    }

    // Update connect button state
    if (dom.connectButton) {
        dom.connectButton.disabled = state.isConnecting;
        if (state.isConnected) {
            dom.connectButton.textContent = '断开连接';
            dom.connectButton.dataset.action = 'disconnect';
            dom.connectButton.classList.remove('bg-discord-green', 'hover:bg-green-600');
            dom.connectButton.classList.add('bg-discord-red', 'hover:bg-red-600');
            if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = true;
        } else {
            dom.connectButton.textContent = '连接';
            dom.connectButton.dataset.action = 'connect';
            dom.connectButton.classList.remove('bg-discord-red', 'hover:bg-red-600');
            dom.connectButton.classList.add('bg-discord-green', 'hover:bg-green-600');
            // Enable input only if WS is connected
            if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = !(state.ws?.readyState === WebSocket.OPEN);
            // Enable button only if WS is connected AND not currently connecting
            dom.connectButton.disabled = !(state.ws?.readyState === WebSocket.OPEN) || state.isConnecting;
        }
    }

    // Update chat input visibility based on connection AND selected contact
    updateChatInputVisibility();

    // Update member list (if still used)
    populateMemberList();
}

// --- System Messages ---
export function addSystemMessage(text, isError = false) {
    const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
    const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
    if (dom.messageList) {
        dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
        scrollToBottom(); // Scroll after adding system message
    }
}

// --- Chat Messages ---
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return escapeHTML(text).replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

function createP2PMessageHTML(msgData) {
    const sender = msgData.isLocal ? (mockUsers.find(u => u.id === state.localUserId) || { name: state.localUserId || '我', avatar: '5865f2' })
                                   : (mockUsers.find(u => u.id === msgData.peerId) || { name: msgData.peerId || '远程用户', avatar: '99aab5' });
    const avatarColor = sender?.avatar || '5865f2';
    // Use sender's name for color class consistently
    const userColorClass = getUserColorClass(sender.name);
    const timeString = formatTime(new Date(msgData.timestamp));
    // Show lock icon only if the message is part of the currently active E2EE session
    const lockIcon = state.sharedKey && state.isConnected && msgData.peerId === state.remoteUserId
                     ? '<span class="material-symbols-outlined text-xs ml-1 text-discord-green align-middle" title="端到端加密">lock</span>' // Material lock icon
                     : '';

    return (
       `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(msgData.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                <p class="text-discord-text-primary text-sm message-content">${renderMessageContent(msgData.text)}</p>
            </div>
        </div>`
    );
}

export function addP2PMessageToList(msgData) {
    if (dom.messageList && msgData.peerId === selectedPeerId) { // Only add if the message belongs to the selected chat
        const messageElement = document.createElement('div');
        messageElement.innerHTML = createP2PMessageHTML(msgData);
        if (messageElement.firstElementChild) {
            dom.messageList.appendChild(messageElement.firstElementChild);
        }
        scrollToBottom();
        updateEmptyState();
    }
    // Ensure the peer is in the contacts list
    addContactToList(msgData.peerId);
}

// --- Typing Indicator ---
export function showTypingIndicator() {
    // Only show if the typing peer is the currently selected AND connected peer
    if (!dom.typingIndicator || !dom.typingUsersSpan || !state.isConnected || state.remoteUserId !== selectedPeerId) return;
    const remoteName = mockUsers.find(u => u.id === state.remoteUserId)?.name || state.remoteUserId || '对方';
    dom.typingUsersSpan.textContent = escapeHTML(remoteName);
    dom.typingIndicator.classList.remove('hidden');
    dom.typingIndicator.classList.add('flex');
    state.setPeerIsTyping(true);
}

export function hideTypingIndicator() {
    if (!dom.typingIndicator) return;
    dom.typingIndicator.classList.add('hidden');
    dom.typingIndicator.classList.remove('flex');
    state.setPeerIsTyping(false);
}

// --- File Messages ---
function createFileMessageHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    // Use peerId from fileInfo if available, otherwise assume current remoteUserId for sender display
    const peerIdForDisplay = fileInfo.peerId || (isLocal ? state.localUserId : state.remoteUserId);
    const sender = isLocal ? (mockUsers.find(u => u.id === state.localUserId) || { name: state.localUserId || '我', avatar: '5865f2' })
                           : (mockUsers.find(u => u.id === peerIdForDisplay) || { name: peerIdForDisplay || '远程用户', avatar: '99aab5' });

    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = getUserColorClass(sender.name);
    const timeString = formatTime(new Date(fileInfo.timestamp || Date.now()));
    const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    // Define icon classes using Material Symbols
    const fileIconClasses = "material-symbols-outlined text-3xl text-discord-text-muted flex-shrink-0"; // Adjust size if needed
    const downloadIconClasses = "material-symbols-outlined text-xl"; // Adjust size
    const checkIconClasses = "material-symbols-outlined text-xl text-discord-green"; // Adjust size

    let fileContentHTML;
    const isFailed = progress < 0; // Check for failure state

    if (isFailed) {
        // Failed state
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord opacity-60">
                <div class="flex items-center space-x-3">
                    <span class="material-symbols-outlined ${fileIconClasses}">description</span> <!-- File icon -->
                    <div class="flex-1 min-w-0">
                        <span class="text-discord-text-primary font-medium block truncate" title="${fileNameEscaped}">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-red">${fileSizeMB} MB - 传输失败</div>
                    </div>
                    <span class="material-symbols-outlined text-xl text-discord-red flex-shrink-0">error</span> <!-- Error icon -->
                </div>
            </div>`;
    } else if (downloadUrl) {
        // Receiver's completed state with download link
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord flex items-center space-x-3">
                <span class="material-symbols-outlined ${fileIconClasses}">description</span> <!-- File icon -->
                <div class="flex-1 min-w-0">
                    <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-link hover:underline font-medium block truncate" title="${fileNameEscaped}">${fileNameEscaped}</a>
                    <div class="text-xs text-discord-text-muted">${fileSizeMB} MB</div>
                </div>
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white" title="下载">
                    <span class="material-symbols-outlined ${downloadIconClasses}">download</span> <!-- Download icon -->
                </a>
            </div>`;
    } else if (isLocal && progress >= 1) {
        // Sender's completed state
         fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3">
                    <span class="material-symbols-outlined ${fileIconClasses}">description</span> <!-- File icon -->
                    <div class="flex-1 min-w-0">
                        <span class="text-discord-text-primary font-medium block truncate" title="${fileNameEscaped}">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已发送</div>
                    </div>
                     <span class="material-symbols-outlined ${checkIconClasses} flex-shrink-0">check_circle</span> <!-- Check icon -->
                </div>
            </div>`;
    } else {
        // Progress indicator state (sender or receiver)
        const progressPercent = Math.round(progress * 100);
        const statusText = isLocal ? '发送中...' : '接收中...';
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3 mb-1">
                     <span class="material-symbols-outlined ${fileIconClasses}">description</span> <!-- File icon -->
                    <div class="flex-1 min-w-0">
                        <span class="text-discord-text-primary font-medium block truncate" title="${fileNameEscaped}">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - ${statusText}</div>
                    </div>
                </div>
                <div class="w-full bg-discord-gray-1 rounded-full h-1.5 mt-1">
                    <div class="bg-discord-blurple h-1.5 rounded-full" style="width: ${progressPercent}%" id="progress-${transferId}"></div>
                </div>
            </div>`;
    }

    return (
       `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded" id="file-msg-${transferId}">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(fileInfo.timestamp || Date.now()).toLocaleString('zh-CN')}">${timeString}</span>
                </div>
                ${fileContentHTML}
            </div>
        </div>`
    );
}

export function addFileMessageToList(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    // Ensure peerId is associated with the fileInfo for correct display and contact list update
    const peerId = isLocal ? state.remoteUserId : (fileInfo.senderId || state.remoteUserId); // Assuming senderId might be added to fileInfo upon reception
    fileInfo.peerId = peerId; // Add peerId to fileInfo if not present

    if (dom.messageList && peerId === selectedPeerId) { // Only add/update if the file belongs to the selected chat
        const transferId = fileInfo.transferId;
        const existingElement = document.getElementById(`file-msg-${transferId}`);

        if (existingElement) {
            // Update existing message
            const newHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newHTML;
            const newElement = tempDiv.firstElementChild;
            if (newElement) {
                existingElement.replaceWith(newElement);
            }
        } else {
            // Add new message
            const messageHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = messageHTML;
            const newElement = tempDiv.firstElementChild;
            if (newElement) {
                dom.messageList.appendChild(newElement);
            }
        }
        scrollToBottom();
        updateEmptyState();
    }
    // Ensure the peer is in the contacts list
    if (peerId) { // Make sure we have a peerId before adding
        addContactToList(peerId);
    }
}

// --- Member List (Right Sidebar - Keep or Remove?) ---
export function toggleMemberList() {
    if (dom.memberListSidebar) {
        dom.memberListSidebar.classList.toggle('hidden');
        dom.memberListToggleButton?.classList.toggle('text-white');
    }
}

export function populateMemberList() {
    const onlineList = dom.memberListSidebar?.querySelector('#online-list-container');
    const offlineList = dom.memberListSidebar?.querySelector('#offline-list-container');
    if (!onlineList || !offlineList || !dom.onlineCountSpan || !dom.offlineCountSpan) {
        // console.warn("Member list elements not found for population.");
        return; // Silently return if sidebar isn't present
    }
    onlineList.innerHTML = '';
    offlineList.innerHTML = '';
    let onlineCount = 0;
    let offlineCount = 0;

    // Update local user info in bottom-left and mock list
    const localUser = mockUsers.find(u => u.id === state.localUserId) || mockUsers[0];
    localUser.id = state.localUserId; // Ensure ID is correct
    localUser.name = state.localUserId; // Use ID as name for now
    localUser.status = 'online'; // Local user is always online in their view
    if (dom.localUsernameSpan) dom.localUsernameSpan.textContent = localUser.name;
    if (dom.localUserTagSpan) dom.localUserTagSpan.textContent = `#${state.localUserId.slice(-4)}`; // Example tag
    if (dom.localUserAvatar) {
        dom.localUserAvatar.src = `https://placehold.co/32x32/${localUser.avatar}/ffffff?text=${escapeHTML(localUser.name.charAt(0).toUpperCase())}`;
        dom.localUserAvatar.alt = `${escapeHTML(localUser.name)} 头像`;
    }
     if (dom.localUserStatusIndicator) dom.localUserStatusIndicator.className = `absolute bottom-0 right-0 block h-3 w-3 bg-discord-green border-2 border-discord-gray-1/80 rounded-full`;

    // Update remote user status in the mock list
    const remoteMockUserIndex = mockUsers.findIndex(u => u.id === state.remoteUserId);
    if (remoteMockUserIndex !== -1) {
        mockUsers[remoteMockUserIndex].status = state.isConnected ? 'online' : 'offline';
    }

    // Filter mock users to only include local and connected remote (or keep all for demo?)
    // Let's keep all mock users for now, updating their status
    mockUsers.forEach(user => {
        // Determine status based on connection state if it's the remote user
        const isUserOnline = user.id === state.localUserId || (user.id === state.remoteUserId && state.isConnected);
        user.status = isUserOnline ? 'online' : 'offline'; // Update status in mock data

        const statusIndicatorClass = isUserOnline ? 'bg-discord-green' : 'bg-gray-500';
        const listToAdd = isUserOnline ? onlineList : offlineList;
        const opacityClass = isUserOnline ? '' : 'opacity-50';
        const nameColorClass = user.colorClass || getUserColorClass(user.name);
        const userHTML = `
            <div class="flex items-center space-x-2 group cursor-pointer p-1 rounded-discord hover:bg-discord-gray-4 ${opacityClass}">
                <div class="relative">
                    <img src="https://placehold.co/32x32/${user.avatar}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}" alt="${escapeHTML(user.name)} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
                    <span class="absolute bottom-0 right-0 block h-3 w-3 ${statusIndicatorClass} border-2 border-discord-gray-2 rounded-full"></span>
                </div>
                <span class="text-sm ${nameColorClass} font-medium group-hover:text-white truncate" title="${escapeHTML(user.name)}">${escapeHTML(user.name)}</span>
            </div>`;
        listToAdd.innerHTML += userHTML;
        if (isUserOnline) onlineCount++;
        else offlineCount++;
    });

    dom.onlineCountSpan.textContent = onlineCount;
    dom.offlineCountSpan.textContent = offlineCount;
}

// --- Contacts List (Left Sidebar) ---

/**
 * Creates the HTML for a single contact item.
 * @param {string} peerId
 * @returns {string} HTML string for the contact item.
 */
function createContactItemHTML(peerId) {
    const user = mockUsers.find(u => u.id === peerId) || { name: peerId, avatar: '7289da' }; // Fallback avatar color
    const avatarColor = user.avatar;
    const displayName = escapeHTML(user.name);
    // Add online/offline status indicator based on current connection state? (Optional)
    const isConnectedPeer = state.isConnected && state.remoteUserId === peerId;
    const statusIndicatorHTML = isConnectedPeer
        ? `<span class="absolute bottom-0 left-5 block h-2.5 w-2.5 bg-discord-green border border-discord-gray-2 rounded-full"></span>`
        : ''; // No indicator if not connected to this specific peer

    return `
        <a href="#" data-peer-id="${peerId}" class="contact-item group flex items-center px-2 py-1.5 text-discord-text-muted hover:bg-discord-gray-4 hover:text-discord-text-primary rounded-discord relative">
            <div class="relative mr-2 flex-shrink-0">
                <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}" alt="${displayName} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
                ${statusIndicatorHTML}
            </div>
            <span class="contact-name truncate flex-1">${displayName}</span>
            <!-- Optional: Add close/remove button -->
            <!-- <button class="remove-contact-btn material-symbols-outlined ml-auto text-xs opacity-0 group-hover:opacity-100 text-discord-red hover:text-red-400" title="移除聊天记录">close</button> -->
        </a>
    `;
}

/**
 * Populates the contacts list in the left sidebar.
 * @param {string[]} peerIds - Array of peer IDs to display.
 */
export function populateContactsList(peerIds) {
    if (!dom.contactsListContainer) return;
    dom.contactsListContainer.innerHTML = ''; // Clear existing list
    if (!peerIds || peerIds.length === 0) {
        dom.contactsListContainer.innerHTML = '<p class="text-xs text-discord-text-muted px-2 py-4 text-center">还没有聊天记录</p>';
        return;
    }
    peerIds.forEach(peerId => {
        // Avoid adding self to the contact list
        if (peerId !== state.localUserId) {
            dom.contactsListContainer.insertAdjacentHTML('beforeend', createContactItemHTML(peerId));
        }
    });
    // Re-apply selected state if a contact was previously selected
    if (selectedPeerId) {
        const selectedItem = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${selectedPeerId}"]`);
        selectedItem?.classList.add('active', 'bg-discord-gray-5', 'text-discord-text-primary');
    }
}

/**
 * Adds a single contact to the list if not already present.
 * @param {string} peerId
 */
export function addContactToList(peerId) {
    if (!dom.contactsListContainer || !peerId || peerId === state.localUserId) return;
    // Check if the contact already exists
    if (!dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`)) {
        // Remove the "no history" message if it exists
        const noHistoryMsg = dom.contactsListContainer.querySelector('p.text-center');
        if (noHistoryMsg) noHistoryMsg.remove();
        // Add the new contact item
        dom.contactsListContainer.insertAdjacentHTML('beforeend', createContactItemHTML(peerId));
    }
     // Update status indicator if this peer is the currently connected one
     updateContactStatusIndicator(peerId);
}

/**
 * Updates the visual status indicator for a contact item.
 * @param {string} peerId
 */
function updateContactStatusIndicator(peerId) {
    if (!dom.contactsListContainer || !peerId) return;
    const contactItem = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (!contactItem) return;

    const isConnectedPeer = state.isConnected && state.remoteUserId === peerId;
    let indicator = contactItem.querySelector('.absolute.bottom-0'); // Find existing indicator

    if (isConnectedPeer && !indicator) {
        // Add indicator if connected and not present
        const imgDiv = contactItem.querySelector('.relative.mr-2');
        if (imgDiv) {
            imgDiv.insertAdjacentHTML('beforeend', `<span class="absolute bottom-0 left-5 block h-2.5 w-2.5 bg-discord-green border border-discord-gray-2 rounded-full"></span>`);
        }
    } else if (!isConnectedPeer && indicator) {
        // Remove indicator if not connected and present
        indicator.remove();
    }
}

/**
 * Sets the currently selected contact, updates UI styles, and loads history.
 * @param {string | null} peerId - The peer ID to select, or null to deselect.
 */
export async function setSelectedContact(peerId) {
    const previouslySelectedId = selectedPeerId;
    selectedPeerId = peerId; // Update the global selectedPeerId

    // Remove active class from previously selected item
    if (previouslySelectedId && dom.contactsListContainer) {
        const prevItem = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${previouslySelectedId}"]`);
        prevItem?.classList.remove('active', 'bg-discord-gray-5', 'text-discord-text-primary');
    }

    // Clear message list and update header/input area
    clearMessageList();
    if (peerId) {
        const contactItem = dom.contactsListContainer?.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
        if (contactItem) {
            contactItem.classList.add('active', 'bg-discord-gray-5', 'text-discord-text-primary');
        }
        updateChatUIForContact(peerId); // Update header, input visibility etc.
        try {
            // Load history for the selected contact
            await connection.loadAndDisplayHistory(peerId);
        } catch (error) {
            console.error(`Error loading history for ${peerId}:`, error);
            addSystemMessage(`加载 ${peerId} 的聊天记录失败。`, true);
        }
    } else {
        // No contact selected
        updateChatUIForContact(null);
    }
    updateEmptyState(); // Update empty state based on selection and messages
}

/**
 * Updates the main chat area header and input visibility based on the selected contact.
 * @param {string | null} peerId
 */
function updateChatUIForContact(peerId) {
    if (dom.channelNameHeader) {
        if (peerId) {
            const user = mockUsers.find(u => u.id === peerId) || { name: peerId };
            dom.channelNameHeader.textContent = escapeHTML(user.name);
            dom.channelNameHeader.previousElementSibling.textContent = 'alternate_email'; // Show @ icon
        } else {
            dom.channelNameHeader.textContent = '选择联系人开始聊天';
            dom.channelNameHeader.previousElementSibling.textContent = 'chat'; // Show chat icon
        }
    }
    updateChatInputVisibility();
    // Hide typing indicator if the selected contact changes
    hideTypingIndicator();
}

/**
 * Updates the visibility of the chat input area based on connection and selection.
 */
export function updateChatInputVisibility() {
    // --- 添加调试日志 ---
    console.log(
        '[Debug] updateChatInputVisibility Check:',
        'isConnected:', state.isConnected,
        'remoteUserId:', state.remoteUserId,
        'selectedPeerId:', selectedPeerId,
        'sharedKey:', state.sharedKey ? 'Exists' : null // 只检查是否存在，不打印密钥本身
    );
    // --------------------

    // 输入框需要同时满足：已连接、连接的远程用户ID === 当前选中的用户ID、共享密钥已建立
    const shouldShowInput = state.isConnected && state.remoteUserId === selectedPeerId && state.sharedKey;
    if (dom.chatInputArea) {
        if (shouldShowInput) {
            console.log('[Debug] updateChatInputVisibility: Enabling input area...'); // 添加日志
            dom.chatInputArea.classList.remove('hidden');
            console.log(`[Debug] chatInputArea classes after remove hidden: ${dom.chatInputArea.className}`); // 添加日志
            if (dom.messageInput) {
                console.log('[Debug] updateChatInputVisibility: Setting input placeholder and enabling.'); // 添加日志
                dom.messageInput.placeholder = `给 ${escapeHTML(selectedPeerId || '')} 发送消息`;
                dom.messageInput.disabled = false;
                 console.log(`[Debug] messageInput disabled state: ${dom.messageInput.disabled}`); // 添加日志
            }
            if (dom.uploadButton) {
                 console.log('[Debug] updateChatInputVisibility: Enabling upload button.'); // 添加日志
                 dom.uploadButton.disabled = false;
                 console.log(`[Debug] uploadButton disabled state: ${dom.uploadButton.disabled}`); // 添加日志
            }
        } else {
            console.log('[Debug] updateChatInputVisibility: Hiding input area and disabling input.'); // 添加日志
            dom.chatInputArea.classList.add('hidden');
            if (dom.messageInput) {
                dom.messageInput.placeholder = `发送消息`; // Reset placeholder
                dom.messageInput.disabled = true;
            }
            if (dom.uploadButton) dom.uploadButton.disabled = true;
        }
    }
}

/**
 * Handles clicks on contact items in the list.
 * @param {Event} event
 */
export function handleContactClick(event) {
    const targetItem = event.target.closest('.contact-item');
    if (!targetItem) return; // Click wasn't on a contact item

    event.preventDefault(); // Prevent default link behavior

    const peerId = targetItem.dataset.peerId;
    if (peerId && peerId !== selectedPeerId) { // Only act if a different contact is clicked
        setSelectedContact(peerId);
    }
    // Handle remove button click (optional)
    // if (event.target.classList.contains('remove-contact-btn')) {
    //     const peerIdToRemove = targetItem.dataset.peerId;
    //     console.log("Remove contact:", peerIdToRemove);
    //     // Implement logic to remove chat history and the item from the list
    // }
}

// --- Contact Status ---
export function updateContactStatus(peerId) {
    if (!peerId || !dom.contactsListContainer) return;
    
    const contactElement = dom.contactsListContainer.querySelector(`[data-peer-id="${peerId}"]`);
    if (!contactElement) return;

    // 根据连接状态更新联系人状态
    if (state.isConnected && state.remoteUserId === peerId) {
        // 当前连接的联系人
        contactElement.classList.add('bg-discord-gray-4');
        contactElement.classList.remove('text-discord-text-muted');
        contactElement.classList.add('text-discord-text-primary');
    } else if (state.isConnecting && state.remoteUserId === peerId) {
        // 正在连接的联系人
        contactElement.classList.add('bg-discord-gray-4/50');
        contactElement.classList.remove('text-discord-text-muted');
        contactElement.classList.add('text-yellow-400');
    } else {
        // 未连接的联系人
        contactElement.classList.remove('bg-discord-gray-4', 'bg-discord-gray-4/50');
        contactElement.classList.remove('text-yellow-400');
        contactElement.classList.add('text-discord-text-muted');
        contactElement.classList.remove('text-discord-text-primary');
    }
} 
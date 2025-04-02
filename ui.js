// --- DOM Element References ---
// Encapsulate DOM elements for easier access and potential refactoring
export const elements = {
    channelLinks: () => document.querySelectorAll('.channel-link'),
    messageInput: () => document.getElementById('message-input'),
    messageList: () => document.getElementById('message-list'),
    channelNameHeader: () => document.getElementById('channel-name'),
    typingIndicator: () => document.getElementById('typing-indicator'),
    typingUsersSpan: () => document.getElementById('typing-users'),
    memberListSidebar: () => document.getElementById('member-list-sidebar'),
    memberListToggleButton: () => document.getElementById('member-list-toggle-button'),
    onlineCountSpan: () => document.getElementById('online-count'),
    offlineCountSpan: () => document.getElementById('offline-count'),
    connectionStatusSpan: () => document.getElementById('connection-status'),
    localUserIdSpan: () => document.getElementById('local-user-id'),
    remoteUserIdInput: () => document.getElementById('remote-user-id-input'),
    connectButton: () => document.getElementById('connect-button'),
    chatInputArea: () => document.querySelector('.px-4.pb-4'),
    uploadButton: () => document.getElementById('upload-button'),
    fileInput: () => document.getElementById('file-input'),
    emptyMessageListDiv: () => document.getElementById('empty-message-list')
};

// --- State Dependencies (Set via initializeUI) ---
let state = {
    getRemoteUserId: () => null,
    getIsConnected: () => false,
    getIsConnecting: () => false,
    getSharedKey: () => null,
    getLocalUserId: () => 'unknown',
    getMockUsers: () => [],
    isWebSocketConnected: () => false
};

/**
 * Initializes the UI module with functions to access application state.
 * @param {object} config - Configuration object containing state accessors.
 */
export function initializeUI(config) {
    state = { ...state, ...config };
    console.log("UI module initialized.");
}

// --- UI Helper Functions ---
export function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%?=~_|])/ig;
    return escapeHTML(text).replace(urlRegex, function(url) {
        // Basic check to avoid long data URLs in links if desired
        if (url.length > 100 && url.startsWith('data:')) {
            return '[data URL]';
        }
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${escapeHTML(url)}</a>`;
    });
}

export function getUserColorClass(username) {
    const user = state.getMockUsers().find(u => u.name === username);
    if (user && user.colorClass) return user.colorClass;
    // Consistent hashing for color assignment
    const colors = ['text-white', 'text-green-400', 'text-red-400', 'text-yellow-400', 'text-blue-400', 'text-purple-400', 'text-pink-400'];
    let hash = 0;
    if (!username) return colors[0];
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    return colors[Math.abs(hash % colors.length)];
}

export function formatTime(date) {
    if (!(date instanceof Date)) date = new Date(date); // Ensure it's a Date object
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- Core UI Update Functions ---

export function updateConnectionStatus(statusText, statusType = 'neutral') {
    const span = elements.connectionStatusSpan();
    const button = elements.connectButton();
    const input = elements.remoteUserIdInput();
    const chatArea = elements.chatInputArea();

    if (span) {
        span.textContent = statusText;
        let colorClass = 'text-discord-text-muted';
        if (statusType === 'success') colorClass = 'text-discord-green';
        else if (statusType === 'error') colorClass = 'text-discord-red';
        else if (statusType === 'progress') colorClass = 'text-yellow-400';
        span.className = `text-xs ml-2 font-semibold ${colorClass}`;
    }

    const isP2PConnected = state.getIsConnected();
    const isE2EE = state.getSharedKey() !== null;
    const isWsConn = state.isWebSocketConnected();
    const isAppConnecting = state.getIsConnecting();

    if (chatArea) {
        chatArea.style.display = isP2PConnected && isE2EE ? '' : 'none';
    }

    if (button) {
        button.disabled = isAppConnecting; // Disable if actively trying to connect
        if (isP2PConnected) {
            button.textContent = '断开连接';
            button.dataset.action = 'disconnect';
            button.classList.remove('bg-discord-green', 'hover:bg-green-600');
            button.classList.add('bg-discord-red', 'hover:bg-red-600');
            if (input) input.disabled = true;
        } else {
            button.textContent = '连接';
            button.dataset.action = 'connect';
            button.classList.remove('bg-discord-red', 'hover:bg-red-600');
            button.classList.add('bg-discord-green', 'hover:bg-green-600');
             // Enable connect button only if WS is up AND not already connecting P2P
            button.disabled = !isWsConn || isAppConnecting;
            if (input) input.disabled = !isWsConn || isAppConnecting;
        }
    }

    // Update member list to reflect potential status change
    populateMemberList();
}

export function addSystemMessage(text, isError = false) {
    const msgList = elements.messageList();
    if (!msgList) return;
    const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
    const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
    msgList.insertAdjacentHTML('beforeend', messageHTML);
    msgList.scrollTop = msgList.scrollHeight;
    updateEmptyState(); // Check if list is no longer empty
}

export function createP2PMessageHTML(msgData) {
    const remoteUserId = state.getRemoteUserId();
    const mockUsers = state.getMockUsers();
    const sharedKey = state.getSharedKey();

    const sender = msgData.isLocal
        ? mockUsers[0] // Assume local user is always first in mockUsers
        : (mockUsers.find(u => u.id === remoteUserId) || { name: remoteUserId || '远程用户', avatar: '99aab5' });

    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = msgData.isLocal ? getUserColorClass(sender.name) : 'text-yellow-400'; // Example color for remote
    const timeString = formatTime(msgData.timestamp);
    const lockIcon = sharedKey ? '<span class="lucide text-xs ml-1 text-discord-green" title="端到端加密">&#xe297;</span>' : '';

    return (
        `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name?.charAt(0).toUpperCase() || '?')}" alt="${escapeHTML(sender.name || 'User')} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name || 'User')}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name || 'User')}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(msgData.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                <p class="text-discord-text-primary text-sm message-content">${renderMessageContent(msgData.text)}</p>
            </div>
        </div>`
    );
}

export function addP2PMessageToList(msgData) {
    const msgList = elements.messageList();
    if (!msgList) return;
    const messageElement = document.createElement('div');
    // createP2PMessageHTML returns a string, so set innerHTML
    messageElement.innerHTML = createP2PMessageHTML(msgData);
    // Append the actual message element, not the temporary div
    if (messageElement.firstElementChild) {
        msgList.appendChild(messageElement.firstElementChild);
    }
    msgList.scrollTop = msgList.scrollHeight;
    updateEmptyState();
}

export function updateEmptyState() {
    const msgList = elements.messageList();
    const emptyDiv = elements.emptyMessageListDiv();
    if (!msgList || !emptyDiv) return;
    const hasMessages = msgList.querySelector('.message-item') !== null;
    emptyDiv.classList.toggle('hidden', hasMessages);
    // Ensure flex properties are set correctly if it becomes visible
    if (!hasMessages) {
        emptyDiv.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    }
}

export function showTypingIndicator() {
    const indicator = elements.typingIndicator();
    const usersSpan = elements.typingUsersSpan();
    const remoteUserId = state.getRemoteUserId();
    const mockUsers = state.getMockUsers();

    if (!indicator || !usersSpan || !state.getIsConnected()) return; // Don't show if disconnected

    const remoteName = mockUsers.find(u => u.id === remoteUserId)?.name || remoteUserId || '对方';
    usersSpan.textContent = escapeHTML(remoteName);
    indicator.classList.remove('hidden');
    indicator.classList.add('flex'); // Ensure flex display for alignment
}

export function hideTypingIndicator() {
    const indicator = elements.typingIndicator();
    if (!indicator) return;
    indicator.classList.add('hidden');
    indicator.classList.remove('flex');
}

// --- File Transfer UI Functions ---

export function createFileMessageHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    const remoteUserId = state.getRemoteUserId();
    const mockUsers = state.getMockUsers();

    const sender = isLocal
        ? mockUsers[0] // Assume local user is first
        : (mockUsers.find(u => u.id === remoteUserId) || { name: remoteUserId || '远程用户', avatar: '99aab5' });

    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = isLocal ? getUserColorClass(sender.name) : 'text-yellow-400';
    const timeString = formatTime(fileInfo.timestamp || Date.now());
    const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    let fileContentHTML;
    if (downloadUrl) {
        // Completed download state
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord flex items-center space-x-3">
                <span class="material-symbols-outlined text-3xl text-discord-text-muted mr-2">description</span> <!-- File icon -->
                <div class="flex-1">
                    <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-link hover:underline font-medium">${fileNameEscaped}</a>
                    <div class="text-xs text-discord-text-muted">${fileSizeMB} MB</div>
                </div>
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white" title="下载">
                    <span class="material-symbols-outlined text-xl">download</span> <!-- Download icon -->
                </a>
            </div>`;
    } else if (isLocal && progress >= 1) {
        // Sender completed state
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3">
                    <span class="material-symbols-outlined text-3xl text-discord-text-muted mr-2">description</span>
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已发送</div>
                    </div>
                     <span class="material-symbols-outlined text-xl text-discord-green">check_circle</span> <!-- Check icon -->
                </div>
            </div>`;
    } else {
        // Progress indicator state
        const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100))); // Clamp progress
        const statusText = isLocal ? '发送中...' : '接收中...';
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3 mb-1">
                    <span class="material-symbols-outlined text-3xl text-discord-text-muted mr-2">description</span>
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - ${statusText}</div>
                    </div>
                     ${progress < 1 ? '<button class="text-discord-text-muted hover:text-discord-red text-xs" title="取消"><span class="material-symbols-outlined text-base">cancel</span></button>' : ''} <!-- TODO: Add cancel functionality -->
                 </div>
                <div class="w-full bg-discord-gray-1 rounded-full h-1.5">
                    <div class="bg-discord-blurple h-1.5 rounded-full transition-width duration-150 ease-linear" style="width: ${progressPercent}%" id="progress-${transferId}"></div>
                </div>
            </div>`;
    }

    // Main message structure
    return (
        `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded" id="file-msg-${transferId}">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name?.charAt(0).toUpperCase() || '?')}" alt="${escapeHTML(sender.name || 'User')} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name || 'User')}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name || 'User')}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(fileInfo.timestamp || Date.now()).toLocaleString('zh-CN')}">${timeString}</span>
                 </div>
                ${fileContentHTML}
            </div>
        </div>`
    );
}

export function addFileMessageToList(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    const msgList = elements.messageList();
    if (!msgList) return;

    const transferId = fileInfo.transferId;
    const existingElement = document.getElementById(`file-msg-${transferId}`);
    const messageHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);

    if (existingElement) {
        // More efficient update: Replace only the inner content if structure is similar?
        // For simplicity now, just replace the whole element.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = messageHTML;
        if (tempDiv.firstElementChild) {
             existingElement.replaceWith(tempDiv.firstElementChild);
        }
    } else {
        // Add new message element
        msgList.insertAdjacentHTML('beforeend', messageHTML);
    }

    // Scroll only if near the bottom or adding a new message?
    // Simple approach: always scroll
    msgList.scrollTop = msgList.scrollHeight;
    updateEmptyState();
}

// --- Member List Functions ---

export function toggleMemberList() {
    const sidebar = elements.memberListSidebar();
    const toggleButton = elements.memberListToggleButton();
    if (sidebar) {
        sidebar.classList.toggle('hidden');
        // Optional: Indicate active state on button
        toggleButton?.classList.toggle('text-white', !sidebar.classList.contains('hidden'));
    }
}

export function populateMemberList() {
    const sidebar = elements.memberListSidebar();
    if (!sidebar) return; // Don't try if sidebar doesn't exist

    const onlineList = sidebar.querySelector('#online-list-container'); // Use specific IDs
    const offlineList = sidebar.querySelector('#offline-list-container');
    const onlineCountSpan = elements.onlineCountSpan();
    const offlineCountSpan = elements.offlineCountSpan();

    if (!onlineList || !offlineList || !onlineCountSpan || !offlineCountSpan) {
        console.warn("Member list inner elements not found for population.");
        return;
    }

    onlineList.innerHTML = ''; // Clear previous entries
    offlineList.innerHTML = '';

    let onlineCount = 0;
    let offlineCount = 0;

    const mockUsers = state.getMockUsers();
    const localUserId = state.getLocalUserId();
    const remoteUserId = state.getRemoteUserId();
    const isP2PConnected = state.getIsConnected();

    // Ensure local user is always in the list and online
    let localUserData = mockUsers.find(u => u.id === localUserId);
    if (!localUserData) {
         // Add placeholder if local user isn't in mock data (should be)
         localUserData = { id: localUserId, name: localUserId, avatar: '7289da', status: 'online' };
         mockUsers[0] = localUserData; // Ensure mockUsers[0] IS local user
    } else {
        localUserData.status = 'online'; // Always show local as online
    }

    // Update remote user status based on P2P connection
    const remoteMockUser = mockUsers.find(u => u.id === remoteUserId);
    if (remoteMockUser) {
        remoteMockUser.status = isP2PConnected ? 'online' : 'offline';
    }

    mockUsers.forEach(user => {
        const isOnline = user.status === 'online';
        const listToAdd = isOnline ? onlineList : offlineList;
        const statusIndicatorClass = isOnline ? 'bg-discord-green' : 'bg-gray-500';
        const opacityClass = isOnline ? '' : 'opacity-50';
        const nameColorClass = user.colorClass || getUserColorClass(user.name);

        const userHTML = `
            <div class="flex items-center space-x-2 group cursor-pointer p-1 rounded-discord hover:bg-discord-gray-4 ${opacityClass}">
                <div class="relative">
                    <img src="https://placehold.co/32x32/${user.avatar || '7289da'}/ffffff?text=${escapeHTML(user.name?.charAt(0).toUpperCase() || '?')}" alt="${escapeHTML(user.name || 'User')} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
                    <span class="absolute bottom-0 right-0 block h-3 w-3 ${statusIndicatorClass} border-2 border-discord-gray-2 rounded-full"></span>
                </div>
                <span class="text-sm ${nameColorClass} font-medium group-hover:text-white truncate" title="${escapeHTML(user.name || 'User')}">${escapeHTML(user.name || 'User')}</span>
            </div>`;

        listToAdd.innerHTML += userHTML;
        if (isOnline) onlineCount++;
        else offlineCount++;
    });

    onlineCountSpan.textContent = onlineCount;
    offlineCountSpan.textContent = offlineCount;
}

/**
 * Sets the initial state of the UI on page load.
 */
export function setupInitialUI() {
     const localId = state.getLocalUserId();
     const localSpan = elements.localUserIdSpan();
     if (localSpan) {
         localSpan.textContent = localId;
     } else {
         console.warn("local-user-id span not found in HTML");
     }

     // Disable channel links (as they are not implemented)
     const chanLinks = elements.channelLinks();
     if (chanLinks.length > 0) {
         chanLinks.forEach(link => {
             link.style.opacity = '0.5';
             link.style.pointerEvents = 'none';
         });
         addSystemMessage("频道切换已禁用，请使用上方连接功能。");
     }

     // Initial population of member list
     populateMemberList();

     // Hide member list on small screens initially
     const sidebar = elements.memberListSidebar();
     if (sidebar && window.innerWidth < 768) {
         sidebar.classList.add('hidden');
     }

     // Show empty state message initially
     updateEmptyState();

     // Initial connection status
     updateConnectionStatus("未连接", 'neutral');
} 
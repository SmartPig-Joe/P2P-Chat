// dom.js

// --- DOM 元素引用 ---
// export const channelLinks = document.querySelectorAll('.channel-link'); // Removed
export const contactsListContainer = document.getElementById('contacts-list-container'); // Added
export const messageInput = document.getElementById('message-input');
export const messageList = document.getElementById('message-list');
// export const channelNameHeader = document.getElementById('channel-name'); // Use chatHeaderName instead
export const typingIndicator = document.getElementById('typing-indicator');
export const typingUsersSpan = document.getElementById('typing-users');
// export const memberListSidebar = document.getElementById('member-list-sidebar'); // Removed - not used
// export const memberListToggleButton = document.getElementById('member-list-toggle-button'); // Removed - not used
// export const onlineCountSpan = document.getElementById('online-count'); // Removed - not used
// export const offlineCountSpan = document.getElementById('offline-count'); // Removed - not used
// export const connectionStatusSpan = document.getElementById('connection-status'); // Removed - not used
export const localUserIdSpan = document.getElementById('local-user-id-display');
export const localUserInfoDiv = document.getElementById('local-user-info');
// export const remoteUserIdInput = document.getElementById('remote-user-id-input'); // Removed - not used
// export const connectButton = document.getElementById('connect-button'); // Removed - not used
// export const chatInputArea = document.querySelector('.chat-input-area'); // Updated selector // REMOVE THIS LINE
export const chatInputContainer = document.getElementById('chat-input-container'); // CORRECT: Get by ID
export const uploadButton = document.getElementById('upload-button');
export const fileInput = document.getElementById('file-input');
export const emptyMessageListDiv = document.getElementById('empty-message-list');
// Add references for add contact elements
export const addContactButton = document.getElementById('add-contact-button');
export const addContactInput = document.getElementById('add-contact-input');
export const addContactNameInput = document.getElementById('add-contact-name-input'); // Optional name input reference added
// Add references for user info at bottom-left if needed for dynamic updates
export const localUsernameDiv = document.querySelector('.local-username'); // Changed selector name
export const localUserTagDiv = document.querySelector('.local-usertag'); // Changed selector name
export const userAvatarSmall = document.querySelector('.user-avatar-small'); // Changed selector name
export const userStatusIndicator = document.querySelector('.user-status-indicator'); // Changed selector name
export const contactContextMenu = document.getElementById('contact-context-menu'); // 新增：联系人右键菜单
export const chatHeaderName = document.getElementById('chat-header-name'); // Reference for chat header name
export const chatHeaderStatus = document.getElementById('chat-header-status'); // Reference for chat header status
export const chatInput = document.getElementById('message-input'); // Exporting messageInput as chatInput as well for clarity/potential refactor 
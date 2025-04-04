# P2P-Chat: 一个基于 WebRTC 的端到端加密聊天应用

这是一个使用纯 Web 技术（HTML, CSS, JavaScript）构建的点对点（P2P）聊天应用程序，其界面风格模仿了 Discord。它通过 WebRTC 建立直接连接，并使用 Web Crypto API 实现端到端加密 (E2EE)。

## 主要功能

*   **P2P 连接**: 使用 WebRTC `RTCPeerConnection` 在两个用户之间建立直接的数据通道。
*   **信令**: 通过 WebSocket 服务器交换 SDP（会话描述协议）和 ICE 候选者以建立连接。
*   **联系人管理**:
    *   发送和接收好友请求。
    *   接受或拒绝好友请求。
    *   将好友添加到联系人列表。
    *   联系人信息（ID 和可选昵称）存储在本地浏览器存储中 (`localStorage`)。
*   **端到端加密 (E2EE)**:
    *   使用 `window.crypto.subtle` API。
    *   通过 ECDH (Elliptic-Curve Diffie-Hellman) 密钥交换算法（P-256 曲线）生成共享密钥。
    *   使用 AES-GCM (256位) 对所有文本聊天消息、**文件传输元数据**、**文件内容**和**打字状态**进行加密和解密。
*   **文本聊天**:
    *   发送和接收加密的文本消息。
    *   **聊天记录** (仅文本消息) **自动保存**到本地浏览器存储 (`localStorage`)，并在重新加载时**恢复**与已连接联系人的聊天记录。
*   **文件传输**:
    *   发送和接收**加密**的文件。
    *   文件被分块（默认为 16KB，可在 `constants.js` 中配置）传输以适应 DataChannel 的限制。
    *   显示发送和接收进度。
    *   接收方可以下载完整的文件。
    *   **文件传输元数据**（文件名、大小、类型）也经过加密。
*   **打字状态提示**: 向对方显示"正在输入..."的提示（加密传输）。
*   **类 Discord 界面**: 使用 Tailwind CSS 构建，模仿 Discord 的布局和颜色方案。
*   **连接状态**: 显示与信令服务器和对等方的连接状态（包括 ICE 状态和数据通道状态）。
*   **用户 ID**: 自动生成唯一的临时用户 ID (e.g., `user-xxxxxx`)。
*   **用户列表**: 显示本地用户和已添加的联系人及其在线状态。
*   **状态管理**: 使用专门的 `state.js` 模块集中管理应用状态。
*   **代码模块化**: 使用 ES6 模块将 JavaScript 代码拆分为多个文件（例如 `main.js`, `connection.js`, `crypto.js`, `ui.js`, `fileTransfer.js`, `storage.js` 等），提高了代码的可维护性。
*   **本地存储**: 使用 `localStorage` 持久化联系人列表和聊天记录。
*   **数据存储:** IndexedDB for client-side storage of messages and keys.

## 技术栈

*   **前端**: HTML5, CSS3, JavaScript (ES6+, Modules)
*   **UI 框架**: [Tailwind CSS](https://tailwindcss.com/)
*   **图标**: [Material Symbols (Outlined)](https://fonts.google.com/icons)
*   **P2P 通信**: WebRTC (`RTCPeerConnection`, `RTCDataChannel`)
*   **信令**: WebSocket
*   **加密**: Web Crypto API (ECDH, AES-GCM)
*   **本地存储**: `localStorage`

## 工作原理

1.  **启动与注册**:
    *   浏览器加载 `index.html`。
    *   JavaScript 模块 (`main.js` 作为入口) 启动，生成一个临时的本地用户 ID (e.g., `user-xxxxxx`)。
    *   客户端连接到预定义的 WebSocket 信令服务器 (在 `constants.js` 中配置) 并使用其用户 ID 进行注册。
    *   **加载本地数据**: 客户端从 `localStorage` 加载之前保存的联系人列表和聊天记录。
2.  **发起连接 (以添加联系人为例)**:
    *   用户 A 在"添加联系人"输入框中输入用户 B 的 ID，然后点击添加按钮。
    *   客户端 A 尝试通过信令服务器建立与用户 B 的 WebRTC 连接 (SDP Offer/Answer, ICE 交换)。
    *   连接建立后 (DataChannel 变为 `open`)，客户端 A **发送一个加密的 `friend_request` 消息** 给用户 B。
    *   客户端 A 在本地将用户 B 标记为"待发送请求"状态。
3.  **处理好友请求**:
    *   客户端 B 收到加密的 `friend_request` 消息，解密后在 UI 中显示通知。
    *   用户 B 可以选择接受或拒绝。
    *   如果接受，客户端 B **发送一个加密的 `friend_accept` 消息** 给用户 A，并将 A 添加到本地联系人列表（存储在 `localStorage`）。
    *   如果拒绝，客户端 B **发送一个加密的 `friend_decline` 消息**。
4.  **完成添加**:
    *   客户端 A 收到 `friend_accept` 或 `friend_decline` 消息。
    *   如果接受，客户端 A 将用户 B 添加到本地联系人列表（存储在 `localStorage`）。
    *   如果拒绝，客户端 A 更新 B 的状态。
5.  **建立聊天连接**:
    *   当用户 A 点击联系人列表中的用户 B 时，客户端 A 会检查是否已存在与 B 的 P2P 连接。
    *   如果不存在或已断开，则通过信令服务器重新发起 WebRTC 连接建立过程（Offer/Answer/ICE）。
    *   当 P2P 连接成功建立且 `RTCDataChannel` 状态变为 `open` 时，连接状态会更新。
6.  **端到端加密设置**:
    *   数据通道打开后，**如果之前没有为该对等方建立过共享密钥**，每个客户端会生成一个 ECDH 密钥对。
    *   客户端通过**加密的数据通道**交换各自的公钥。
    *   收到对方公钥后，每个客户端使用自己的私钥和对方的公钥通过 ECDH 派生出一个共享的 AES-GCM 对称密钥，并**将此密钥与对等方的 ID 关联存储**。
    *   如果之前已建立过密钥，则直接使用存储的密钥。
    *   加密建立完成，状态更新为 "E2EE"。
7.  **安全通信**:
    *   所有后续的文本消息、文件元信息、文件块和打字状态都使用**对应联系人的共享 AES-GCM 密钥**进行加密后，再通过 `RTCDataChannel` 发送。
    *   接收方使用相同的共享密钥解密收到的数据。
    *   发送的文本消息会**同时保存到 `localStorage`** 中与该联系人关联的聊天记录里。
    *   接收到的文本消息在解密后也会**保存到 `localStorage`**。
    *   加载聊天界面时，会从 `localStorage` **读取并显示**与当前选中联系人的历史消息。

## 如何运行

1.  **信令服务器**:
    *   此项目需要一个兼容的 WebSocket 信令服务器来协调 P2P 连接的建立。
    *   代码中使用的服务器地址在 `constants.js` 文件的 `SIGNALING_SERVER_URL` 常量中定义 (默认为 `wss://signal.smartpig.top/ws`)。
    *   **你需要运行自己的信令服务器实例，并将 `constants.js` 中的 `SIGNALING_SERVER_URL` 更新为你的服务器地址。** 一个简单的信令服务器示例 (`server/main.go`) 已包含在此仓库中。
2.  **客户端**:
    *   无需构建或安装。
    *   只需在支持 WebRTC 和 Web Crypto API 的现代浏览器（如 Chrome, Firefox, Edge）中直接打开 `index.html` 文件即可（需要通过 HTTP 服务器访问以支持 ES6 模块，例如使用 Live Server 扩展）。
    *   为了测试 P2P 功能，你需要在两个不同的浏览器标签页或窗口中打开此文件。

## 如何使用

1.  通过 HTTP 服务器（如 VS Code Live Server）在第一个浏览器窗口中打开 `index.html`。注意顶部栏显示的本地用户 ID（例如 `user-123456`）。
2.  同样，在第二个浏览器窗口中打开 `index.html`。注意其本地用户 ID（例如 `user-654321`）。
3.  在第一个窗口的"添加联系人"区域，输入第二个窗口的用户 ID (`user-654321`)，然后点击添加按钮。
4.  第二个窗口应收到好友请求通知。点击接受。
5.  现在两个窗口应该互相出现在对方的联系人列表中，状态显示为在线。
6.  点击联系人列表中的对方，连接状态应更新，最终显示为 "已连接到 [对方名称/ID] (E2EE)"。
7.  连接和加密建立后，底部的消息输入区域将出现。
8.  现在你可以开始发送加密的文本消息和文件了。关闭并重新打开页面后，联系人和聊天记录应该会被保留和恢复。

## 已知限制与未来可能改进

*   **信令服务器依赖**: 需要外部运行并正确配置信令服务器。
*   **错误处理**: 可以进一步增强错误处理和用户反馈，特别是在连接失败或存储错误时。
*   **无用户认证**: 任何知道用户 ID 的人都可以尝试连接并发起好友请求。
*   **扩展性**: 目前仅支持 1 对 1 聊天。
*   **文件传输 UI**: 文件传输进度条在某些情况下可能不够精确或平滑。
*   **无群组聊天**: 不支持多人聊天室。
*   **存储限制**: `localStorage` 有大小限制，大量聊天记录或非常大的联系人列表可能导致问题。
*   **密钥管理**: 共享密钥存储在内存中，并在建立连接时重新协商（如果需要），没有持久化存储密钥（这通常更安全，但意味着每次浏览器完全关闭后重新连接都需要重新进行密钥交换）。
*   **本地运行**: 由于使用了 ES6 模块，需要通过 HTTP 服务器（如 Live Server）运行 `index.html`，直接打开本地文件可能无法工作。

---

欢迎对此项目进行贡献或提出改进建议！

### 项目结构

```
.
├── index.html          # 主 HTML 文件
├── style.css           # 主 CSS 样式文件
├── README.md           # 项目说明文件
├── .gitattributes      # Git 属性文件
├── src/                # 核心逻辑代码目录
│   ├── connection.js   # WebSocket 连接管理
│   ├── crypto.js       # 加密/解密逻辑
│   ├── db.js           # IndexedDB 数据库操作
│   ├── dom.js          # DOM 操作辅助函数
│   ├── fileTransfer.js # 文件传输逻辑
│   ├── main.js         # 应用主入口和初始化
│   ├── state.js        # 应用状态管理
│   └── utils.js        # 通用辅助函数
├── ui/                 # 用户界面相关代码目录
│   ├── chatArea.js     # 聊天区域 UI 管理
│   ├── contactList.js  # 联系人列表 UI 管理
│   ├── contextMenu.js  # 右键菜单逻辑
│   ├── index.js        # UI 模块入口
│   ├── main.js         # UI 主逻辑
│   ├── messages.js     # 消息显示和管理
│   └── profile.js      # 用户资料 UI
├── fonts/              # 字体文件目录
├── server/             # 后端服务器代码目录
│   └── server.js       # WebSocket 服务器实现
└── .git/               # Git 仓库目录 (通常不包含在结构图中)
```

 

# P2P-Chat: 一个基于 WebRTC 的端到端加密聊天应用

这是一个使用纯 Web 技术（HTML, CSS, JavaScript）构建的点对点（P2P）聊天应用程序，其界面风格模仿了 Discord。它通过 WebRTC 建立直接连接，并使用 Web Crypto API 实现端到端加密 (E2EE)。

## 主要功能

*   **P2P 连接**: 使用 WebRTC `RTCPeerConnection` 在两个用户之间建立直接的数据通道。
*   **信令**: 通过 WebSocket 服务器交换 SDP（会话描述协议）和 ICE 候选者以建立连接。
*   **端到端加密 (E2EE)**:
    *   使用 `window.crypto.subtle` API。
    *   通过 ECDH (Elliptic-Curve Diffie-Hellman) 密钥交换算法（P-256 曲线）生成共享密钥。
    *   使用 AES-GCM (256位) 对所有聊天消息和文件传输元数据进行加密和解密。
*   **文本聊天**: 发送和接收加密的文本消息。
*   **文件传输**:
    *   发送和接收加密的文件。
    *   文件被分块（16KB）传输以适应 DataChannel 的限制。
    *   显示发送和接收进度。
    *   接收方可以下载完整的文件。
*   **打字状态提示**: 向对方显示"正在输入..."的提示（加密传输）。
*   **类 Discord 界面**: 使用 Tailwind CSS 构建，模仿 Discord 的布局和颜色方案。
*   **连接状态**: 显示与信令服务器和对等方的连接状态。
*   **用户 ID**: 自动生成唯一的临时用户 ID。
*   **用户列表 (模拟)**: 显示本地用户和已连接的远程用户（状态为模拟）。
*   **代码模块化**: 使用 ES6 模块将 JavaScript 代码拆分为多个文件（例如 `main.js`, `connection.js`, `crypto.js`, `ui.js` 等），提高了代码的可维护性。

## 技术栈

*   **前端**: HTML5, CSS3, JavaScript (ES6+, Modules)
*   **UI 框架**: [Tailwind CSS](https://tailwindcss.com/)
*   **图标**: [Material Symbols (Outlined)](https://fonts.google.com/icons)
*   **P2P 通信**: WebRTC (`RTCPeerConnection`, `RTCDataChannel`)
*   **信令**: WebSocket
*   **加密**: Web Crypto API (ECDH, AES-GCM)

## 工作原理

1.  **启动与注册**:
    *   浏览器加载 `index.html`。
    *   JavaScript 模块 (`main.js` 作为入口) 启动，生成一个临时的本地用户 ID (e.g., `user-xxxxxx`)。
    *   客户端连接到预定义的 WebSocket 信令服务器 (在 `constants.js` 中配置) 并使用其用户 ID 进行注册。
2.  **发起连接**:
    *   用户 A 在输入框中输入用户 B 的 ID，然后点击"连接"按钮。
    *   客户端 A 创建一个 `RTCPeerConnection` 实例和一个 `RTCDataChannel`。
    *   客户端 A 创建一个 SDP Offer，将其设置为本地描述，并通过信令服务器发送给用户 B。
3.  **接受连接**:
    *   客户端 B 从信令服务器收到用户 A 的 Offer。
    *   客户端 B 将收到的 Offer 设置为远程描述。
    *   客户端 B 创建一个 SDP Answer，将其设置为本地描述，并通过信令服务器发送回用户 A。
4.  **建立连接**:
    *   客户端 A 收到用户 B 的 Answer 并将其设置为远程描述。
    *   在此期间，两个客户端通过信令服务器交换 ICE 候选者（网络地址信息），WebRTC 尝试建立直接的 P2P 连接。
    *   当 P2P 连接成功建立且 `RTCDataChannel` 状态变为 `open` 时，连接状态会更新。
5.  **端到端加密设置**:
    *   数据通道打开后，每个客户端生成一个 ECDH 密钥对（公钥/私钥）。
    *   客户端通过数据通道交换各自的公钥。
    *   收到对方公钥后，每个客户端使用自己的私钥和对方的公钥通过 ECDH 派生出一个共享的 AES-GCM 对称密钥。
    *   加密建立完成，状态更新为 "E2EE"。
6.  **安全通信**:
    *   所有后续的文本消息、文件信息和打字状态都使用共享的 AES-GCM 密钥进行加密后，再通过 `RTCDataChannel` 发送。
    *   接收方使用相同的共享密钥解密收到的数据。

## 如何运行

1.  **信令服务器**:
    *   此项目需要一个兼容的 WebSocket 信令服务器来协调 P2P 连接的建立。
    *   代码中使用的服务器地址在 `constants.js` 文件的 `SIGNALING_SERVER_URL` 常量中定义 (默认为 `wss://signal.smartpig.top/ws`)。
    *   **你需要运行自己的信令服务器实例，并将 `constants.js` 中的 `SIGNALING_SERVER_URL` 更新为你的服务器地址。** 一个简单的 Node.js 信令服务器示例可以在网上找到，它需要处理 `register`, `offer`, `answer`, `candidate` 和 `user_disconnected` 类型的消息。
2.  **客户端**:
    *   无需构建或安装。
    *   只需在支持 WebRTC 和 Web Crypto API 的现代浏览器（如 Chrome, Firefox, Edge）中直接打开 `index.html` 文件即可（需要通过 HTTP 服务器访问以支持 ES6 模块，例如使用 Live Server 扩展）。
    *   为了测试 P2P 功能，你需要在两个不同的浏览器标签页或窗口中打开此文件。

## 如何使用

1.  通过 HTTP 服务器（如 VS Code Live Server）在第一个浏览器窗口中打开 `index.html`。注意顶部栏显示的本地用户 ID（例如 `user-123456`）。
2.  同样，在第二个浏览器窗口中打开 `index.html`。注意其本地用户 ID（例如 `user-654321`）。
3.  回到第一个窗口，在"对方 ID"输入框中输入第二个窗口的用户 ID (`user-654321`)。
4.  点击"连接"按钮。
5.  两个窗口的连接状态应依次更新为"信令服务器已连接" -> "呼叫/收到 Offer..." -> "ICE 状态: checking/connected" -> "数据通道开启 (等待加密...)" -> "已连接到 [对方ID] (E2EE)"。
6.  连接和加密建立后，底部的消息输入区域将出现。
7.  现在你可以开始发送加密的文本消息和文件了。

## 已知限制与未来可能改进

*   **信令服务器依赖**: 需要外部运行并正确配置信令服务器。
*   **模拟 UI 元素**: 服务器列表、频道列表和大部分用户列表信息目前是静态的模拟数据，没有实际功能。
*   **无持久化**: 聊天记录和用户 ID 在页面刷新后会丢失。
*   **错误处理**: 可以进一步增强错误处理和用户反馈。
*   **无用户认证**: 任何知道用户 ID 的人都可以尝试连接。
*   **扩展性**: 目前仅支持 1 对 1 聊天。
*   **本地运行**: 由于使用了 ES6 模块，需要通过 HTTP 服务器（如 Live Server）运行 `index.html`，直接打开本地文件可能无法工作。

---

欢迎对此项目进行贡献或提出改进建议！

 

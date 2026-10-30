# 源码结构与入口

根目录只保留插件清单、注册配置、README、许可证、图标和三个 Windows 快捷脚本。DSH 从 GitHub 安装时按 package.json 的 files 清单打包运行资源；无需 prepare、编译或 postinstall。

| 位置 | 内容 |
| --- | --- |
| src/index.js | 宿主服务入口、fish_* 工具注册 |
| src/client.js | DSH 设置页的控制台启动入口 |
| src/owner-*.js | 主人身份绑定、收件核验、回复及配置 |
| src/conversation-*.js | 会话选择与指定联系人回复 |
| src/video-*.js、share-policy.js、comment-policy.js | 视频兴趣、分享和评论策略 |
| src/browser/ | Edge 连接、DOM 提取、原生交互表达式 |
| src/console-*.js | 本机控制台服务、视图和操作 |
| src/billing.js | 宿主账号账单读取 |
| src/store.js | 本机状态持久化 |
| config/default-settings.json | 默认运行配置；不含用户数据 |
| console/index.html、app.js、style.css | 控制台结构、交互、暖色样式 |
| personas/ | 可导入的通用人设 |
| locale/ | 宿主插件名称与说明翻译 |
| tests/unit/、tests/browser/ | 合成测试，不参与安装打包 |
| scripts/Install-Windows.ps1 | 本地源码安装备用入口 |
| scripts/Windows-Common.ps1 | Windows 环境定位与官方 CLI 封装 |
| scripts/test.mjs、check-release.mjs | 测试与发布资料检查 |
| docs/agent-workflow.md | 宿主加载的工具使用说明 |
| docs/FIRST-RUN.md | 首次绑定和启动提示词 |
| docs/WINDOWS.md | 本地安装、升级与卸载 |
| docs/VALIDATION.md | 验收范围和限制 |

命名规则：以功能命名，小写英文加连字符；测试与源码同名并使用 .test.js 或 .test.mjs 后缀。仅 index.js、client.js 使用宿主入口的通用名称。运行数据在用户目录 .dsh 中，禁止提交到仓库。

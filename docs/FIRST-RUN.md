# 首次启动提示词

把下面这段发给 DeepSeek Harness；先完成普通聊天，确认当前模型能正常回答。

```text
我安装了大肥鱼插件。请先调用 fish_status 核对版本 0.8.0-dev.17。
这是首次配置：调用 fish_persona_import，confirm="import_persona"、useBuiltin=true。
我希望在开发阶段连续读取：调用 fish_development_mode，confirm="set_development_mode"、enabled=true。
作息保持关闭，模型和发送预算保留。
调用 fish_console_open 打开控制台，并告诉我在“私信与运行”点击“打开 / 重新连接”。
现在只初始化和连接，不启动回复、不发送、不评论、不分享。
```

如果已经配置过人设，跳过导入；重新导入内置人设会替换自定义人格设置。不要让模型直接编辑状态文件。

在专用 Edge 登录机器人抖音账号后，把主人账号的完整公开主页和抖音号提供给 DSH：

```text
请只读核验并绑定我的主人账号。
主人公开主页：这里粘贴 https://www.douyin.com/user/ 开头的完整链接
主人抖音号：这里填写主页上显示的“抖音号”，不要填昵称
调用 fish_owner_bind，confirm="bind_owner_from_public_profile"，使用上面的 sourceRef 和 ownerHandle。
保持暂停，不发送消息；核验失败返回具体原因，不重复启动或修改 verified 字段。
```

绑定成功后：控制台读取会话 → 选择回复对象 → 保存 → 启动 → 用对应账号发一条新文字。界面回执与对方真实收件分别核对。主人和机器人是两个需要能相互私信的账号；插件不代登录或代过验证。

## 首次给主人自动分享原生卡片

1. 自己选定一个可访问的公开视频完整链接。
2. 明确要求 DSH 使用 `fish_owner_native_share_once`，`confirm="share_one_native_video_card_to_boss"`，`sourceRef` 为该链接，仅分享一次给主人。
3. 主人账号确实收到并点开准确卡片后，告诉 DSH。它使用该次真实 `attemptId`、准确 `sourceRef` 和 `kind="native_card"`、`confirm="owner_opened_exact_native_card"` 调用 `fish_owner_receipt_confirm`。
4. 到刷视频页保存兴趣和分享设置，再启动自动模式。

这一步会真实发送一张卡片，不能在只想打开控制台时执行。原生@也需单独确认，不能复用卡片证明。接收人没确认时不伪造结果。

## 调整预算

通过 `fish_settings` 查看当前值，再让 DSH 调用 `fish_settings_update(confirm="update_owner_settings",changes=...)`。开发读取开关不会增加模型调用、私信或评论的预算。账号余额与本插件预约数量是两种不同数据。

## 遇到问题

- `import_persona_first`：尚未导入人设。
- `dedicated_browser_binding_required`：从控制台打开/重连专用 Edge。
- `different_owner_already_bound`：已经绑定另一位主人，不静默换绑；先核对是否使用了正确 Windows 用户。
- `owner_profile_not_verified`：核对公开主页与抖音号，保持页面可见；不是按昵称猜人。
- `native_share_live_verification_required`：完成本账号的一次卡片发送和实际收件确认。
- `interaction_result_unresolved`：复核原记录，不能清空台账或重复发送。
- 浏览器状态错误：专用窗口只保留一个抖音标签，点击重新连接。遇到可见登录/验证由本人完成。

没有单独的 `/message` 标签不说明失败，抖音私信可能是主页内的面板。看不到实际验证遮罩时，不凭一个验证 iframe 猜测账号未登录。

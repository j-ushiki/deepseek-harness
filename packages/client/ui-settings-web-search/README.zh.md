---
description: "dsh Web 客户端插件页上的搜索提供方设置页：在本部署已合成的搜索提供方之间选择，并编辑所选提供方的密钥、接口地址与单次请求上限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**网页搜索**，即可选择本部署使用的搜索提供方，并设置该提供方的密钥、接口地址与单次请求上限。仅当部署合成了两个或更多搜索提供方时才显示选择器；选择其一会立即写入 `web.searchProvider`，而提供方自身的字段保持本页"先暂存、后保存"的行为。密钥通过凭据域写入而不进设置文件，其明文从不出现在任何响应里。页面只在 Host 服务任一搜索提供方命名空间期间存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

官方分组里的**网页搜索**卡片打开这一页。当部署合成了两个或更多搜索提供方时，**搜索提供方**控件恰好列出 Host 所服务的提供方，并把选择写入 `web.searchProvider`；其下方的字段随之属于所选提供方，切换会丢弃未保存的编辑，因此一个提供方的草稿绝不会被保存进另一个提供方的设置节。只有一个提供方时该控件不出现，页面与以往完全一致。

**API Key** 每次加载都是空的，只报告是否已配置密钥；留空保存等于保留现有密钥，而当凭据不能从这里写入时（例如由进程环境变量提供的密钥）该控件会被禁用。它所寻址的引用在本节声明了 `apiKeyEnv` 时即该值，否则为相应提供方的默认值——DeepSeek 为 `DEEPSEEK_API_KEY`，Ollama Cloud 为 `OLLAMA_CLOUD_API_KEY`。**接口地址**与提供方的上限字段（DeepSeek 为**单次请求最多搜索次数**，Ollama Cloud 与 Exa 为**最大结果数**，Perplexity 为**最大回答 token 数**）显示生效值（接口地址为空时淡淡地显示所选提供方的默认值），一旦被覆盖就带**已覆盖**标签和**恢复默认**，清空后保存等于重置。除提供方选择外，点击**保存**之前不会写入任何内容；离开页面即丢弃草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧在 `ui-primitives` 的共享 `SettingsFormModel` 之上维护 `WebSearchCardController`。控制器持有一张把每个提供方 id 映射到其命名空间、上限字段与凭据引用的表——由于客户端 bundle 纯净性门禁禁止导入它们，这些值从 Host 包复制而来——并从 settings describe 镜像推导出被服务的子集。`SwitchableScope` 把表单模型的读写转发到所选提供方的 `ctx.configForms.get` 结果，因此切换提供方只替换设置节、无需重建暂存表单；控制器在替换前丢弃暂存编辑。密钥是表单里唯一的密文控件：写入走 `remote.credentials.set`，引用名取自上文；是否成功由 `remote.credentials.describe` 回读判定。scope 变化时、以及 Host 对所监视引用发出 `credentials/reference-updated` 时，控制器都会重读凭据，因为在模型页写入的密钥不会改变任何设置节。页面通过 `ctx.configForms.whileServed` 按提供方命名空间把 `WebSearchCard` 注册进插件页的 `plugins.item` slot。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与字段。
- [credentials](../../credentials/README.zh.md)——密钥写入所经的凭据引用 seam。
- [web-search-deepseek](../../web/web-search-deepseek/README.zh.md)——注册其命名空间的 DeepSeek 提供方。
- [web-search-ollama](../../web/web-search-ollama/README.zh.md)——注册其命名空间的 Ollama Cloud 提供方。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **提供方表在客户端有一份副本**——客户端 bundle 不能导入 Host 包，因此新增提供方需要在此添加对应条目与本地化标签。
- **只暴露各提供方的接口地址与上限**——其他提供方专有字段（模型、API 版本、token 预算、时效）保持组合值不变。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

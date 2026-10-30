# LifeOS · 人生系统

移动端人生管理应用。用 Capacitor 将一套纯前端 Web 应用打包成 Android App，UI 采用 liquid glass（液态玻璃）视觉语言。

## 模块
- **今日**：问候卡 + 灵动智能球 + 当日进度环
- **导入**：粘贴 / 上传 Markdown 笔记，端侧 AI 自动归类成计划与待办
- **计划**：阅读 / 健身 / 饮食 / 自定义计划，含任务增删改与提醒
- **关系**：可缩放、全屏、拖拽的人生地图，中心为「人生领域」，计划环绕并自动连线
- **我的**：主题切换、AI 引擎设置、数据备份与导出

## 技术栈
- Capacitor + WebView（Android）
- 纯前端 HTML / CSS / JS，localStorage 持久化
- 端侧启发式 AI 引擎（可在「我的」切换为远程）

## 本地运行
```bash
npm install
npm run copy        # 同步 index.html -> www/index.html
# 直接用浏览器打开 www/index.html 预览
npm run android     # 需本机安装 Android SDK，构建并打开原生工程
```

## 开发日志
见 `journal/` 目录，含中文与英文双语记录。

## 署名
SWP(SHUAI)

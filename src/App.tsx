import { useEffect, useMemo, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2,
  CircleAlert,
  Moon,
  Loader2,
  Sun,
  Monitor,
} from 'lucide-react';
import './App.css';
import { CreateCodexPage } from './features/accounts/CreateCodexPage';
import { accountLabel, isApiKeyAccount } from './features/accounts/accountUtils';
import {
  providerTestStatusLabel,
  type ProviderConfigAudit,
  type ProviderConfigAuditCheck,
  type ProviderConfigAuditTone,
  type ProviderFeedbackLabels,
} from './features/accounts/ProviderFeedbackPanels';
import { DashboardPage, type DashboardPageLabels } from './features/dashboard/DashboardPage';
import {
  buildDiagnosticsReport,
  buildGitWorktreeDiagnosticsReport,
} from './features/diagnostics/diagnosticsReports';
import { OperationGuide, type OperationGuideLabels } from './features/guide/OperationGuide';
import { CodexInstancesPage } from './features/instances/CodexInstancesPage';
import type { CloneCapabilityEditorLabels } from './features/instances/CloneCapabilityEditor';
import type { InstanceListHelpers, InstanceListLabels } from './features/instances/InstanceList';
import { SettingsPage } from './features/settings/SettingsPage';
import {
  type ResourceLensLabels,
  type SyncPackageMaintenanceLabels,
} from './features/sync-package/SyncPackageResources';
import {
  buildResourceLensReport,
  buildSyncPackageBackupReport,
  buildSyncPackagePreflightReport,
  buildSyncPackageResourceDiffReport,
  buildSyncPackageResourceReport,
  type SyncPackageReportDeps,
  type SyncPackageResourceDiffReportDeps,
} from './features/sync-package/syncPackageReports';
import {
  syncPackageAppliedFreshness as buildSyncPackageAppliedFreshness,
  syncPackageAppliedMarkerPath,
  syncPackageAppliedResourceRatio,
  syncPackageAppliedSummary as buildSyncPackageAppliedSummary,
  syncPackageApplyBlocker as getSyncPackageApplyBlocker,
  syncPackagePreflightBlocker,
  syncPackageRepairBlocker as getSyncPackageRepairBlocker,
  syncPackageResourceDiffHint,
  syncPackageStateLabel as getSyncPackageStateLabel,
  type SyncPackageFreshness,
  type SyncPackageStatusLabels,
} from './features/sync-package/syncPackageStatus';
import { getDiagnosticsSnapshot } from './services/diagnostics';
import type { InstanceCapabilityBadgeLabels } from './features/instances/InstanceCapabilityBadges';
import type { InstanceHistoryCellLabels } from './features/instances/InstanceHistoryCell';
import type { InstanceListSectionLabels } from './features/instances/InstanceListSection';
import type { InstanceMoreActionLabels } from './features/instances/InstanceMoreActionItems';
import type { InstancePrimaryActionLabels } from './features/instances/InstancePrimaryActions';
import type { InstanceTableHeaderLabels } from './features/instances/InstanceTableHeader';
import type { SessionPanelLabels } from './features/instances/SessionPanels';
import { visibleInstances } from './features/instances/instanceUtils';
import { useAppUpdater } from './features/updater/useAppUpdater';
import type {
  CodexAccount,
  CloneCapabilityEditDraft,
  CloneReadinessCheck,
  CloneReadinessSummary,
  CloneReadinessTone,
  CodexHistoryStatus,
  CodexHistorySyncResult,
  CloneFormValues,
  CodexProviderConnectionTestResult,
  CodexProviderModelsFetchResult,
  CodexSessionExportResult,
  CodexSessionSummary,
  CodexSessionUsageSummary,
  CodexSyncPackageBackupSummary,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageStatus,
  DiagnosticsSnapshot,
  GeneralConfig,
  GitWorktreeCreateResult,
  GitWorktreeDefaults,
  GitWorktreeFormValues,
  InstanceProfile,
  ZedOpenResult,
} from './shared/types';
import { getLocalErrorEvents, reportError } from './telemetry';
import { updaterConfig } from './generated/updater';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  providerPresets,
  type ProviderPreset,
} from './providerCatalog';

type Page = 'dashboard' | 'codexCreate' | 'codexList' | 'settings' | 'guide';
type AuthType = 'apiKey' | 'officialAccount';
type ThemeMode = 'system' | 'dark' | 'light';

type OAuthStartResponse = {
  loginId?: string;
  authUrl?: string;
  login_id?: string;
  auth_url?: string;
};

type Message = {
  tone: 'success' | 'error';
  text: string;
};

type CloneCapabilitySnapshot = {
  version: number;
  app: string;
  exportedAt: number;
  source: {
    instanceId: string;
    instanceName: string;
    codexHome: string;
    workingDir?: string | null;
  };
  provider: {
    authType: string;
    baseUrl?: string | null;
    providerId?: string | null;
    providerName?: string | null;
    model?: string | null;
  };
  capabilities: {
    modelCatalogEnabled: boolean;
    modelCatalogModels: string[];
    goalEnabled: boolean;
    goal?: string | null;
    promptPackEnabled: boolean;
    promptPack?: string | null;
    launchScriptPresent: boolean;
  };
  boundaries: string[];
  warnings: string[];
};

type CloneCapabilitySnapshotExportResult = {
  exportedPath: string;
  snapshot: CloneCapabilitySnapshot;
};

type ProviderHealthRecord = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  normalizedBaseUrl: string;
  model: string;
  ok: boolean;
  codexReady: boolean;
  status: string;
  protocol: string;
  httpStatus?: number | null;
  latencyMs: number;
  ttfbMs?: number | null;
  message: string;
  testedAt: number;
};

const CUSTOM_PROVIDER_PRESETS_KEY = 'codex-clone-launcher:custom-provider-presets:v1';
const PROVIDER_HEALTH_HISTORY_KEY = 'codex-clone-launcher:provider-health-history:v1';
const THEME_MODE_KEY = 'codex-clone-launcher:theme-mode:v1';
const CLONE_MODEL_CATALOG_MAX_MODELS = 240;
const PROVIDER_HEALTH_HISTORY_LIMIT = 48;
const CLONE_CAPABILITY_SNAPSHOT_APP = 'codex-clone-launcher';
const text = {
  appTitle: 'Codex 分身启动器',
  brand: '本地分身工作台',
  dashboard: '控制台',
  dashboardLead: '分身、同步包、更新和诊断状态集中在一个工作台。',
  healthTitle: '分身健康',
  healthLead: '先确认配置、同步包和启动状态，再执行修复。',
  healthBulkRefresh: '批量刷新状态',
  healthBulkVerify: '批量校验分身',
  healthBulkRepair: '批量同步/修复',
  healthBulkDone: '批量健康操作完成',
  healthNoClones: '还没有可操作的 Codex 分身。',
  cloneReadinessReady: '可启动',
  cloneReadinessWarn: '需处理',
  cloneReadinessBlocked: '已阻止',
  cloneReadinessUnchecked: '未检查',
  cloneReadinessTitle: '启动前体检',
  healthChecked: '已检查',
  healthMismatchWarning: 'mismatch / warning',
  syncManifestTitle: '同步包清单',
  syncManifestLead: '稳定资源纳入白名单，运行态和账号配置保持隔离。',
  resourceLensTitle: 'MCP / Skills 资源透视',
  resourceLensLead: '只读聚焦同步包里的 MCP、skills、rules、AGENTS、memories 和安全配置片段；不写本体、不写分身。',
  resourceLensReady: 'Ready',
  resourceLensIssues: 'Issues',
  resourceLensInventory: 'Inventory',
  resourceLensEmpty: '暂无可展示的 MCP/Skills 资源；先提取或刷新本体同步包。',
  resourceLensCopy: '复制资源透视',
  resourceLensCopied: '资源透视已复制',
  resourceLensCopyFailed: '资源透视复制失败',
  resourceDiff: 'Diff',
  syncManifestDetails: '同步包明细',
  syncManifestIncluded: '已纳入白名单',
  syncManifestExcluded: '固定排除项',
  syncManifestEntryPreview: 'Manifest 条目',
  syncManifestNoEntries: '尚无 manifest 条目；请先提取/刷新本体同步包。',
  syncManifestMoreEntries: '更多条目',
  quickActions: '快捷操作',
  moreActions: '更多操作',
  advancedOptions: '高级选项',
  syncPackageManage: '去列表处理',
  syncPackageDetails: '同步包详情',
  syncPackageBackups: '备份列表',
  copyResources: 'Copy resources',
  copyPreflight: 'Copy preflight',
  copyBackups: 'Copy backups',
  preflight: 'Preflight',
  preflightCheck: 'Check',
  copy: 'Copy',
  open: 'Open',
  diagnosticsTitle: '诊断中心',
  diagnosticsLead: '集中查看启动器日志、Codex 路径和进程信息；遇到未响应或同步卡顿时先看这里。',
  diagnosticsRefresh: '刷新诊断',
  diagnosticsLogs: '最近日志',
  diagnosticsNoLogs: '还没有可用日志',
  diagnosticsLogDir: '日志目录',
  diagnosticsPid: '启动器 PID',
  diagnosticsCodexPathOk: 'Codex 路径可用',
  diagnosticsCodexPathMissing: 'Codex 路径缺失或不可访问',
  diagnosticsOpenLogDir: '打开日志目录',
  diagnosticsOpenSyncPackage: '打开同步包目录',
  diagnosticsCopyReport: '复制诊断报告',
  diagnosticsReportCopied: '诊断报告已复制',
  diagnosticsReportCopyFailed: '诊断报告复制失败',
  diagnosticsReportPreview: '诊断报告预览',
  diagnosticsIssueSummary: '同步包提示',
  diagnosticsNoIssues: '暂无 warning/skipped',
  openPathFailed: '打开路径失败',
  providerHealthTitle: 'Provider 健康记录',
  providerHealthLead: '保存最近连接测试的非密摘要，用于给模型预设打健康徽章；不保存 API Key 或响应正文。',
  providerHealthEmpty: '暂无连接测试记录',
  providerHealthClear: '清空健康记录',
  providerHealthCleared: 'Provider 健康记录已清空',
  providerHealthCodexReady: 'Codex ready',
  providerHealthChatOnly: 'Chat only',
  providerHealthFailed: 'Failed',
  builtinPreset: '内置',
  customPreset: '自定义',
  openCreate: '去创建',
  openList: '去列表',
  openSettings: '去设置',
  cloneRunningCount: '运行中分身',
  cloneTotalCount: '分身总数',
  packageFreshness: '同步包状态',
  launcherVersion: '启动器版本',
  createCodex: '创建 Codex',
  codexList: 'Codex 列表',
  settings: '设置',
  guide: '操作说明',
  codexHeroTitle: '输入 Base URL 和 API Key，创建 Codex 分身',
  codexHeroLead:
    '分身保留独立 CODEX_HOME、auth 和额度配置；本体内容只通过“本体同步包”的提取和“同步/修复”手动应用。',
  thirdPartyApi: '第三方 API',
  baseUrl: 'Base URL',
  officialEntry: '官方账号入口',
  collapseOfficial: '收起官方账号入口',
  cloneName: '分身名称',
  model: '模型',
  modelCatalog: '写入分身 /model 模型目录',
  modelCatalogHint: '把当前模型和已拉取模型写入分身自己的 model-catalog.json，并在 config.toml 设置 model_catalog_json；不写本体。',
  modelCatalogEmpty: '暂无已拉取模型；开启后会至少写入当前模型。',
  apiKey: 'API Key',
  workdir: '工作目录（可留空）',
  launchScript: '启动脚本（可留空）',
  launchScriptHint: '只保存到分身 CODEX_HOME，并通过环境变量交给外部注入器；不会写入 Codex 安装目录。',
  launchScriptConfigured: '启动脚本已配置',
  goalPursuit: '追求目标',
  goalPursuitHint: '为这个分身写入专属目标文件，并在启动时通过分身 AGENTS.md 与环境变量携带；不写本体，不改本体 goals 数据库。',
  goalPursuitPlaceholder: '例如：持续完成 provider 融合、验证构建，并在遇到问题时优先自修复。',
  goalPursuitRequired: '已开启追求目标，请填写目标内容。',
  goalPursuitConfigured: '追求目标已配置',
  cloneCapabilityEdit: '编辑目标',
  cloneCapabilitySave: '保存目标',
  cloneCapabilityCancel: '取消',
  cloneCapabilitySaved: '分身目标已保存',
  cloneCapabilityTitle: '分身目标',
  cloneCapabilityLead: '更新已有分身的追求目标；关闭时只清理该分身 CODEX_HOME 内的 clone-goal.* 和 AGENTS 托管块。',
  promptPack: '分身提示词包',
  promptPackHint: '参考 CC Switch 的 prompts 管理，把常用工作模式写入分身 clone-prompts.md 和 AGENTS 托管块；只属于这个分身。',
  promptPackPlaceholder: '写入这个分身可复用的提示词、角色模式或检查清单。',
  promptPackRequired: '已开启分身提示词包，请填写提示词内容。',
  promptPackConfigured: '提示词包已配置',
  promptPackDefault:
    '## 代码审查\n\n- 先找行为回归、数据丢失、权限/凭据泄露和缺失测试。\n- 结论优先，文件和行号必须具体。\n\n## 排错\n\n- 先复现，再定位最小失败面，再修改验证。\n- 优先保留用户已有改动，不回滚无关文件。\n\n## 功能融合\n\n- 优先保留本体/分身边界；新能力必须可回退、可诊断。\n- 不复制 source auth、credentials、quota、plugins/cache/log 或运行临时态。',
  cloneSnapshotExport: '导出能力快照',
  cloneSnapshotExportTitle: '导出目标、提示词包、模型目录和 provider 非密字段；不导出 API Key、auth 或运行态',
  cloneSnapshotUse: '套用快照',
  cloneSnapshotUseTitle: '把分身能力快照套用到创建表单；API Key 仍需手动填写',
  cloneSnapshotImport: '导入能力快照',
  cloneSnapshotExported: '分身能力快照已导出',
  cloneSnapshotImported: '能力快照已套用到创建表单',
  cloneSnapshotImportFailed: '能力快照导入失败',
  inheritCodex: '创建时应用已提取的本体同步包（不刷新本体）',
  launchAfterCreate: '创建后立即启动',
  createAndLaunchCodex: '创建并启动 Codex 分身',
  createOnlyCodex: '创建 Codex 分身',
  officialTitle: '连接官方 OpenAI/Codex 账号',
  officialLead: '这是可选入口；Base URL + API Key 表单会一直保留。',
  openOfficialLogin: '打开官方登录',
  completeLogin: '完成登录',
  chooseOfficial: '选择官方账号',
  useOfficial: '使用所选官方账号创建分身',
  inheritTitle: '同步包内容',
  inheritChat: '聊天记录、sessions、session_index',
  inheritSkills: 'skills、rules、AGENTS.md',
  inheritMcp: 'MCP 配置和 mcp-servers',
  inheritGoals: 'goals_1.sqlite 可随同步包继承；新目标只写入分身 clone-goal.*',
  inheritPlugins: 'memories、sqlite、转录记录（不包含 plugins/cache/log 运行缓存）',
  inheritNote:
    '提取/刷新本体会先备份旧同步包再生成新包；启动分身不会刷新本体；同步/修复只应用已有同步包，不复制 auth.json、.credentials.json、plugins/cache/log 或覆盖额度配置。',
  noCodex: '还没有 Codex 分身，请先创建。',
  codexSubtitle: '只显示 Codex 分身，并提供记忆同步、校验和修复。',
  settingsLead: '只保留 Codex 启动路径。',
  worktreeTitle: '上游工作树',
  worktreeLead: '从 upstream/<base> 或可用远端基线创建新工作树，成功后自动填入分身工作目录。',
  worktreeRepoDir: 'Git 仓库目录',
  worktreeBaseRemote: '远端',
  worktreeBaseBranch: 'Base branch',
  worktreeNewBranch: '新分支',
  worktreeDir: '工作树目录',
  worktreeFetch: '创建前 fetch 远端基线',
  worktreeDetect: '检测仓库',
  worktreeCreate: '创建并填入工作目录',
  worktreeDetected: '已检测仓库',
  worktreeCreated: '工作树已创建',
  worktreeUseInCreate: '已填入创建表单',
  worktreeRequiredRepo: '请先选择或填写 Git 仓库目录',
  worktreeRequiredBranch: '请填写新分支和工作树目录',
  worktreeCopyDiagnostics: '复制工作树诊断',
  worktreeDiagnosticsCopied: '工作树诊断已复制',
  guideLead: '先创建分身；需要继承本体内容时，再提取同步包并对分身执行同步/修复。',
  guideQuickStart: '推荐流程',
  guideSafety: '边界规则',
  guideTroubleshooting: '常见处理',
  guidePackageMissing: '尚未提取',
  guidePackageNotGenerated: '还没有生成同步包',
  guideManagedCloneOnly: '只统计受管 Codex 分身',
  guidePackageSize: '包大小',
  guideFilesUnit: '文件',
  guideDirsUnit: '目录',
  themeLabel: '主题',
  themeSystem: '跟随系统',
  themeDark: '深色',
  themeLight: '浅色',
  themeUpdated: '主题已切换',
  updateTitle: '应用更新',
  updateLead: '通过 GitHub Releases 的 latest.json 检查新版本，发现更新后可下载、安装并重启。',
  currentVersion: '当前版本',
  updateRepository: '发布仓库',
  updateEndpoint: '更新源',
  updateUnknownVersion: '未知',
  updateLatestVersion: '最新版本',
  updateCheckedAt: '检查时间',
  autoCheckUpdates: '启动时自动检查更新',
  checkUpdate: '检查更新',
  checkAndInstallUpdate: '检查并安装',
  installUpdate: '下载并安装',
  skipThisVersion: '跳过此版本',
  resumeSkippedUpdate: '恢复提示',
  openReleases: '打开发布页',
  updateIdle: '未检查更新',
  updateChecking: '正在检查更新',
  updateNoUpdate: '当前已是最新版本',
  updateAvailable: '发现新版本',
  updateSkipped: '已跳过此版本',
  updateInstalling: '正在下载并安装更新',
  updateInstalled: '更新已安装，正在重启',
  updateInstalledRestartFailed: '更新已安装，请手动重启应用',
  updateCheckFailed: '检查更新失败',
  updateInstallFailed: '安装更新失败',
  updateLatestJsonMissing: 'GitHub Release 缺少 latest.json；请重新发布带 updater metadata 的版本。',
  updateSignatureHint: '更新签名或公钥校验失败；请确认 GitHub Secret 私钥和 tauri.conf.json 公钥匹配。',
  updateNetworkHint: '网络或代理访问 GitHub Releases 失败；可打开发布页手动下载。',
  updateDesktopOnlyHint: '当前页面不是 Tauri 桌面运行环境；请在桌面 APP 内检查更新。',
  save: '保存',
  codexPath: 'Codex 路径',
  pick: '选择',
  autoDetect: '自动识别',
  refresh: '刷新',
  instance: '分身',
  profileDir: 'Profile 目录',
  status: '状态',
  lastLaunch: '最近启动',
  actions: '操作',
  history: '记忆',
  historyCheck: '校验',
  historyRepair: '同步/修复',
  historyExportMarkdown: '导出 Markdown',
  historyExportMarkdownTitle: '只读导出最近 5 个分身会话',
  historyExportedMarkdown: 'Markdown 已导出',
  openZed: 'Zed',
  openZedDone: '已发送到 Zed',
  syncPackageTitle: '本体同步包',
  syncPackageMissing: '还未提取本体同步包，点击提取后会生成可手动同步到分身的安全白名单内容。',
  syncPackageRefresh: '提取/刷新本体',
  syncPackageReady: '同步包就绪',
  syncPackageStale: '本体已有更新',
  syncPackageStaleHint: '本体已有新变化；同步/修复仍会应用当前已提取的包，若要同步最新内容请先刷新本体。',
  syncPackageApplyUnknown: '同步包状态尚未加载，请先刷新状态或等待自动刷新完成。',
  syncPackageApplyMissing: '请先点击“提取/刷新本体”，生成本体同步包后再同步/修复。',
  syncPackageApplyStale: '将应用上一次已提取的本体同步包；如需最新内容，请先点击“提取/刷新本体”。',
  syncPackageApplyReady: '同步/修复只会把已提取的本体同步包应用到这个分身。',
  syncPackageExtracted: '本体同步包已刷新',
  syncPackageRestoreBackup: '恢复备份',
  syncPackageRestoredBackup: '同步包备份已恢复',
  syncPackageAppliedOpen: '打开记录',
  syncPackageAppliedCopy: '复制记录',
  syncPackageAppliedCopied: '同步包应用记录已复制',
  syncPackageAppliedMissing: '这个分身还没有同步包应用记录，请先执行“同步/修复”。',
  syncPackageCurrentApplied: '已应用当前同步包',
  syncPackageCurrentMissing: '未应用当前同步包',
  syncPackageCurrentUnknown: '当前同步包状态未知',
  historyRefresh: '刷新状态',
  running: '运行中',
  stopped: '未运行',
  sessionUsageRefresh: '统计用量',
  sessionListRefresh: '查看会话',
  sessionDetails: '会话列表',
  sessionUsageTitle: '会话用量',
  sessionUsageEmpty: '还没有可用 token 统计',
  sessionCostTitle: '成本透视',
  sessionCostEstimate: '估算成本',
  sessionCostUnpriced: '未匹配价格',
  sessionCostBillableInput: '计费输入',
  sessionCostCacheRate: '缓存命中',
  sessionCostOutput: '输出',
  sessionCostDisclaimer: '本地参考估算，不读取账单，不代表服务商最终收费。',
  sessionCopyProjectDir: '复制目录',
  sessionProjectDirCopied: '会话目录已复制',
  never: '未启动',
  start: '启动',
  stop: '停止',
  delete: '删除',
  requiredName: '请填写分身名称',
  requiredApi: '请填写 Base URL 和 API Key',
  requiredModel: '请填写模型',
  providerTest: '测试连接',
  providerTestHealthy: 'Provider 可用',
  providerTestDegraded: 'Provider 可用但较慢',
  providerTestChatOnly: 'Chat 桥接可用',
  providerTestFailed: 'Provider 测试失败',
  providerTestHint: '会发送一次低 token 请求；API Key 不会保存到模型预设或诊断报告。',
  providerModelsFetch: '拉取模型',
  providerModelsFetched: 'Provider 模型已拉取',
  providerModelsEmpty: '未识别到模型',
  providerModelsHint: '从 /models 只读拉取模型列表；API Key 只用于这次请求，不会保存。',
  providerAuditTitle: 'Provider 配置审计',
  providerAuditReady: '配置可用',
  providerAuditWarn: '建议确认',
  providerAuditBlocked: '缺少必填',
  providerAuditLead: '创建前本地检查 provider/base URL/API Key/模型/预设重复；不保存 API Key，不请求网络，不写本体。',
  requiredOfficial: '请先连接或选择官方账号',
  created: '已创建',
  createdLaunched: '已创建并启动',
  oauthOpened: '已打开官方登录页面，完成后回到 APP 点击“完成登录”。',
  noPendingLogin: '没有待完成的官方登录流程',
  officialConnected: '官方账号已连接',
  codexStarted: 'Codex 分身已启动',
  codexStopped: 'Codex 分身已停止',
  codexDeleted: 'Codex 分身已删除',
  pathDetected: '已识别路径',
  pathMissing: '未识别到路径',
  settingsSaved: '路径设置已保存',
  syncPackageStatusRefreshed: '同步包状态已刷新',
  busyWorking: '正在处理，请等待；Codex 系统弹窗出现时请选择应用，不要直接关闭。',
  busyExtracting: '正在提取本体同步包，旧包会先备份；数据较多时可能短暂卡顿。',
  busyRepairing: '正在应用同步包并修复分身历史；期间应用可能短暂卡顿。',
  busyBulkHealth: '正在批量处理分身健康；会顺序执行，避免多个写入任务互相覆盖。',
  busyStarting: '正在启动 Codex 分身；如果窗口显示未响应，请先等待。',
  busyOpeningZed: '正在调用 Zed 打开工作目录；如果 Zed 未响应，请检查 zed CLI 是否可用。',
  busyWorktree: '正在处理 Git 工作树；创建前会先检查目录、分支和远端基线。',
  starting: '启动中',
  stopping: '停止中',
  refreshing: '刷新中',
  verifying: '校验中',
  repairing: '同步中',
  deleting: '删除中',
  pathPlaceholder: '留空则自动探测',
  providerModelsCountUnit: '个模型',
  providerModelsHiddenPrefix: '还有 ',
  providerModelsHiddenSuffix: ' 个 provider 返回模型未显示',
  providerModelsFetching: '正在从 provider /models 拉取模型列表...',
  providerLatencyLabel: '延迟',
  providerTtfbLabel: 'TTFB',
  providerTesting: '正在测试 provider endpoint、模型和 API Key...',
  providerNeedsRelay: 'Needs relay/proxy',
  sessionRecentTitle: '最近会话',
  sessionReadSuccessPrefix: '已读取 ',
  sessionReadSuccessSuffix: ' 个分身会话',
  sessionSearchPlaceholder: '搜索已读取会话',
  sessionCountUnit: '条',
  sessionMessageUnit: '条消息',
  sessionNoTimestamp: '无时间戳',
  sessionUnknownProjectDir: '未知项目目录',
  sessionNoMatches: '没有匹配的已读取会话',
  sessionMorePrefix: '还有 ',
  sessionMoreSuffix: ' 条',
  sessionIndexLabel: 'index',
  sessionFilesLabel: 'files',
  sessionUsageTokensUnit: 'tokens',
  sessionUsageEventsUnit: 'events',
  sessionUsageInput: '输入',
  sessionUsageCache: '缓存',
  sessionUsageOutputLabel: '输出',
  sessionUsageFiles: '文件',
  sessionUsageRangeUnknown: '?',
  sessionUsageRangeSeparator: '->',
  sessionUsageModelInput: '输入',
  sessionUsageModelCache: '缓存',
  sessionUsageModelOutput: '输出',
  modelCatalogStandby: '待写入',
} as const;

const sessionPanelLabels: SessionPanelLabels = {
  recentTitle: text.sessionRecentTitle,
  countUnit: text.sessionCountUnit,
  messageUnit: text.sessionMessageUnit,
  noTimestamp: text.sessionNoTimestamp,
  unknownProjectDir: text.sessionUnknownProjectDir,
  noMatches: text.sessionNoMatches,
  morePrefix: text.sessionMorePrefix,
  moreSuffix: text.sessionMoreSuffix,
  usageTitle: text.sessionUsageTitle,
  usageTokensUnit: text.sessionUsageTokensUnit,
  usageEventsUnit: text.sessionUsageEventsUnit,
  usageInput: text.sessionUsageInput,
  usageCache: text.sessionUsageCache,
  usageOutputLabel: text.sessionUsageOutputLabel,
  usageFiles: text.sessionUsageFiles,
  usageRangeUnknown: text.sessionUsageRangeUnknown,
  usageRangeSeparator: text.sessionUsageRangeSeparator,
  usageModelInput: text.sessionUsageModelInput,
  usageModelCache: text.sessionUsageModelCache,
  usageModelOutput: text.sessionUsageModelOutput,
  usageEmpty: text.sessionUsageEmpty,
  costTitle: text.sessionCostTitle,
  costUnpriced: text.sessionCostUnpriced,
  costBillableInput: text.sessionCostBillableInput,
  costCacheRate: text.sessionCostCacheRate,
  costOutput: text.sessionCostOutput,
  costEstimate: text.sessionCostEstimate,
  costDisclaimer: text.sessionCostDisclaimer,
};

const instanceListSectionLabels: InstanceListSectionLabels = {
  searchPlaceholder: text.sessionSearchPlaceholder,
  refresh: text.refresh,
};

const instanceTableHeaderLabels: InstanceTableHeaderLabels = {
  instance: text.instance,
  profileDir: text.profileDir,
  status: text.status,
  history: text.history,
  lastLaunch: text.lastLaunch,
  actions: text.actions,
};

const instanceStatusLabels = {
  running: text.running,
  stopped: text.stopped,
};

const instancePrimaryActionLabels: InstancePrimaryActionLabels = {
  start: text.start,
  starting: text.starting,
  stop: text.stop,
  stopping: text.stopping,
  historyRepair: text.historyRepair,
  repairing: text.repairing,
  delete: text.delete,
  deleting: text.deleting,
};

const instanceMoreActionLabels: InstanceMoreActionLabels = {
  cloneCapabilityEdit: text.cloneCapabilityEdit,
  cloneCapabilityLead: text.cloneCapabilityLead,
  cloneSnapshotExport: text.cloneSnapshotExport,
  cloneSnapshotExportTitle: text.cloneSnapshotExportTitle,
  cloneSnapshotUse: text.cloneSnapshotUse,
  cloneSnapshotUseTitle: text.cloneSnapshotUseTitle,
  historyCheck: text.historyCheck,
  historyExportMarkdown: text.historyExportMarkdown,
  historyExportMarkdownTitle: text.historyExportMarkdownTitle,
  historyRefresh: text.historyRefresh,
  openZed: text.openZed,
  refreshing: text.refreshing,
  resourceDiff: text.resourceDiff,
  sessionListRefresh: text.sessionListRefresh,
  sessionUsageRefresh: text.sessionUsageRefresh,
  syncPackageAppliedCopy: text.syncPackageAppliedCopy,
  syncPackageAppliedOpen: text.syncPackageAppliedOpen,
  verifying: text.verifying,
};

const cloneCapabilityEditorLabels: CloneCapabilityEditorLabels = {
  cancel: text.cloneCapabilityCancel,
  lead: text.cloneCapabilityLead,
  placeholder: text.goalPursuitPlaceholder,
  save: text.cloneCapabilitySave,
  title: text.cloneCapabilityTitle,
  goalPursuit: text.goalPursuit,
};

const instanceCapabilityBadgeLabels: InstanceCapabilityBadgeLabels = {
  launchScriptConfigured: text.launchScriptConfigured,
  modelCatalog: text.modelCatalog,
  goalPursuitConfigured: text.goalPursuitConfigured,
  promptPackConfigured: text.promptPackConfigured,
};

const instanceHistoryCellLabels: InstanceHistoryCellLabels = {
  sessionIndexLabel: text.sessionIndexLabel,
  sessionFilesLabel: text.sessionFilesLabel,
};

const resourceLensLabels: ResourceLensLabels = {
  title: text.resourceLensTitle,
  lead: text.resourceLensLead,
  ready: text.resourceLensReady,
  issues: text.resourceLensIssues,
  inventory: text.resourceLensInventory,
  empty: text.resourceLensEmpty,
  copy: text.resourceLensCopy,
};

const syncPackageMaintenanceLabels: SyncPackageMaintenanceLabels = {
  copy: text.copy,
  open: text.open,
  preflightCheck: text.preflightCheck,
  restoreBackup: text.syncPackageRestoreBackup,
};

const guideQuickStartSteps = [
  '到“设置”确认 Codex 路径；不确定时点“自动识别”。',
  '到“创建 Codex”填写 Base URL、API Key、分身名称和模型，然后创建。',
  '需要继承本体内容时，到“Codex 列表”先“提取/刷新本体”，再对分身点“同步/修复”。',
  '同步后点“校验”或“刷新状态”，确认无异常再启动分身。',
];

const guideSafetyRules = [
  '本体只负责生成同步包，分身只负责应用同步包。',
  '同步/修复不会覆盖账号、API Key、auth、cache、log 或 plugins 运行态。',
  '每个分身都有独立 CODEX_HOME；账号、额度和窗口状态互不混用。',
];

const guideTroubleshootingItems = [
  '提示“本体已有更新”：可以继续同步当前包；要最新内容时先点“提取/刷新本体”。',
  '分身内容缺失：按“提取/刷新本体 -> 同步/修复 -> 重启分身”处理。',
  '启动或同步异常：到“设置”底部的“诊断中心”刷新诊断，再查看最近日志。',
];

const dashboardPageLabels: DashboardPageLabels = {
  dashboard: text.dashboard,
  dashboardLead: text.dashboardLead,
  openCreate: text.openCreate,
  openList: text.openList,
  openSettings: text.openSettings,
  cloneRunningCount: text.cloneRunningCount,
  cloneTotalCount: text.cloneTotalCount,
  packageFreshness: text.packageFreshness,
  launcherVersion: text.launcherVersion,
  healthTitle: text.healthTitle,
  healthLead: text.healthLead,
  healthChecked: text.healthChecked,
  healthMismatchWarning: text.healthMismatchWarning,
  healthBulkRefresh: text.healthBulkRefresh,
  healthBulkVerify: text.healthBulkVerify,
  healthBulkRepair: text.healthBulkRepair,
  syncPackageTitle: text.syncPackageTitle,
  syncManifestLead: text.syncManifestLead,
  syncPackageManage: text.syncPackageManage,
};

const operationGuideLabels: OperationGuideLabels = {
  guide: text.guide,
  guideLead: text.guideLead,
  syncPackageTitle: text.syncPackageTitle,
  syncPackageStale: text.syncPackageStale,
  syncPackageReady: text.syncPackageReady,
  guidePackageMissing: text.guidePackageMissing,
  guidePackageNotGenerated: text.guidePackageNotGenerated,
  cloneTotalCount: text.cloneTotalCount,
  guideManagedCloneOnly: text.guideManagedCloneOnly,
  guidePackageSize: text.guidePackageSize,
  guideFilesUnit: text.guideFilesUnit,
  guideDirsUnit: text.guideDirsUnit,
  guideQuickStart: text.guideQuickStart,
  guideSafety: text.guideSafety,
  guideTroubleshooting: text.guideTroubleshooting,
  quickStartSteps: guideQuickStartSteps,
  safetyRules: guideSafetyRules,
  troubleshootingItems: guideTroubleshootingItems,
};

const providerFeedbackLabels: ProviderFeedbackLabels = {
  providerAuditTitle: text.providerAuditTitle,
  providerAuditLead: text.providerAuditLead,
  providerModelsFetched: text.providerModelsFetched,
  providerModelsEmpty: text.providerModelsEmpty,
  providerModelsCountUnit: text.providerModelsCountUnit,
  providerModelsHiddenPrefix: text.providerModelsHiddenPrefix,
  providerModelsHiddenSuffix: text.providerModelsHiddenSuffix,
  providerLatencyLabel: text.providerLatencyLabel,
  providerTtfbLabel: text.providerTtfbLabel,
  providerHealthCodexReady: text.providerHealthCodexReady,
  providerNeedsRelay: text.providerNeedsRelay,
  providerTestHealthy: text.providerTestHealthy,
  providerTestDegraded: text.providerTestDegraded,
  providerTestChatOnly: text.providerTestChatOnly,
  providerTestFailed: text.providerTestFailed,
};

const instanceListLabels: InstanceListLabels = {
  section: instanceListSectionLabels,
  tableHeader: instanceTableHeaderLabels,
  status: instanceStatusLabels,
  primaryAction: instancePrimaryActionLabels,
  moreAction: instanceMoreActionLabels,
  capabilityEditor: cloneCapabilityEditorLabels,
  capabilityBadge: instanceCapabilityBadgeLabels,
  historyCell: instanceHistoryCellLabels,
  sessionPanel: sessionPanelLabels,
  moreActions: text.moreActions,
  syncPackageApplyReady: text.syncPackageApplyReady,
  sessionDetails: text.sessionDetails,
  sessionUsageTitle: text.sessionUsageTitle,
};

const instanceListHelpers: InstanceListHelpers = {
  formatTime,
  formatShortPath,
  formatTokenCount,
  formatUsd,
  historySummary,
  syncPackageAppliedMarkerPath,
  syncPackageAppliedSummary,
  syncPackageAppliedFreshness,
  syncPackageResourceDiffHint,
  cloneReadinessSummary,
};

const syncPackageReportDeps: SyncPackageReportDeps = {
  formatBytes,
  formatTime,
  syncPackageStateLabel,
};

const syncPackageResourceDiffReportDeps: SyncPackageResourceDiffReportDeps = {
  formatTime,
};

function defaultCloneValues(name: string): CloneFormValues {
  return {
    name,
    baseUrl: '',
    apiKey: '',
    model: DEFAULT_MODEL,
    modelCatalogEnabled: false,
    providerId: DEFAULT_PROVIDER_ID,
    providerName: DEFAULT_PROVIDER_NAME,
    workingDir: '',
    launchScript: '',
    goalEnabled: false,
    goalText: '',
    promptPackEnabled: false,
    promptPackText: text.promptPackDefault,
    inheritLocalData: false,
    launchAfterCreate: true,
  };
}
function defaultGitWorktreeValues(): GitWorktreeFormValues {
  return {
    repoDir: '',
    baseRemote: 'upstream',
    baseBranch: 'main',
    newBranch: '',
    worktreeDir: '',
    fetchBeforeCreate: true,
  };
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return text.never;
  return new Date(timestamp).toLocaleString();
}

function formatShortPath(path?: string | null): string {
  if (!path) return '无备份';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('\\') || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatTokenCount(tokens?: number | null): string {
  const value = Number(tokens ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  return String(Math.round(value));
}

function formatUsd(value?: number | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '$0.0000';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function cloneModelCatalogModels(
  currentModel: string,
  providerModelsResult?: CodexProviderModelsFetchResult | null,
): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const value of [currentModel, ...(providerModelsResult?.models ?? [])]) {
    const model = value.trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(model);
    if (models.length >= CLONE_MODEL_CATALOG_MAX_MODELS) break;
  }
  return models;
}

function normalizeProviderAuditBaseUrl(value: string): string {
  const baseUrl = normalizeProviderBaseUrl(value);
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
      url.pathname = '/v1';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

function providerAuditComparableBaseUrl(value: string): string {
  const normalized = normalizeProviderAuditBaseUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function isLocalProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.startsWith('127.');
}

function buildProviderConfigAudit(input: {
  form: CloneFormValues;
  presets: ProviderPreset[];
  providerTestResult?: CodexProviderConnectionTestResult | null;
  providerModelsResult?: CodexProviderModelsFetchResult | null;
  modelCatalogModels: string[];
}): ProviderConfigAudit {
  const checks: ProviderConfigAuditCheck[] = [];
  const addCheck = (check: ProviderConfigAuditCheck) => checks.push(check);
  const rawBaseUrl = input.form.baseUrl.trim();
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(rawBaseUrl);
  const comparableBaseUrl = providerAuditComparableBaseUrl(rawBaseUrl);
  const model = input.form.model.trim();
  const providerId = input.form.providerId.trim().toLowerCase();
  const hasApiKey = Boolean(input.form.apiKey.trim());
  let baseUrlValid = Boolean(rawBaseUrl);

  if (!rawBaseUrl) {
    baseUrlValid = false;
    addCheck({
      id: 'base-url-missing',
      status: 'blocked',
      label: 'Base URL',
      detail: '请填写 OpenAI 兼容 Base URL。',
    });
  } else {
    try {
      const url = new URL(normalizedBaseUrl);
      const originOnly = url.pathname === '/v1' && new URL(normalizeProviderBaseUrl(rawBaseUrl)).pathname.replace(/\/+$/, '') === '';
      addCheck({
        id: 'base-url-normalized',
        status: 'ok',
        label: 'Base URL',
        detail: originOnly ? `将按 ${normalizedBaseUrl} 测试/写入。` : `已规范化为 ${normalizedBaseUrl}。`,
      });
      if (url.protocol === 'http:' && !isLocalProviderHost(url.hostname)) {
        addCheck({
          id: 'base-url-http',
          status: 'warning',
          label: '非 HTTPS',
          detail: '远程 provider 建议使用 HTTPS；localhost/127.0.0.1 本地网关除外。',
        });
      }
    } catch {
      baseUrlValid = false;
      addCheck({
        id: 'base-url-invalid',
        status: 'blocked',
        label: 'Base URL 格式',
        detail: '无法解析为 URL；请包含 http:// 或 https://。',
      });
    }
  }

  addCheck({
    id: 'api-key',
    status: hasApiKey ? 'ok' : 'blocked',
    label: 'API Key',
    detail: hasApiKey ? '已填写；审计和诊断不会显示或保存密钥内容。' : '第三方 API 分身需要填写 API Key。',
  });

  addCheck({
    id: 'model',
    status: model ? 'ok' : 'blocked',
    label: '模型',
    detail: model ? `当前模型 ${model}。` : '请填写模型，或先从 Provider 模型列表中选择。',
  });

  if (input.providerTestResult) {
    addCheck({
      id: 'provider-test',
      status: input.providerTestResult.codexReady
        ? input.providerTestResult.status === 'degraded'
          ? 'warning'
          : 'ok'
        : 'warning',
      label: providerTestStatusLabel(input.providerTestResult, providerFeedbackLabels),
      detail: input.providerTestResult.message,
    });
  } else {
    addCheck({
      id: 'provider-test-missing',
      status: baseUrlValid && hasApiKey && model ? 'warning' : 'muted',
      label: 'Provider 测试',
      detail: baseUrlValid && hasApiKey && model ? '尚未运行测试连接。' : '补齐必填项后可运行测试连接。',
    });
  }

  if (input.providerModelsResult) {
    addCheck({
      id: 'provider-models',
      status: input.providerModelsResult.ok ? 'ok' : 'warning',
      label: input.providerModelsResult.ok ? text.providerModelsFetched : text.providerModelsEmpty,
      detail: input.providerModelsResult.ok
        ? `已识别 ${input.providerModelsResult.modelCount} 个模型。`
        : input.providerModelsResult.message,
    });
  } else {
    addCheck({
      id: 'provider-models-missing',
      status: input.form.modelCatalogEnabled && model ? 'warning' : 'muted',
      label: 'Provider 模型',
      detail: input.form.modelCatalogEnabled ? '模型目录会先只包含当前模型；可先拉取 provider 模型补全。' : '可选：拉取 /models 后再写入分身模型目录。',
    });
  }

  const exactPresets = input.presets.filter((preset) => {
    const presetBase = providerAuditComparableBaseUrl(preset.baseUrl);
    return Boolean(comparableBaseUrl && presetBase === comparableBaseUrl && preset.model.trim() === model);
  });
  const similarPresets = input.presets.filter((preset) => {
    const presetBase = providerAuditComparableBaseUrl(preset.baseUrl);
    const sameBase = Boolean(comparableBaseUrl && presetBase === comparableBaseUrl);
    const sameProvider = Boolean(providerId && preset.providerId.trim().toLowerCase() === providerId);
    return (sameBase || sameProvider) && !exactPresets.includes(preset);
  });

  if (exactPresets.length) {
    addCheck({
      id: 'preset-exact',
      status: 'muted',
      label: '已有预设',
      detail: `与 ${exactPresets.length} 个 Provider 预设完全匹配，可直接复用或作为分身专属配置。`,
    });
  } else if (similarPresets.length) {
    addCheck({
      id: 'preset-similar',
      status: 'muted',
      label: '相近预设',
      detail: `找到 ${similarPresets.length} 个同 provider 或同 Base URL 预设，保存自定义预设前建议确认命名。`,
    });
  } else if (rawBaseUrl && model) {
    addCheck({
      id: 'preset-new',
      status: 'ok',
      label: '预设关系',
      detail: '当前 provider/model 组合未与 Provider 预设重复。',
    });
  }

  const blockingCount = checks.filter((check) => check.status === 'blocked').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const tone: ProviderConfigAuditTone = blockingCount ? 'blocked' : warningCount ? 'warning' : 'ok';
  return {
    tone,
    label: blockingCount ? text.providerAuditBlocked : warningCount ? text.providerAuditWarn : text.providerAuditReady,
    detail: blockingCount
      ? `${blockingCount} 项必填待补，创建前请先处理。`
      : warningCount
        ? `${warningCount} 项建议确认；不影响保存分身配置。`
        : 'Provider、模型、测试和预设关系看起来可用。',
    normalizedBaseUrl,
    duplicatePresetCount: exactPresets.length,
    similarPresetCount: similarPresets.length,
    blockingCount,
    warningCount,
    checks,
  };
}

function clipProviderHealthMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function providerHealthRuntimeKey(baseUrl: string, model: string): string {
  return `${providerAuditComparableBaseUrl(baseUrl)}|${model.trim().toLowerCase()}`;
}

function providerHealthRecordFromTest(input: {
  form: CloneFormValues;
  result: CodexProviderConnectionTestResult;
}): ProviderHealthRecord {
  const baseUrl = input.form.baseUrl.trim();
  const model = input.form.model.trim() || DEFAULT_MODEL;
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(baseUrl);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerId: input.form.providerId.trim() || DEFAULT_PROVIDER_ID,
    providerName: input.form.providerName.trim() || DEFAULT_PROVIDER_NAME,
    baseUrl,
    normalizedBaseUrl,
    model,
    ok: input.result.ok,
    codexReady: input.result.codexReady,
    status: input.result.status || 'unknown',
    protocol: input.result.protocol || 'unknown',
    httpStatus: input.result.httpStatus ?? null,
    latencyMs: input.result.latencyMs,
    ttfbMs: input.result.ttfbMs ?? null,
    message: clipProviderHealthMessage(input.result.message),
    testedAt: Date.now(),
  };
}

function normalizeProviderHealthRecord(value: unknown): ProviderHealthRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ProviderHealthRecord>;
  const baseUrl = String(record.baseUrl ?? '').trim();
  const normalizedBaseUrl = normalizeProviderAuditBaseUrl(String(record.normalizedBaseUrl ?? baseUrl));
  const model = String(record.model ?? '').trim();
  const testedAt = Number(record.testedAt);
  if (!baseUrl || !model || !Number.isFinite(testedAt)) return null;
  return {
    id: String(record.id ?? `${testedAt}-${model}`),
    providerId: String(record.providerId ?? DEFAULT_PROVIDER_ID).trim() || DEFAULT_PROVIDER_ID,
    providerName: String(record.providerName ?? DEFAULT_PROVIDER_NAME).trim() || DEFAULT_PROVIDER_NAME,
    baseUrl,
    normalizedBaseUrl,
    model,
    ok: Boolean(record.ok),
    codexReady: Boolean(record.codexReady),
    status: String(record.status ?? 'unknown'),
    protocol: String(record.protocol ?? 'unknown'),
    httpStatus:
      typeof record.httpStatus === 'number' && Number.isFinite(record.httpStatus) ? record.httpStatus : null,
    latencyMs: Number.isFinite(Number(record.latencyMs)) ? Number(record.latencyMs) : 0,
    ttfbMs: Number.isFinite(Number(record.ttfbMs)) ? Number(record.ttfbMs) : null,
    message: clipProviderHealthMessage(String(record.message ?? '')),
    testedAt,
  };
}

function compactProviderHealthHistory(records: ProviderHealthRecord[]): ProviderHealthRecord[] {
  const seen = new Set<string>();
  const sorted = [...records].sort((a, b) => b.testedAt - a.testedAt);
  const next: ProviderHealthRecord[] = [];
  for (const record of sorted) {
    const key = providerHealthRuntimeKey(record.normalizedBaseUrl || record.baseUrl, record.model);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(record);
    if (next.length >= PROVIDER_HEALTH_HISTORY_LIMIT) break;
  }
  return next;
}

function readProviderHealthHistory(): ProviderHealthRecord[] {
  try {
    const raw = localStorage.getItem(PROVIDER_HEALTH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return compactProviderHealthHistory(
      parsed
        .map((item) => normalizeProviderHealthRecord(item))
        .filter((item): item is ProviderHealthRecord => Boolean(item)),
    );
  } catch {
    return [];
  }
}

function writeProviderHealthHistory(records: ProviderHealthRecord[]) {
  localStorage.setItem(PROVIDER_HEALTH_HISTORY_KEY, JSON.stringify(compactProviderHealthHistory(records)));
}

function readThemeMode(): ThemeMode {
  const value = localStorage.getItem(THEME_MODE_KEY);
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
}

function resolveThemeMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveThemeMode(mode);
  document.documentElement.dataset.themeMode = mode;
}

function themeModeLabel(mode: ThemeMode): string {
  if (mode === 'dark') return text.themeDark;
  if (mode === 'light') return text.themeLight;
  return text.themeSystem;
}

function slugifyProviderPresetId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `provider-${Date.now()}`;
}

function normalizeCustomProviderPreset(input: Partial<ProviderPreset>): ProviderPreset | null {
  const label = String(input.label ?? '').trim();
  const baseUrl = String(input.baseUrl ?? '').trim();
  const model = String(input.model ?? '').trim() || DEFAULT_MODEL;
  if (!label || (!baseUrl && !model)) return null;
  const providerName = String(input.providerName ?? '').trim() || label;
  const providerId = String(input.providerId ?? '').trim() || slugifyProviderPresetId(providerName);
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6)
    : [text.customPreset, '本地保存'];
  const website = String(input.website ?? '').trim();
  return {
    id: String(input.id ?? '').trim() || `custom-${slugifyProviderPresetId(label)}`,
    label,
    providerId,
    providerName,
    baseUrl,
    model,
    badge: text.customPreset,
    detail: String(input.detail ?? '').trim() || '本地保存的模型入口，只保存 provider/base URL/model。',
    tags,
    website,
    custom: true,
  };
}

function readCustomProviderPresets(): ProviderPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeCustomProviderPreset(item as Partial<ProviderPreset>))
      .filter((item): item is ProviderPreset => Boolean(item));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function getBooleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function getStringArrayField(value: Record<string, unknown>, key: string, limit = CLONE_MODEL_CATALOG_MAX_MODELS): string[] {
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const textValue = typeof item === 'string' ? item.trim() : '';
    if (!textValue) continue;
    const dedupeKey = textValue.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(textValue);
    if (result.length >= limit) break;
  }
  return result;
}

function parseCloneCapabilitySnapshot(content: string): CloneCapabilitySnapshot {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error('snapshot root must be an object');
  const version = Number(parsed.version);
  const app = getStringField(parsed, ['app']);
  if (version !== 1 || app !== CLONE_CAPABILITY_SNAPSHOT_APP) {
    throw new Error('不是 Codex 分身能力快照 v1');
  }
  if (!isRecord(parsed.source) || !isRecord(parsed.provider) || !isRecord(parsed.capabilities)) {
    throw new Error('snapshot missing source/provider/capabilities');
  }
  const source = parsed.source;
  const provider = parsed.provider;
  const capabilities = parsed.capabilities;
  const goal = getStringField(capabilities, ['goal']);
  const promptPack = getStringField(capabilities, ['promptPack']);
  const modelCatalogModels = getStringArrayField(capabilities, 'modelCatalogModels');

  return {
    version,
    app,
    exportedAt: Number(parsed.exportedAt) || Date.now(),
    source: {
      instanceId: getStringField(source, ['instanceId']),
      instanceName: getStringField(source, ['instanceName']) || 'Codex 分身',
      codexHome: getStringField(source, ['codexHome']),
      workingDir: getStringField(source, ['workingDir']) || null,
    },
    provider: {
      authType: getStringField(provider, ['authType']) || 'apiKey',
      baseUrl: getStringField(provider, ['baseUrl']) || null,
      providerId: getStringField(provider, ['providerId']) || DEFAULT_PROVIDER_ID,
      providerName: getStringField(provider, ['providerName']) || DEFAULT_PROVIDER_NAME,
      model: getStringField(provider, ['model']) || DEFAULT_MODEL,
    },
    capabilities: {
      modelCatalogEnabled: getBooleanField(capabilities, 'modelCatalogEnabled') && modelCatalogModels.length > 0,
      modelCatalogModels,
      goalEnabled: getBooleanField(capabilities, 'goalEnabled') && Boolean(goal),
      goal: goal || null,
      promptPackEnabled: getBooleanField(capabilities, 'promptPackEnabled') && Boolean(promptPack),
      promptPack: promptPack || null,
      launchScriptPresent: getBooleanField(capabilities, 'launchScriptPresent'),
    },
    boundaries: getStringArrayField(parsed, 'boundaries', 12),
    warnings: getStringArrayField(parsed, 'warnings', 12),
  };
}

function normalizeProviderBaseUrl(value: string): string {
  const first = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] ?? '';
  if (!first) return '';
  try {
    const url = new URL(first);
    return url.toString().replace(/\/+$/, '');
  } catch {
    return first.replace(/\/+$/, '');
  }
}

function historySummary(status?: CodexHistoryStatus | null): string {
  if (!status) return '未检测';
  const model = status.currentModel ? ` / ${status.currentModel}` : '';
  const auth = status.authOk ? 'auth OK' : 'auth warning';
  const syncMode = status.syncMode ?? 'shared';
  return `${status.threadCount} 线程，mismatch ${status.mismatchCount}，${auth}，sync ${syncMode}，${status.currentProvider}${model}`;
}

function creationHistoryMessage(instance: InstanceProfile): string {
  const status = instance.historyStatus;
  if (!status) return instance.name;
  const verify = status.ok ? '校验 OK' : '有警告';
  return `${instance.name}，已同步 ${status.threadCount} 条线程，mismatch ${status.mismatchCount}，${verify}`;
}

const syncPackageStatusLabels: SyncPackageStatusLabels = {
  missing: text.syncPackageMissing,
  stale: text.syncPackageStale,
  ready: text.syncPackageReady,
  currentUnknown: text.syncPackageCurrentUnknown,
  applyUnknown: text.syncPackageApplyUnknown,
  applyMissing: text.syncPackageApplyMissing,
  currentMissing: text.syncPackageCurrentMissing,
  appliedMissing: text.syncPackageAppliedMissing,
  currentApplied: text.syncPackageCurrentApplied,
};

const syncPackageFormatters = {
  formatTime,
  formatBytes,
};

function syncPackageAppliedSummary(status?: CodexHistoryStatus | null): string {
  return buildSyncPackageAppliedSummary(status, syncPackageFormatters);
}

function syncPackageAppliedFreshness(
  status: CodexHistoryStatus | null | undefined,
  currentPackage: CodexSyncPackageStatus | null,
): SyncPackageFreshness {
  return buildSyncPackageAppliedFreshness(
    status,
    currentPackage,
    syncPackageStatusLabels,
    syncPackageFormatters,
  );
}

function syncPackageStateLabel(status: CodexSyncPackageStatus | null): string {
  return getSyncPackageStateLabel(status, syncPackageStatusLabels);
}

function cloneReadinessSummary(
  instance: InstanceProfile,
  history: CodexHistoryStatus | null | undefined,
  syncPackage: CodexSyncPackageStatus | null,
): CloneReadinessSummary {
  const checks: CloneReadinessCheck[] = [];
  const addCheck = (check: CloneReadinessCheck) => checks.push(check);
  const model = history?.currentModel?.trim() || 'model ?';
  const provider = history?.currentProvider?.trim() || 'provider ?';

  if (!history) {
    addCheck({
      id: 'history-unchecked',
      status: 'warning',
      label: text.cloneReadinessUnchecked,
      detail: '尚未读取分身状态，先刷新或校验一次再判断同步和账号状态。',
    });
  } else {
    addCheck({
      id: 'auth',
      status: history.authOk ? 'ok' : 'blocked',
      label: history.authOk ? 'Auth OK' : 'Auth 需处理',
      detail: history.authOk
        ? `${history.authMode ?? 'auth'} / ${history.providerBaseUrlHost ?? 'host ?'}`
        : '分身账号或 API Key 投影不可用，启动前先修复账号绑定。',
    });
    addCheck({
      id: 'provider-model',
      status: history.currentProvider && history.currentModel ? 'ok' : 'warning',
      label: 'Provider / model',
      detail: `${provider} / ${model}`,
    });
    addCheck({
      id: 'history-index',
      status: history.mismatchCount || history.missingSessionFiles ? 'warning' : 'ok',
      label: '会话索引',
      detail: `mismatch ${history.mismatchCount} / missing ${history.missingSessionFiles} / files ${history.sessionFileCount}`,
    });
    if (history.warnings?.length) {
      addCheck({
        id: 'history-warning',
        status: 'warning',
        label: '历史同步提示',
        detail: history.warnings[0],
      });
    }
  }

  const freshness = syncPackageAppliedFreshness(history, syncPackage);
  if (!syncPackage?.exists) {
    addCheck({
      id: 'sync-package-missing',
      status: 'warning',
      label: '同步包',
      detail: text.syncPackageApplyMissing,
    });
  } else if (!history?.syncPackageApplied) {
    addCheck({
      id: 'sync-package-not-applied',
      status: 'warning',
      label: '同步包',
      detail: '当前分身还没有 clone-sync-package-applied.json 应用记录。',
    });
  } else {
    addCheck({
      id: 'sync-package-applied',
      status: freshness.tone === 'warning' ? 'warning' : 'ok',
      label: '同步包',
      detail: freshness.title,
    });
  }

  const resourceDiff = syncPackageResourceDiffHint(history, syncPackage);
  if (resourceDiff.tone === 'warning') {
    addCheck({
      id: 'resource-diff',
      status: 'warning',
      label: resourceDiff.label,
      detail: resourceDiff.title,
    });
  }

  addCheck({
    id: 'model-catalog',
    status: instance.modelCatalogEnabled ? 'ok' : 'muted',
    label: text.modelCatalog,
    detail: instance.modelCatalogEnabled
      ? `${instance.modelCatalogCount ?? 0} models / ${formatShortPath(instance.modelCatalogPath)}`
      : '未写入分身模型目录；可以用能力快照或创建表单补齐。',
  });
  addCheck({
    id: 'goal',
    status: instance.goalEnabled ? 'ok' : 'muted',
    label: text.goalPursuit,
    detail: instance.goalEnabled
      ? formatShortPath(instance.goalPath)
      : '未配置分身专属目标；长期任务分身建议开启。',
  });
  addCheck({
    id: 'prompt-pack',
    status: instance.promptPackEnabled ? 'ok' : 'muted',
    label: text.promptPack,
    detail: instance.promptPackEnabled
      ? formatShortPath(instance.promptPackPath)
      : '未配置提示词包；常用工作模式可以沉淀到分身。',
  });
  addCheck({
    id: 'working-dir',
    status: instance.workingDir?.trim() ? 'ok' : 'muted',
    label: text.workdir,
    detail: instance.workingDir?.trim() || '未绑定工作目录，启动后需在 Codex 内手动选择上下文。',
  });
  addCheck({
    id: 'launch-script',
    status: instance.launchScript?.trim() ? 'ok' : 'muted',
    label: text.launchScript,
    detail: instance.launchScript?.trim() ? text.launchScriptConfigured : '未配置启动脚本；这是可选能力。',
  });

  const blockingCount = checks.filter((check) => check.status === 'blocked').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const tone: CloneReadinessTone = blockingCount ? 'blocked' : warningCount ? 'warning' : 'ok';
  const label =
    tone === 'blocked'
      ? text.cloneReadinessBlocked
      : tone === 'warning'
        ? text.cloneReadinessWarn
        : text.cloneReadinessReady;
  const detail =
    tone === 'blocked'
      ? `${blockingCount} 个阻断项，启动前先处理。`
      : tone === 'warning'
        ? `${warningCount} 个提示项，仍可按需启动。`
        : '核心检查通过，可直接启动。';

  return { tone, label, detail, checks, blockingCount, warningCount };
}

function syncPackageApplyBlocker(status: CodexSyncPackageStatus | null): string | null {
  return getSyncPackageApplyBlocker(status, syncPackageStatusLabels);
}

function syncPackageRepairBlocker(
  status: CodexSyncPackageStatus | null,
  preflight: CodexSyncPackagePreflightReport | null,
): string | null {
  return getSyncPackageRepairBlocker(status, preflight, syncPackageStatusLabels);
}

function diagnosticsSummary(snapshot: DiagnosticsSnapshot | null): string {
  if (!snapshot) return '未加载';
  const logCount = snapshot.logFiles?.length ?? 0;
  const pathState = snapshot.codexAppPathExists ? '路径 OK' : '路径待修复';
  return `${pathState}，${logCount} 个日志文件，PID ${snapshot.launcherPid}`;
}

function busyMessage(label: string): string {
  if (label === 'codex-sync-package-extract') return text.busyExtracting;
  if (label === 'codex-sync-package-preflight') return 'Checking sync package preflight...';
  if (label.startsWith('codex-sync-package-restore-')) return '正在从备份恢复当前同步包...';
  if (label === 'diagnostics-refresh') return text.diagnosticsRefresh;
  if (label.startsWith('codex-history-repair-')) return text.busyRepairing;
  if (label.startsWith('codex-history-export-')) return text.historyExportMarkdown;
  if (label.startsWith('codex-clone-snapshot-export-')) return '正在导出分身能力快照...';
  if (label.startsWith('codex-clone-snapshot-use-')) return '正在套用分身能力快照...';
  if (label.startsWith('codex-clone-capabilities-')) return '正在保存分身目标...';
  if (label.startsWith('codex-session-usage-')) return '正在统计分身会话 token 用量...';
  if (label.startsWith('codex-history-bulk-')) return text.busyBulkHealth;
  if (label.startsWith('codex-start-')) return text.busyStarting;
  if (label.startsWith('codex-open-zed-')) return text.busyOpeningZed;
  if (label === 'provider-model-fetch') return text.providerModelsFetching;
  if (label === 'provider-connection-test') return text.providerTesting;
  if (label.startsWith('git-worktree-')) return text.busyWorktree;
  if (label === 'app-update-check') return text.updateChecking;
  if (label === 'app-update-auto-check') return text.updateChecking;
  if (label === 'app-update-install') return text.updateInstalling;
  return text.busyWorking;
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showOfficialPanel, setShowOfficialPanel] = useState(false);
  const [codexForm, setCodexForm] = useState<CloneFormValues>(() =>
    defaultCloneValues('Codex 工作分身'),
  );
  const [providerTestResult, setProviderTestResult] = useState<CodexProviderConnectionTestResult | null>(null);
  const [providerModelsResult, setProviderModelsResult] = useState<CodexProviderModelsFetchResult | null>(null);
  const [gitWorktreeForm, setGitWorktreeForm] = useState<GitWorktreeFormValues>(() =>
    defaultGitWorktreeValues(),
  );
  const [gitWorktreeDefaults, setGitWorktreeDefaults] = useState<GitWorktreeDefaults | null>(null);
  const [gitWorktreeResult, setGitWorktreeResult] = useState<GitWorktreeCreateResult | null>(null);
  const [officialAccounts, setOfficialAccounts] = useState<CodexAccount[]>([]);
  const [officialAccountId, setOfficialAccountId] = useState('');
  const [pendingLoginId, setPendingLoginId] = useState('');
  const [codexInstances, setCodexInstances] = useState<InstanceProfile[]>([]);
  const [cloneCapabilityDrafts, setCloneCapabilityDrafts] = useState<Record<string, CloneCapabilityEditDraft>>({});
  const [historyByInstance, setHistoryByInstance] = useState<Record<string, CodexHistoryStatus>>({});
  const [syncPackage, setSyncPackage] = useState<CodexSyncPackageStatus | null>(null);
  const [syncPackageBackups, setSyncPackageBackups] = useState<CodexSyncPackageBackupSummary[]>([]);
  const [syncPackagePreflight, setSyncPackagePreflight] = useState<CodexSyncPackagePreflightReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [codexAppPath, setCodexAppPath] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [customProviderPresets] = useState<ProviderPreset[]>(() =>
    readCustomProviderPresets(),
  );
  const [providerHealthHistory, setProviderHealthHistory] = useState<ProviderHealthRecord[]>(() =>
    readProviderHealthHistory(),
  );
  const [diagnosticsReport, setDiagnosticsReport] = useState('');
  const [exportDirByInstance, setExportDirByInstance] = useState<Record<string, string>>({});
  const [sessionsByInstance, setSessionsByInstance] = useState<Record<string, CodexSessionSummary[]>>({});
  const [usageByInstance, setUsageByInstance] = useState<Record<string, CodexSessionUsageSummary>>({});
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const cloneSnapshotImportRef = useRef<HTMLInputElement | null>(null);
  const {
    availableUpdate,
    updateStatus,
    autoCheckUpdates,
    skippedUpdateVersion,
    setAutoCheckUpdates,
    checkForAppUpdate,
    installAppUpdate,
    skipAvailableUpdate,
    clearSkippedUpdate,
    openReleasePage,
  } = useAppUpdater({
    labels: {
      idle: text.updateIdle,
      noUpdate: text.updateNoUpdate,
      skipped: text.updateSkipped,
      available: text.updateAvailable,
      installing: text.updateInstalling,
      installed: text.updateInstalled,
      installedRestartFailed: text.updateInstalledRestartFailed,
      checkFailed: text.updateCheckFailed,
      installFailed: text.updateInstallFailed,
      latestJsonMissing: text.updateLatestJsonMissing,
      signatureHint: text.updateSignatureHint,
      desktopOnlyHint: text.updateDesktopOnlyHint,
      networkHint: text.updateNetworkHint,
    },
    showMessage,
    withBusy,
  });

  const codexCloneList = useMemo(() => visibleInstances(codexInstances), [codexInstances]);
  const providerPresetCatalog = useMemo(
    () => [...providerPresets, ...customProviderPresets],
    [customProviderPresets],
  );
  const officialAccountOptions = useMemo(
    () => officialAccounts.filter((account) => !isApiKeyAccount(account)),
    [officialAccounts],
  );
  const modelCatalogModels = useMemo(
    () => cloneModelCatalogModels(codexForm.model, providerModelsResult),
    [codexForm.model, providerModelsResult],
  );
  const providerConfigAudit = useMemo(
    () =>
      buildProviderConfigAudit({
        form: codexForm,
        presets: providerPresetCatalog,
        providerTestResult,
        providerModelsResult,
        modelCatalogModels,
      }),
    [codexForm, providerPresetCatalog, providerTestResult, providerModelsResult, modelCatalogModels],
  );

  function showMessage(tone: Message['tone'], value: string) {
    setMessage({ tone, text: value });
  }

  function updateCodexForm(patch: Partial<CloneFormValues>) {
    if (
      Object.prototype.hasOwnProperty.call(patch, 'baseUrl') ||
      Object.prototype.hasOwnProperty.call(patch, 'apiKey') ||
      Object.prototype.hasOwnProperty.call(patch, 'model')
    ) {
      setProviderTestResult(null);
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'baseUrl') ||
      Object.prototype.hasOwnProperty.call(patch, 'apiKey')
    ) {
      setProviderModelsResult(null);
    }
    setCodexForm((current) => ({ ...current, ...patch }));
  }

  function updateGitWorktreeForm(patch: Partial<GitWorktreeFormValues>) {
    setGitWorktreeForm((current) => ({ ...current, ...patch }));
  }

  function rememberProviderHealth(record: ProviderHealthRecord) {
    setProviderHealthHistory((current) => {
      const next = compactProviderHealthHistory([record, ...current]);
      writeProviderHealthHistory(next);
      return next;
    });
  }

  function updateThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    localStorage.setItem(THEME_MODE_KEY, mode);
    applyThemeMode(mode);
    showMessage('success', `${text.themeUpdated}: ${themeModeLabel(mode)}`);
  }

  function applyCloneCapabilitySnapshot(snapshot: CloneCapabilitySnapshot, sourceLabel: string) {
    const model = snapshot.provider.model?.trim() || DEFAULT_MODEL;
    const catalogModels = snapshot.capabilities.modelCatalogModels;
    setProviderTestResult(null);
    setProviderModelsResult(
      catalogModels.length
        ? {
            ok: true,
            status: 'snapshot',
            endpoint: 'clone capability snapshot',
            httpStatus: null,
            latencyMs: 0,
            modelCount: catalogModels.length,
            models: catalogModels,
            message: '来自分身能力快照；不包含 API Key。',
            responsePreview: null,
          }
        : null,
    );
    setCodexForm((current) => ({
      ...current,
      name: `${snapshot.source.instanceName || current.name || 'Codex 分身'} 复制`,
      baseUrl: snapshot.provider.baseUrl?.trim() || '',
      apiKey: '',
      model,
      modelCatalogEnabled: snapshot.capabilities.modelCatalogEnabled && catalogModels.length > 0,
      providerId: snapshot.provider.providerId?.trim() || DEFAULT_PROVIDER_ID,
      providerName: snapshot.provider.providerName?.trim() || DEFAULT_PROVIDER_NAME,
      workingDir: snapshot.source.workingDir?.trim() || '',
      launchScript: '',
      goalEnabled: snapshot.capabilities.goalEnabled && Boolean(snapshot.capabilities.goal?.trim()),
      goalText: snapshot.capabilities.goal?.trim() || '',
      promptPackEnabled:
        snapshot.capabilities.promptPackEnabled && Boolean(snapshot.capabilities.promptPack?.trim()),
      promptPackText: snapshot.capabilities.promptPack?.trim() || text.promptPackDefault,
    }));
    setShowOfficialPanel(snapshot.provider.authType === 'officialAccount');
    setPage('codexCreate');
    const warnings = snapshot.warnings.length ? `；${snapshot.warnings.length} 条提示` : '';
    showMessage('success', `${text.cloneSnapshotImported}: ${sourceLabel}；API Key 需手动填写${warnings}`);
  }

  async function exportCloneCapabilitySnapshot(instanceId: string) {
    await withBusy(`codex-clone-snapshot-export-${instanceId}`, async () => {
      const exported = await invoke<CloneCapabilitySnapshotExportResult>(
        'codex_export_clone_capability_snapshot',
        { instanceId },
      );
      showMessage(
        'success',
        `${text.cloneSnapshotExported}: ${exported.snapshot.source.instanceName} -> ${exported.exportedPath}`,
      );
    });
  }

  async function useCloneCapabilitySnapshot(instanceId: string) {
    await withBusy(`codex-clone-snapshot-use-${instanceId}`, async () => {
      const exported = await invoke<CloneCapabilitySnapshotExportResult>(
        'codex_export_clone_capability_snapshot',
        { instanceId },
      );
      applyCloneCapabilitySnapshot(exported.snapshot, exported.snapshot.source.instanceName);
    });
  }

  function startCloneCapabilityEdit(instance: InstanceProfile) {
    setCloneCapabilityDrafts((current) => ({
      ...current,
      [instance.id]: current[instance.id] ?? {
        goalEnabled: Boolean(instance.goalEnabled),
        goalText: instance.goal?.trim() || '',
        promptPackEnabled: Boolean(instance.promptPackEnabled),
        promptPackText: instance.promptPack?.trim() || text.promptPackDefault,
      },
    }));
  }

  function updateCloneCapabilityDraft(instanceId: string, patch: Partial<CloneCapabilityEditDraft>) {
    setCloneCapabilityDrafts((current) => {
      const existing = current[instanceId];
      if (!existing) return current;
      return {
        ...current,
        [instanceId]: { ...existing, ...patch },
      };
    });
  }

  function cancelCloneCapabilityEdit(instanceId: string) {
    setCloneCapabilityDrafts((current) => {
      const next = { ...current };
      delete next[instanceId];
      return next;
    });
  }

  async function saveCloneCapabilities(instanceId: string) {
    const draft = cloneCapabilityDrafts[instanceId];
    if (!draft) return;
    await withBusy(`codex-clone-capabilities-${instanceId}`, async () => {
      if (draft.goalEnabled && !draft.goalText.trim()) {
        throw new Error(text.goalPursuitRequired);
      }
      const updated = await invoke<InstanceProfile>('codex_update_clone_capabilities', {
        input: {
          instanceId,
          goalEnabled: draft.goalEnabled,
          goal: draft.goalEnabled ? draft.goalText.trim() : null,
        },
      });
      setCodexInstances((current) => current.map((instance) => (instance.id === instanceId ? updated : instance)));
      cancelCloneCapabilityEdit(instanceId);
      await refreshCodexInstances();
      showMessage('success', `${text.cloneCapabilitySaved}: ${updated.name || updated.id}`);
    });
  }

  function openCloneSnapshotImport() {
    cloneSnapshotImportRef.current?.click();
  }

  async function importCloneCapabilitySnapshotFromFile(file: File) {
    try {
      const snapshot = parseCloneCapabilitySnapshot(await file.text());
      applyCloneCapabilitySnapshot(snapshot, file.name);
    } catch (error) {
      reportError(error, { area: 'clone-capability-snapshot', action: 'import' });
      showMessage('error', `${text.cloneSnapshotImportFailed}: ${String(error)}`);
    }
  }

  function handleCloneSnapshotImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void importCloneCapabilitySnapshotFromFile(file);
  }

  async function fetchProviderModels() {
    await withBusy('provider-model-fetch', async () => {
      const baseUrl = codexForm.baseUrl.trim();
      const apiKey = codexForm.apiKey.trim();
      if (!baseUrl) throw new Error('请先填写 Base URL');
      const result = await invoke<CodexProviderModelsFetchResult>('codex_fetch_provider_models', {
        input: { baseUrl, apiKey },
      });
      setProviderModelsResult(result);
      if (result.ok) {
        setCodexForm((current) => ({ ...current, modelCatalogEnabled: true }));
      }
      showMessage(
        result.ok ? 'success' : 'error',
        `${result.ok ? text.providerModelsFetched : text.providerModelsEmpty}: ${result.message}`,
      );
    });
  }

  async function testProviderConnection() {
    await withBusy('provider-connection-test', async () => {
      const baseUrl = codexForm.baseUrl.trim();
      const apiKey = codexForm.apiKey.trim();
      const model = codexForm.model.trim();
      if (!baseUrl || !apiKey) throw new Error(text.requiredApi);
      if (!model) throw new Error(text.requiredModel);
      const result = await invoke<CodexProviderConnectionTestResult>('codex_test_provider_connection', {
        input: { baseUrl, apiKey, model },
      });
      setProviderTestResult(result);
      rememberProviderHealth(providerHealthRecordFromTest({ form: codexForm, result }));
      showMessage(result.codexReady ? 'success' : 'error', `${providerTestStatusLabel(result, providerFeedbackLabels)}: ${result.message}`);
    });
  }

  async function refreshCodexAccounts() {
    const accounts = await invoke<CodexAccount[]>('list_codex_accounts');
    setOfficialAccounts(accounts);
    const firstOfficial = accounts.find((account) => !isApiKeyAccount(account));
    if (firstOfficial && !officialAccountId) {
      setOfficialAccountId(firstOfficial.id);
    }
  }

  async function refreshCodexInstances() {
    const instances = await invoke<InstanceProfile[]>('codex_list_instances');
    setCodexInstances(instances);
    setHistoryByInstance((current) => {
      const next = { ...current };
      for (const instance of instances) {
        if (instance.historyStatus) next[instance.id] = instance.historyStatus;
      }
      return next;
    });
  }

  async function refreshSyncPackage() {
    const status = await invoke<CodexSyncPackageStatus>('codex_sync_package_status');
    setSyncPackage(status);
  }

  async function refreshSyncPackageBackups() {
    const backups = await invoke<CodexSyncPackageBackupSummary[]>('codex_sync_package_backups');
    setSyncPackageBackups(backups);
  }

  async function refreshSyncPackagePreflight() {
    const preflight = await invoke<CodexSyncPackagePreflightReport>('codex_sync_package_preflight');
    setSyncPackagePreflight(preflight);
    return preflight;
  }

  async function refreshDiagnostics() {
    const snapshot = await getDiagnosticsSnapshot(80);
    setDiagnostics(snapshot);
  }

  async function requireSyncPackageForApply() {
    const status = await invoke<CodexSyncPackageStatus>('codex_sync_package_status');
    setSyncPackage(status);
    const blocker = syncPackageApplyBlocker(status);
    if (blocker) throw new Error(blocker);
    const preflight = await refreshSyncPackagePreflight();
    const preflightBlocker = syncPackagePreflightBlocker(preflight);
    if (preflightBlocker) throw new Error(preflightBlocker);
    return status;
  }

  async function refreshConfig() {
    const config = await invoke<GeneralConfig>('get_general_config');
    setCodexAppPath(config.codex_app_path || '');
  }

  async function refreshAppVersion() {
    setAppVersion(await getVersion());
  }

  async function refreshAll() {
    await Promise.allSettled([
      refreshCodexAccounts(),
      refreshCodexInstances(),
      refreshSyncPackage(),
      refreshSyncPackageBackups(),
      refreshSyncPackagePreflight(),
      refreshDiagnostics(),
      refreshConfig(),
      refreshAppVersion(),
    ]);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (readThemeMode() === 'system') applyThemeMode('system');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [themeMode]);

  async function withBusy(label: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function createCodexClone(authType: AuthType = 'apiKey') {
    await withBusy('create-codex', async () => {
      const name = codexForm.name.trim();
      if (!name) throw new Error(text.requiredName);
      if (authType === 'apiKey' && (!codexForm.baseUrl.trim() || !codexForm.apiKey.trim())) {
        throw new Error(text.requiredApi);
      }
      if (authType === 'officialAccount' && !officialAccountId) {
        throw new Error(text.requiredOfficial);
      }
      if (codexForm.inheritLocalData) {
        await requireSyncPackageForApply();
      }
      if (codexForm.goalEnabled && !codexForm.goalText.trim()) {
        throw new Error(text.goalPursuitRequired);
      }
      if (codexForm.promptPackEnabled && !codexForm.promptPackText.trim()) {
        throw new Error(text.promptPackRequired);
      }

      const input: Record<string, unknown> = {
        name,
        authType,
        launchAfterCreate: codexForm.launchAfterCreate,
        inheritLocalData: codexForm.inheritLocalData,
        model: codexForm.model.trim() || DEFAULT_MODEL,
        modelCatalogEnabled: codexForm.modelCatalogEnabled,
        modelCatalogModels: codexForm.modelCatalogEnabled ? modelCatalogModels : [],
        workingDir: codexForm.workingDir.trim() || null,
        launchScript: codexForm.launchScript.trim() || null,
        goalEnabled: codexForm.goalEnabled,
        goal: codexForm.goalEnabled ? codexForm.goalText.trim() : null,
        promptPackEnabled: codexForm.promptPackEnabled,
        promptPack: codexForm.promptPackEnabled ? codexForm.promptPackText.trim() : null,
      };

      if (authType === 'apiKey') {
        input.apiKeyConfig = {
          apiKey: codexForm.apiKey.trim(),
          baseUrl: codexForm.baseUrl.trim(),
          providerId: codexForm.providerId.trim() || DEFAULT_PROVIDER_ID,
          providerName: codexForm.providerName.trim() || DEFAULT_PROVIDER_NAME,
        };
      } else {
        input.officialAccountId = officialAccountId;
      }

      const instance = await invoke<InstanceProfile>('codex_create_clone_and_launch', { input });
      await refreshCodexInstances();
      showMessage(
        'success',
        `${codexForm.launchAfterCreate ? text.createdLaunched : text.created}: ${creationHistoryMessage(instance)}`,
      );
      setPage('codexList');
    });
  }

  async function startOfficialLogin() {
    await withBusy('oauth-start', async () => {
      const response = await invoke<OAuthStartResponse>('codex_oauth_login_start');
      const loginId = response.loginId ?? response.login_id ?? '';
      const authUrl = response.authUrl ?? response.auth_url ?? '';
      if (!loginId || !authUrl) {
        throw new Error('OAuth start response missing loginId/authUrl');
      }
      setPendingLoginId(loginId);
      await openUrl(authUrl);
      showMessage('success', text.oauthOpened);
    });
  }

  async function completeOfficialLogin() {
    if (!pendingLoginId) {
      showMessage('error', text.noPendingLogin);
      return;
    }
    await withBusy('oauth-complete', async () => {
      const account = await invoke<CodexAccount>('codex_oauth_login_completed', {
        loginId: pendingLoginId,
      });
      setPendingLoginId('');
      await refreshCodexAccounts();
      setOfficialAccountId(account.id);
      showMessage('success', `${text.officialConnected}: ${accountLabel(account)}`);
    });
  }

  async function startCodexInstance(instanceId: string) {
    await withBusy(`codex-start-${instanceId}`, async () => {
      await invoke('codex_start_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexStarted);
    });
  }

  async function stopCodexInstance(instanceId: string) {
    await withBusy(`codex-stop-${instanceId}`, async () => {
      await invoke('codex_stop_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexStopped);
    });
  }

  async function deleteCodexInstance(instanceId: string) {
    await withBusy(`codex-delete-${instanceId}`, async () => {
      await invoke('codex_delete_instance', { instanceId });
      await refreshCodexInstances();
      showMessage('success', text.codexDeleted);
    });
  }

  async function refreshCodexHistory(instanceId: string) {
    await withBusy(`codex-history-refresh-${instanceId}`, async () => {
      const status = await invoke<CodexHistoryStatus>('codex_history_status', { instanceId });
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      showMessage('success', `记忆状态：${historySummary(status)}`);
    });
  }

  async function verifyCodexHistory(instanceId: string) {
    await withBusy(`codex-history-verify-${instanceId}`, async () => {
      const status = await invoke<CodexHistoryStatus>('codex_history_verify', { instanceId });
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      showMessage(status.ok ? 'success' : 'error', `记忆校验：${historySummary(status)}`);
    });
  }

  async function extractCodexSyncPackage() {
    await withBusy('codex-sync-package-extract', async () => {
      const status = await invoke<CodexSyncPackageStatus>('codex_extract_sync_package');
      setSyncPackage(status);
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage(
        'success',
        `${text.syncPackageExtracted}: ${status.fileCount} 文件 / ${status.directoryCount} 目录 / ${formatBytes(status.copiedBytes)}`,
      );
    });
  }

  async function restoreSyncPackageBackup(backupId: string) {
    await withBusy(`codex-sync-package-restore-${backupId}`, async () => {
      const status = await invoke<CodexSyncPackageStatus>('codex_restore_sync_package_backup', { backupId });
      setSyncPackage(status);
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage(
        'success',
        `${text.syncPackageRestoredBackup}: ${backupId} / ${status.fileCount} 文件 / ${status.directoryCount} 目录`,
      );
    });
  }

  async function refreshCodexSyncPackageStatus() {
    await withBusy('codex-sync-package-status', async () => {
      await refreshSyncPackage();
      await refreshSyncPackageBackups();
      await refreshSyncPackagePreflight();
      showMessage('success', text.syncPackageStatusRefreshed);
    });
  }

  async function refreshCodexSyncPackagePreflight() {
    await withBusy('codex-sync-package-preflight', async () => {
      const preflight = await refreshSyncPackagePreflight();
      showMessage('success', `Preflight: ${preflight.status} / errors ${preflight.errorCount} / warnings ${preflight.warningCount}`);
    });
  }

  async function refreshDiagnosticsStatus() {
    await withBusy('diagnostics-refresh', async () => {
      await refreshDiagnostics();
      showMessage('success', text.diagnosticsRefresh);
    });
  }

  async function copyDiagnosticsReport() {
    const localErrors = getLocalErrorEvents();
    const report = buildDiagnosticsReport({
      diagnostics,
      syncPackage,
      syncPackageBackups,
      syncPackagePreflight,
      updateStatus,
      availableUpdate,
      updaterOwnerRepo: updaterConfig.ownerRepo,
      updaterEndpoint: updaterConfig.endpoint,
      localErrors,
      gitWorktreeForm,
      gitWorktreeDefaults,
      gitWorktreeResult,
      providerTestResult,
      providerModelsResult,
      providerConfigAudit,
      modelCatalogEnabled: codexForm.modelCatalogEnabled,
      modelCatalogModels,
      promptPackEnabled: codexForm.promptPackEnabled,
      promptPackChars: codexForm.promptPackText.trim().length,
      instances: codexCloneList,
      historyByInstance,
      usageByInstance,
      providerPresetCatalog,
      providerHealthHistory,
      codexAppPath,
      appVersion,
      labels: {
        diagnosticsNoLogs: text.diagnosticsNoLogs,
        sessionCostUnpriced: text.sessionCostUnpriced,
      },
      formatters: {
        formatTime,
        formatBytes,
        formatShortPath,
        formatUsd,
      },
      syncPackageLabels: syncPackageStatusLabels,
      syncPackageStateLabel,
      cloneReadinessSummary,
    });
    setDiagnosticsReport(report);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.diagnosticsReportCopied);
    } catch (error) {
      reportError(error, { area: 'diagnostics', action: 'copy-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copyGitWorktreeDiagnosticsReport() {
    const report = buildGitWorktreeDiagnosticsReport({
      form: gitWorktreeForm,
      defaults: gitWorktreeDefaults,
      result: gitWorktreeResult,
      appVersion,
    });
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.worktreeDiagnosticsCopied);
    } catch (error) {
      reportError(error, { area: 'git-worktree', action: 'copy-diagnostics' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageResourceReport() {
    const report = buildSyncPackageResourceReport(syncPackage, syncPackageReportDeps);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncManifestTitle}: copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copyResourceLensReport() {
    const report = buildResourceLensReport(syncPackage, syncPackageReportDeps);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', text.resourceLensCopied);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-lens-report' });
      showMessage('error', `${text.resourceLensCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageBackupReport() {
    const report = buildSyncPackageBackupReport(syncPackageBackups, syncPackageReportDeps);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncPackageTitle}: backups copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-backup-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackagePreflightReport() {
    const report = buildSyncPackagePreflightReport(syncPackagePreflight, syncPackageReportDeps);
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncPackageTitle}: preflight copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-preflight-report' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function repairCodexHistory(instanceId: string) {
    await withBusy(`codex-history-repair-${instanceId}`, async () => {
      await requireSyncPackageForApply();
      const result = await invoke<CodexHistorySyncResult>('codex_history_repair', { instanceId });
      const status = await invoke<CodexHistoryStatus>('codex_history_status', { instanceId });
      await refreshSyncPackage();
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      const warningText = result.warnings?.length ? `；提示：${result.warnings[0]}` : '';
      const markerText = status.syncPackageApplied
        ? `；应用记录 ${syncPackageAppliedResourceRatio(status.syncPackageApplied)} / ${formatBytes(status.syncPackageApplied.copiedBytes ?? 0)}`
        : '';
      showMessage(
        result.ok ? 'success' : 'error',
        `已应用本体同步包，聊天 ${result.syncedThreads} 条源线程，对齐 ${result.updatedThreads} 行、${result.updatedSessionFiles} 个 session，mismatch ${result.mismatchCountAfter}${markerText}${warningText}`,
      );
    });
  }

  async function exportCodexHistoryMarkdown(instanceId: string) {
    await withBusy(`codex-history-export-${instanceId}`, async () => {
      const exported = await invoke<CodexSessionExportResult[]>(
        'codex_export_recent_sessions_markdown',
        { instanceId, limit: 5 },
      );
      const first = exported[0]?.exportedPath ?? '';
      const exportDir = first ? first.replace(/[\\/][^\\/]*$/, '') : '';
      if (exportDir) {
        setExportDirByInstance((current) => ({ ...current, [instanceId]: exportDir }));
      }
      showMessage(
        'success',
        `${text.historyExportedMarkdown}: ${exported.length} 个会话${first ? ` -> ${first}` : ''}`,
      );
    });
  }

  async function refreshCodexSessionList(instanceId: string) {
    await withBusy(`codex-session-list-${instanceId}`, async () => {
      const sessions = await invoke<CodexSessionSummary[]>('codex_list_recent_sessions', {
        instanceId,
        limit: 8,
      });
      setSessionsByInstance((current) => ({ ...current, [instanceId]: sessions }));
      showMessage('success', `${text.sessionReadSuccessPrefix}${sessions.length}${text.sessionReadSuccessSuffix}`);
    });
  }

  async function copyCodexSessionProjectDir(projectDir: string) {
    try {
      await navigator.clipboard.writeText(projectDir);
      showMessage('success', `${text.sessionProjectDirCopied}: ${projectDir}`);
    } catch (error) {
      reportError(error, { area: 'sessions', action: 'copy-project-dir' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function refreshCodexSessionUsage(instanceId: string) {
    await withBusy(`codex-session-usage-${instanceId}`, async () => {
      const usage = await invoke<CodexSessionUsageSummary>('codex_scan_session_usage', {
        instanceId,
      });
      setUsageByInstance((current) => ({ ...current, [instanceId]: usage }));
      showMessage(
        'success',
        `${text.sessionUsageTitle}: ${usage.eventCount} ${text.sessionUsageEventsUnit} / ${formatTokenCount(usage.totalTokens)} ${text.sessionUsageTokensUnit} / ${usage.scannedFiles} ${text.sessionUsageFiles}`,
      );
    });
  }

  async function openCodexHistoryExportDir(instanceId: string) {
    const path = exportDirByInstance[instanceId];
    if (!path) return;
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openCodexInstanceInZed(instanceId: string) {
    await withBusy(`codex-open-zed-${instanceId}`, async () => {
      const result = await invoke<ZedOpenResult>('codex_open_instance_in_zed', { instanceId });
      showMessage('success', `${text.openZedDone}: ${result.mode} -> ${result.target}`);
    });
  }

  async function bulkRefreshCodexHistory() {
    await withBusy('codex-history-bulk-refresh', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      const updates: Record<string, CodexHistoryStatus> = {};
      for (const instance of codexCloneList) {
        updates[instance.id] = await invoke<CodexHistoryStatus>('codex_history_status', {
          instanceId: instance.id,
        });
      }
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      showMessage('success', `${text.healthBulkDone}: ${codexCloneList.length}`);
    });
  }

  async function bulkVerifyCodexHistory() {
    await withBusy('codex-history-bulk-verify', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      const updates: Record<string, CodexHistoryStatus> = {};
      let okCount = 0;
      for (const instance of codexCloneList) {
        const status = await invoke<CodexHistoryStatus>('codex_history_verify', {
          instanceId: instance.id,
        });
        updates[instance.id] = status;
        if (status.ok) okCount += 1;
      }
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      showMessage(
        okCount === codexCloneList.length ? 'success' : 'error',
        `${text.healthBulkDone}: ${okCount}/${codexCloneList.length} OK`,
      );
    });
  }

  async function bulkRepairCodexHistory() {
    await withBusy('codex-history-bulk-repair', async () => {
      if (!codexCloneList.length) throw new Error(text.healthNoClones);
      await requireSyncPackageForApply();
      const updates: Record<string, CodexHistoryStatus> = {};
      let okCount = 0;
      for (const instance of codexCloneList) {
        const result = await invoke<CodexHistorySyncResult>('codex_history_repair', {
          instanceId: instance.id,
        });
        const status = await invoke<CodexHistoryStatus>('codex_history_status', {
          instanceId: instance.id,
        });
        updates[instance.id] = status;
        if (result.ok && status.ok) okCount += 1;
      }
      await refreshSyncPackage();
      setHistoryByInstance((current) => ({ ...current, ...updates }));
      const appliedCount = Object.values(updates).filter((status) => status.syncPackageApplied).length;
      showMessage(
        okCount === codexCloneList.length ? 'success' : 'error',
        `${text.healthBulkDone}: ${okCount}/${codexCloneList.length} OK；应用记录 ${appliedCount}/${codexCloneList.length}`,
      );
    });
  }

  async function pickCodexAppPath() {
    const selected = await open({ multiple: false, directory: false });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) setCodexAppPath(path);
  }

  async function detectCodexAppPath() {
    await withBusy('detect-codex', async () => {
      const path = await invoke<string | null>('detect_app_path', { app: 'codex', force: true });
      setCodexAppPath(path || '');
      showMessage(path ? 'success' : 'error', path ? `${text.pathDetected}: ${path}` : text.pathMissing);
    });
  }

  async function saveSettings() {
    await withBusy('settings-save', async () => {
      await invoke('set_app_path', { app: 'codex', path: codexAppPath.trim() });
      showMessage('success', text.settingsSaved);
    });
  }

  async function pickGitWorktreeRepoDir() {
    const selected = await open({ multiple: false, directory: true });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) updateGitWorktreeForm({ repoDir: path });
  }

  async function pickGitWorktreeTargetDir() {
    const selected = await open({ multiple: false, directory: true });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) updateGitWorktreeForm({ worktreeDir: path });
  }

  async function detectGitWorktreeDefaults() {
    await withBusy('git-worktree-detect', async () => {
      const repoDir = gitWorktreeForm.repoDir.trim();
      if (!repoDir) throw new Error(text.worktreeRequiredRepo);
      const defaults = await invoke<GitWorktreeDefaults>('codex_git_worktree_defaults', {
        repoDir,
      });
      setGitWorktreeDefaults(defaults);
      setGitWorktreeResult(null);
      updateGitWorktreeForm({
        repoDir: defaults.repoDir,
        baseRemote: defaults.baseRemote,
        baseBranch: defaults.baseBranch,
        newBranch: defaults.suggestedBranch,
        worktreeDir: defaults.suggestedWorktreeDir,
      });
      showMessage('success', `${text.worktreeDetected}: ${defaults.baseRef}`);
    });
  }

  async function createGitWorktree() {
    await withBusy('git-worktree-create', async () => {
      const repoDir = gitWorktreeForm.repoDir.trim();
      const newBranch = gitWorktreeForm.newBranch.trim();
      const worktreeDir = gitWorktreeForm.worktreeDir.trim();
      if (!repoDir) throw new Error(text.worktreeRequiredRepo);
      if (!newBranch || !worktreeDir) throw new Error(text.worktreeRequiredBranch);
      const result = await invoke<GitWorktreeCreateResult>('codex_create_upstream_worktree', {
        input: {
          repoDir,
          baseRemote: gitWorktreeForm.baseRemote.trim() || 'upstream',
          baseBranch: gitWorktreeForm.baseBranch.trim() || 'main',
          newBranch,
          worktreeDir,
          fetchBeforeCreate: gitWorktreeForm.fetchBeforeCreate,
        },
      });
      setGitWorktreeResult(result);
      updateCodexForm({ workingDir: result.worktreeDir });
      showMessage('success', `${text.worktreeCreated}: ${result.baseRef} -> ${result.worktreeDir}`);
    });
  }

  function useGitWorktreeResultInCreateForm() {
    if (!gitWorktreeResult?.worktreeDir) return;
    updateCodexForm({ workingDir: gitWorktreeResult.worktreeDir });
    setPage('codexCreate');
    showMessage('success', `${text.worktreeUseInCreate}: ${gitWorktreeResult.worktreeDir}`);
  }

  async function openDiagnosticsLogDir() {
    const path = diagnostics?.logDir;
    if (!path) {
      showMessage('error', text.diagnosticsNoLogs);
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openSyncPackageDir() {
    const path = syncPackage?.packagePath || syncPackage?.manifestPath;
    if (!path) {
      showMessage('error', text.syncPackageApplyMissing);
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function openSyncPackageBackupDir(path: string) {
    try {
      await openPath(path);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  function findCodexClone(instanceId: string): InstanceProfile | null {
    return codexCloneList.find((instance) => instance.id === instanceId) ?? null;
  }

  function syncPackageAppliedPayload(instanceId: string) {
    const instance = findCodexClone(instanceId);
    if (!instance) return null;
    const history = historyByInstance[instanceId] ?? instance.historyStatus;
    const marker = history?.syncPackageApplied;
    if (!marker) return null;
    const codexHome = history?.codexHome || instance.userDataDir;
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      codexHome,
      markerPath: syncPackageAppliedMarkerPath(instance, history),
      marker,
    };
  }

  async function openSyncPackageAppliedMarker(instanceId: string) {
    const payload = syncPackageAppliedPayload(instanceId);
    if (!payload?.markerPath) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    try {
      await openPath(payload.markerPath);
    } catch (error) {
      showMessage('error', `${text.openPathFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageAppliedMarker(instanceId: string) {
    const payload = syncPackageAppliedPayload(instanceId);
    if (!payload) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showMessage('success', text.syncPackageAppliedCopied);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-applied-marker' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  async function copySyncPackageResourceDiff(instanceId: string) {
    const instance = findCodexClone(instanceId);
    if (!instance) {
      showMessage('error', text.syncPackageAppliedMissing);
      return;
    }
    const history = historyByInstance[instanceId] ?? instance.historyStatus;
    const report = buildSyncPackageResourceDiffReport(
      { currentPackage: syncPackage, history, instance },
      syncPackageResourceDiffReportDeps,
    );
    try {
      await navigator.clipboard.writeText(report);
      showMessage('success', `${text.syncManifestTitle}: diff copied`);
    } catch (error) {
      reportError(error, { area: 'sync-package', action: 'copy-resource-diff' });
      showMessage('error', `${text.diagnosticsReportCopyFailed}: ${String(error)}`);
    }
  }

  const advancedOptionsDefaultOpen = Boolean(
    codexForm.workingDir.trim() ||
      codexForm.launchScript.trim() ||
      codexForm.modelCatalogEnabled ||
      codexForm.goalEnabled ||
      codexForm.goalText.trim() ||
      codexForm.promptPackEnabled ||
      (codexForm.promptPackText.trim() && codexForm.promptPackText.trim() !== text.promptPackDefault.trim()),
  );

  const navItems: Array<{ id: Page; label: string }> = [
    { id: 'dashboard', label: text.dashboard },
    { id: 'codexCreate', label: text.createCodex },
    { id: 'codexList', label: text.codexList },
    { id: 'settings', label: text.settings },
    { id: 'guide', label: text.guide },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">{text.brand}</div>
          <h1>{text.appTitle}</h1>
        </div>
        <div className="topbar-actions">
          <nav className="tabs">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? 'active' : ''}
                onClick={() => setPage(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="theme-switch" aria-label={text.themeLabel}>
            <button
              className={themeMode === 'system' ? 'active' : ''}
              onClick={() => updateThemeMode('system')}
              title={text.themeSystem}
              type="button"
            >
              <Monitor size={16} />
            </button>
            <button
              className={themeMode === 'dark' ? 'active' : ''}
              onClick={() => updateThemeMode('dark')}
              title={text.themeDark}
              type="button"
            >
              <Moon size={16} />
            </button>
            <button
              className={themeMode === 'light' ? 'active' : ''}
              onClick={() => updateThemeMode('light')}
              title={text.themeLight}
              type="button"
            >
              <Sun size={16} />
            </button>
          </div>
        </div>
      </header>

      {message ? (
        <div className={`notice ${message.tone}`}>
          {message.tone === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <span>{message.text}</span>
        </div>
      ) : null}

      {busy ? (
        <div className="notice working">
          <Loader2 className="spin" size={18} />
          <span>{busyMessage(busy)}</span>
        </div>
      ) : null}

      <input
        ref={cloneSnapshotImportRef}
        accept="application/json,.json"
        className="hidden-file-input"
        onChange={handleCloneSnapshotImport}
        type="file"
      />

      {page === 'dashboard' ? (
        <DashboardPage
          labels={dashboardPageLabels}
          syncPackage={syncPackage}
          instances={codexCloneList}
          historyByInstance={historyByInstance}
          appVersion={appVersion}
          busy={busy}
          packageState={syncPackageStateLabel(syncPackage)}
          packageBytesLabel={formatBytes(syncPackage?.copiedBytes ?? 0)}
          syncBlocker={syncPackageRepairBlocker(syncPackage, syncPackagePreflight)}
          onOpenCreate={() => setPage('codexCreate')}
          onOpenList={() => setPage('codexList')}
          onOpenSettings={() => setPage('settings')}
          onBulkRefresh={bulkRefreshCodexHistory}
          onBulkVerify={bulkVerifyCodexHistory}
          onBulkRepair={bulkRepairCodexHistory}
        />
      ) : null}

      {page === 'codexCreate' ? (
        <CreateCodexPage
          labels={{
            codexHeroTitle: text.codexHeroTitle,
            codexHeroLead: text.codexHeroLead,
            thirdPartyApi: text.thirdPartyApi,
            collapseOfficial: text.collapseOfficial,
            officialEntry: text.officialEntry,
            cloneSnapshotImport: text.cloneSnapshotImport,
            cloneName: text.cloneName,
            model: text.model,
            baseUrl: text.baseUrl,
            apiKey: text.apiKey,
            providerModelsHint: text.providerModelsHint,
            providerTestHint: text.providerTestHint,
            providerModelsFetch: text.providerModelsFetch,
            providerTest: text.providerTest,
            officialTitle: text.officialTitle,
            officialLead: text.officialLead,
            openOfficialLogin: text.openOfficialLogin,
            completeLogin: text.completeLogin,
            chooseOfficial: text.chooseOfficial,
            useOfficial: text.useOfficial,
            advancedOptions: text.advancedOptions,
            workdir: text.workdir,
            launchScript: text.launchScript,
            launchScriptHint: text.launchScriptHint,
            modelCatalog: text.modelCatalog,
            modelCatalogHint: text.modelCatalogHint,
            providerModelsCountUnit: text.providerModelsCountUnit,
            modelCatalogStandby: text.modelCatalogStandby,
            modelCatalogEmpty: text.modelCatalogEmpty,
            goalPursuit: text.goalPursuit,
            goalPursuitHint: text.goalPursuitHint,
            goalPursuitPlaceholder: text.goalPursuitPlaceholder,
            promptPack: text.promptPack,
            promptPackHint: text.promptPackHint,
            promptPackPlaceholder: text.promptPackPlaceholder,
            launchAfterCreate: text.launchAfterCreate,
            inheritCodex: text.inheritCodex,
            createAndLaunchCodex: text.createAndLaunchCodex,
            createOnlyCodex: text.createOnlyCodex,
            inheritTitle: text.inheritTitle,
            inheritChat: text.inheritChat,
            inheritSkills: text.inheritSkills,
            inheritMcp: text.inheritMcp,
            inheritGoals: text.inheritGoals,
            inheritPlugins: text.inheritPlugins,
            inheritNote: text.inheritNote,
          }}
          form={codexForm}
          busy={busy}
          showOfficialPanel={showOfficialPanel}
          canCompleteOfficialLogin={Boolean(pendingLoginId)}
          officialAccountId={officialAccountId}
          officialAccountOptions={officialAccountOptions}
          providerModelsResult={providerModelsResult}
          providerConfigAudit={providerConfigAudit}
          providerTestResult={providerTestResult}
          providerFeedbackLabels={providerFeedbackLabels}
          modelCatalogModels={modelCatalogModels}
          advancedOptionsDefaultOpen={advancedOptionsDefaultOpen}
          onToggleOfficialPanel={() => setShowOfficialPanel((value) => !value)}
          onOpenCloneSnapshotImport={openCloneSnapshotImport}
          onFormChange={updateCodexForm}
          onFetchProviderModels={() => void fetchProviderModels()}
          onTestProviderConnection={() => void testProviderConnection()}
          onStartOfficialLogin={startOfficialLogin}
          onCompleteOfficialLogin={completeOfficialLogin}
          onOfficialAccountChange={setOfficialAccountId}
          onCreateOfficialClone={() => void createCodexClone('officialAccount')}
          onCreateApiKeyClone={() => void createCodexClone('apiKey')}
        />
      ) : null}

      {page === 'codexList' ? (
        <CodexInstancesPage
          labels={{
            syncPackage: {
              title: text.syncPackageTitle,
              missing: text.syncPackageMissing,
              ready: text.syncPackageReady,
              stale: text.syncPackageStale,
              staleHint: text.syncPackageStaleHint,
              applyMissing: text.syncPackageApplyMissing,
              refresh: text.syncPackageRefresh,
              refreshing: text.refreshing,
              historyRefresh: text.historyRefresh,
              preflight: text.preflight,
              moreActions: text.moreActions,
              copyResources: text.copyResources,
              copyPreflight: text.copyPreflight,
              copyBackups: text.copyBackups,
              resourceLensCopy: text.resourceLensCopy,
              details: text.syncPackageDetails,
              manifestIncluded: text.syncManifestIncluded,
              manifestExcluded: text.syncManifestExcluded,
              manifestEntryPreview: text.syncManifestEntryPreview,
              manifestMoreEntries: text.syncManifestMoreEntries,
              manifestNoEntries: text.syncManifestNoEntries,
              resourceLensTitle: text.resourceLensTitle,
              backups: text.syncPackageBackups,
            },
            codexList: text.codexList,
            codexSubtitle: text.codexSubtitle,
            noCodex: text.noCodex,
            syncPackageApplyStale: text.syncPackageApplyStale,
          }}
          resourceLensLabels={resourceLensLabels}
          maintenanceLabels={syncPackageMaintenanceLabels}
          instanceListLabels={instanceListLabels}
          instanceListHelpers={instanceListHelpers}
          syncPackage={syncPackage}
          syncPackageBackups={syncPackageBackups}
          syncPackagePreflight={syncPackagePreflight}
          instances={codexCloneList}
          busy={busy}
          historyByInstance={historyByInstance}
          cloneCapabilityDrafts={cloneCapabilityDrafts}
          sessionsByInstance={sessionsByInstance}
          usageByInstance={usageByInstance}
          sessionSearchQuery={sessionSearchQuery}
          exportDirByInstance={exportDirByInstance}
          syncBlockedReason={syncPackageRepairBlocker(syncPackage, syncPackagePreflight)}
          formatBytes={formatBytes}
          formatTime={formatTime}
          onExtractSyncPackage={extractCodexSyncPackage}
          onRefreshSyncPackage={refreshCodexSyncPackageStatus}
          onPreflightSyncPackage={refreshCodexSyncPackagePreflight}
          onCopyResourceReport={copySyncPackageResourceReport}
          onCopyResourceLensReport={copyResourceLensReport}
          onCopyBackupReport={copySyncPackageBackupReport}
          onCopyPreflightReport={copySyncPackagePreflightReport}
          onOpenBackup={openSyncPackageBackupDir}
          onRestoreBackup={restoreSyncPackageBackup}
          onRefreshInstances={refreshCodexInstances}
          onStartInstance={startCodexInstance}
          onStopInstance={stopCodexInstance}
          onDeleteInstance={deleteCodexInstance}
          onHistoryRefresh={refreshCodexHistory}
          onHistoryVerify={verifyCodexHistory}
          onHistoryRepair={repairCodexHistory}
          onHistoryExportMarkdown={exportCodexHistoryMarkdown}
          onCloneSnapshotExport={exportCloneCapabilitySnapshot}
          onCloneSnapshotUse={useCloneCapabilitySnapshot}
          onCloneCapabilityEdit={startCloneCapabilityEdit}
          onCloneCapabilityDraftChange={updateCloneCapabilityDraft}
          onCloneCapabilitySave={saveCloneCapabilities}
          onCloneCapabilityCancel={cancelCloneCapabilityEdit}
          onSessionListRefresh={refreshCodexSessionList}
          onSessionUsageRefresh={refreshCodexSessionUsage}
          onSessionSearchQueryChange={setSessionSearchQuery}
          onCopySessionProjectDir={copyCodexSessionProjectDir}
          onOpenHistoryExportDir={openCodexHistoryExportDir}
          onOpenZed={openCodexInstanceInZed}
          onOpenSyncPackageAppliedMarker={openSyncPackageAppliedMarker}
          onCopySyncPackageAppliedMarker={copySyncPackageAppliedMarker}
          onCopySyncPackageResourceDiff={copySyncPackageResourceDiff}
        />
      ) : null}

      {page === 'settings' ? (
        <SettingsPage
          busy={busy}
          appVersion={appVersion}
          codexAppPath={codexAppPath}
          gitWorktreeForm={gitWorktreeForm}
          gitWorktreeDefaults={gitWorktreeDefaults}
          gitWorktreeResult={gitWorktreeResult}
          updateStatus={updateStatus}
          hasAvailableUpdate={Boolean(availableUpdate)}
          latestUpdateVersion={availableUpdate?.version}
          autoCheckUpdates={autoCheckUpdates}
          skippedUpdateVersion={skippedUpdateVersion}
          updaterOwnerRepo={updaterConfig.ownerRepo}
          updaterEndpoint={updaterConfig.endpoint}
          syncPackage={syncPackage}
          syncPackagePreflight={syncPackagePreflight}
          diagnostics={diagnostics}
          diagnosticsReport={diagnosticsReport}
          localErrors={getLocalErrorEvents()}
          packageState={syncPackageStateLabel(syncPackage)}
          diagnosticsSummary={diagnosticsSummary(diagnostics)}
          labels={{
            settings: text.settings,
            settingsLead: text.settingsLead,
            save: text.save,
            codexPath: text.codexPath,
            pick: text.pick,
            autoDetect: text.autoDetect,
            pathPlaceholder: text.pathPlaceholder,
            refreshing: text.refreshing,
            worktreeTitle: text.worktreeTitle,
            worktreeLead: text.worktreeLead,
            worktreeRepoDir: text.worktreeRepoDir,
            worktreeBaseRemote: text.worktreeBaseRemote,
            worktreeBaseBranch: text.worktreeBaseBranch,
            worktreeNewBranch: text.worktreeNewBranch,
            worktreeDir: text.worktreeDir,
            worktreeFetch: text.worktreeFetch,
            worktreeDetect: text.worktreeDetect,
            worktreeCreate: text.worktreeCreate,
            worktreeUseInCreate: text.worktreeUseInCreate,
            worktreeCopyDiagnostics: text.worktreeCopyDiagnostics,
            update: {
              title: text.updateTitle,
              currentVersion: text.currentVersion,
              unknownVersion: text.updateUnknownVersion,
              lead: text.updateLead,
              repository: text.updateRepository,
              endpoint: text.updateEndpoint,
              latestVersion: text.updateLatestVersion,
              checkedAt: text.updateCheckedAt,
              autoCheck: text.autoCheckUpdates,
              check: text.checkUpdate,
              checking: text.updateChecking,
              install: text.installUpdate,
              checkAndInstall: text.checkAndInstallUpdate,
              installing: text.updateInstalling,
              skip: text.skipThisVersion,
              resumeSkipped: text.resumeSkippedUpdate,
              openReleases: text.openReleases,
              never: text.never,
            },
            diagnostics: {
              title: text.diagnosticsTitle,
              lead: text.diagnosticsLead,
              quickActions: text.quickActions,
              packageFreshness: text.packageFreshness,
              launcherVersion: text.launcherVersion,
              diagnosticsPid: text.diagnosticsPid,
              codexPath: text.codexPath,
              pathPlaceholder: text.pathPlaceholder,
              diagnosticsLogDir: text.diagnosticsLogDir,
              issueSummary: text.diagnosticsIssueSummary,
              noIssues: text.diagnosticsNoIssues,
              refreshing: text.refreshing,
              refresh: text.diagnosticsRefresh,
              copyReport: text.diagnosticsCopyReport,
              openLogDir: text.diagnosticsOpenLogDir,
              openSyncPackage: text.diagnosticsOpenSyncPackage,
              reportPreview: text.diagnosticsReportPreview,
              logs: text.diagnosticsLogs,
              noLogs: text.diagnosticsNoLogs,
            },
          }}
          onSaveSettings={saveSettings}
          onCodexPathChange={setCodexAppPath}
          onPickCodexPath={() => void pickCodexAppPath()}
          onDetectCodexPath={() => void detectCodexAppPath()}
          onGitWorktreeChange={updateGitWorktreeForm}
          onPickGitWorktreeRepo={() => void pickGitWorktreeRepoDir()}
          onPickGitWorktreeTarget={() => void pickGitWorktreeTargetDir()}
          onDetectGitWorktree={() => void detectGitWorktreeDefaults()}
          onCreateGitWorktree={() => void createGitWorktree()}
          onUseGitWorktreeResult={useGitWorktreeResultInCreateForm}
          onCopyGitWorktreeDiagnostics={() => void copyGitWorktreeDiagnosticsReport()}
          onAutoCheckUpdatesChange={setAutoCheckUpdates}
          onCheckUpdate={() => void checkForAppUpdate()}
          onInstallUpdate={() => void installAppUpdate()}
          onSkipUpdate={() => skipAvailableUpdate()}
          onClearSkippedUpdate={() => clearSkippedUpdate()}
          onOpenReleases={() => void openReleasePage()}
          onRefreshDiagnostics={refreshDiagnosticsStatus}
          onCopyDiagnosticsReport={copyDiagnosticsReport}
          onOpenLogDir={openDiagnosticsLogDir}
          onOpenSyncPackage={openSyncPackageDir}
        />
      ) : null}

      {page === 'guide' ? (
        <OperationGuide
          cloneCount={codexCloneList.length}
          formatBytes={formatBytes}
          labels={operationGuideLabels}
          syncPackage={syncPackage}
        />
      ) : null}
    </div>
  );
}

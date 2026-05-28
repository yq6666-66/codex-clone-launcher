import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Settings,
} from 'lucide-react';
import './App.css';

type Page = 'codexCreate' | 'codexList' | 'settings';
type AuthType = 'apiKey' | 'officialAccount';

type CodexAccount = {
  id: string;
  email: string;
  auth_mode?: string | null;
  openai_api_key?: string | null;
  account_name?: string | null;
};

type OAuthStartResponse = {
  loginId?: string;
  authUrl?: string;
  login_id?: string;
  auth_url?: string;
};

type InstanceProfile = {
  id: string;
  name: string;
  userDataDir: string;
  running: boolean;
  isDefault?: boolean;
  lastPid?: number | null;
  lastLaunchedAt?: number | null;
  historyStatus?: CodexHistoryStatus | null;
};

type CodexHistoryStatus = {
  ok: boolean;
  currentProvider: string;
  currentModel?: string | null;
  threadCount: number;
  sessionFileCount: number;
  sessionIndexCount: number;
  mismatchCount: number;
  missingSessionFiles: number;
  authOk: boolean;
  boundAccountId?: string | null;
  authMode?: string | null;
  providerBaseUrlHost?: string | null;
  syncMode?: string | null;
  lastSyncAt?: number | null;
  lastBackupPath?: string | null;
  warnings: string[];
};

type CodexHistorySyncResult = {
  ok: boolean;
  dryRun: boolean;
  threadCount: number;
  mismatchCountBefore: number;
  mismatchCountAfter: number;
  updatedThreads: number;
  updatedRolloutPaths: number;
  updatedSessionFiles: number;
  rewrittenIndexEntries: number;
  syncedThreads: number;
  backupRetentionDeleted: number;
  lockWaitMs: number;
  stderrWarnings: string[];
  authMode?: string | null;
  providerBaseUrlHost?: string | null;
  syncMode?: string | null;
  backupPath?: string | null;
  warnings: string[];
};

type GeneralConfig = {
  codex_app_path: string;
};

type Message = {
  tone: 'success' | 'error';
  text: string;
};

type CloneFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  workingDir: string;
  inheritLocalData: boolean;
  launchAfterCreate: boolean;
};

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_PROVIDER_ID = 'custom';
const DEFAULT_PROVIDER_NAME = 'Custom API';

const text = {
  appTitle: 'Codex 分身启动器',
  brand: 'AI Clone Launcher',
  createCodex: '创建 Codex',
  codexList: 'Codex 列表',
  settings: '设置',
  codexHeroTitle: '输入 Base URL 和 API Key，创建 Codex 分身',
  codexHeroLead:
    '默认同步本机聊天记录、sessions、skills、MCP、plugins 和 memories；每个分身保留自己的 CODEX_HOME、auth 和额度配置。',
  thirdPartyApi: '第三方 API',
  officialEntry: '官方账号入口',
  collapseOfficial: '收起官方账号入口',
  cloneName: '分身名称',
  model: '模型',
  apiKey: 'API Key',
  workdir: '工作目录（可留空）',
  inheritCodex: '同步本机聊天记录、sessions、skills、MCP、plugins、memories',
  launchAfterCreate: '创建后立即启动',
  createAndLaunchCodex: '创建并启动 Codex 分身',
  createOnlyCodex: '创建 Codex 分身',
  officialTitle: '连接官方 OpenAI/Codex 账号',
  officialLead: '这是可选入口；Base URL + API Key 表单会一直保留。',
  openOfficialLogin: '打开官方登录',
  completeLogin: '完成登录',
  chooseOfficial: '选择官方账号',
  useOfficial: '使用所选官方账号创建分身',
  inheritTitle: '默认同步内容',
  inheritChat: '聊天记录、sessions、session_index',
  inheritSkills: 'skills、rules、AGENTS.md',
  inheritMcp: 'MCP 配置和 mcp-servers',
  inheritPlugins: 'plugins、memories、sqlite 状态',
  inheritNote:
    '创建和修复会写入 clone-history-sync-summary.json，并创建 SQLite 备份；不会复制 auth.json 或覆盖 config.toml。',
  noCodex: '还没有 Codex 分身，请先创建。',
  codexSubtitle: '只显示 Codex 分身，并提供记忆同步、校验和修复。',
  settingsLead: '只保留 Codex 启动路径。',
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
  historyRefresh: '刷新状态',
  running: '运行中',
  stopped: '未运行',
  never: '未启动',
  start: '启动',
  stop: '停止',
  delete: '删除',
  requiredName: '请填写分身名称',
  requiredApi: '请填写 Base URL 和 API Key',
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
  pathPlaceholder: '留空则自动探测',
} as const;

function defaultCloneValues(name: string): CloneFormValues {
  return {
    name,
    baseUrl: '',
    apiKey: '',
    model: DEFAULT_MODEL,
    workingDir: '',
    inheritLocalData: true,
    launchAfterCreate: true,
  };
}

function isApiKeyAccount(account: CodexAccount): boolean {
  return Boolean(account.openai_api_key) || account.auth_mode === 'api_key';
}

function accountLabel(account: CodexAccount): string {
  return account.account_name || account.email || account.id;
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

function visibleInstances(instances: InstanceProfile[]): InstanceProfile[] {
  return instances.filter((instance) => !instance.isDefault);
}

export default function App() {
  const [page, setPage] = useState<Page>('codexCreate');
  const [showOfficialPanel, setShowOfficialPanel] = useState(false);
  const [codexForm, setCodexForm] = useState<CloneFormValues>(() =>
    defaultCloneValues('Codex 工作分身'),
  );
  const [officialAccounts, setOfficialAccounts] = useState<CodexAccount[]>([]);
  const [officialAccountId, setOfficialAccountId] = useState('');
  const [pendingLoginId, setPendingLoginId] = useState('');
  const [codexInstances, setCodexInstances] = useState<InstanceProfile[]>([]);
  const [historyByInstance, setHistoryByInstance] = useState<Record<string, CodexHistoryStatus>>({});
  const [codexAppPath, setCodexAppPath] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<Message | null>(null);

  const codexCloneList = useMemo(() => visibleInstances(codexInstances), [codexInstances]);
  const officialAccountOptions = useMemo(
    () => officialAccounts.filter((account) => !isApiKeyAccount(account)),
    [officialAccounts],
  );

  function showMessage(tone: Message['tone'], value: string) {
    setMessage({ tone, text: value });
  }

  function updateCodexForm(patch: Partial<CloneFormValues>) {
    setCodexForm((current) => ({ ...current, ...patch }));
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

  async function refreshConfig() {
    const config = await invoke<GeneralConfig>('get_general_config');
    setCodexAppPath(config.codex_app_path || '');
  }

  async function refreshAll() {
    await Promise.allSettled([refreshCodexAccounts(), refreshCodexInstances(), refreshConfig()]);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

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

      const input: Record<string, unknown> = {
        name,
        authType,
        launchAfterCreate: codexForm.launchAfterCreate,
        inheritLocalData: codexForm.inheritLocalData,
        model: codexForm.model.trim() || DEFAULT_MODEL,
        workingDir: codexForm.workingDir.trim() || null,
      };

      if (authType === 'apiKey') {
        input.apiKeyConfig = {
          apiKey: codexForm.apiKey.trim(),
          baseUrl: codexForm.baseUrl.trim(),
          providerId: DEFAULT_PROVIDER_ID,
          providerName: DEFAULT_PROVIDER_NAME,
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

  async function repairCodexHistory(instanceId: string) {
    await withBusy(`codex-history-repair-${instanceId}`, async () => {
      const result = await invoke<CodexHistorySyncResult>('codex_history_repair', { instanceId });
      const status = await invoke<CodexHistoryStatus>('codex_history_status', { instanceId });
      setHistoryByInstance((current) => ({ ...current, [instanceId]: status }));
      showMessage(
        result.ok ? 'success' : 'error',
        `已同步 ${result.syncedThreads} 条源线程，对齐 ${result.updatedThreads} 行、${result.updatedSessionFiles} 个 session，mismatch ${result.mismatchCountAfter}`,
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

  const navItems: Array<{ id: Page; label: string }> = [
    { id: 'codexCreate', label: text.createCodex },
    { id: 'codexList', label: text.codexList },
    { id: 'settings', label: text.settings },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">{text.brand}</div>
          <h1>{text.appTitle}</h1>
        </div>
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
      </header>

      {message ? (
        <div className={`notice ${message.tone}`}>
          {message.tone === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <span>{message.text}</span>
        </div>
      ) : null}

      {page === 'codexCreate' ? (
        <main className="create-grid">
          <section className="hero-card">
            <div className="hero-badge">
              <Rocket size={16} />
              CODEX CLONE
            </div>
            <h2>{text.codexHeroTitle}</h2>
            <p>{text.codexHeroLead}</p>

            <div className="api-strip">
              <div>
                <KeyRound size={16} />
                {text.thirdPartyApi}
              </div>
              <button
                className={showOfficialPanel ? 'active' : ''}
                onClick={() => setShowOfficialPanel((value) => !value)}
                type="button"
              >
                {showOfficialPanel ? text.collapseOfficial : text.officialEntry}
              </button>
            </div>

            <div className="form-grid">
              <label>
                <span>{text.cloneName}</span>
                <input value={codexForm.name} onChange={(event) => updateCodexForm({ name: event.target.value })} />
              </label>
              <label>
                <span>{text.model}</span>
                <input value={codexForm.model} onChange={(event) => updateCodexForm({ model: event.target.value })} />
              </label>
              <label className="wide">
                <span>Base URL</span>
                <input
                  autoFocus
                  value={codexForm.baseUrl}
                  onChange={(event) => updateCodexForm({ baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label className="wide">
                <span>{text.apiKey}</span>
                <input
                  value={codexForm.apiKey}
                  onChange={(event) => updateCodexForm({ apiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                />
              </label>

              {showOfficialPanel ? (
                <div className="official-panel wide">
                  <div>
                    <strong>{text.officialTitle}</strong>
                    <p>{text.officialLead}</p>
                  </div>
                  <div className="official-actions">
                    <button onClick={startOfficialLogin} type="button" disabled={Boolean(busy)}>
                      {text.openOfficialLogin}
                    </button>
                    <button onClick={completeOfficialLogin} type="button" disabled={Boolean(busy) || !pendingLoginId}>
                      {text.completeLogin}
                    </button>
                  </div>
                  <select value={officialAccountId} onChange={(event) => setOfficialAccountId(event.target.value)}>
                    <option value="">{text.chooseOfficial}</option>
                    {officialAccountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-action"
                    onClick={() => void createCodexClone('officialAccount')}
                    type="button"
                    disabled={Boolean(busy)}
                  >
                    {text.useOfficial}
                  </button>
                </div>
              ) : null}

              <label className="wide">
                <span>{text.workdir}</span>
                <input
                  value={codexForm.workingDir}
                  onChange={(event) => updateCodexForm({ workingDir: event.target.value })}
                  placeholder="C:\\path\\to\\workspace"
                />
              </label>
            </div>

            <div className="checks">
              <label>
                <input
                  type="checkbox"
                  checked={codexForm.inheritLocalData}
                  onChange={(event) => updateCodexForm({ inheritLocalData: event.target.checked })}
                />
                {text.inheritCodex}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={codexForm.launchAfterCreate}
                  onChange={(event) => updateCodexForm({ launchAfterCreate: event.target.checked })}
                />
                {text.launchAfterCreate}
              </label>
            </div>

            <button className="primary-action" onClick={() => void createCodexClone('apiKey')} type="button" disabled={Boolean(busy)}>
              {busy === 'create-codex' ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {codexForm.launchAfterCreate ? text.createAndLaunchCodex : text.createOnlyCodex}
            </button>
          </section>

          <aside className="info-card">
            <h3>{text.inheritTitle}</h3>
            <ul>
              <li>{text.inheritChat}</li>
              <li>{text.inheritSkills}</li>
              <li>{text.inheritMcp}</li>
              <li>{text.inheritPlugins}</li>
            </ul>
            <p>{text.inheritNote}</p>
          </aside>
        </main>
      ) : null}

      {page === 'codexList' ? (
        <InstanceList
          title={text.codexList}
          subtitle={text.codexSubtitle}
          emptyText={text.noCodex}
          instances={codexCloneList}
          onRefresh={refreshCodexInstances}
          onStart={startCodexInstance}
          onStop={stopCodexInstance}
          onDelete={deleteCodexInstance}
          busy={busy}
          historyByInstance={historyByInstance}
          onHistoryRefresh={refreshCodexHistory}
          onHistoryVerify={verifyCodexHistory}
          onHistoryRepair={repairCodexHistory}
        />
      ) : null}

      {page === 'settings' ? (
        <section className="settings-page">
          <div className="section-header">
            <div>
              <h2>{text.settings}</h2>
              <p>{text.settingsLead}</p>
            </div>
            <button onClick={saveSettings} type="button" disabled={Boolean(busy)}>
              <Settings size={16} />
              {text.save}
            </button>
          </div>
          <PathRow
            title={text.codexPath}
            value={codexAppPath}
            onChange={setCodexAppPath}
            onPick={() => void pickCodexAppPath()}
            onDetect={() => void detectCodexAppPath()}
          />
        </section>
      ) : null}
    </div>
  );
}

function InstanceList(props: {
  title: string;
  subtitle: string;
  emptyText: string;
  instances: InstanceProfile[];
  busy: string;
  onRefresh: () => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  historyByInstance: Record<string, CodexHistoryStatus>;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
}) {
  return (
    <section className="list-page">
      <div className="section-header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
        <button onClick={() => void props.onRefresh()} type="button">
          <RefreshCw size={16} />
          {text.refresh}
        </button>
      </div>
      <InstanceTable {...props} />
    </section>
  );
}

function InstanceTable(props: {
  emptyText: string;
  instances: InstanceProfile[];
  busy: string;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  historyByInstance: Record<string, CodexHistoryStatus>;
  onHistoryRefresh?: (id: string) => Promise<void>;
  onHistoryVerify?: (id: string) => Promise<void>;
  onHistoryRepair?: (id: string) => Promise<void>;
}) {
  if (props.instances.length === 0) {
    return <div className="empty-state">{props.emptyText}</div>;
  }
  const showHistory = Boolean(props.onHistoryRefresh || props.onHistoryVerify || props.onHistoryRepair);

  return (
    <div className={showHistory ? 'instance-table with-history' : 'instance-table'}>
      <div className="table-head">
        <span>{text.instance}</span>
        <span>{text.profileDir}</span>
        <span>{text.status}</span>
        {showHistory ? <span>{text.history}</span> : null}
        <span>{text.lastLaunch}</span>
        <span>{text.actions}</span>
      </div>
      {props.instances.map((instance) => {
        const history = props.historyByInstance[instance.id] ?? instance.historyStatus;
        return (
          <div className="table-row" key={instance.id}>
            <strong>{instance.name || instance.id}</strong>
            <code>{instance.userDataDir}</code>
            <span className={instance.running ? 'status running' : 'status'}>
              {instance.running ? text.running : text.stopped}
            </span>
            {showHistory ? (
              <div className={history?.ok ? 'history-cell ok' : 'history-cell'}>
                <strong>{historySummary(history)}</strong>
                <small>
                  index {history?.sessionIndexCount ?? 0} / files {history?.sessionFileCount ?? 0}
                </small>
                <small>
                  {history?.authMode ?? 'auth ?'} / {history?.providerBaseUrlHost ?? 'host ?'}
                </small>
                <small>sync {history?.syncMode ?? 'shared'}</small>
                <small>backup {formatShortPath(history?.lastBackupPath)}</small>
                {history?.warnings?.length ? <small className="warning">{history.warnings[0]}</small> : null}
              </div>
            ) : null}
            <span>{formatTime(instance.lastLaunchedAt)}</span>
            <div className="row-actions">
              {instance.running ? (
                <button disabled={Boolean(props.busy)} onClick={() => void props.onStop(instance.id)} type="button">
                  {text.stop}
                </button>
              ) : (
                <button disabled={Boolean(props.busy)} onClick={() => void props.onStart(instance.id)} type="button">
                  {text.start}
                </button>
              )}
              {props.onHistoryRefresh ? (
                <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryRefresh?.(instance.id)} type="button">
                  {text.historyRefresh}
                </button>
              ) : null}
              {props.onHistoryVerify ? (
                <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryVerify?.(instance.id)} type="button">
                  {text.historyCheck}
                </button>
              ) : null}
              {props.onHistoryRepair ? (
                <button disabled={Boolean(props.busy)} onClick={() => void props.onHistoryRepair?.(instance.id)} type="button">
                  {text.historyRepair}
                </button>
              ) : null}
              <button className="danger" disabled={Boolean(props.busy)} onClick={() => void props.onDelete(instance.id)} type="button">
                {text.delete}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PathRow(props: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  onDetect: () => void;
}) {
  return (
    <div className="path-row">
      <label>
        <span>{props.title}</span>
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={text.pathPlaceholder} />
      </label>
      <button onClick={props.onPick} type="button">
        <FolderOpen size={16} />
        {text.pick}
      </button>
      <button onClick={props.onDetect} type="button">
        <RefreshCw size={16} />
        {text.autoDetect}
      </button>
    </div>
  );
}

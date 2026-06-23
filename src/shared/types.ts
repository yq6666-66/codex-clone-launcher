export type GeneralConfig = {
  codex_app_path: string;
};

export type GitWorktreeDefaults = {
  repoDir: string;
  currentBranch: string;
  remotes: string[];
  baseRemote: string;
  baseBranch: string;
  baseRef: string;
  suggestedBranch: string;
  suggestedWorktreeDir: string;
  dirty: boolean;
  warnings: string[];
};

export type GitWorktreeCreateResult = {
  repoDir: string;
  baseRef: string;
  newBranch: string;
  worktreeDir: string;
  fetched: boolean;
  output: string;
  warnings: string[];
};

export type GitWorktreeFormValues = {
  repoDir: string;
  baseRemote: string;
  baseBranch: string;
  newBranch: string;
  worktreeDir: string;
  fetchBeforeCreate: boolean;
};

export type CodexAccount = {
  id: string;
  email: string;
  auth_mode?: string | null;
  has_openai_api_key?: boolean | null;
  account_name?: string | null;
};

export type CloneFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelCatalogEnabled: boolean;
  providerId: string;
  providerName: string;
  workingDir: string;
  launchScript: string;
  goalEnabled: boolean;
  goalText: string;
  promptPackEnabled: boolean;
  promptPackText: string;
  inheritLocalData: boolean;
  launchAfterCreate: boolean;
};

export type CodexSyncPackageResourceSummary = {
  id: string;
  label: string;
  status: string;
  applyMode: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  paths: string[];
  missing: string[];
  errors: string[];
  items?: string[];
  detail: string;
};

export type CodexSyncPackageAppliedMarker = {
  version: number;
  appliedAt: number;
  packagePath: string;
  manifestPath: string;
  packageCreatedAt?: number | null;
  source?: string | null;
  staleWhenApplied: boolean;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  resources: CodexSyncPackageResourceSummary[];
  warnings: string[];
};

export type InstanceProfile = {
  id: string;
  name: string;
  userDataDir: string;
  workingDir?: string | null;
  launchScript?: string | null;
  modelCatalogEnabled?: boolean;
  modelCatalogPath?: string | null;
  modelCatalogCount?: number;
  goalEnabled?: boolean;
  goal?: string | null;
  goalPath?: string | null;
  promptPackEnabled?: boolean;
  promptPack?: string | null;
  promptPackPath?: string | null;
  running: boolean;
  isDefault?: boolean;
  lastPid?: number | null;
  lastLaunchedAt?: number | null;
  historyStatus?: CodexHistoryStatus | null;
};

export type CloneCapabilityEditDraft = {
  goalEnabled: boolean;
  goalText: string;
  promptPackEnabled: boolean;
  promptPackText: string;
};

export type CodexHistoryStatus = {
  codexHome?: string;
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
  syncPackageApplied?: CodexSyncPackageAppliedMarker | null;
  warnings: string[];
};

export type CodexHistorySyncResult = {
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

export type CodexSessionExportResult = {
  sessionId: string;
  title: string;
  exportedPath: string;
  messageCount: number;
};

export type CodexSessionSummary = {
  sessionId: string;
  title: string;
  rolloutPath: string;
  projectDir?: string | null;
  summary?: string | null;
  searchPreview?: string | null;
  messageCount: number;
  lastMessageAt?: string | null;
  rolloutExists: boolean;
};

export type CodexSessionUsageModelSummary = {
  model: string;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CodexSessionUsageSummary = {
  codexHome: string;
  scannedFiles: number;
  parsedFiles: number;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  firstEventAt?: string | null;
  lastEventAt?: string | null;
  byModel: CodexSessionUsageModelSummary[];
  warnings: string[];
};

export type ZedOpenResult = {
  target: string;
  mode: string;
  zedPath: string;
};

export type CodexProviderConnectionTestResult = {
  ok: boolean;
  codexReady: boolean;
  status: string;
  protocol: string;
  endpoint: string;
  httpStatus?: number | null;
  latencyMs: number;
  ttfbMs?: number | null;
  message: string;
  responsePreview?: string | null;
};

export type CodexProviderModelsFetchResult = {
  ok: boolean;
  status: string;
  endpoint: string;
  httpStatus?: number | null;
  latencyMs: number;
  modelCount: number;
  models: string[];
  message: string;
  responsePreview?: string | null;
};

export type CloneReadinessTone = 'ok' | 'warning' | 'blocked' | 'muted';

export type CloneReadinessCheck = {
  id: string;
  status: CloneReadinessTone;
  label: string;
  detail: string;
};

export type CloneReadinessSummary = {
  tone: CloneReadinessTone;
  label: string;
  detail: string;
  checks: CloneReadinessCheck[];
  blockingCount: number;
  warningCount: number;
};

export type CodexSyncPackageStatus = {
  exists: boolean;
  packagePath: string;
  manifestPath: string;
  source?: string | null;
  createdAt?: number | null;
  sourceModifiedAt?: number | null;
  stale: boolean;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  entries: Array<{
    path: string;
    kind: string;
    status: string;
    bytes: number;
    fileCount?: number;
    directoryCount?: number;
    sha256?: string | null;
    error?: string | null;
  }>;
  resources?: CodexSyncPackageResourceSummary[];
  skipped: string[];
  warnings: string[];
};

export type CodexSyncPackageBackupSummary = {
  id: string;
  backupPath: string;
  packagePath: string;
  manifestPath: string;
  backupCreatedAt?: number | null;
  packageCreatedAt?: number | null;
  source?: string | null;
  fileCount: number;
  directoryCount: number;
  copiedBytes: number;
  resourceCount: number;
  readyResourceCount: number;
  status: string;
  warnings: string[];
  error?: string | null;
};

export type CodexSyncPackagePreflightCheck = {
  id: string;
  label: string;
  status: string;
  detail: string;
  action?: string | null;
};

export type CodexSyncPackagePreflightReport = {
  checkedAt: number;
  status: string;
  readyToApply: boolean;
  packagePath: string;
  manifestPath: string;
  packageCreatedAt?: number | null;
  source?: string | null;
  stale: boolean;
  entriesChecked: number;
  resourcesChecked: number;
  errorCount: number;
  warningCount: number;
  unsafePaths: string[];
  checks: CodexSyncPackagePreflightCheck[];
};

export type DiagnosticsSnapshot = {
  logDir: string;
  latestLogFile?: string | null;
  latestLogTail: string;
  startupLogFile?: string | null;
  startupLogTail: string;
  startupMutexName: string;
  logFiles: Array<{
    name: string;
    path: string;
    bytes: number;
    modifiedAt?: number | null;
  }>;
  codexAppPath: string;
  codexAppPathExists: boolean;
  codexLaunchPath?: string | null;
  codexLaunchPathSource: string;
  launcherPid: number;
};

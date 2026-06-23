import { mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type {
  CodexHistoryStatus,
  CodexSyncPackagePreflightReport,
  CodexSyncPackageResourceSummary,
  CodexSyncPackageStatus,
  DiagnosticsSnapshot,
  InstanceProfile,
} from '../shared/types';

type InvokePayload = Record<string, unknown> | undefined;

type E2eState = {
  instances: InstanceProfile[];
  syncPackage: CodexSyncPackageStatus;
  preflight: CodexSyncPackagePreflightReport;
  calls: Array<{ cmd: string; args: InvokePayload }>;
};

declare global {
  interface Window {
    __CODEX_CLONE_E2E_STATE__?: E2eState;
  }
}

const now = 1_788_956_400_000;
const packagePath = 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\sync-package\\codex-home';
const manifestPath = 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\sync-package\\codex-sync-package-manifest.json';
const sourcePath = 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\source\\.codex';

const resources: CodexSyncPackageResourceSummary[] = [
  {
    id: 'skills',
    label: 'skills',
    status: 'ready',
    applyMode: 'shared-link',
    fileCount: 3,
    directoryCount: 2,
    bytes: 8192,
    paths: ['skills', 'vendor_imports/skills'],
    missing: [],
    errors: [],
    items: ['codex-security', 'build-web-apps', 'github'],
    detail: 'Skills are shared from the main Codex home instead of copied per clone.',
  },
  {
    id: 'mcp-servers',
    label: 'mcp-servers',
    status: 'ready',
    applyMode: 'shared-link',
    fileCount: 2,
    directoryCount: 1,
    bytes: 4096,
    paths: ['mcp-servers'],
    missing: [],
    errors: [],
    items: ['github', 'node_repl'],
    detail: 'MCP server definitions are shared from the main Codex home.',
  },
  {
    id: 'plugins-cache',
    label: 'plugins/cache',
    status: 'ready',
    applyMode: 'shared-link',
    fileCount: 6,
    directoryCount: 4,
    bytes: 32768,
    paths: ['plugins/cache'],
    missing: [],
    errors: [],
    items: ['openai-curated-remote', 'openai-bundled'],
    detail: 'Plugin bundles are linked to avoid duplicate memory and disk pressure.',
  },
];

function readySyncPackage(stale = false): CodexSyncPackageStatus {
  return {
    exists: true,
    packagePath,
    manifestPath,
    source: sourcePath,
    createdAt: now,
    sourceModifiedAt: stale ? now + 60_000 : now,
    stale,
    fileCount: 18,
    directoryCount: 9,
    copiedBytes: 96_256,
    entries: [
      { path: 'skills', kind: 'directory', status: 'copied', bytes: 8192, fileCount: 3, directoryCount: 2 },
      { path: 'mcp-servers', kind: 'directory', status: 'copied', bytes: 4096, fileCount: 2, directoryCount: 1 },
      { path: 'plugins/cache', kind: 'directory', status: 'shared', bytes: 32768, fileCount: 6, directoryCount: 4 },
      { path: 'sessions', kind: 'directory', status: 'merged', bytes: 51200, fileCount: 7, directoryCount: 2 },
    ],
    resources,
    skipped: ['auth.json', '.credentials.json', 'plugins/cache/log'],
    warnings: stale ? ['local Codex home changed after sync package extraction'] : [],
  };
}

function missingSyncPackage(): CodexSyncPackageStatus {
  return {
    exists: false,
    packagePath,
    manifestPath,
    source: null,
    createdAt: null,
    sourceModifiedAt: null,
    stale: false,
    fileCount: 0,
    directoryCount: 0,
    copiedBytes: 0,
    entries: [],
    resources: [],
    skipped: [],
    warnings: [],
  };
}

function preflightFor(status: CodexSyncPackageStatus): CodexSyncPackagePreflightReport {
  return {
    checkedAt: now + 5_000,
    status: status.exists ? 'ready' : 'missing',
    readyToApply: status.exists,
    packagePath: status.packagePath,
    manifestPath: status.manifestPath,
    packageCreatedAt: status.createdAt,
    source: status.source,
    stale: status.stale,
    entriesChecked: status.entries.length,
    resourcesChecked: status.resources?.length ?? 0,
    errorCount: 0,
    warningCount: status.warnings.length,
    unsafePaths: [],
    checks: [
      {
        id: 'manifest',
        label: 'manifest path',
        status: status.exists ? 'ok' : 'blocked',
        detail: status.exists ? 'manifest path matches current package root' : 'sync package is not extracted yet',
      },
      {
        id: 'resources',
        label: 'shared resources',
        status: status.exists ? 'ok' : 'blocked',
        detail: status.exists ? 'skills, MCP servers, and plugin cache are ready to link' : 'no resources to apply',
      },
    ],
  };
}

function historyStatus(instance: InstanceProfile, applied = false): CodexHistoryStatus {
  return {
    codexHome: instance.userDataDir,
    ok: true,
    currentProvider: 'e2e-provider',
    currentModel: 'gpt-5.5',
    threadCount: applied ? 4 : 0,
    sessionFileCount: applied ? 3 : 0,
    sessionIndexCount: applied ? 3 : 0,
    mismatchCount: 0,
    missingSessionFiles: 0,
    authOk: true,
    boundAccountId: 'api-key',
    authMode: 'apiKey',
    providerBaseUrlHost: '127.0.0.1',
    syncMode: applied ? 'sync-package' : 'empty',
    lastSyncAt: applied ? now + 8_000 : null,
    syncPackageApplied: applied
      ? {
          version: 1,
          appliedAt: now + 8_000,
          packagePath,
          manifestPath,
          packageCreatedAt: now,
          source: sourcePath,
          staleWhenApplied: false,
          fileCount: 18,
          directoryCount: 9,
          copiedBytes: 96_256,
          resources,
          warnings: [],
        }
      : null,
    warnings: [],
  };
}

function diagnosticsSnapshot(): DiagnosticsSnapshot {
  return {
    logDir: 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\logs',
    latestLogFile: 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\logs\\app.log',
    latestLogTail:
      '[info] e2e diagnostics log tail\n[warn] Authorization=Bearer e2e-secret-token-000000000000 path=C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\logs\\app.log\n[info] sync package preflight ready',
    startupLogFile: 'C:\\Users\\admin\\.codex_clone_launcher\\source\\codex-clone-launcher.log',
    startupLogTail:
      '[Launcher] e2e startup mutex available api_key=sk-e2e-diagnostics-000000000000\n[Launcher] raw token sk-e2e-standalone-000000000000',
    startupMutexName: 'Global\\CodexCloneLauncherStartup',
    logFiles: [
      {
        name: 'app.log',
        path: 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\logs\\app.log',
        bytes: 2048,
        modifiedAt: now,
      },
    ],
    codexAppPath: 'C:\\ProgramData\\Codex\\CodexApp\\Codex.exe',
    codexAppPathExists: true,
    codexLaunchPath: 'C:\\ProgramData\\Codex\\CodexApp\\Codex.exe',
    codexLaunchPathSource: 'configured',
    launcherPid: 4242,
  };
}

export function installTauriE2eMocks() {
  mockWindows('main');
  mockConvertFileSrc('windows');

  const state: E2eState = {
    instances: [],
    syncPackage: missingSyncPackage(),
    preflight: preflightFor(missingSyncPackage()),
    calls: [],
  };
  window.__CODEX_CLONE_E2E_STATE__ = state;

  mockIPC((cmd, args) => {
    const payload = args as InvokePayload;
    state.calls.push({ cmd, args: payload });

    switch (cmd) {
      case 'plugin:app|version':
        return '0.24.13';
      case 'get_general_config':
        return { codex_app_path: 'C:\\ProgramData\\Codex\\CodexApp\\Codex.exe' };
      case 'list_codex_accounts':
        return [];
      case 'codex_list_instances':
        return state.instances;
      case 'codex_sync_package_status':
        return state.syncPackage;
      case 'codex_sync_package_backups':
        return [];
      case 'codex_sync_package_preflight':
        state.preflight = preflightFor(state.syncPackage);
        return state.preflight;
      case 'get_diagnostics_snapshot':
        return diagnosticsSnapshot();
      case 'codex_extract_sync_package':
        state.syncPackage = readySyncPackage(false);
        state.preflight = preflightFor(state.syncPackage);
        return state.syncPackage;
      case 'codex_create_clone_and_launch': {
        const input = (payload?.input ?? {}) as Record<string, unknown>;
        const id = `e2e-${state.instances.length + 1}`;
        const instance: InstanceProfile = {
          id,
          name: String(input.name ?? 'E2E Clone'),
          userDataDir: `C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\instances\\codex\\${id}`,
          workingDir: typeof input.workingDir === 'string' ? input.workingDir : null,
          launchScript: typeof input.launchScript === 'string' ? input.launchScript : null,
          modelCatalogEnabled: Boolean(input.modelCatalogEnabled),
          modelCatalogPath: null,
          modelCatalogCount: Array.isArray(input.modelCatalogModels) ? input.modelCatalogModels.length : 0,
          goalEnabled: Boolean(input.goalEnabled),
          goal: typeof input.goal === 'string' ? input.goal : null,
          goalPath: null,
          promptPackEnabled: Boolean(input.promptPackEnabled),
          promptPack: typeof input.promptPack === 'string' ? input.promptPack : null,
          promptPackPath: null,
          running: Boolean(input.launchAfterCreate),
          lastPid: input.launchAfterCreate ? 5522 : null,
          lastLaunchedAt: input.launchAfterCreate ? now + 7_000 : null,
          historyStatus: historyStatus({ id, name: String(input.name ?? 'E2E Clone'), userDataDir: '' } as InstanceProfile, Boolean(input.inheritLocalData)),
        };
        state.instances = [instance, ...state.instances];
        return instance;
      }
      case 'codex_history_status': {
        const instance = state.instances.find((item) => item.id === payload?.instanceId) ?? state.instances[0];
        return historyStatus(instance, Boolean(instance?.historyStatus?.syncPackageApplied));
      }
      case 'codex_history_verify': {
        const instance = state.instances.find((item) => item.id === payload?.instanceId) ?? state.instances[0];
        return historyStatus(instance, Boolean(instance?.historyStatus?.syncPackageApplied));
      }
      case 'codex_history_repair': {
        const instance = state.instances.find((item) => item.id === payload?.instanceId) ?? state.instances[0];
        if (!instance) throw new Error('instance not found');
        instance.historyStatus = historyStatus(instance, true);
        return {
          ok: true,
          dryRun: false,
          threadCount: 4,
          mismatchCountBefore: 2,
          mismatchCountAfter: 0,
          updatedThreads: 4,
          updatedRolloutPaths: 3,
          updatedSessionFiles: 3,
          rewrittenIndexEntries: 3,
          syncedThreads: 4,
          backupRetentionDeleted: 0,
          lockWaitMs: 0,
          stderrWarnings: [],
          authMode: 'apiKey',
          providerBaseUrlHost: '127.0.0.1',
          syncMode: 'sync-package',
          backupPath: null,
          warnings: [],
        };
      }
      case 'codex_export_clone_capability_snapshot':
        return {
          exportedPath: 'C:\\Users\\admin\\AppData\\Local\\Temp\\codex-clone-e2e\\snapshot.json',
          snapshot: {
            version: 1,
            source: { instanceId: payload?.instanceId ?? 'e2e-1', instanceName: 'E2E Clone' },
            provider: {
              authType: 'apiKey',
              baseUrl: 'http://127.0.0.1:65535/v1',
              providerId: 'e2e',
              providerName: 'E2E Provider',
              model: 'gpt-5.5',
            },
            capabilities: {
              goalEnabled: false,
              goal: null,
              promptPackEnabled: false,
              promptPack: null,
              modelCatalogEnabled: false,
              modelCatalogModels: [],
            },
          },
        };
      case 'codex_list_recent_sessions':
        return [];
      case 'codex_scan_session_usage':
        return null;
      case 'codex_start_instance':
      case 'codex_stop_instance':
      case 'codex_delete_instance':
      case 'plugin:opener|open_path':
      case 'plugin:opener|open_url':
      case 'plugin:dialog|open':
        return null;
      case 'plugin:updater|check':
        throw new Error('latest.json missing updater signature in e2e failure-state check');
      default:
        throw new Error(`Unhandled E2E Tauri command: ${cmd}`);
    }
  });
}

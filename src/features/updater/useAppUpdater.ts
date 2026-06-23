import { useEffect, useRef, useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { openUrl } from '@tauri-apps/plugin-opener';
import { updaterConfig } from '../../generated/updater';
import { reportError } from '../../telemetry';
import type { UpdatePanelStatus } from './UpdatePanel';

const UPDATE_AUTO_CHECK_KEY = 'codex-clone-launcher:auto-update-check:v2';
const UPDATE_SKIPPED_VERSION_KEY = 'codex-clone-launcher:skipped-update-version';

export type AvailableUpdate = Awaited<ReturnType<typeof check>>;

export type AppUpdaterLabels = {
  idle: string;
  noUpdate: string;
  skipped: string;
  available: string;
  installing: string;
  installed: string;
  installedRestartFailed: string;
  checkFailed: string;
  installFailed: string;
  latestJsonMissing: string;
  signatureHint: string;
  desktopOnlyHint: string;
  networkHint: string;
};

type ShowMessage = (tone: 'success' | 'error', value: string) => void;
type WithBusy = (label: string, task: () => Promise<void>) => Promise<void>;

function readLocalStorageBoolean(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === 'true';
}

function diagnoseUpdateError(error: unknown, labels: AppUpdaterLabels): string {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();
  if (lower.includes('404') || lower.includes('not found') || lower.includes('latest.json')) {
    return labels.latestJsonMissing;
  }
  if (lower.includes('signature') || lower.includes('pubkey') || lower.includes('public key')) {
    return labels.signatureHint;
  }
  if (lower.includes('invoke') || lower.includes('__tauri') || lower.includes('tauri')) {
    return labels.desktopOnlyHint;
  }
  if (
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('dns') ||
    lower.includes('proxy') ||
    lower.includes('failed to fetch')
  ) {
    return labels.networkHint;
  }
  return detail;
}

export function useAppUpdater(input: {
  labels: AppUpdaterLabels;
  showMessage: ShowMessage;
  withBusy: WithBusy;
}) {
  const { labels, showMessage, withBusy } = input;
  const autoCheckStarted = useRef(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdatePanelStatus>({ message: labels.idle });
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(() =>
    readLocalStorageBoolean(UPDATE_AUTO_CHECK_KEY, false),
  );
  const [skippedUpdateVersion, setSkippedUpdateVersion] = useState(
    () => localStorage.getItem(UPDATE_SKIPPED_VERSION_KEY) ?? '',
  );

  async function resolveAppUpdate(
    options: { ignoreSkipped?: boolean; silentNoUpdate?: boolean } = {},
  ): Promise<AvailableUpdate> {
    try {
      const update = await check();
      setAvailableUpdate(update);
      if (!update) {
        setUpdateStatus({ message: labels.noUpdate, checkedAt: Date.now() });
        if (!options.silentNoUpdate) showMessage('success', labels.noUpdate);
        return null;
      }
      if (!options.ignoreSkipped && skippedUpdateVersion === update.version) {
        setAvailableUpdate(null);
        setUpdateStatus({
          message: `${labels.skipped}: ${update.version}`,
          version: update.version,
          notes: update.body ?? undefined,
          checkedAt: Date.now(),
        });
        return null;
      }
      const message = `${labels.available}: ${update.version}`;
      setUpdateStatus({
        message,
        version: update.version,
        notes: update.body ?? undefined,
        checkedAt: Date.now(),
      });
      showMessage('success', message);
      return update;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const diagnostic = diagnoseUpdateError(error, labels);
      reportError(error, { area: 'updater', action: 'check', detail });
      setAvailableUpdate(null);
      setUpdateStatus({
        message: `${labels.checkFailed}: ${diagnostic}`,
        diagnostic: detail,
        checkedAt: Date.now(),
      });
      showMessage('error', `${labels.checkFailed}: ${diagnostic}`);
      return null;
    }
  }

  useEffect(() => {
    localStorage.setItem(UPDATE_AUTO_CHECK_KEY, String(autoCheckUpdates));
    if (!autoCheckUpdates || autoCheckStarted.current) return;
    autoCheckStarted.current = true;
    const timer = window.setTimeout(() => {
      void withBusy('app-update-auto-check', async () => {
        await resolveAppUpdate({ silentNoUpdate: true });
      });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [autoCheckUpdates, skippedUpdateVersion]);

  async function checkForAppUpdate() {
    await withBusy('app-update-check', async () => {
      await resolveAppUpdate();
    });
  }

  async function installAppUpdate() {
    await withBusy('app-update-install', async () => {
      const update = availableUpdate ?? (await resolveAppUpdate({ ignoreSkipped: true }));
      if (!update) {
        return;
      }
      let downloaded = 0;
      let total = 0;
      try {
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? 0;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
          } else if (event.event === 'Finished') {
            downloaded = total || downloaded;
          }
          setUpdateStatus({
            message: labels.installing,
            version: update.version,
            notes: update.body ?? undefined,
            downloaded,
            total,
          });
        });
        setUpdateStatus({
          message: labels.installed,
          version: update.version,
          notes: update.body ?? undefined,
          downloaded,
          total,
        });
        showMessage('success', labels.installed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const diagnostic = diagnoseUpdateError(error, labels);
        reportError(error, { area: 'updater', action: 'install', detail });
        setUpdateStatus({
          message: `${labels.installFailed}: ${diagnostic}`,
          diagnostic: detail,
          version: update.version,
          notes: update.body ?? undefined,
        });
        showMessage('error', `${labels.installFailed}: ${diagnostic}`);
        return;
      }

      try {
        await relaunch();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const diagnostic = diagnoseUpdateError(error, labels);
        reportError(error, { area: 'updater', action: 'relaunch', detail });
        setUpdateStatus({
          message: `${labels.installedRestartFailed}: ${diagnostic}`,
          diagnostic: detail,
          version: update.version,
          notes: update.body ?? undefined,
          downloaded,
          total,
        });
        showMessage('error', `${labels.installedRestartFailed}: ${diagnostic}`);
      }
    });
  }

  function skipAvailableUpdate() {
    if (!availableUpdate) return;
    localStorage.setItem(UPDATE_SKIPPED_VERSION_KEY, availableUpdate.version);
    setSkippedUpdateVersion(availableUpdate.version);
    setAvailableUpdate(null);
    setUpdateStatus({
      message: `${labels.skipped}: ${availableUpdate.version}`,
      version: availableUpdate.version,
      notes: availableUpdate.body ?? undefined,
      checkedAt: Date.now(),
    });
  }

  function clearSkippedUpdate() {
    localStorage.removeItem(UPDATE_SKIPPED_VERSION_KEY);
    setSkippedUpdateVersion('');
    setUpdateStatus({ message: labels.idle });
  }

  async function openReleasePage() {
    await openUrl(updaterConfig.releasePage);
  }

  return {
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
  };
}

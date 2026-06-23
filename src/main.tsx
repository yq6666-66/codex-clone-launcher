import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTelemetry, reportError, TelemetryErrorBoundary } from './telemetry';

async function bootstrap() {
  if (import.meta.env.VITE_TAURI_E2E_MOCKS === '1') {
    const { installTauriE2eMocks } = await import('./test-support/tauriE2eMocks');
    installTauriE2eMocks();
  }

  initTelemetry();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <TelemetryErrorBoundary
      fallback={
        <main className="fatal-error">
          <h1>应用发生错误</h1>
          <p>请重启 Codex 分身启动器；如果问题持续，请带上操作步骤和版本号反馈。</p>
        </main>
      }
        onError={(error) => {
          reportError(error, { area: 'react', action: 'error-boundary' });
        }}
      >
        <App />
      </TelemetryErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();

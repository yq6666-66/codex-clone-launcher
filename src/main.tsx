import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTelemetry, TelemetryErrorBoundary } from './telemetry';

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
    >
      <App />
    </TelemetryErrorBoundary>
  </React.StrictMode>,
);

// Файл: /components/VersionDisplay.tsx
'use client';

import { useEffect, useState } from 'react';
import { BackendResponseError, fetchHealthVersion } from '@/lib/api/backendClient';

export default function VersionDisplay() {
  const [webApiVersion, setWebApiVersion] = useState('...');
  const [scraperVersion, setScraperVersion] = useState('...');

  useEffect(() => {
    async function fetchVersion() {
      try {
        const data = await fetchHealthVersion();
        setWebApiVersion(data.webApiVersion || data.version || 'unknown');
        setScraperVersion(data.scraperVersion || 'unknown');
      } catch (error) {
        const fallback = error instanceof BackendResponseError ? 'error' : 'n/a';
        setWebApiVersion(fallback);
        setScraperVersion(fallback);
      }
    }

    fetchVersion();
  }, []);

  // Версия фронтенда (запекается при сборке Docker-образа)
  const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'local';

  return (
    <div style={{ fontSize: '0.8rem', color: '#718096' }}>
      <span>Frontend: {frontendVersion}</span> | <span>Backend: {webApiVersion}</span> | <span>{scraperVersion}</span>
    </div>
  );
}

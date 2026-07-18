'use client';

import { useEffect } from 'react';
import type { components } from '@/lib/generated/lots-webapi';
import { getOrCreateLotViewClientId } from '@/utils/lotViewClientId';

type LotViewEventRequest = components['schemas']['LotViewEventRequestDto'];

declare global {
  interface Window {
    __fedtagLotViewEventsSent?: Set<string>;
  }
}

function markSentOnce(key: string): boolean {
  window.__fedtagLotViewEventsSent ??= new Set<string>();
  if (window.__fedtagLotViewEventsSent.has(key)) {
    return false;
  }

  const sessionKey = `fedtag_lot_view_sent:${key}`;
  if (window.sessionStorage.getItem(sessionKey) === '1') {
    window.__fedtagLotViewEventsSent.add(key);
    return false;
  }

  window.__fedtagLotViewEventsSent.add(key);
  window.sessionStorage.setItem(sessionKey, '1');
  return true;
}

export default function LotViewTelemetryBeacon({ lotPublicId }: { lotPublicId: number | string }) {
  useEffect(() => {
    if (!lotPublicId || typeof document === 'undefined') return;

    const send = () => {
      if (document.visibilityState !== 'visible') return;

      const key = String(lotPublicId);
      if (!markSentOnce(key)) return;

      const clientId = getOrCreateLotViewClientId();
      if (!clientId) return;

      const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
      const body: LotViewEventRequest = {
        source: 'lot_detail_client',
        visibleAtUtc: new Date().toISOString(),
      };

      // navigator.sendBeacon cannot attach the mandatory intent/client headers.
      // fetch keepalive is intentional: transport reliability must not weaken server validation.
      void fetch(`${apiUrl}/api/lots/${lotPublicId}/view-events`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-Lot-View-Intent': 'visible-detail',
          'X-Lot-Client-Id': clientId,
        },
        body: JSON.stringify(body),
      }).catch(() => {
        // Telemetry is best-effort; database-side dedupe keeps client retries safe.
      });
    };

    if (document.visibilityState === 'visible') {
      queueMicrotask(send);
    } else {
      document.addEventListener('visibilitychange', send, { once: true });
    }

    return () => {
      document.removeEventListener('visibilitychange', send);
    };
  }, [lotPublicId]);

  return null;
}

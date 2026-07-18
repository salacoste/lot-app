// components/YandexMetrika.tsx

"use client";

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import {
  isAnalyticsAllowedPath,
  yandexMetrikaPageView,
  yandexMetrikaPrivacyConfig,
} from '@/utils/analyticsPrivacy.logic.shared.mjs';

const counterId = 105080568;

type YandexMetrikaWindow = Window & {
  ym?: (id: number, command: string, value: unknown) => void;
};

export default function YandexMetrika() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allowed = isAnalyticsAllowedPath(pathname);

  useEffect(() => {
    const pageView = yandexMetrikaPageView(pathname, searchParams.toString());
    if (pageView === null) return;
    (window as YandexMetrikaWindow).ym?.(counterId, 'hit', pageView);
  }, [pathname, searchParams]);

  if (!allowed) return null;

  const privacyConfig = JSON.stringify(yandexMetrikaPrivacyConfig);

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`
          (function(m,e,t,r,i,k,a){
              m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
              m[i].l=1*new Date();
              for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
              k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
          })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=105080568', 'ym');

          ym(${counterId}, 'init', ${privacyConfig});
        `}
      </Script>
      <noscript>
        <div>
          <img src={`https://mc.yandex.ru/watch/${counterId}`} style={{ position: 'absolute', left: '-9999px' }} alt="" />
        </div>
      </noscript>
    </>
  );
}

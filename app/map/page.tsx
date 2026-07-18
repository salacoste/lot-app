// app/map/page.tsx

import { Metadata } from 'next';
import MapClient from './MapClient';

export const metadata: Metadata = {
  title: 'Карта торгов по банкротству: поиск недвижимости и участков — auction.thepeace.ru',
  description: 'Интерактивная карта лотов с торгов по банкротству. Удобный поиск коммерческой и жилой недвижимости, земельных участков и зданий от должников по всей России.',
  keywords: 'карта торгов по банкротству, имущество должников на карте, недвижимость с торгов, поиск лотов на карте, аукционы по банкротству карта, купить участок с торгов',
  alternates: {
    canonical: 'https://auction.thepeace.ru/map',
  },
  openGraph: {
    title: 'Карта торгов по банкротству — auction.thepeace.ru',
    description: 'Интерактивная карта для визуального поиска выгодных лотов: коммерческая недвижимость, земельные участки и дома с торгов по банкротству в вашем регионе.',
    url: 'https://auction.thepeace.ru/map',
    type: 'website',
    locale: 'ru_RU',
    siteName: 'auction.thepeace.ru',
    // Желательно добавить скриншот карты для соцсетей:
    // images: [{ url: 'https://auction.thepeace.ru/map-og-image.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Карта торгов по банкротству — auction.thepeace.ru',
    description: 'Интерактивная карта лотов с торгов по банкротству.',
  }
};

export default function MapPage() {
  return (
    <>
      {/* Скрытый H1 для SEO, так как на самой карте нет текстовых заголовков */}
      <h1 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>
        Карта лотов с торгов по банкротству
      </h1>
      <MapClient />
    </>
  );
}
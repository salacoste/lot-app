import { MetadataRoute } from 'next';

// Функция, которая вернет конфиг robots.txt
export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://auction.thepeace.ru';

  // Генерируем список sitemap-ов.
  // Пока sitemap-ов 2-3, вписываем вручную.
  // Если будет много — лучше сделать цикл.
  const sitemaps = [
      `${baseUrl}/sitemap/0.xml`,
      `${baseUrl}/sitemap/1.xml`,
      `${baseUrl}/sitemap/2.xml`,
      // ... добавить с запасом, если планируется рост, или добавить логику
  ];

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    // Robots.txt поддерживает массив sitemap
    sitemap: sitemaps,
  };
}

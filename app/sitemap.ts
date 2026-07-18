import { MetadataRoute } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { generateSlug } from '../utils/slugify';
import {
  PASSENGER_CARS_BASE_PATH,
  buildPassengerCarPath,
  fetchVehicleFilterOptions,
  getModelsForBrand,
} from '../utils/vehiclePaths';

const BASE_URL = 'https://auction.thepeace.ru';

async function getPassengerCarListingRoutes(): Promise<MetadataRoute.Sitemap> {
  const catalog = await fetchVehicleFilterOptions();
  const routes: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}${PASSENGER_CARS_BASE_PATH}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ];

  for (const brand of catalog.brands) {
    routes.push({
      url: `${BASE_URL}${buildPassengerCarPath(brand)}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.85,
    });

    const models = getModelsForBrand(brand, catalog.modelsByBrand);
    for (const model of models) {
      routes.push({
        url: `${BASE_URL}${buildPassengerCarPath(brand, model)}`,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
  }

  return routes;
}

// Генерируем список sitemap-файлов (id: 0, id: 1 ...)
export async function generateSitemaps() {
  // В идеале сделать запрос к API, чтобы узнать общее кол-во (count), 
  // но можно просто вернуть диапазон, так как знаем примерное число.
  // Для 100000 лотов и размера чанка 5000 нужно 20 частей.
  // Увеличим запас до 30, пустые sitemap не страшны.
  const totalChunks = 30;
  return Array.from({ length: totalChunks }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: number | string | Promise<number | string> }): Promise<MetadataRoute.Sitemap> {
  // Next 16 passes generated sitemap route params asynchronously.
  const sitemapId = Number(await id);

  // Для id=0 (первый чанк) можно добавить статические страницы
  const staticRoutes: MetadataRoute.Sitemap = [];
  if (sitemapId === 0) {
    staticRoutes.push({ // можно добавить другие статические страницы
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    });
    staticRoutes.push({
      url: `${BASE_URL}/how-it-works/alerts`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    });
    staticRoutes.push({
      url: `${BASE_URL}/how-it-works/similar-lots`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    });
    staticRoutes.push({
      url: `${BASE_URL}/how-it-works/ai-assessment`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    });

    const passengerCarRoutes = await getPassengerCarListingRoutes();
    staticRoutes.push(...passengerCarRoutes);
  }

  // Запрашиваем чанк данных из API
  const pageSize = 5000; // Уменьшаем размер страницы до 5000, чтобы избежать ошибки 2MB cache limit
  const page = sitemapId + 1; // API ожидает page начиная с 1

  const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
  if (!apiUrl)
    return staticRoutes;

  try {
    const res = await fetch(`${apiUrl}/api/lots/sitemap-data?page=${page}&pageSize=${pageSize}`, {
      cache: 'no-store' // Отключаем кэширование данных запроса, чтобы не забивать Data Cache и избежать лимита
    });

    if (!res.ok)
      return staticRoutes;

    const lots: any[] = await res.json();

    if (!lots || lots.length === 0) {
      // Если лотов нет, просто возвращаем пустой (или со статикой) sitemap
      return staticRoutes;
    }

    const lotRoutes = lots.map((lot) => {
      // Берем slug напрямую из БД, если его нет — генерируем (с фоллбэком на 'lot')
      const slug = lot.slug ?? generateSlug(lot.title || lot.description || 'lot');
      const url = `${BASE_URL}/lot/${slug}-${lot.publicId}`;

      return {
        url: url,
        // Используем реальную дату создания лота из БД
        lastModified: lot.createdAt ? new Date(lot.createdAt) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
    });

    return [...staticRoutes, ...lotRoutes];

  } catch (error) {
    unstable_rethrow(error);
    console.error(`Sitemap error for id ${sitemapId}:`, error);
    return staticRoutes;
  }
}

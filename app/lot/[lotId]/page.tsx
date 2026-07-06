// app/lot/[lotId]/page.tsx
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Lot } from '../../../types';
import LotDetailsClient from './LotDetailsClient';
import { CATEGORIES_TREE, FINAL_TRADE_STATUSES } from '../../data/constants';
import { PASSENGER_CAR_CATEGORY } from '../../../utils/lotBreadcrumbs';
import { generateLotSchemas, generateLotUrl } from './schemas';
import { generateSlug } from '../../../utils/slugify';

// --- SEO ОПТИМИЗАЦИЯ: Компонент для структурированных данных JSON-LD ---
// Этот скрипт помогает Яндексу и Google точно понять, что продается на странице.
function JsonLd({ lot }: { lot: Lot }) {
  const schemas = generateLotSchemas(lot);

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}

type Props = {
  params: Promise<{ lotId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Динамическая генерация ключевых слов ---
const generateKeywords = (lot: Lot): string => {
  // Базовые ключевые слова для любой страницы
  const baseKeywords = [
    'торги по банкротству', 'аукционы по банкротству', 'имущество банкротов', 'аукцион',
    'электронные торги', 'купить на торгах', 'купить со скидкой', 'имущество должников', 'auction.thepeace.ru'
  ];

  // Ключевые слова на основе категорий
  const categoryKeywords: string[] = [];
  const lotCategory = lot.categories?.[0]; // Берем самую специфичную категорию

  if (lotCategory) {
    const categoryName = lotCategory.name.toLowerCase();
    // Добавляем запросы для конкретной категории
    categoryKeywords.push(
      `купить ${categoryName} с торгов`,
      `${categoryName} с торгов по банкротству`,
      `${categoryName} аукцион по банкротству`
    );

    // Ищем родительскую категорию и добавляем запросы для нее
    const parentCategory = CATEGORIES_TREE.find(cat => cat.children?.some(child => child.name === categoryName));
    if (parentCategory) {
      const parentCategoryName = parentCategory.name.toLowerCase();
      categoryKeywords.push(
        `купить ${parentCategoryName} с торгов`,
        `${parentCategoryName} с торгов по банкротству`,
        `${parentCategoryName} аукцион по банкротству`
      );
    }
  }

  // Ключевые слова из данных самого лота
  const lotSpecificKeywords = lot.title ? lot.title.split(' ').filter(word => word.length > 2) : [];

  const isPassengerCar = lot.categories?.some((category) => category.name === PASSENGER_CAR_CATEGORY);
  const vehicleBrand = lot.attributes?.brand;
  const vehicleModel = lot.attributes?.model;

  if (isPassengerCar) {
    categoryKeywords.push(
      'легковые автомобили с торгов',
      'авто с торгов по банкротству',
    );

    if (vehicleBrand) {
      lotSpecificKeywords.push(
        vehicleBrand,
        `${vehicleBrand} с торгов`,
        `купить ${vehicleBrand} на торгах`,
      );
    }

    if (vehicleBrand && vehicleModel) {
      lotSpecificKeywords.push(
        vehicleModel,
        `${vehicleBrand} ${vehicleModel}`,
        `${vehicleBrand} ${vehicleModel} с торгов`,
        `купить ${vehicleBrand} ${vehicleModel} на торгах`,
      );
    }
  }
  if (lot.bidding?.tradeNumber) {
    lotSpecificKeywords.push(
      lot.bidding.tradeNumber,
      `торги ${lot.bidding.tradeNumber}`,
      `аукцион ${lot.bidding.tradeNumber}`,
    );
  }

  for (const info of lot.cadastralInfos ?? []) {
    const cadastralNumber = info.cadastralNumber?.trim();
    if (!cadastralNumber) continue;

    lotSpecificKeywords.push(
      cadastralNumber,
      `торги ${cadastralNumber}`,
      `кадастровый номер ${cadastralNumber}`,
    );
  }

  // Объединяем все, удаляем дубликаты и возвращаем строку
  const allKeywords = [...baseKeywords, ...categoryKeywords, ...lotSpecificKeywords];
  
  return [...new Set(allKeywords)].join(', ');
};

// Функция для получения данных лота по ID
async function getLotData(slugOrId: string): Promise<Lot | null> {
  const publicId = extractIdFromSlug(slugOrId);
  const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
  const url = `${apiUrl}/api/lots/${publicId}`;

  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');

    const res = await fetch(url, {
      cache: 'no-store',
      headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    });

    if (!res.ok)
      return null;

    return res.json();
  } catch (error) {
    console.error(`Не удалось загрузить данные для лота ${publicId}:`, error);
    return null;
  }
}

function extractIdFromSlug(slug: string): string {
  // Проверяем, является ли строка валидным GUID (формат: 8-4-4-4-12)
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (guidRegex.test(slug)) {
    // Если это GUID, возвращаем его целиком без обрезки
    return slug;
  }

  // Если это не GUID, значит это SEO-slug. Ищем PublicId в конце.
  const match = slug.match(/-(\d+)$/);
  if (match) return match[1]; 
  
  return slug;
}

function isLotActive(tradeStatus?: string | null): boolean {
  if (!tradeStatus) return true;
  return !FINAL_TRADE_STATUSES.includes(tradeStatus);
}

// ГЕНЕРАЦИЯ МЕТАДАННЫХ
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lotId } = await params;
  const lot = await getLotData(lotId);

  if (!lot) {
    return {
      title: 'Лот не найден',
      description: 'К сожалению, данный лот не был найден.',
    };
  }

  // Формируем заголовок и описание, богатые ключевыми словами
  const price = lot.startPrice ?? 0;
  const formattedPrice = price.toLocaleString('ru-RU').replace(/\s/g, ' ');

  const lotTitle = lot.title || lot.description.substring(0, 120);

  // Проверяем, активен ли лот
  const isActive = isLotActive(lot.tradeStatus);

  // Формируем Title в зависимости от статуса
  const title = isActive
    ? `Купить ${lotTitle} на торгах по банкротству за ${formattedPrice} ₽ — auction.thepeace.ru`
    : `[Архив] ${lotTitle} — ${lot.tradeStatus || 'Торги завершены'}`;
  
  // Формируем Description в зависимости от статуса
  const descriptionParts = isActive 
    ? [
        lot.description.substring(0, 120),
        `Начальная цена: ${formattedPrice} ₽`,
        lot.bidding?.tradeNumber ? `Номер торгов: ${lot.bidding.tradeNumber}` : null,
        lot.bidding?.tradePeriod ? `Торги: ${lot.bidding.tradePeriod}` : null,
        lot.propertyRegionName ? `Регион: ${lot.propertyRegionName}` : null,
        'Открытый аукцион по реализации имущества банкротов. Участвуйте в торгах на auction.thepeace.ru!'
      ].filter(Boolean)
    : [
        `ВНИМАНИЕ: Торги по данному лоту завершены. Статус: ${lot.tradeStatus || 'Архив'}.`,
        lot.description.substring(0, 100),
        `Начальная цена составляла: ${formattedPrice} ₽`,
        lot.bidding?.tradeNumber ? `Номер торгов: ${lot.bidding.tradeNumber}` : null,
        lot.propertyRegionName ? `Регион: ${lot.propertyRegionName}` : null,
        'Исторические данные об аукционе по банкротству на auction.thepeace.ru.'
      ].filter(Boolean);

  const description = descriptionParts.join('. ');
  
  const keywords = generateKeywords(lot);
  const baseUrl = 'https://auction.thepeace.ru';
  const lotUrl = generateLotUrl(lot, baseUrl);
  
  // Подготовка изображений для Open Graph
  const ogImages = [];
  if (lot.imageUrl) {
    ogImages.push({ url: lot.imageUrl.startsWith('http') ? lot.imageUrl : `${baseUrl}${lot.imageUrl}` });
  }
  if (lot.images && lot.images.length > 0) {
    lot.images.slice(0, 3).forEach(img => {
      ogImages.push({ url: img.startsWith('http') ? img : `${baseUrl}${img}` });
    });
  }
  if (ogImages.length === 0) {
    ogImages.push({ url: `${baseUrl}/placeholder.png` });
  }

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: lotUrl,
    },
    openGraph: {
      title,
      description,
      url: lotUrl,
      siteName: 'auction.thepeace.ru',
      images: ogImages,
      locale: 'ru_RU',
      type: 'website',
      // Дополнительные поля для лучшей индексации
      ...(lot.bidding?.tradePeriod && {
        publishedTime: new Date().toISOString(),
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description.substring(0, 200),
      ...(ogImages.length > 0 && { images: [ogImages[0].url] }),
    },
    // Дополнительные метаданные
    other: {
      ...(lot.createdAt && { 'article:published_time': new Date(lot.createdAt).toISOString() }),
      'article:modified_time': new Date().toISOString(),
      'article:author': lot.bidding?.arbitrationManager?.name || 'auction.thepeace.ru',
      'article:section': lot.categories?.[0]?.name || 'Торги по банкротству',
    },
  };
}

export default async function Page({ params }: Props) {
  const { lotId } = await params;
  const lot = await getLotData(lotId);

  if (!lot) {
    notFound();
  }

  const canonicalSlug = lot.slug ?? generateSlug(lot.title || lot.description || 'lot');
  const requestedSlug = lotId.replace(/-\d+$/, '');
  if (requestedSlug && requestedSlug !== canonicalSlug && lot.publicId) {
    redirect(`/lot/${canonicalSlug}-${lot.publicId}`);
  }

  return (
    <>
      {/* Вставляем скрипт с микроразметкой в начало страницы */}
      <JsonLd lot={lot} />

      {/* Клиентский компонент для отображения лота */}
      <LotDetailsClient lot={lot} />
    </>
  );
}
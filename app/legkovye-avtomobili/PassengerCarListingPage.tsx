import { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PAGE_SIZE } from '@/app/data/constants';
import Breadcrumbs from '@/components/Breadcrumbs';
import { buildPassengerCarListingBreadcrumbs } from '@/utils/lotBreadcrumbs';
import { fetchPassengerCarLots } from '@/utils/passengerCarListing';
import {
  generateBreadcrumbListSchema,
  generateItemListSchema,
} from '@/utils/listingSchemas';
import {
  PASSENGER_CAR_CATEGORY_LABEL,
  buildPassengerCarPath,
  resolvePassengerCarRoute,
} from '@/utils/vehiclePaths';
import PassengerCarListingClient from './PassengerCarListingClient';
import styles from './listing.module.css';

const BASE_URL = 'https://auction.thepeace.ru';

function extractListingSearchParams(searchParams: Record<string, string | undefined>): Record<string, string> {
  const params: Record<string, string> = {};

  Object.entries(searchParams).forEach(([key, value]) => {
    if (!value || key === 'page') return;
    params[key] = value;
  });

  return params;
}

type ListingPageProps = {
  brandSlug?: string;
  modelSlug?: string;
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildListingTitle(brand?: string, model?: string): string {
  if (brand && model) {
    return `${brand} ${model} — легковые автомобили с торгов по банкротству | auction.thepeace.ru`;
  }

  if (brand) {
    return `${brand} — легковые автомобили с торгов по банкротству | auction.thepeace.ru`;
  }

  return `${PASSENGER_CAR_CATEGORY_LABEL} по банкротству | auction.thepeace.ru`;
}

function buildListingDescription(totalCount: number, brand?: string, model?: string): string {
  const countLabel = totalCount > 0 ? `${totalCount} лотов` : 'Лоты';

  if (brand && model) {
    return `${countLabel} ${brand} ${model} на электронных торгах по банкротству. Актуальные цены, даты торгов и подробные описания на auction.thepeace.ru.`;
  }

  if (brand) {
    return `${countLabel} ${brand} на электронных торгах по банкротству. Выберите модель и участвуйте в аукционах на auction.thepeace.ru.`;
  }

  return `${countLabel} легковых автомобилей на электронных торгах по банкротству. Фильтры по марке, модели, году выпуска и пробегу на auction.thepeace.ru.`;
}

function buildListingKeywords(brand?: string, model?: string): string {
  const keywords = [
    'легковые автомобили с торгов',
    'авто с торгов по банкротству',
    'купить автомобиль на торгах',
    'аукцион автомобилей банкротство',
    'auction.thepeace.ru',
  ];

  if (brand) {
    keywords.push(
      `${brand} с торгов`,
      `${brand} аукцион банкротство`,
      `купить ${brand} с торгов`,
    );
  }

  if (brand && model) {
    keywords.push(
      `${brand} ${model} с торгов`,
      `${brand} ${model} аукцион`,
      `купить ${brand} ${model} на торгах`,
    );
  }

  return [...new Set(keywords)].join(', ');
}

function buildListingHeading(brand?: string, model?: string): string {
  if (brand && model) {
    return `${brand} ${model} с торгов по банкротству`;
  }

  if (brand) {
    return `${brand} — легковые автомобили с торгов`;
  }

  return PASSENGER_CAR_CATEGORY_LABEL;
}

function buildListingIntro(brand?: string, model?: string): string {
  if (brand && model) {
    return `Подборка лотов ${brand} ${model}, выставленных на электронные торги по банкротству. Сравнивайте цены, сроки торгов и переходите к карточкам лотов.`;
  }

  if (brand) {
    return `Легковые автомобили ${brand} с торгов по банкротству. Выберите модель в фильтрах или перейдите к конкретному лоту из списка ниже.`;
  }

  return 'Каталог легковых автомобилей с электронных торгов по банкротству. Используйте фильтры по марке, модели, году выпуска и пробегу.';
}

export async function buildPassengerCarListingMetadata(
  brandSlug?: string,
  modelSlug?: string,
  page = 1,
): Promise<Metadata> {
  const route = await resolvePassengerCarRoute(brandSlug, modelSlug);
  if (route.notFound) {
    return { title: 'Страница не найдена' };
  }

  const listing = await fetchPassengerCarLots({
    brand: route.brand,
    model: route.model,
    page,
    pageSize: PAGE_SIZE,
  });

  const canonicalPath = buildPassengerCarPath(route.brand, route.model);
  const canonical = page > 1
    ? `${BASE_URL}${canonicalPath}?page=${page}`
    : `${BASE_URL}${canonicalPath}`;

  const title = buildListingTitle(route.brand, route.model);
  const description = buildListingDescription(listing.totalCount, route.brand, route.model);

  return {
    title,
    description,
    keywords: buildListingKeywords(route.brand, route.model),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'auction.thepeace.ru',
      locale: 'ru_RU',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description: description.substring(0, 200),
    },
    robots: page > 1 ? { index: true, follow: true } : undefined,
  };
}

export async function PassengerCarListingPage({
  brandSlug,
  modelSlug,
  searchParams,
}: ListingPageProps) {
  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, Number(resolvedSearchParams.page) || 1);
  const route = await resolvePassengerCarRoute(brandSlug, modelSlug);

  if (route.notFound) {
    notFound();
  }

  const listing = await fetchPassengerCarLots({
    brand: route.brand,
    model: route.model,
    page,
    pageSize: PAGE_SIZE,
    searchParams: extractListingSearchParams(resolvedSearchParams),
  });

  const breadcrumbs = buildPassengerCarListingBreadcrumbs({
    brand: route.brand,
    model: route.model,
  });

  const heading = buildListingHeading(route.brand, route.model);
  const intro = buildListingIntro(route.brand, route.model);

  const schemas = [
    generateBreadcrumbListSchema(breadcrumbs),
    generateItemListSchema({
      name: heading,
      items: listing.items,
      totalCount: listing.totalCount,
      page,
      pageSize: PAGE_SIZE,
    }),
  ];

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      <main className={styles.main}>
        <Breadcrumbs crumbs={breadcrumbs} />

        <header className={styles.header}>
          <h1 className={styles.title}>{heading}</h1>
          <p className={styles.intro}>{intro}</p>
        </header>

        <Suspense fallback={<p className={styles.loadingMessage}>Загрузка лотов...</p>}>
          <PassengerCarListingClient
            brand={route.brand}
            model={route.model}
            initialLots={listing.items}
            initialTotalPages={listing.totalPages}
            initialPage={page}
            initialTotalCount={listing.totalCount}
          />
        </Suspense>
      </main>
    </>
  );
}

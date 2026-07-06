import { Lot } from '@/types';
import { generateSlug } from '@/utils/slugify';
import { BreadcrumbCrumb } from '@/utils/lotBreadcrumbs';

const BASE_URL = 'https://auction.thepeace.ru';

function getLotAbsoluteUrl(lot: Lot): string {
  const slug = lot.slug ?? generateSlug(lot.title || lot.description);
  return `${BASE_URL}/lot/${slug}-${lot.publicId}`;
}

export function generateBreadcrumbListSchema(crumbs: BreadcrumbCrumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: crumb.href.startsWith('http') ? crumb.href : `${BASE_URL}${crumb.href}`,
    })),
  };
}

export function generateItemListSchema(options: {
  name: string;
  items: Lot[];
  totalCount: number;
  page: number;
  pageSize: number;
}) {
  const offset = (options.page - 1) * options.pageSize;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: options.name,
    numberOfItems: options.totalCount,
    itemListElement: options.items.map((lot, index) => ({
      '@type': 'ListItem',
      position: offset + index + 1,
      url: getLotAbsoluteUrl(lot),
      name: lot.title || lot.description.substring(0, 100),
    })),
  };
}

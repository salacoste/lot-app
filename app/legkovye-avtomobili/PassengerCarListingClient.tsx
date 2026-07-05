'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { LotItem } from '@/components/LotItem';
import Pagination from '@/components/Pagination';
import Filters from '@/components/Filters/Filters';
import ActiveFiltersSummary from '@/components/ActiveFiltersSummary';
import { PAGE_SIZE } from '@/app/data/constants';
import {
  PASSENGER_CAR_CATEGORY,
  buildPassengerCarPath,
} from '@/utils/vehiclePaths';
import { Lot } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { applyQueryUpdates, type QueryUpdates } from '@/lib/queryNavigation';
import styles from './listing.module.css';

type PassengerCarListingClientProps = {
  brand?: string;
  model?: string;
  initialLots: Lot[];
  initialTotalPages: number;
  initialPage: number;
  initialTotalCount: number;
};

function buildListingApiParams(options: {
  page: number;
  brand?: string;
  model?: string;
  searchParams: URLSearchParams;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(options.page));
  params.set('pageSize', String(PAGE_SIZE));
  params.append('categories', PASSENGER_CAR_CATEGORY);

  if (options.brand) {
    params.set('attr_brand', options.brand);
  }

  if (options.model) {
    params.set('attr_model', options.model);
  }

  options.searchParams.forEach((value, key) => {
    if (key === 'page' || key === 'categories' || key === 'attr_brand' || key === 'attr_model') {
      return;
    }

    params.set(key, value);
  });

  return params;
}

export default function PassengerCarListingClient({
  brand,
  model,
  initialLots,
  initialTotalPages,
  initialPage,
  initialTotalCount,
}: PassengerCarListingClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const page = Math.max(1, Number(searchParams.get('page')) || initialPage);
  const searchParamsKey = searchParams.toString();
  const tagsParam = searchParams.get('tags') || '';

  const [lots, setLots] = useState(initialLots);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);

  const filterState = useMemo(() => {
    const dynamicFilters: Record<string, string> = {};
    if (brand) dynamicFilters.brand = brand;
    if (model) dynamicFilters.model = model;

    searchParams.forEach((value, key) => {
      if (key.startsWith('attr_')) {
        dynamicFilters[key.substring(5)] = value;
      }
    });

    return {
      categories: [PASSENGER_CAR_CATEGORY],
      biddingType: searchParams.get('biddingType') || 'Все',
      priceFrom: searchParams.get('priceFrom') || '',
      priceTo: searchParams.get('priceTo') || '',
      searchQuery: searchParams.get('searchQuery') || '',
      isSharedOwnership: searchParams.get('isSharedOwnership'),
      regions: searchParams.getAll('regions'),
      dynamicFilters,
    };
  }, [brand, model, searchParamsKey]);

  useEffect(() => {
    sessionStorage.setItem('isFromFavorites', 'false');
    sessionStorage.setItem(
      'lotListUrl',
      searchParamsKey ? `${pathname}?${searchParamsKey}` : pathname,
    );
  }, [pathname, searchParamsKey]);

  useEffect(() => {
    if (authLoading) return;

    const isInitialView = page === initialPage && searchParamsKey === '';

    // SSR-данные без cookie админа; для админа всегда подгружаем с API
    if (isInitialView && !user?.isAdmin) {
      setLots(initialLots);
      setTotalPages(initialTotalPages);
      setTotalCount(initialTotalCount);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadLots = async () => {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
      if (!apiUrl) {
        setLoading(false);
        return;
      }

      const params = buildListingApiParams({ page, brand, model, searchParams });

      try {
        const res = await fetch(`${apiUrl}/api/lots/list?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error('Failed to load lots');
        }

        const data = await res.json();
        if (cancelled) return;

        setLots(data.items ?? []);
        setTotalPages(data.totalPages ?? 0);
        setTotalCount(data.totalCount ?? 0);
        setError(null);
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить список лотов. Проверьте соединение или повторите позднее.');
          setLots([]);
          setTotalPages(0);
          setTotalCount(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadLots();

    return () => {
      cancelled = true;
    };
  }, [
    page,
    brand,
    model,
    initialPage,
    initialLots,
    initialTotalPages,
    initialTotalCount,
    searchParamsKey,
    searchParams,
    tagsParam,
    authLoading,
    user?.isAdmin,
    retryEpoch,
  ]);

  const dynamicFilterLabelByKey: Record<string, string> = {
    brand: 'Марка',
    model: 'Модель',
    year: 'Год',
    mileage: 'Пробег, км',
  };

  const updateQueryInPage = useCallback((updates: QueryUpdates) => {
    const nextParams = applyQueryUpdates(new URLSearchParams(searchParams.toString()), updates);
    const query = nextParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const handleFiltersUpdate = useCallback((updates: Record<string, unknown>) => {
    const nextBrand = String(updates['attr_brand'] ?? updates.brand ?? brand ?? '').trim();
    const nextModel = String(updates['attr_model'] ?? updates.model ?? model ?? '').trim();
    const nextParams = new URLSearchParams();

    Object.entries(updates).forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined) {
        return;
      }

      if (key === 'categories' || key === 'attr_brand' || key === 'attr_model' || key === 'brand' || key === 'model' || key === 'page') {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => nextParams.append(key, String(item)));
        return;
      }

      nextParams.set(key, String(value));
    });

    const nextPath = buildPassengerCarPath(
      nextBrand || undefined,
      nextBrand && nextModel ? nextModel : undefined,
    );
    const query = nextParams.toString();
    router.push(query ? `${nextPath}?${query}` : nextPath);
  }, [brand, model, router]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onRemove?: () => void }> = [];
    const searchQuery = searchParams.get('searchQuery') || '';
    const biddingType = searchParams.get('biddingType') || 'Все';
    const isSharedOwnership = searchParams.get('isSharedOwnership');
    const priceFrom = searchParams.get('priceFrom') || '';
    const priceTo = searchParams.get('priceTo') || '';
    const regions = searchParams.getAll('regions');

    if (searchQuery) {
      chips.push({
        id: 'searchQuery',
        label: `Поиск: ${searchQuery}`,
        onRemove: () => updateQueryInPage({ searchQuery: null, page: 1 }),
      });
    }

    if (biddingType && biddingType !== 'Все') {
      chips.push({
        id: 'biddingType',
        label: `Тип торгов: ${biddingType}`,
        onRemove: () => updateQueryInPage({ biddingType: 'Все', page: 1 }),
      });
    }

    if (priceFrom) {
      chips.push({
        id: 'priceFrom',
        label: `Цена от: ${priceFrom}`,
        onRemove: () => updateQueryInPage({ priceFrom: null, page: 1 }),
      });
    }

    if (priceTo) {
      chips.push({
        id: 'priceTo',
        label: `Цена до: ${priceTo}`,
        onRemove: () => updateQueryInPage({ priceTo: null, page: 1 }),
      });
    }

    if (isSharedOwnership === 'false') {
      chips.push({
        id: 'isSharedOwnership_false',
        label: 'Собственность: Целиком',
        onRemove: () => updateQueryInPage({ isSharedOwnership: null, page: 1 }),
      });
    }

    if (isSharedOwnership === 'true') {
      chips.push({
        id: 'isSharedOwnership_true',
        label: 'Собственность: Только доли',
        onRemove: () => updateQueryInPage({ isSharedOwnership: null, page: 1 }),
      });
    }

    if (regions.length > 0) {
      chips.push({
        id: 'regions',
        label: `Регионы: ${regions.join(', ')}`,
        onRemove: () => updateQueryInPage({ regions: [], page: 1 }),
      });
    }

    if (tagsParam) {
      const tags = tagsParam.split(',').filter(Boolean).map((tag) => tag.trim());
      if (tags.length > 0) {
        chips.push({
          id: 'tags',
          label: `Теги: ${tags.join(', ')}`,
          onRemove: () => updateQueryInPage({ tags: null, page: 1 }),
        });
      }
    }

    Object.entries(filterState.dynamicFilters).forEach(([key, value]) => {
      if (!value) return;
      if (key === 'brand' || key === 'model') return;
      const label = dynamicFilterLabelByKey[key] ?? `Атрибут: ${key}`;
      chips.push({
        id: `attr_${key}`,
        label: `${label}: ${value}`,
        onRemove: () => updateQueryInPage({ [`attr_${key}`]: null }),
      });
    });

    return chips;
  }, [searchParams, filterState.dynamicFilters, tagsParam, updateQueryInPage]);

  const clearAllFilters = useCallback(() => {
    const nextPath = buildPassengerCarPath(brand, model);
    router.push(nextPath, { scroll: false });
  }, [brand, model, router]);

  const onRetryClick = useCallback(() => {
    setRetryEpoch((current) => current + 1);
  }, []);

  const onPageChange = useCallback((nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(nextPage));
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return (
    <section className={styles.content}>
      <ActiveFiltersSummary
        activeFilterCount={activeFilterChips.length}
        chips={activeFilterChips}
        onClearAll={activeFilterChips.length > 0 ? clearAllFilters : undefined}
      />

      <aside className={styles.filtersSidebar}>
        <Filters
          categories={filterState.categories}
          biddingType={filterState.biddingType}
          priceFrom={filterState.priceFrom}
          priceTo={filterState.priceTo}
          searchQuery={filterState.searchQuery}
          isSharedOwnership={filterState.isSharedOwnership}
          regions={filterState.regions}
          dynamicFilters={filterState.dynamicFilters}
          onUpdate={handleFiltersUpdate}
        />
      </aside>

      <div className={styles.results}>
        {!loading && !authLoading && totalCount > 0 && (
          <p className={styles.count}>Найдено лотов: {totalCount}</p>
        )}

        {(loading || authLoading) ? (
          <p className={styles.loadingMessage}>Загрузка лотов...</p>
        ) : error ? (
          <div>
            <p className={styles.errorMessage}>{error}</p>
            <button className={styles.searchButton} type="button" onClick={() => onRetryClick()}>
              Повторить
            </button>
          </div>
        ) : lots.length > 0 ? (
          <>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />

            <div className={styles.lotsGrid}>
              {lots.map((lot) => (
                <LotItem key={lot.id} lot={lot} />
              ))}
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          </>
        ) : (
          <div>
            <p className={styles.emptyMessage}>
              По вашему запросу лотов не найдено.
              {activeFilterChips.length > 0 ? ' Попробуйте убрать один или несколько фильтров.' : null}
            </p>
            {activeFilterChips.length > 0 ? (
              <button
                className={styles.searchButton}
                type="button"
                onClick={clearAllFilters}
              >
                Сбросить все фильтры
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

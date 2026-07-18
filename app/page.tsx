// app/page.tsx
'use client';

import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import Link from 'next/link';

import { PAGE_SIZE } from './data/constants';

import { LotItem } from '@/components/LotItem';
import Pagination from '../components/Pagination';
import Filters from '../components/Filters/Filters';
import Breadcrumbs from '@/components/Breadcrumbs';
import styles from './page.module.css';
import { Lot } from '../types';

import PromoGrid from '@/components/PromoGrid/PromoGrid';
import HeroSection from '@/components/HeroSection/HeroSection';
import { useAuth } from '@/context/AuthContext';
import { useQueryNavigation } from '@/hooks/useQueryNavigation';
import { buildPassengerCarListingBreadcrumbs } from '@/utils/lotBreadcrumbs';
import { PASSENGER_CAR_CATEGORY } from '@/utils/vehiclePaths';
import ActiveFiltersSummary from '@/components/ActiveFiltersSummary';
import { type QueryUpdates } from '@/lib/queryNavigation';

// Обертка для основного компонента, чтобы использовать Suspense
export default function PageWrapper() {
  return (
    <Suspense fallback={<div>Загрузка...</div>}>
      <Page />
    </Suspense>
  );
}

// --- Основной компонент страницы ---
function Page() {
  const { updateQuery, params } = useQueryNavigation();
  const { user, loading: authLoading } = useAuth();

  // Источник правды для UI и API — params из useQueryNavigation (синхронизирован с window.location)
  const page = Number(params.get('page')) || 1;
  const biddingType = params.get('biddingType') || 'Все';
  const priceFromParam = params.get('priceFrom') || '';
  const priceToParam = params.get('priceTo') || '';
  const searchQueryParam = params.get('searchQuery') || '';
  const categoriesParam = params.getAll('categories');
  const isSharedOwnershipParam = params.get('isSharedOwnership');
  const regionsParam = params.getAll('regions');
  const tagsParam = params.get('tags') || '';

  // Извлекаем динамические фильтры из URL
  const dynamicFiltersParam: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith('attr_')) {
      dynamicFiltersParam[key.substring(5)] = value;
    }
  });

  useEffect(() => {
    // Сбрасываем флаг Избранного, так как мы на главной странице
    sessionStorage.setItem('isFromFavorites', 'false');
    // Сохраняем текущий URL списка для кнопки «Назад» на странице лота
    const query = params.toString();
    sessionStorage.setItem('lotListUrl', query ? `/?${query}` : '/');
  }, [params]);

  const passengerCarCrumbs = useMemo(() => {
    const isSinglePassengerCategory =
      categoriesParam.length === 1 && categoriesParam[0] === PASSENGER_CAR_CATEGORY;

    if (!isSinglePassengerCategory) {
      return null;
    }

    return buildPassengerCarListingBreadcrumbs({
      brand: dynamicFiltersParam.brand,
      model: dynamicFiltersParam.model,
    });
  }, [categoriesParam, dynamicFiltersParam]);

  const onPageChange = (nextPage: number) => {
    updateQuery({ page: nextPage }, { scroll: false });
  };

  // Данные
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isFiltersVisible, setIsFiltersVisible] = useState(false);

  // Загрузка данных ТОЛЬКО из searchParams
  const fetchLots = useCallback(async () => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
    if (!apiUrl) {
      console.error("API URL не определен!");
      setLoading(false);
      return;
    }

    const apiParams = new URLSearchParams(params.toString());
    apiParams.set('pageSize', String(PAGE_SIZE));
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/lots/list?${apiParams.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Не удалось загрузить лоты: ${errorText}`);
      }

      const data = await res.json();

      setLots(data.items);
      setTotalPages(data.totalPages);
    } catch (e) {
      console.error('Ошибка при загрузке лотов:', e);
      setError('Не удалось загрузить список лотов. Проверьте соединение или повторите позднее.');
      setLots([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    if (authLoading) return;

    let isCancelled = false;

    const fetchDataAndScroll = async () => {
      await fetchLots();

      if (isCancelled) return;

      const scrollPosition = sessionStorage.getItem('scrollPosition');
      if (scrollPosition) {
        requestAnimationFrame(() => {
          window.scrollTo(0, parseInt(scrollPosition, 10));
          sessionStorage.removeItem('scrollPosition');
        });
      }
    };

    fetchDataAndScroll();

    return () => {
      isCancelled = true;
    };
  }, [fetchLots, authLoading, user?.isAdmin]);

  const dynamicFilterLabelByKey: Record<string, string> = {
    brand: 'Марка',
    model: 'Модель',
    year: 'Год',
    mileage: 'Пробег, км',
  };

  const activeFilterChips = useMemo(() => {
    const chips = [];

    if (searchQueryParam) {
      chips.push({
        id: 'searchQuery',
        label: `Поиск: ${searchQueryParam}`,
        onRemove: () => updateQuery({ searchQuery: null, page: 1 }),
      });
    }

    if (biddingType && biddingType !== 'Все') {
      chips.push({
        id: 'biddingType',
        label: `Тип торгов: ${biddingType}`,
        onRemove: () => updateQuery({ biddingType: 'Все', page: 1 }),
      });
    }

    if (priceFromParam) {
      chips.push({
        id: 'priceFrom',
        label: `Цена от: ${priceFromParam}`,
        onRemove: () => updateQuery({ priceFrom: null, page: 1 }),
      });
    }

    if (priceToParam) {
      chips.push({
        id: 'priceTo',
        label: `Цена до: ${priceToParam}`,
        onRemove: () => updateQuery({ priceTo: null, page: 1 }),
      });
    }

    if (isSharedOwnershipParam === 'false') {
      chips.push({
        id: 'isSharedOwnership_false',
        label: 'Собственность: Целиком',
        onRemove: () => updateQuery({ isSharedOwnership: null, page: 1 }),
      });
    }

    if (isSharedOwnershipParam === 'true') {
      chips.push({
        id: 'isSharedOwnership_true',
        label: 'Собственность: Только доли',
        onRemove: () => updateQuery({ isSharedOwnership: null, page: 1 }),
      });
    }

    if (categoriesParam.length > 0) {
      chips.push({
        id: 'categories',
        label: `Категории: ${categoriesParam.join(', ')}`,
        onRemove: () => updateQuery({ categories: [], page: 1 }),
      });
    }

    if (regionsParam.length > 0) {
      chips.push({
        id: 'regions',
        label: `Регионы: ${regionsParam.join(', ')}`,
        onRemove: () => updateQuery({ regions: [], page: 1 }),
      });
    }

    if (tagsParam) {
      const tags = tagsParam.split(',').filter(Boolean).map((tag) => tag.trim());
      if (tags.length > 0) {
        chips.push({
          id: 'tags',
          label: `Теги: ${tags.join(', ')}`,
          onRemove: () => updateQuery({ tags: null, page: 1 }),
        });
      }
    }

    Object.entries(dynamicFiltersParam).forEach(([key, value]) => {
      if (!value) return;
      const label = dynamicFilterLabelByKey[key] ?? `Атрибут: ${key}`;
      const chipUpdate: QueryUpdates = { page: 1 };
      chipUpdate[`attr_${key}`] = null;
      chips.push({
        id: `attr_${key}`,
        label: `${label}: ${value}`,
        onRemove: () => updateQuery(chipUpdate),
      });
    });

    return chips;
  }, [
    searchQueryParam,
    biddingType,
    priceFromParam,
    priceToParam,
    isSharedOwnershipParam,
    categoriesParam,
    regionsParam,
    tagsParam,
    dynamicFiltersParam,
    updateQuery,
  ]);

  const clearAllFilters = useCallback(() => {
    const updates: Record<string, string | string[] | number | null> = {
      biddingType: 'Все',
      searchQuery: null,
      priceFrom: null,
      priceTo: null,
      isSharedOwnership: null,
      categories: [],
      regions: [],
      page: 1,
    };

    Object.keys(dynamicFiltersParam).forEach((key) => {
      updates[`attr_${key}`] = null;
    });

    if (tagsParam) {
      updates.tags = null;
    }

    updateQuery(updates);
  }, [dynamicFiltersParam, tagsParam, updateQuery]);

  const handleRetry = useCallback(() => {
    fetchLots();
  }, [fetchLots]);

  return (
    <main className={styles.main}>
      <div className={styles.heroWrapper}>
        <HeroSection />

        <div className={styles.mapBanner}>
          <Link href="/map" className={styles.mapLinkButton}>
            Смотреть недвижимость на карте
          </Link>
        </div>

        {/* --- ПРОМО БАННЕР (Магнит Саратов) --- */}
        {/* <div className={styles.promoBanner} style={{ position: 'relative', overflow: 'hidden', padding: '20px' }}>

        <div className={styles.promoContent} style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '15px',
          width: '100%',
          position: 'relative',
          zIndex: 10
        }}>
          <div style={{ flex: '1 1 300px', paddingRight: '10px' }}>
            <div className={styles.promoBadge}>🔥 Инвест-лот месяца: Магнит (Саратов)</div>
            <div className={styles.promoText}>
              Доходность 20%. Вход от 24 млн руб. Федеральный арендатор.
            </div>
          </div>

          <Link href="/gab/magnit-saratov" className={styles.promoButton} style={{
            whiteSpace: 'nowrap',
            flex: '1 1 auto',
            textAlign: 'center',
            minWidth: '200px',
            maxWidth: '100%'
          }}>
            Смотреть расчет
          </Link>
        </div> */}

        {/* ПЕЧАТЬ */}
        {/* <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotate(-15deg)',
          border: '1px solid #c53030',
          padding: '5px 15px',
          color: '#c53030',
          backgroundColor: 'transparent',
          zIndex: 20,
          pointerEvents: 'none',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          <div style={{
            fontSize: '2rem',
            fontWeight: '400',
            fontFamily: 'Arial, sans-serif',
            lineHeight: '1.1'
          }}>
            Продано
          </div>
          <div style={{
            fontSize: '1.1rem',
            fontWeight: '700', // ЖИРНЫЙ ШРИФТ ДЛЯ ЦЕНЫ
            fontFamily: 'Arial, sans-serif',
            marginTop: '4px'
          }}>
            35 678 900 руб.
          </div>
        </div>
      </div> */}

        {/* Скрываем дом в Глазинино */}
        {/* <div className={styles.promoWrapper}>ы
          <PromoGrid hotSlug="dom-v-glazinino" maxArchived={0} />
        </div> */}
      </div>


      {user?.isAdmin && (
        <div className={styles.actionBannersGrid}>
          <div className={styles.addAdBanner}>
            <div className={styles.addAdContent}>
              <h3>Частные объявления</h3>
              <p>Разместите объявление бесплатно или найдите предложения от других инвесторов.</p>
            </div>
            {/* Обертка для двух кнопок */}
            <div className={styles.addAdButtons}>
              <Link href="/add-ad" className={styles.addAdLinkButton}>
                + Добавить объявление
              </Link>
              <Link href="/ads" className={styles.viewAdsLinkButton}>
                Смотреть объявления
              </Link>
            </div>
          </div>
        </div>
      )}

      <section className={styles.contentArea}>
        {passengerCarCrumbs && <Breadcrumbs crumbs={passengerCarCrumbs} />}

        <div className={styles.filtersContainer}>
          <ActiveFiltersSummary
            activeFilterCount={activeFilterChips.length}
            chips={activeFilterChips}
            onClearAll={clearAllFilters}
          />

          <button
            className={styles.toggleFiltersButton}
            onClick={() => setIsFiltersVisible(!isFiltersVisible)}
          >
            {isFiltersVisible
              ? `Скрыть фильтры${activeFilterChips.length > 0 ? ` (${activeFilterChips.length})` : ''}`
              : `Показать фильтры${activeFilterChips.length > 0 ? ` (${activeFilterChips.length})` : ''}`}
          </button>

          {/* Фильтры */}
          <aside className={`${styles.filtersSidebar} ${isFiltersVisible ? styles.sidebarVisible : ''}`}>
            <Filters
              categories={categoriesParam}
              biddingType={biddingType}
              priceFrom={priceFromParam}
              priceTo={priceToParam}
              searchQuery={searchQueryParam}
              isSharedOwnership={isSharedOwnershipParam}
              regions={regionsParam}
              dynamicFilters={dynamicFiltersParam}
              onUpdate={updateQuery}
            />
          </aside>
        </div>

        {loading || authLoading ? (
          <div className={styles.loadingMessage}>Загрузка лотов...</div>
        ) : error ? (
          <div>
            <p className={styles.errorMessage}>{error}</p>
            <button className={styles.searchButton} type="button" onClick={handleRetry}>
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
              {lots.map((lot: Lot) => (
                <LotItem
                  key={lot.id}
                  lot={lot}
                // если нужен доп. класс обёртки от page.module.css
                // className={styles.lotWrapper}
                />
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
      </section>
    </main>
  );
}

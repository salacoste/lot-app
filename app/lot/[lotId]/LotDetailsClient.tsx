// app/lot/[id]/LotDetailsClient.tsx

'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LotMap from '../../../components/LotMap';
import { Lot } from '../../../types';
import styles from './lot.module.css';
import AiEvaluationBlock from '@/components/AiEvaluationBlock/AiEvaluationBlock';
import { generateSlug } from '../../../utils/slugify';
import LotHeaderSummary, { LotHeaderGallery, LotHeaderStatusSummary, getStatusTheme } from './LotHeaderSummary';
import LotFavoriteActions from './LotFavoriteActions';
import LotDocumentsSection from './LotDocumentsSection';
import { buildLotBreadcrumbs, getLotPagePath } from '@/utils/lotBreadcrumbs';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getDynamicFiltersForCategories } from '@/app/data/constants';
import { getWeightedMarketPrice, shouldShowPriceEstimate } from '@/utils/priceEvaluation';

const IconTelegram = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 3.5L2.5 11L9.5 13.5L11.5 20.5L14.5 16.5L19 20.5L21.5 3.5Z" />
  </svg>
);

const IconMax = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Стилизованная иконка в виде буквы M для мессенджера MAX */}
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <path d="M7 16V8l5 4 5-4v8" />
  </svg>
);

// Компонент для отображения одного этапа покупки
const PurchaseStep = ({ title, description }: { title: string; description: string }) => (
  <div className={styles.step}>
    <h3>{title}</h3>
    <p>{description}</p>
  </div>
);

// Функция форматирования даты
const formatDate = (dateString: string) => {
  if (!dateString || dateString === '0001-01-01T00:00:00') return '-';
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Функция для определения, является ли статус конечным
const isFinalStatus = (status?: string | null) => {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes('завершенные') ||
    s.includes('отменен') ||
    s.includes('не состоял') ||
    s.includes('аннулирован')
  );
};

const getTagLabel = (tag: NonNullable<Lot['tags']>[number]) => tag.label?.trim() || '';

// Компонент получает данные через пропсы
export default function LotDetailsClient({ lot }: { lot: Lot | null }) {
  const router = useRouter();
  const { user } = useAuth();

  // Состояния для редактирования (Admin)
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState(lot?.description || '');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [isEditingViewingProcedure, setIsEditingViewingProcedure] = useState(false);
  const [viewingProcedureText, setViewingProcedureText] = useState(lot?.bidding?.viewingProcedure || '');
  const [isSavingViewingProcedure, setIsSavingViewingProcedure] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);

  // Состояние для причины статуса
  const [isReasonExpanded, setIsReasonExpanded] = useState(false);

  // Сохранение лота в историю просмотренных
  useEffect(() => {
    if (lot?.id) {
      try {
        const viewed = JSON.parse(localStorage.getItem('viewedLots') || '[]');
        if (!viewed.includes(lot.id)) {
          viewed.push(lot.id);
          // Ограничим историю, например, 1000 последними лотами, чтобы не переполнять localStorage
          if (viewed.length > 1000) {
            viewed.shift();
          }
          localStorage.setItem('viewedLots', JSON.stringify(viewed));
        }
      } catch (e) {
        console.error('Ошибка при сохранении просмотренного лота', e);
      }
    }
  }, [lot?.id]);

  // Обработчик "Назад"
  const handleBackToList = () => {
    // Проверяем, откуда мы пришли
    const isFromFavorites = sessionStorage.getItem('isFromFavorites') === 'true';
    const savedListUrl = sessionStorage.getItem('lotListUrl');
    const savedQuery = sessionStorage.getItem('lotListQuery');

    if (isFromFavorites) {
      // Если пришли из избранного, возвращаемся в избранное (с учетом пагинации, если она была сохранена)
      const favQuery = sessionStorage.getItem('favoritesQuery') || '';
      router.push(`/favorites${favQuery}`);
      return;
    }

    if (savedListUrl) {
      router.push(savedListUrl);
      return;
    }

    router.push(savedQuery ? `/${savedQuery}` : '/');
  };

  const handleSaveDescription = async () => {
    if (!lot) return;
    setIsSavingDescription(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/lots/${lot.id}/description`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: descriptionText }),
        credentials: 'include'
      });
      if (res.ok) {
        setIsEditingDescription(false);
        lot.description = descriptionText;
        alert('Описание сохранено. Лот поставлен в общую очередь классификации (обычно 10–15 мин).');
      } else {
        alert('Ошибка при сохранении описания');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при сохранении описания');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleSaveViewingProcedure = async () => {
    if (!lot) return;
    setIsSavingViewingProcedure(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/lots/${lot.id}/viewing-procedure`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ viewingProcedure: viewingProcedureText }),
        credentials: 'include'
      });
      if (res.ok) {
        setIsEditingViewingProcedure(false);
        if (lot.bidding) {
          lot.bidding.viewingProcedure = viewingProcedureText.trim() || undefined;
        }
      } else {
        alert('Ошибка при сохранении порядка ознакомления');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при сохранении порядка ознакомления');
    } finally {
      setIsSavingViewingProcedure(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!lot || !e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    setIsUploadingImage(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/lots/${lot.id}/images`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      if (res.ok) {
        window.location.reload();
      } else {
        alert('Ошибка при загрузке фото');
      }
    } catch (error) {
      console.error(error);
      alert('Ошибка при загрузке фото');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!lot || !e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    setIsUploadingDocument(true);
    try {
      const extractToDescription = lot.needsDescriptionReview ? 'true' : 'false';
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/lots/${lot.id}/documents?extractToDescription=${extractToDescription}`,
        {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.extractedDescription) {
          alert('Документ загружен. Описание обновлено из файла, лот поставлен в очередь классификации.');
        } else {
          alert('Документ загружен.');
        }
        window.location.reload();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message ?? 'Ошибка при загрузке документа');
      }
    } catch (error) {
      console.error(error);
      alert('Ошибка при загрузке документа');
    } finally {
      setIsUploadingDocument(false);
      e.target.value = '';
    }
  };

  const handleReclassify = async () => {
    if (!lot) return;
    if (!confirm('Вы уверены, что хотите переклассифицировать этот лот?')) return;
    
    setIsReclassifying(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/lots/${lot.id}/reclassify`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message ?? 'Лот поставлен в очередь на переклассификацию.');
      } else {
        alert('Ошибка при переклассификации');
      }
    } catch (error) {
      console.error(error);
      alert('Ошибка при переклассификации');
    } finally {
      setIsReclassifying(false);
    }
  };

  // Если данные не пришли с сервера
  if (!lot) {
    return (
      <div className={styles.container}>
        <button onClick={handleBackToList} className={styles.backLink}>
          &larr; Вернуться к списку лотов
        </button>
        <h1>Лот не найден</h1>
        <p>К сожалению, запрашиваемый лот не существует или был удален.</p>
      </div>
    );
  }

  const crumbs = buildLotBreadcrumbs(lot);
  const lotUrl = getLotPagePath(lot);

  const getRankColorClass = (rank: number | null | undefined) => {
    if (!rank) return styles.rankLow; // Если null или 0 — серый цвет

    if (rank >= 8) return styles.rankHigh;
    if (rank >= 5) return styles.rankMedium;
    return styles.rankLow;
  };

  // TODO: Подготовка бейджей
  const badges: string[] = [];

  // Подготовка картинок для галереи
  // Если массив images пуст, пытаемся взять imageUrl или ставим заглушку
  const galleryImages = (lot.images && lot.images.length > 0)
    ? lot.images
    : (lot.imageUrl ? [lot.imageUrl] : ['/placeholder.png']);

  // --- ИКОНКИ (Копируем из LotCard для единообразия) ---
  const IconArrowUp = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
  );

  const IconArrowDown = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
    </svg>
  );

  // Определяем направление цены
  const getPriceDirectionIcon = () => {
    const type = lot.bidding?.type?.toLowerCase() || '';

    if (type.includes('аукцион')) {
      return (
        <span className={styles.iconUp} title="Цена повышается">
          <IconArrowUp />
        </span>
      );
    }

    if (type.includes('предложение')) {
      return (
        <span className={styles.iconDown} title="Цена понижается">
          <IconArrowDown />
        </span>
      );
    }

    return null;
  };

  // Проверяем, есть ли хоть одна запись с задатком > 0
  const showDepositColumn = lot.priceSchedules && lot.priceSchedules.some(s => s.deposit && s.deposit > 0);

  const displayPrice = getWeightedMarketPrice(lot);

  // Получаем конфигурацию динамических фильтров для категорий лота
  const dynamicFiltersConfig = useMemo(() => {
    if (!lot.categories) return [];
    return getDynamicFiltersForCategories(lot.categories.map(c => c.name), 'union');
  }, [lot.categories]);

  // Фильтруем только те атрибуты, которые есть у лота и имеют значение
  const displayAttributes = useMemo(() => {
    if (!lot.attributes || Object.keys(lot.attributes).length === 0) return [];
    
    return dynamicFiltersConfig
      .filter(config => lot.attributes![config.id])
      .map(config => ({
        label: config.label,
        value: lot.attributes![config.id]
      }));
  }, [lot.attributes, dynamicFiltersConfig]);

  const visibleTags = Array.isArray(lot.tags)
    ? lot.tags.filter((tag) => getTagLabel(tag))
    : [];

  return (

    <main className={styles.container}>
      <LotHeaderSummary
        lot={lot}
        crumbs={crumbs}
        onBackToList={handleBackToList}
      />

      <div className={styles.lotDetailGrid}>

        {/* --- ЭЛЕМЕНТЫ ПЕРВОЙ СТРОКИ --- */}

        {/* --- ЛЕВАЯ КОЛОНКА: ФОТОГАЛЕРЕЯ --- */}
        <div className={styles.imageSection}>
          <LotHeaderGallery
            lot={lot}
            galleryImages={galleryImages}
            badges={badges}
          />
          {user?.isAdmin && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <label className={styles.ctaButton} style={{ cursor: 'pointer', display: 'inline-block', padding: '0.5rem 1rem', background: '#3182ce', color: '#fff' }}>
                {isUploadingImage ? 'Загрузка...' : 'Добавить фото'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleImageUpload}
                  disabled={isUploadingImage}
                />
              </label>
            </div>
          )}
        </div>

        {/* Правая колонка: Информация о лоте */}
        <div className={styles.infoSection}>

          <LotHeaderStatusSummary
            lot={lot}
            isReasonExpanded={isReasonExpanded}
            onToggleReason={() => setIsReasonExpanded(!isReasonExpanded)}
          />

          <p className={styles.lotInfo}><b>Номер лота:</b> {lot.publicId}</p>
          <p className={styles.lotInfo}><b>Тип торгов:</b> {lot.bidding?.type}</p>
          <p className={styles.lotInfo}><b>Прием заявок:</b> {lot.bidding?.bidAcceptancePeriod}</p>

          {visibleTags.length > 0 && (
            <div className={styles.tagBlock} aria-label="Публичные теги лота">
              {visibleTags.map((tag, index) => {
                const tagText = getTagLabel(tag);
                return (
                  <span key={`${tag.key || tagText}-${index}`} className={styles.tagChip}>
                    {tagText}
                  </span>
                );
              })}
            </div>
          )}

          {lot.bidding?.tradePeriod && (
            <p className={styles.lotInfo}><b>Период торгов:</b> {lot.bidding?.tradePeriod}</p>
          )}

          {(lot.bidding?.bankruptMessageId || lot.bidding?.id) && (
            <div className={`${styles.lotInfo} ${styles.lotInfoColumn}`}>
              <b>Информация о торгах с Федресурса:</b>
              <div className={styles.documentLinks}>
                {user?.isSubscriptionActive ? (
                  <>
                    {lot.bidding?.bankruptMessageId && (
                      <a
                        href={`https://fedresurs.ru/bankruptmessages/${lot.bidding.bankruptMessageId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.documentLink}
                      >
                        Сообщение об объявлении торгов
                      </a>
                    )}
                    {lot.bidding?.id && (
                      <a
                        href={`https://fedresurs.ru/biddings/${lot.bidding.id}/messages`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.documentLink}
                      >
                        Все сообщения по торгам
                      </a>
                    )}
                  </>
                ) : (
                  <div
                    className={styles.proBadgeWrapper}
                    onClick={() => router.push(user ? '/subscribe' : `/login?returnUrl=${encodeURIComponent(lotUrl)}`)}
                    title={user ? 'Перейти на PRO тариф' : 'Войти для просмотра'}
                  >
                    <div className={styles.proBadgeContent}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', flexShrink: 0 }}>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      Доступно пользователям с PRO доступом
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <LotFavoriteActions lot={lot} />

          <div className={styles.priceInfo}>
            {/* Блок для начальной цены */}
            <div>
              <span className={styles.priceLabel}>Начальная цена:</span>
              <span className={styles.priceValue}>
                {lot.startPrice ? `${lot.startPrice.toLocaleString()} ₽` : 'Не указана'}

                {/* Вставляем иконку */}
                {getPriceDirectionIcon()}
              </span>
            </div>

            {/* Задаток */}
            {lot.deposit && (
              <div className={styles.depositInfo}>
                <span className={styles.depositLabel}>Величина задатка:</span>
                <span className={styles.depositValue}>
                  {lot.deposit.toLocaleString()} ₽
                </span>
              </div>
            )}

            {/* Шаг цены (аукциона) */}
            {lot.step && (
              <div className={styles.depositInfo}>
                <span className={styles.depositLabel}>Шаг цены:</span>
                <span className={styles.depositValue}>
                  {lot.step.toLocaleString()} ₽
                </span>
              </div>
            )}
          </div>

          {/* БЛОК ИТОГОВ: показываем только если статус конечный */}
          {isFinalStatus(lot.tradeStatus) && (
            <div className={`${styles.tradeResultsInfo} ${styles[getStatusTheme(lot.tradeStatus)]}`}>
              <h3 className={styles.resultTitle}>Итоги торгов</h3>

              {lot.finalPrice != null && (
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Итоговая цена:</span>
                  <span className={`${styles.resultValue} ${styles.highlightPrice}`}>
                    {lot.finalPrice.toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              )}

              {lot.winnerName && (
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Победитель:</span>
                  <span className={styles.resultValue}>{lot.winnerName}</span>
                </div>
              )}

              {/* {lot.winnerInn && (
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>ИНН Победителя:</span>
                  <span className={styles.resultValue}>{lot.winnerInn}</span>
                </div>
              )} */}

              {/* Если торги не состоялись / отменены, и данных о победителе нет */}
              {!lot.finalPrice && !lot.winnerName && (
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>Примечание:</span>
                  <span className={styles.resultValue}>Торги завершены без определения победителя.</span>
                </div>
              )}
            </div>
          )}

          <p className={styles.lotInfo}><b>Площадка:</b> {lot.bidding?.platform}</p>

          {lot.bidding?.tradeNumber && (
            user?.isSubscriptionActive ? (
              <p className={styles.lotInfo}><b>Номер торгов:</b> {lot.bidding.tradeNumber}</p>
            ) : (
              <div className={`${styles.lotInfo} ${styles.lotInfoColumn}`}>
                <b>Номер торгов:</b>
                <div
                  className={styles.proBadgeWrapper}
                  onClick={() => router.push(user ? '/subscribe' : `/login?returnUrl=${encodeURIComponent(lotUrl)}`)}
                  title={user ? 'Перейти на PRO тариф' : 'Войти для просмотра'}
                >
                  <div className={styles.proBadgeContent}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', flexShrink: 0 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    Доступно пользователям с PRO доступом
                  </div>
                </div>
              </div>
            )
          )}

          {/* Можно добавить кнопку "купить" прямо сюда */}
          {/* <button className={styles.ctaButton} style={{ marginTop: '2rem' }}>Оставить заявку</button> */}
        </div>

        {/* --- ЭЛЕМЕНТЫ ВТОРОЙ СТРОКИ --- */}

        {/* Описание лота (занимает всю ширину) */}
        <div className={styles.descriptionSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className={styles.sectionTitle}>Описание лота</h2>
            {user?.isAdmin && lot.needsDescriptionReview && !isEditingDescription && (
              <span style={{
                background: '#fef3c7',
                color: '#92400e',
                padding: '0.25rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}>
                Нет описания имущества
              </span>
            )}
            {user?.isAdmin && !isEditingDescription && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  onClick={handleReclassify}
                  disabled={isReclassifying}
                  className={styles.ctaButton}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', background: '#ed8936', color: '#fff' }}
                >
                  {isReclassifying ? 'Отправка...' : 'Переклассифицировать'}
                </button>
                <button 
                  onClick={() => setIsEditingDescription(true)}
                  className={styles.ctaButton}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', background: '#e2e8f0', color: '#2d3748' }}
                >
                  Редактировать
                </button>
              </div>
            )}
          </div>
          <div className={styles.descriptionText}>
            {isEditingDescription ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <textarea 
                  value={descriptionText}
                  onChange={(e) => setDescriptionText(e.target.value)}
                  style={{ width: '100%', minHeight: '200px', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={handleSaveDescription} 
                    disabled={isSavingDescription}
                    className={styles.ctaButton}
                    style={{ padding: '0.5rem 1rem', background: '#3182ce', color: '#fff' }}
                  >
                    {isSavingDescription ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button 
                    onClick={() => {
                      setIsEditingDescription(false);
                      setDescriptionText(lot.description || '');
                    }}
                    disabled={isSavingDescription}
                    className={styles.ctaButton}
                    style={{ padding: '0.5rem 1rem', background: '#e2e8f0', color: '#2d3748' }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              lot.description
            )}
          </div>
          {user?.isAdmin && lot.needsDescriptionReview && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#4a5568' }}>
                Если перечень имущества в отдельном файле (docx, pdf), загрузите его — текст будет извлечён в описание.
              </p>
              <label className={styles.ctaButton} style={{ display: 'inline-block', padding: '0.5rem 1rem', background: '#3182ce', color: '#fff', cursor: 'pointer' }}>
                {isUploadingDocument ? 'Загрузка…' : 'Загрузить документ'}
                <input
                  type="file"
                  accept=".docx,.doc,.pdf,.xlsx,.xls,.rtf"
                  multiple
                  onChange={handleDocumentUpload}
                  disabled={isUploadingDocument}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}
        </div>

        {/* Категории и Регион */}
        {((lot.categories && lot.categories.length > 0) || lot.propertyRegionName) && (
          <div className={styles.descriptionSection}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {lot.propertyRegionName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4a5568' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                  <span style={{ fontSize: '1.05rem', fontWeight: 500 }}>{lot.propertyRegionName}</span>
                </div>
              )}
              
              {lot.categories && lot.categories.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {lot.categories.map((c, idx) => (
                    <div key={idx} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.375rem', 
                      padding: '0.375rem 0.75rem', 
                      backgroundColor: '#edf2f7', 
                      color: '#2d3748', 
                      borderRadius: '9999px', 
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      border: '1px solid #e2e8f0'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#48bb78" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      {c.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Динамические атрибуты */}
        {displayAttributes.length > 0 && (
          <div className={styles.descriptionSection}>
            <h2 className={styles.sectionTitle}>Характеристики</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
              {displayAttributes.map((attr, idx) => (
                <div key={idx} style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.85rem', color: '#718096', marginBottom: '0.25rem' }}>{attr.label}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 500, color: '#2d3748' }}>{attr.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Информация по кадастровым номерам */}
        {lot.cadastralInfos && lot.cadastralInfos.length > 0 && (
          <div className={styles.descriptionSection}>
            <h2 className={styles.sectionTitle}>Данные из Росреестра</h2>

            {user?.isSubscriptionActive ? (
              <div className={styles.cadastralList}>
                {lot.cadastralInfos.map((info, idx) => (
                  <div key={idx} className={styles.cadastralCard}>
                    <h3 className={styles.cadastralTitle}>
                      Кадастровый номер: <span>{info.cadastralNumber}</span>
                    </h3>
                    <div className={styles.cadastralGrid}>
                      {info.area && (
                        <div className={styles.cadastralItem}>
                          <span className={styles.cadastralLabel}>Площадь:</span>
                          <span className={styles.cadastralValue}>{info.area} кв.м.</span>
                        </div>
                      )}
                      {info.cadastralCost && (
                        <div className={styles.cadastralItem}>
                          <span className={styles.cadastralLabel}>Кадастровая стоимость:</span>
                          <span className={styles.cadastralValue}>
                            {info.cadastralCost.toLocaleString('ru-RU')} ₽
                          </span>
                        </div>
                      )}
                      {info.category && (
                        <div className={styles.cadastralItem}>
                          <span className={styles.cadastralLabel}>Категория земель:</span>
                          <span className={styles.cadastralValue}>{info.category}</span>
                        </div>
                      )}
                      {info.permittedUse && (
                        <div className={styles.cadastralItem}>
                          <span className={styles.cadastralLabel}>Разрешенное использование:</span>
                          <span className={styles.cadastralValue}>{info.permittedUse}</span>
                        </div>
                      )}
                      {info.status && (
                        <div className={styles.cadastralItem}>
                          <span className={styles.cadastralLabel}>Статус:</span>
                          <span className={styles.cadastralValue}>{info.status}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Заглушка для пользователей без подписки/триала */
              <div className={styles.lockedProBlock}>
                <div className={styles.lockedContent}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <h3>Скрытая информация</h3>
                  <p>Полные данные из Росреестра (площадь, стоимость, категория земель и ВРИ) доступны пользователям с активной подпиской или в период пробного доступа (7 дней после регистрации).</p>
                  {/* Кнопка ведет на тарифы или регистрацию в зависимости от того, авторизован ли пользователь */}
                  <button
                    className={`${styles.ctaButton} ${styles.maxButton}`}
                    onClick={() => router.push(user ? '/subscribe' : `/login?returnUrl=${encodeURIComponent(lotUrl)}`)}
                    style={{ marginTop: '1rem' }}
                  >
                    {user ? 'Перейти на PRO тариф' : 'Войти для просмотра'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Отдельный блок для арбитражного управляющего и должника */}
        {/*
        {(lot.bidding?.arbitrationManager || lot.bidding?.debtor) && (
          <div className={styles.descriptionSection}>
            <h2 className={styles.sectionTitle}>Участники процедуры банкротства</h2>
            <div className={styles.participantsContainer}>
              {lot.bidding?.debtor && (
                <div className={styles.participantBlock}>
                  <h3 className={styles.participantTitle}>Должник</h3>
                  <div className={styles.participantInfo}>
                    <span className={styles.participantName}>{lot.bidding.debtor.name}</span>
                    {lot.bidding.debtor.inn && (
                      <span className={styles.participantDetail}>ИНН: {lot.bidding.debtor.inn}</span>
                    )}
                    {lot.bidding.debtor.snils && (
                      <span className={styles.participantDetail}>СНИЛС: {lot.bidding.debtor.snils}</span>
                    )}
                    {lot.bidding.debtor.ogrn && (
                      <span className={styles.participantDetail}>ОГРН: {lot.bidding.debtor.ogrn}</span>
                    )}
                  </div>
                </div>
              )}

              {lot.bidding?.arbitrationManager && (
                <div className={styles.participantBlock}>
                  <h3 className={styles.participantTitle}>Арбитражный управляющий</h3>
                  <div className={styles.participantInfo}>
                    <span className={styles.participantName}>{lot.bidding.arbitrationManager.name}</span>
                    {lot.bidding.arbitrationManager.inn && (
                      <span className={styles.participantDetail}>ИНН: {lot.bidding.arbitrationManager.inn}</span>
                    )}
                    {lot.bidding.arbitrationManager.snils && (
                      <span className={styles.participantDetail}>СНИЛС: {lot.bidding.arbitrationManager.snils}</span>
                    )}
                    {lot.bidding.arbitrationManager.ogrn && (
                      <span className={styles.participantDetail}>ОГРН: {lot.bidding.arbitrationManager.ogrn}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        */}

        {/* Экспресс-оценка (Quick) */}
        {!isFinalStatus(lot.tradeStatus) && user?.isAdmin && (displayPrice || lot.investmentSummary) && (
          <div className={styles.descriptionSection}>
            <AiEvaluationBlock
              type="quick"
              currentPrice={lot.startPrice}
              priceConfidence={lot.priceConfidence}
              quickData={{
                estimatedPrice: displayPrice ?? undefined,
                investmentSummary: lot.investmentSummary,
              }}
            />
          </div>
        )}

        {/* Глубокая аналитика (DeepSeek Reasoning Evaluation) */}
        {!isFinalStatus(lot.tradeStatus) && user?.isAdmin && lot.startPrice != null && lot.startPrice > 1000000 && shouldShowPriceEstimate(lot) && (
          <div className={styles.descriptionSection}>
            <AiEvaluationBlock
              type="deep"
              lotPublicId={lot.publicId}
              currentPrice={lot.startPrice}
            />
          </div>
        )}

        <LotDocumentsSection documents={lot.documents ?? []} />
      </div>

      {/* Показываем карту, только если есть координаты */}
      {lot.coordinates && lot.coordinates.length === 2 && (
        <div className={styles.mapSection}>
          <h2 className={styles.sectionTitle}>Расположение на карте</h2>
          <LotMap coordinates={lot.coordinates as [number, number]} />
        </div>
      )}

      {/* Порядок ознакомления с имуществом */}
      {(lot.bidding?.viewingProcedure || user?.isAdmin) && (
        <div className={styles.descriptionSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className={styles.sectionTitle}>Порядок ознакомления с имуществом</h2>
            {user?.isAdmin && !isEditingViewingProcedure && (
              <button
                onClick={() => setIsEditingViewingProcedure(true)}
                className={styles.ctaButton}
                style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', background: '#e2e8f0', color: '#2d3748' }}
              >
                Редактировать
              </button>
            )}
          </div>
          <div className={styles.descriptionText}>
            {isEditingViewingProcedure ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <textarea
                  value={viewingProcedureText}
                  onChange={(e) => setViewingProcedureText(e.target.value)}
                  placeholder="Телефон, график работы, адрес для ознакомления..."
                  style={{ width: '100%', minHeight: '120px', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                />
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#666' }}>
                  Относится ко всем лотам этих торгов.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={handleSaveViewingProcedure}
                    disabled={isSavingViewingProcedure}
                    className={styles.ctaButton}
                    style={{ padding: '0.5rem 1rem', background: '#3182ce', color: '#fff' }}
                  >
                    {isSavingViewingProcedure ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingViewingProcedure(false);
                      setViewingProcedureText(lot.bidding?.viewingProcedure || '');
                    }}
                    disabled={isSavingViewingProcedure}
                    className={styles.ctaButton}
                    style={{ padding: '0.5rem 1rem', background: '#e2e8f0', color: '#2d3748' }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              lot.bidding?.viewingProcedure || (
                user?.isAdmin ? <span style={{ color: '#666' }}>Не указан</span> : null
              )
            )}
          </div>
        </div>
      )}

      {/* ГРАФИК СНИЖЕНИЯ ЦЕНЫ */}
      {lot.priceSchedules && lot.priceSchedules.length > 0 && (
        <div className={styles.priceScheduleSection}>
          <h2 className={styles.sectionTitle}>График снижения цены</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.priceScheduleTable}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>№</th>

                  {/* Десктоп: Дата начала */}
                  <th className={styles.desktopOnly}>Дата начала</th>
                  {/* Мобильный: Дата начала + Цена */}
                  <th className={`${styles.mobileOnly} ${styles.mobileDateColumn}`}>
                    <div className={styles.thGroup}>
                      <span>Дата начала</span>
                      <span className={styles.subHeader}>Цена, руб.</span>
                    </div>
                  </th>

                  {/* Десктоп: Дата окончания */}
                  <th className={styles.desktopOnly}>Дата окончания</th>

                  {/* Десктоп: Цена */}
                  <th className={styles.desktopOnly}>Цена, руб.</th>

                  {/* Мобильный: Дата окончания + Задаток */}
                  <th className={`${styles.mobileOnly} ${styles.mobileDateColumn}`}>
                    <div className={styles.thGroup}>
                      <span>Дата окончания</span>
                      {showDepositColumn && (<span className={styles.subHeader}>Задаток, руб.</span>)}
                    </div>
                  </th>

                  {/* Десктоп: Задаток */}
                  {showDepositColumn && (
                    <th className={styles.desktopOnly}>Задаток, руб.</th>
                  )}

                  {/* <th style={{ textAlign: 'center' }}>Ранг</th> */}
                </tr>
              </thead>
              <tbody>
                {lot.priceSchedules.map((schedule) => (
                  <tr key={schedule.number}>
                    <td style={{ textAlign: 'center', color: '#888' }}>{schedule.number}</td>

                    {/* Десктоп: Дата начала */}
                    <td className={styles.desktopOnly}>{formatDate(schedule.startDate)}</td>

                    {/* Мобильный: Дата начала + Цена */}
                    <td className={`${styles.mobileOnly} ${styles.mobileDateColumn}`}>
                      <div className={styles.cellGroup}>
                        <div className={styles.dateRow}>{formatDate(schedule.startDate)}</div>
                        <div className={styles.priceRow}>
                          {schedule.price?.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </td>

                    {/* Десктоп: Дата окончания */}
                    <td className={styles.desktopOnly}>{formatDate(schedule.endDate)}</td>

                    {/* Десктоп: Цена */}
                    <td className={styles.desktopOnly} style={{ fontWeight: 600 }}>
                      {schedule.price?.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                    </td>

                    {/* Мобильный: Дата окончания + Задаток */}
                    <td className={`${styles.mobileOnly} ${styles.mobileDateColumn}`}>
                      <div className={styles.cellGroup}>
                        <div className={styles.dateRow}>{formatDate(schedule.endDate)}</div>
                        {showDepositColumn && (<div className={styles.depositRow}>
                          {schedule.deposit?.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                        </div>)}
                      </div>
                    </td>

                    {/* Десктоп: Задаток */}
                    {showDepositColumn && (
                      <td className={styles.desktopOnly}>
                        {schedule.deposit?.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                      </td>
                    )}

                    {/* Ранг (Общий) */}
                    {/* <td className={styles.rankCell}>
                      {schedule.estimatedRank ? (
                        <span
                          className={styles.rankBadge}
                          style={{
                            backgroundColor:
                              schedule.estimatedRank >= 8 ? '#48bb78' :
                                schedule.estimatedRank >= 5 ? '#ecc94b' :
                                  '#f56565'
                          }}
                        >
                          {schedule.estimatedRank}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td> */}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

        {/* Информация о покупке или Похожие лоты */}
        {isFinalStatus(lot.tradeStatus) ? (
          <div className={styles.purchaseInfo}>
            <h2>Похожие лоты</h2>
            {lot.similarLots && lot.similarLots.length > 0 ? (
              <div className={styles.similarLotsGrid}>
                {lot.similarLots.map((sl) => {
                  const slSlug = sl.slug ?? generateSlug(sl.title || '');
                  const slUrl = `/lot/${slSlug}-${sl.publicId}`;
                  return (
                    <a key={sl.id} href={slUrl} className={styles.similarLotCard}>
                      <div className={styles.similarLotImageWrap}>
                        <img
                          src={sl.imageUrl || '/placeholder.png'}
                          alt={sl.title || 'Лот'}
                          className={styles.similarLotImage}
                          loading="lazy"
                        />
                      </div>
                      <div className={styles.similarLotInfo}>
                        <h3 className={styles.similarLotTitle}>{sl.title}</h3>
                        {sl.startPrice != null && (
                          <div className={styles.similarLotPrice}>
                            {sl.startPrice.toLocaleString('ru-RU')} ₽
                          </div>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p>Похожих лотов не найдено.</p>
            )}
          </div>
        ) : (
        <div className={styles.purchaseInfo}>
          <h2>Как купить лот</h2>
          <PurchaseStep
            title="1. Осмотр имущества"
            description={
              (lot.bidding?.viewingProcedure)
                ? `Вам необходимо самостоятельно ознакомиться с имуществом. Порядок ознакомления указан выше на этой странице.`
                : "Вам необходимо самостоятельно связаться с арбитражным управляющим для осмотра имущества. Напишите нам для получения контактов управляющего, если они не указаны в описании лота."
            }
          />
          <PurchaseStep
            title="2. Договор"
            description="Если после осмотра вы решили приобрести данный лот с нашей помощью, мы заключаем с вами договор, в котором прописаны все условия сотрудничества и наша ответственность."
          />
          <PurchaseStep
            title="3. Задаток и комиссия"
            description="Вы переводите задаток на специальный счет торговой площадки и оплачиваете нашу комиссию по договору."
          />
          <PurchaseStep
            title="4. Участие в торгах"
            description="Наш специалист подает заявку, участвует в торгах от вашего имени и борется за победу по согласованной с вами стратегии."
          />
          <PurchaseStep
            title="5. Завершение сделки"
            description="В случае победы мы подписываем протокол торгов. Вы оплачиваете оставшуюся стоимость лота напрямую продавцу. Если торги не выиграны, задаток возвращается вам в полном объеме."
          />

          <div style={{ margin: '2rem 0', textAlign: 'center' }}>
            <Link href="/agent-info" className={styles.documentLink} style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              Зачем нужен агент на торгах и за что вы платите? &rarr;
            </Link>
          </div>

          <div className={styles.contactSection}>
            <h3 className={styles.contactTitle}>Связаться с менеджером для выкупа лота:</h3>
            <div className={styles.buttonsWrapper}>
              <a
                href="https://t.me/79269598508"
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.ctaButton} ${styles.telegramButton}`}
              >
                <IconTelegram />
                Написать в Telegram
              </a>

              <a
                href="https://max.ru/u/f9LHodD0cOJk9dQzNqxn7h5DTb0BdyRPGsRxxNiC57Pl81OBY1btJow-xtk"
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.ctaButton} ${styles.maxButton}`}
              >
                <IconMax />
                Написать в MAX
              </a>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

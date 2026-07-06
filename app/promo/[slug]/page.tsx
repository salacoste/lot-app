// app/promo/[slug]/page.tsx

import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PROMO_LOTS, type PromoLot } from '../data/promo-lots';
import styles from './promo.module.css';
import ImageGallery from './ImageGallery';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const lot = PROMO_LOTS[slug];
  if (!lot) return { title: 'Лот не найден' };

  const seoDescription = lot.metaDescription || lot.description.slice(0, 160) + '...';

  return {
    title: `${lot.title} | Инвест-предложение`,
    description: lot.description,
    keywords: lot.keywords ? lot.keywords.join(', ') : undefined,
    openGraph: {
      title: lot.title,
      description: lot.description,
      images: lot.img ? [lot.img] : [],
    },
  };
}

function computeScheduleStatus(
  schedule: PromoLot['schedule'],
  lotStatus: string
) {
  // Если торги завершены, возвращаем оригинальный график без изменений
  // Добавляем поле computedStatus, равное исходному status, чтобы не ломать верстку
  if (lotStatus === 'archive' || lotStatus === 'sold') {
    return schedule.map(item => ({
      ...item,
      computedStatus: item.status
    }));
  }

  // Для активных торгов вычисляем статусы
  const now = new Date();
  // Сбрасываем время в 00:00:00, чтобы сравнивать только даты
  now.setHours(0, 0, 0, 0);

  return schedule.map(item => {
    // Парсим дату из формата "DD.MM.YYYY"
    const [day, month, year] = item.date.split('.').map(Number);
    const itemDate = new Date(year, month - 1, day);

    let computedStatus = item.status;

    // Если дата этапа строго меньше текущей даты (т.е. была вчера или раньше)
    if (itemDate < now) {
      computedStatus = 'previous';
    }

    return {
      ...item,
      computedStatus
    };
  });
}

export default async function PromoLotPage({ params }: Props) {
  const { slug } = await params;
  const lot = PROMO_LOTS[slug];

  if (!lot) {
    notFound();
  }

  // Если вдруг images не заполнен, используем одиночную img как массив
  const galleryImages = lot.images && lot.images.length > 0
    ? lot.images
    : [lot.img];

  // Формируем JSON-LD (Schema.org)
  // Это даст "расширенный сниппет" в поиске (цена, адрес, наличие)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing', // Или 'SingleFamilyResidence'
    'name': lot.title,
    'description': lot.description,
    'image': galleryImages.map(img => `https://auction.thepeace.ru${img}`), // Лучше полные URL
    'address': {
      '@type': 'PostalAddress',
      'streetAddress': lot.address // Просто строка, если нет разбивки
      // Лучше разбить: 'addressLocality': 'Одинцово', 'addressRegion': 'Московская область'
    },
    'offers': {
      '@type': 'Offer',
      'price': lot.priceStart.replace(/\s/g, ''), // Убираем пробелы "40 000" -> "40000"
      'priceCurrency': 'RUB',
      'availability': 'https://schema.org/InStock',
      'url': `https://auction.thepeace.ru/promo/${slug}` // Ссылка на страницу
    }
  };

  // Вычисляем статусы
  const scheduleWithStatus = computeScheduleStatus(lot.schedule, lot.status);

  return (
    <div className={styles.container}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>← Все лоты</Link>
        <span className={styles.label}>Инвест-идея</span>
      </header>

      <section>
        <h1 className={styles.title}>{lot.title}</h1>
        {/* Адрес можно добавить, если нужно */}

        <ImageGallery
          images={galleryImages}
          title={lot.title}
          badges={lot.badges}
        />

        <div className={styles.grid}>
          <div className={styles.content}>
            <h2>Описание актива</h2>

            {/* {lot.description && (
              <p className={styles.descriptionText}>
                {lot.description}
              </p>
            )} */}

            <ul className={styles.featuresList}>
              {lot.features.map((feature, idx) => (
                <li key={idx} dangerouslySetInnerHTML={{ __html: feature }} />
                /* dangerouslySetInnerHTML нужен, если в тексте есть <b> или <br> */
              ))}
            </ul>

            <div className={styles.expertBlock}>
              <h3>💡 Мнение эксперта:</h3>
              <p>{lot.expertOpinion}</p>
            </div>
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.priceCard}>
              <h3>График снижения цены</h3>

              <div className={styles.tableWrapper}>
                <table className={styles.priceTable}>
                  <thead>
                    <tr>
                      <th>Дата (до)</th>
                      <th style={{ textAlign: 'right' }}>Цена, ₽</th>
                      <th style={{ textAlign: 'right' }}>Задаток</th>
                      <th style={{ textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleWithStatus.map((row, idx) => (
                      <tr key={idx} className={styles[row.computedStatus]}>
                        <td>{row.date}</td>
                        <td className={styles.numCell}>{row.price}</td>
                        <td className={styles.numCell}>{row.deposit}</td>
                        <td className={styles.statusIconCell}>{row.statusText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Легенда под таблицей */}
              <div className={styles.legendBlock}>
                <div className={styles.legendItem}>
                  <span className={styles.legendIcon}>✅</span> — Рекомендуем покупать
                </div>
              </div>

              <div className={styles.ctaBlock}>
                <a href={`https://t.me/${lot.managerTg}`} target="_blank" className={styles.callButton}>
                  💬 Обсудить стратегию
                </a>
                <a href="#" className={styles.emailLink}>
                  📊 Получить фин. модель
                </a>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

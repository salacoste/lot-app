// Файл: app/subscribe/page.tsx

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import styles from './subscribe.module.css';
import Link from 'next/link';

export default function SubscribePage() {
    const { user } = useAuth();
    const router = useRouter();

    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasAgreed, setHasAgreed] = useState(false);

    const handlePayment = async (planId: string) => {
        setIsLoading(planId);
        setError(null);

        if (!user) {
            router.push('/login?redirect=/subscribe');
            return;
        }

        const backendUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
        const apiUrl = `${backendUrl}/api/payments/create-session`;

        // Запрос к бэкенду для создания сессии оплаты
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                // передаем ID тарифа, так как их существует несколько
                body: JSON.stringify({ planId })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Не удалось создать сессию оплаты.');
            }

            const { confirmationUrl } = await res.json();

            // Перенаправление на страницу платежного шлюзаы
            if (confirmationUrl) {
                window.location.href = confirmationUrl;
            } else {
                throw new Error('Не удалось получить ссылку на оплату.');
            }

        } catch (err: any) {
            alert('Произошла ошибка. Попробуйте позже.');
            setError(err.message || 'Произошла неизвестная ошибка.');
            setIsLoading(null);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <h1 className={styles.title}>Доступ к PRO</h1>
                <p className={styles.subtitle}>
                    Получите неограниченный доступ ко всем объектам на карте и расширенным фильтрам для максимально эффективного поиска.
                </p>

                {/* --- информационная плашка --- */}
                <div className={styles.infoBanner}>
                    <strong>Внимание:</strong> Онлайн-оплата на сайте временно недоступна по техническим причинам.<br/>
                    Для подключения PRO-тарифа, пожалуйста, напишите нам на e-mail: {' '}
                    <a href="mailto:info@auction.thepeace.ru">info@auction.thepeace.ru</a>.
                    Мы оперативно выставим счет или пришлем ссылку для оплаты.
                </div>

                {/* Блок с преимуществами */}
                <div className={styles.featuresWrapper}>
                    <ul className={styles.featuresList}>
                        <li>✓ Полный доступ ко всем объектам</li>
                        <li>✓ AI-анализ инвестиционной привлекательности</li>
                        <li>✓ Неограниченное использование фильтров</li>
                        <li>✓ Просмотр детальной информации по лотам</li>
                        <li><Link href="/how-it-works/alerts">✓ Email уведомления о новых лотах по вашим фильтрам</Link></li>
                    </ul>
                </div>

                {/* Тарифные планы */}
                <div className={styles.plansContainer}>
                    <div className={styles.planCard}>
                        <h2 className={styles.planTitle}>Месяц</h2>
                        <p className={styles.planPrice}>1000 ₽</p>
                        <p className={styles.planDescription}>Полный доступ ко всем лотам и аналитике на 30 дней.</p>
                        <button 
                            onClick={() => handlePayment('pro-month')} 
                            disabled={!!isLoading || !hasAgreed} 
                            className={styles.button}
                        >
                            {isLoading === 'pro-month' ? 'Загрузка...' : 'Выбрать'}
                        </button>
                    </div>

                    <div className={`${styles.planCard} ${styles.planCardFeatured}`}>
                        <div className={styles.featuredBadge}>Выгодно</div>
                        <h2 className={styles.planTitle}>Год</h2>
                        <p className={styles.planPrice}>8 000 ₽</p>
                        <p className={styles.planDescription}>Экономия 4000 ₽! Полный доступ на 365 дней.</p>
                        <button 
                            onClick={() => handlePayment('pro-year')} 
                            disabled={!!isLoading || !hasAgreed} 
                            className={styles.button}
                        >
                            {isLoading === 'pro-year' ? 'Загрузка...' : 'Выбрать'}
                        </button>
                    </div>
                </div>

                {/* --- БЛОК СОГЛАСИЯ --- */}
                <div className={styles.agreement}>
                  <input 
                    type="checkbox" 
                    id="terms-agreement"
                    checked={hasAgreed}
                    onChange={(e) => setHasAgreed(e.target.checked)}
                  />
                  <label htmlFor="terms-agreement">
                    Я принимаю условия <Link href="/terms" target="_blank">Публичной оферты</Link> и даю согласие на обработку персональных данных.
                  </label>
                </div>
                {/* ----------------------------- */}

                {error && <p className={styles.errorMessage}>{error}</p>}

                {/* Секция FAQ */}
                <section className={styles.faqSection}>
                    <h2 className={styles.sectionTitle}>Часто задаваемые вопросы</h2>
                    <div className={styles.faqItem}>
                        <h4>Могу ли я отменить подписку в любое время?</h4>
                        <p>Да, вы можете отменить подписку в любой момент в вашем личном кабинете. Доступ к PRO-функциям сохранится до конца оплаченного периода.</p>
                    </div>
                    <div className={styles.faqItem}>
                        <h4>Какие способы оплаты вы принимаете?</h4>
                        <p>Мы принимаем банковские карты Мир через безопасный платежный шлюз.</p>
                    </div>
                    <div className={styles.faqItem}>
                        <h4>Что произойдет после оплаты?</h4>
                        <p>Сразу после успешной оплаты PRO-статус будет активирован для вашего аккаунта, и вы получите полный доступ ко всем функциям сайта.</p>
                    </div>
                </section>
            </div>
        </div>
    );
}

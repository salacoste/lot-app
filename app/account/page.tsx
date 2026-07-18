'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import styles from './account.module.css';
import AdCard from '@/components/AdCard/AdCard';
import { LotItem } from '@/components/LotItem';
import Pagination from '@/components/Pagination';
import type { Lot } from '@/types';

const ProfileIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
    </svg>
);

const SubscriptionIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>
);

const AlertsIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>
);

const AdsIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
);

const VotesIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-4.35-9.33-8.3C.73 9.4 2.1 5.5 5.72 4.62 7.79 4.12 9.6 5.02 12 7.5c2.4-2.48 4.21-3.38 6.28-2.88 3.62.88 4.99 4.78 3.05 8.08C19 16.65 12 21 12 21z" />
    </svg>
);

const CounterpartyIcon = () => (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 10h2"></path><path d="M13 10h2"></path><path d="M9 14h2"></path><path d="M13 14h2"></path>
    </svg>
);

type AccountTab = 'profile' | 'subscription' | 'my-ads' | 'my-votes';
const VOTED_LOTS_PAGE_SIZE = 12;

// Функция для расчета оставшихся дней триала
const getTrialDaysLeft = (createdAt?: string) => {
    if (!createdAt) return 0;

    const createdDate = new Date(createdAt);
    const trialEndDate = new Date(createdDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Считаем разницу в миллисекундах и переводим в дни
    const diffTime = trialEndDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > 0 ? diffDays : 0;
};

// Вспомогательная функция для правильного склонения слова "день"
const getDaysWord = (days: number) => {
    if (days % 10 === 1 && days % 100 !== 11) return 'день';
    if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return 'дня';
    return 'дней';
};


export default function AccountPage() {
    const { user, loading: authLoading, logout } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<AccountTab>('profile');
    const [myAds, setMyAds] = useState<any[]>([]);
    const [loadingAds, setLoadingAds] = useState(false);
    const [votedLots, setVotedLots] = useState<Lot[]>([]);
    const [loadingVotedLots, setLoadingVotedLots] = useState(false);
    const [votedLotsError, setVotedLotsError] = useState<string | null>(null);
    const [votedLotsPage, setVotedLotsPage] = useState(1);
    const [votedLotsTotalPages, setVotedLotsTotalPages] = useState(0);

    useEffect(() => {
        const requestedTab = new URLSearchParams(window.location.search).get('tab');
        if (requestedTab === 'my-votes') setActiveTab('my-votes');
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.push('/login?returnUrl=/account');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (activeTab === 'my-ads' && user) {
            fetchMyAds();
        }
    }, [activeTab, user]);

    useEffect(() => {
        if (activeTab !== 'my-votes' || !user) return;
        const controller = new AbortController();
        setLoadingVotedLots(true);
        setVotedLotsError(null);

        fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/voted-lots?page=${votedLotsPage}&pageSize=${VOTED_LOTS_PAGE_SIZE}`, {
            credentials: 'include',
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) throw new Error('Не удалось загрузить поддержанные лоты.');
                return response.json();
            })
            .then((data) => {
                if (controller.signal.aborted) return;
                setVotedLots(data.items || []);
                setVotedLotsTotalPages(data.totalPages || 0);
            })
            .catch((requestError) => {
                if (!controller.signal.aborted) {
                    console.error('Ошибка загрузки поддержанных лотов', requestError);
                    setVotedLotsError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить лоты.');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoadingVotedLots(false);
            });

        return () => controller.abort();
    }, [activeTab, user, votedLotsPage]);

    const selectTab = (tab: AccountTab) => {
        setActiveTab(tab);
        const url = tab === 'my-votes' ? '/account?tab=my-votes' : '/account';
        window.history.replaceState(null, '', url);
    };

    const fetchMyAds = async () => {
        setLoadingAds(true);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/ads/my`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setMyAds(data);
            }
        } catch (e) {
            console.error('Ошибка загрузки моих объявлений', e);
        } finally {
            setLoadingAds(false);
        }
    };

    // Можно вынести этот стиль в глобальный CSS, но для лоадера обычно оставляют так или создают класс .loader
    if (authLoading || !user) {
        return <div className="loading-state">Загрузка...</div>;
    }

    const formatDate = (dateString?: string) => {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('ru-RU', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
    };

    return (
        <main className={styles.container}>
            <h1 className={styles.pageTitle}>Личный кабинет</h1>

            <div className={styles.layout}>
                <aside className={styles.sidebar}>
                    <button
                        className={`${styles.tabLink} ${activeTab === 'profile' ? styles.activeTab : ''}`}
                        onClick={() => selectTab('profile')}
                    >
                        <ProfileIcon />
                        Профиль
                    </button>

                    <button
                        className={`${styles.tabLink} ${activeTab === 'subscription' ? styles.activeTab : ''}`}
                        onClick={() => selectTab('subscription')}
                    >
                        <SubscriptionIcon />
                        Подписка Pro
                    </button>

                    <button
                        className={`${styles.tabLink} ${activeTab === 'my-ads' ? styles.activeTab : ''}`}
                        onClick={() => selectTab('my-ads')}
                    >
                        <AdsIcon />
                        Мои объявления
                    </button>

                    <button
                        className={`${styles.tabLink} ${activeTab === 'my-votes' ? styles.activeTab : ''}`}
                        onClick={() => selectTab('my-votes')}
                    >
                        <VotesIcon />
                        Мои голоса
                    </button>

                    <Link href="/alerts" className={styles.tabLink}>
                        <AlertsIcon />
                        Мои уведомления
                    </Link>

                    <Link href="/account/counterparties" className={styles.tabLink}>
                        <CounterpartyIcon />
                        Контрагенты
                    </Link>

                    <Link href="/account/case-batches" className={styles.tabLink}>
                        Пакетная проверка дел
                    </Link>

                    <Link href="/account/leasing" className={styles.tabLink}>
                        Лизинговая активность
                    </Link>

                    <button
                        className={`${styles.tabLink} ${styles.logoutTab}`}
                        onClick={logout}
                    >
                        Выйти
                    </button>
                </aside>

                <section className={styles.contentArea}>

                    {activeTab === 'profile' && (
                        <div>
                            <h2 className={styles.sectionTitle}>Данные профиля</h2>

                            <div className={styles.infoBlock}>
                                <span className={styles.infoLabel}>Имя пользователя</span>
                                <span className={styles.infoValue}>{user.name || 'Не указано'}</span>
                            </div>

                            <div className={styles.infoBlock}>
                                <span className={styles.infoLabel}>Email</span>
                                <span className={styles.infoValue}>{user.email}</span>
                            </div>

                            {/* <div className={styles.infoBlock}>
                <span className={styles.infoLabel}>ID Пользователя</span>
                <span className={`${styles.infoValue} ${styles.idValue}`}>
                  {user.id}
                </span>
              </div> */}
                        </div>
                    )}

                    {activeTab === 'subscription' && (
                        <div>
                            <h2 className={styles.sectionTitle}>Управление подпиской</h2>

                            <div className={styles.infoBlock}>
                                <span className={styles.infoLabel}>Текущий статус</span>
                                {user.isOnTrial ? (
                                    <span className={`${styles.statusBadge} ${styles.statusPro}`}>
                                        Пробный период Pro (осталось {getTrialDaysLeft(user.createdAt)} {getDaysWord(getTrialDaysLeft(user.createdAt))})
                                    </span>
                                ) : user.isSubscriptionActive ? (
                                    <span className={`${styles.statusBadge} ${styles.statusPro}`}>Активна (Pro)</span>
                                ) : (
                                    <span className={`${styles.statusBadge} ${styles.statusBasic}`}>Базовая</span>
                                )}
                            </div>

                            {/* Показываем дату окончания ТОЛЬКО если подписка куплена.
                            Для триала мы дату не показываем, так как там есть счетчик дней */}
                            {user.isSubscriptionActive && !user.isOnTrial && user.subscriptionEndDate && (
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>Действует до</span>
                                    <span className={styles.infoValue}>{formatDate(user.subscriptionEndDate)}</span>
                                </div>
                            )}

                            {/* Блок с предложением купить подписку показываем если юзер на базе 
                            ИЛИ если он на триале (чтобы он мог купить заранее) */}
                            {(!user.isSubscriptionActive || user.isOnTrial) && (
                                <div className={styles.upsellBlock}>
                                    <h3 className={styles.upsellTitle}>
                                        {user.isOnTrial ? 'Продлите Pro-доступ' : 'Перейдите на Pro тариф'}
                                    </h3>
                                    <p className={styles.upsellText}>
                                        Получите доступ к AI-оценке лотов, настройке мгновенных email-уведомлений по вашим фильтрам и глубокой аналитике торгов.
                                    </p>
                                    <Link href="/subscribe" className={styles.subscribeButton}>
                                        Оформить подписку
                                    </Link>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'my-ads' && (
                        <div>
                            <h2 className={styles.sectionTitle}>Мои объявления</h2>
                            
                            {loadingAds ? (
                                <div>Загрузка объявлений...</div>
                            ) : myAds.length === 0 ? (
                                <div>
                                    <p style={{ marginBottom: '16px', color: '#666' }}>У вас пока нет объявлений.</p>
                                    <Link href="/add-ad" className={styles.subscribeButton} style={{ display: 'inline-block' }}>
                                        Подать объявление
                                    </Link>
                                </div>
                            ) : (
                                <div className={styles.adsGrid}>
                                    {myAds.map(ad => (
                                        <AdCard key={ad.id} ad={ad} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'my-votes' && (
                        <div>
                            <h2 className={styles.sectionTitle}>Лоты, которые вы поддержали</h2>
                            <p className={styles.sectionIntro}>
                                Здесь собраны ваши запросы на AI-разбор. Чтобы освободить лимит, откройте лот и отзовите голос.
                            </p>

                            {loadingVotedLots ? (
                                <div>Загрузка лотов...</div>
                            ) : votedLotsError ? (
                                <p className={styles.errorText}>{votedLotsError}</p>
                            ) : votedLots.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <p>Вы пока не голосовали за разбор лотов.</p>
                                    <Link href="/" className={styles.subscribeButton}>Найти интересный лот</Link>
                                </div>
                            ) : (
                                <>
                                    <div className={styles.votedLotsGrid}>
                                        {votedLots.map((lot) => <LotItem key={lot.id} lot={lot} />)}
                                    </div>
                                    {votedLotsTotalPages > 1 && (
                                        <Pagination
                                            currentPage={votedLotsPage}
                                            totalPages={votedLotsTotalPages}
                                            onPageChange={setVotedLotsPage}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

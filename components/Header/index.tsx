'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useFavorites } from '@/context/FavoritesContext';
import { useChat } from '@/context/ChatContext';
import { useState, useEffect } from 'react';
import styles from './styles.module.css';
import { usePromoVisibility } from '../../app/hooks/usePromoVisibility';
import { hot_lot_id } from '../../app/data/constants';

export const Header = () => {
    const { user, logout } = useAuth();
    const { favoritesCount } = useFavorites();
    const { unreadCount } = useChat();
    const [moderationCount, setModerationCount] = useState(0);
    const [needsDescriptionCount, setNeedsDescriptionCount] = useState(0);
    const [unmatchedVehicleCount, setUnmatchedVehicleCount] = useState(0);

    useEffect(() => {
        if (user?.isAdmin) {
            fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/admin/ads/moderation/count`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.count === 'number') {
                    setModerationCount(data.count);
                }
            })
            .catch(err => console.error('Ошибка загрузки счетчика модерации', err));

            fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/admin/lots/needs-description/count?activeOnly=true`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.count === 'number') {
                    setNeedsDescriptionCount(data.count);
                }
            })
            .catch(err => console.error('Ошибка загрузки счетчика лотов без описания', err));

            fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/admin/lots/unmatched-vehicle-attributes/count?activeOnly=true`, {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.count === 'number') {
                    setUnmatchedVehicleCount(data.count);
                }
            })
            .catch(err => console.error('Ошибка загрузки счетчика неразобранных марок/моделей', err));
        }
    }, [user]);

    // --- ПОЛУЧАЕМ ТЕКУЩИЙ URL ---
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Собираем полный путь (например, "/?page=2")
    // Если параметров нет, searchParams.toString() вернет пустую строку
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

    // Формируем ссылку для входа
    // encodeURIComponent важен, чтобы спецсимволы не сломали URL
    const loginHref = `/login?returnUrl=${encodeURIComponent(currentPath)}`;

    // Используем ТОТ ЖЕ ID, что и в баннере!
    const promoId = hot_lot_id;
    const { isVisible, isMounted, showPromo } = usePromoVisibility(promoId);

    return (
        <header className={styles.headerWrapper}>
            <div className={styles.headerContent}>

                {/* --- ЛЕВАЯ ЧАСТЬ: ЛОГОТИП --- */}
                <div className={styles.leftSection}>
                    <Link href="/" className={styles.logoLink}>
                        <Image
                            src="/s-lot_logo.png"
                            alt="auction.thepeace.ru Логотип"
                            width={120} // Примерная ширина (Next.js требует width/height)
                            height={40} // Высота
                            className={styles.logoImage}
                            priority // Загружать сразу, так как это LCP элемент
                        />
                    </Link>
                </div>

                {/* --- ПРАВАЯ ЧАСТЬ: МЕНЮ --- */}
                <div className={styles.rightSection}>

                    {/* КНОПКА ВОССТАНОВЛЕНИЯ */}
                    {/* Показываем ТОЛЬКО если баннер СКРЫТ (!isVisible) */}
                    {isMounted && !isVisible && (
                        <button onClick={showPromo} className={styles.restorePromoButton}>
                            🔥 <span className={styles.restoreText}>Лот месяца</span>
                        </button>
                    )}

                    {user ? (
                        <>
                            <span className={styles.userInfo}>{user.email}</span>

                            {/* Сообщения */}
                            <Link href="/inbox" className={styles.favLink} title="Сообщения">
                                <svg viewBox="0 0 24 24" className={styles.favIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                                {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
                            </Link>

                            {/* Избранное */}
                            <Link href="/favorites" className={styles.favLink} title="Избранное">
                                <svg viewBox="0 0 24 24" className={styles.favIcon}>
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                </svg>
                                {favoritesCount > 0 && <span className={styles.badge}>{favoritesCount}</span>}
                            </Link>

                            {/* Админка */}
                            {user.isAdmin && (
                                <>
                                    <Link href="/admin/lots-needing-description" className={styles.accountLink} title="Лоты без описания">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                <polyline points="14 2 14 8 20 8"></polyline>
                                                <line x1="12" y1="18" x2="12" y2="12"></line>
                                                <line x1="12" y1="9" x2="12.01" y2="9"></line>
                                            </svg>
                                            {needsDescriptionCount > 0 && (
                                                <span className={styles.badge} style={{ position: 'absolute', top: '-8px', right: '-8px' }}>
                                                    {needsDescriptionCount}
                                                </span>
                                            )}
                                        </div>
                                        <span className={styles.accountText}>Описания</span>
                                    </Link>
                                    <Link href="/admin/unmatched-vehicle-attributes" className={styles.accountLink} title="Марки и модели">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M7 17h10"></path>
                                                <path d="M7 11h10"></path>
                                                <path d="M7 5h10"></path>
                                                <circle cx="5" cy="5" r="1"></circle>
                                                <circle cx="5" cy="11" r="1"></circle>
                                                <circle cx="5" cy="17" r="1"></circle>
                                            </svg>
                                            {unmatchedVehicleCount > 0 && (
                                                <span className={styles.badge} style={{ position: 'absolute', top: '-8px', right: '-8px' }}>
                                                    {unmatchedVehicleCount}
                                                </span>
                                            )}
                                        </div>
                                        <span className={styles.accountText}>Авто</span>
                                    </Link>
                                    <Link href="/admin/ads" className={styles.accountLink} title="Модерация">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                            </svg>
                                            {moderationCount > 0 && <span className={styles.badge} style={{ position: 'absolute', top: '-8px', right: '-8px' }}>{moderationCount}</span>}
                                        </div>
                                        <span className={styles.accountText}>Модерация</span>
                                    </Link>
                                    <Link href="/admin/contract-permissions" className={styles.accountLink} title="Договоры">
                                        <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                            <polyline points="14 2 14 8 20 8"></polyline>
                                            <line x1="16" y1="13" x2="8" y2="13"></line>
                                            <line x1="16" y1="17" x2="8" y2="17"></line>
                                        </svg>
                                        <span className={styles.accountText}>Договоры</span>
                                    </Link>
                                </>
                            )}

                            {/* Аккаунт / Профиль */}
                            <Link href="/account" className={styles.accountLink} title="Аккаунт">
                                <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                                <span className={styles.accountText}>Аккаунт</span>
                            </Link>

                            <button onClick={logout} className={styles.logoutBtn}>
                                Выйти
                            </button>
                        </>
                    ) : (
                        <Link href={loginHref} className={styles.loginLink}>
                            Войти
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
};

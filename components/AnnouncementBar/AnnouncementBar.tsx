'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './AnnouncementBar.module.css';

export interface Announcement {
    id: string;
    badge: string;
    text: string;
    linkHref: string;
    linkText: string;
}

// История анонсов (самые новые сверху). В будущем можно использовать для Changelog.
export const ANNOUNCEMENTS: Announcement[] = [
    {
        id: 'aiLotAnalysisVotes_v1',
        badge: 'Новое',
        text: 'Голосуйте за лоты, для которых хотите увидеть детальный AI-разбор, и управляйте голосами в личном кабинете.',
        linkHref: '/how-it-works/ai-assessment',
        linkText: 'Как это работает →'
    },
    {
        id: 'hideVehicleFiltersPromo_v1',
        badge: 'Новое',
        text: 'Мы добавили умные фильтры! Теперь легковые автомобили можно искать по марке, модели, году выпуска и пробегу.',
        linkHref: '/legkovye-avtomobili',
        linkText: 'Попробовать →'
    },
    {
        id: 'hideAlertsPromo_v1',
        badge: 'Новое',
        text: 'Узнавайте о новых лотах первыми! Настройте автоматическую email-рассылку по вашим фильтрам.',
        linkHref: '/alerts',
        linkText: 'Настроить подписку →'
    }
];

export default function AnnouncementBar() {
    const [currentAnnouncement, setCurrentAnnouncement] = useState<Announcement | null>(null);

    useEffect(() => {
        // Ищем первый анонс, который пользователь еще не закрыл
        const unread = ANNOUNCEMENTS.find(a => !localStorage.getItem(a.id));
        if (unread) {
            setCurrentAnnouncement(unread);
        }
    }, []);

    const handleClose = () => {
        if (currentAnnouncement) {
            localStorage.setItem(currentAnnouncement.id, 'true');
            setCurrentAnnouncement(null);
        }
    };

    if (!currentAnnouncement) return null;

    return (
        <div className={styles.bar}>
            <div className={styles.content}>
                <span className={styles.badge}>{currentAnnouncement.badge}</span>
                <span className={styles.text}>
                    {currentAnnouncement.text}
                </span>
                <Link href={currentAnnouncement.linkHref} className={styles.link} onClick={handleClose}>
                    {currentAnnouncement.linkText}
                </Link>
            </div>
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Закрыть">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import ContractModal from '@/components/ContractModal/ContractModal';
import { Lot } from '../../../types';
import styles from './lot.module.css';

const HeartOutline = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

const HeartFilled = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="#e53e3e" stroke="#e53e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

type LotFavoriteActionsProps = {
  lot: Lot;
};

export default function LotFavoriteActions({
  lot,
}: LotFavoriteActionsProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(false);
  const [isFavLoading, setIsFavLoading] = useState(false);
  const [hasContractPermission, setHasContractPermission] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);

  useEffect(() => {
    if (!user || !lot) {
      setIsFavorite(false);
      setIsFavLoading(false);
      setHasContractPermission(false);
      return;
    }

    const checkFavorite = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/favorites/ids`, {
          credentials: 'include',
        });
        if (res.ok) {
          const ids: string[] = await res.json();
          setIsFavorite(ids.includes(lot.id));
        }
      } catch (e) {
        console.error('Ошибка проверки избранного', e);
      } finally {
        setIsFavLoading(false);
      }
    };

    const checkContractPermission = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/contracts/permission/${lot.id}`,
          {
            credentials: 'include',
          },
        );
        if (res.ok) {
          const data = await res.json();
          setHasContractPermission(data.hasPermission);
        }
      } catch (e) {
        console.error('Ошибка проверки прав на договор', e);
      }
    };

    setIsFavLoading(true);
    setHasContractPermission(false);
    checkFavorite();
    checkContractPermission();
  }, [user, lot]);

  const handleToggleFavorite = async () => {
    if (!user) {
      router.push(`/login?returnUrl=/lot/${lot.publicId}`);
      return;
    }

    setIsFavLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/favorites/toggle/${lot.id}`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      if (res.ok) {
        const data = await res.json();
        setIsFavorite(data.isFavorite);
      } else if (res.status === 400) {
        const errorData = await res.json();
        alert(errorData.message || 'Ошибка добавления в избранное');
      }
    } catch (e) {
      console.error('Ошибка при изменении избранного', e);
    } finally {
      setIsFavLoading(false);
    }
  };

  return (
    <>
      <div className={styles.favoriteButtonWrap}>
        <button
          onClick={handleToggleFavorite}
          disabled={isFavLoading}
          className={`${styles.favoriteButtonDetail} ${isFavorite ? styles.isActive : ''}`}
        >
          {isFavorite ? <HeartFilled /> : <HeartOutline />}
          {isFavorite ? 'В избранном' : 'Добавить в избранное'}
        </button>

        {hasContractPermission && (
          <button
            className={styles.favoriteButtonDetail}
            style={{ marginTop: '0.75rem', borderColor: '#3182ce', color: '#3182ce' }}
            onClick={() => setIsContractModalOpen(true)}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Сформировать договор
          </button>
        )}
      </div>

      <ContractModal
        isOpen={isContractModalOpen}
        onClose={() => setIsContractModalOpen(false)}
        lotId={lot.id}
      />
    </>
  );
}

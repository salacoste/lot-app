'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './lot.module.css';

type VoteStatus = {
  isVoted: boolean;
  votesCount: number;
};

export default function LotAnalysisVote({
  lotId,
  initialVotesCount = 0,
}: {
  lotId: string;
  initialVotesCount?: number;
}) {
  const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [isVoted, setIsVoted] = useState(false);
  const [votesCount, setVotesCount] = useState(initialVotesCount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVotesCount(initialVotesCount);
  }, [initialVotesCount]);

  useEffect(() => {
    if (authLoading || !user || !apiUrl) return;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/lots/${lotId}/vote/status`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<VoteStatus>;
      })
      .then((status) => {
        if (!status || controller.signal.aborted) return;
        setIsVoted(status.isVoted);
        setVotesCount(status.votesCount);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.error('Не удалось получить статус голоса', requestError);
        }
      });

    return () => controller.abort();
  }, [apiUrl, authLoading, lotId, user]);

  const handleVote = async () => {
    if (!user) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      router.push(`/login?returnUrl=${returnUrl}`);
      return;
    }
    if (!apiUrl || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/lots/${lotId}/vote`, {
        method: isVoted ? 'DELETE' : 'PUT',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message || 'Не удалось сохранить голос. Попробуйте ещё раз.');
        return;
      }

      setIsVoted(Boolean(payload.isVoted));
      setVotesCount(Number(payload.votesCount) || 0);
    } catch (requestError) {
      console.error('Не удалось сохранить голос', requestError);
      setError('Сервис временно недоступен. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.analysisVote} aria-labelledby="analysis-vote-title">
      <div>
        <h2 id="analysis-vote-title" className={styles.analysisVoteTitle}>Хотите AI-разбор этого лота?</h2>
        <p className={styles.analysisVoteText}>
          Голос помогает сформировать очередь лотов для детального разбора. Одновременно можно поддержать до {user?.isSubscriptionActive ? 10 : 3} лотов.
        </p>
        <Link href="/how-it-works/ai-assessment" className={styles.analysisVoteLearnMore}>
          Как работает AI-оценка и голосование
        </Link>
      </div>
      <div className={styles.analysisVoteActions}>
        <span className={styles.analysisVoteCount} aria-live="polite">{votesCount} {votesCount === 1 ? 'голос' : 'голосов'}</span>
        <button
          type="button"
          className={`${styles.analysisVoteButton} ${isVoted ? styles.analysisVoteButtonActive : ''}`}
          disabled={isSubmitting || authLoading}
          aria-pressed={isVoted}
          onClick={handleVote}
        >
          {isSubmitting ? 'Сохраняем…' : isVoted ? 'Отозвать голос' : 'Запросить разбор'}
        </button>
        {error && (
          <p className={styles.analysisVoteError} role="alert">
            {error} {error.includes('лимит') && <Link href="/account?tab=my-votes">Управлять голосами</Link>}
          </p>
        )}
      </div>
    </section>
  );
}

// components/AiEvaluationBlock/AiEvaluationBlock.tsx
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import styles from './aiEvaluationBlock.module.css';
import { shouldApplyEvaluationFetchResult } from '@/utils/adminAiEvaluationEditor.logic.shared.mjs';

interface EvaluationData {
    estimatedPrice?: number | null;
    liquidityScore?: number | null;
    investmentSummary: string | null | undefined;
    reasoningText?: string | null;
    isReasoningTextTeaser?: boolean;
    upsidePercent?: number;
}

interface AiEvaluationBlockProps {
    type: 'quick' | 'deep';
    lotPublicId?: number | string;
    currentPrice?: number | null;
    quickData?: EvaluationData;
    externalData?: EvaluationData | null;
    priceConfidence?: string | null;
    initialReasoningText?: string | null;
    isTeaser?: boolean;
    initialLiquidityScore?: number | null;
}

const getQuickConfidenceClass = (conf: string | null | undefined, styles: Record<string, string>) => {
    switch (conf?.toLowerCase()) {
        case 'high': return styles.confidenceHigh;
        case 'medium': return styles.confidenceMedium;
        case 'low': return styles.confidenceLow;
        case 'not_evaluable': return styles.confidenceNotEvaluable;
        case 'manual': return styles.confidenceManual;
        default: return styles.confidenceMedium;
    }
};

const getQuickConfidenceLabel = (conf: string | null | undefined) => {
    switch (conf?.toLowerCase()) {
        case 'high': return 'Высокая точность';
        case 'medium': return 'Средняя точность';
        case 'low': return 'Низкая точность (мало данных)';
        case 'not_evaluable': return 'Автооценка недоступна для этого типа лота';
        case 'manual': return 'Ручная оценка';
        default: return 'Точность оценки';
    }
};

export default function AiEvaluationBlock({
    type,
    lotPublicId,
    currentPrice,
    quickData,
    externalData,
    priceConfidence,
    initialReasoningText,
    isTeaser,
    initialLiquidityScore
}: AiEvaluationBlockProps) {
    const [evaluationResult, setEvaluationResult] = useState<EvaluationData | null>(() => {
        if (type === 'quick') return quickData || null;
        if (type === 'deep' && initialReasoningText) {
            return {
                investmentSummary: null, // we don't need it here usually, it's in quick
                reasoningText: initialReasoningText,
                liquidityScore: initialLiquidityScore ?? undefined
            };
        }
        return null;
    });
    const [isTeaserMode, setIsTeaserMode] = useState<boolean>(!!isTeaser);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [error, setError] = useState<string | React.ReactNode>(null);
    const [isLoadingInitial, setIsLoadingInitial] = useState(true);

    // Состояния для ручного редактирования админом
    const [isEditing, setIsEditing] = useState(false);
    const [editReasoningText, setEditReasoningText] = useState('');
    const [editInvestmentSummary, setEditInvestmentSummary] = useState('');
    const [editEstimatedPrice, setEditEstimatedPrice] = useState<number | ''>('');
    const [editLiquidityScore, setEditLiquidityScore] = useState<number | ''>('');
    const [isSaving, setIsSaving] = useState(false);

    const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
    const { user } = useAuth();
    const router = useRouter();
    const externalDataRef = useRef(externalData);
    externalDataRef.current = externalData;

    useEffect(() => {
        if (externalData !== undefined) {
            setEvaluationResult(externalData);
            setIsLoadingInitial(false);
            setIsEvaluating(false);
            return;
        }

        if (type === 'quick') {
            setEvaluationResult(quickData || null);
        }
    }, [externalData, quickData, type]);

    useEffect(() => {
        if (externalData !== undefined || type !== 'deep' || !lotPublicId || !user) {
            setIsLoadingInitial(false);
            return;
        }

        const abortController = new AbortController();

        const checkMyEvaluation = async () => {
            try {
                // Пытаемся получить оценку
                // Бэкенд вернет 200 ТОЛЬКО если пользователь уже тратил лимит на этот лот
                const response = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluation`, {
                    credentials: 'include',
                    signal: abortController.signal,
                });

                if (response.ok) {
                    const data = await response.json();
                    if (shouldApplyEvaluationFetchResult({
                        isControlled: externalDataRef.current !== undefined,
                        aborted: abortController.signal.aborted,
                    })) {
                        setEvaluationResult(data);
                        setIsTeaserMode(false);
                    }
                } else {
                    // 404 или 401 — значит еще не запускали или не авторизованы
                    // Просто ничего не делаем, останется кнопка "Запустить анализ"
                }
            } catch (e) {
                if (!abortController.signal.aborted) {
                    console.error("Error checking evaluation:", e);
                }
            } finally {
                if (!abortController.signal.aborted) {
                    setIsLoadingInitial(false);
                }
            }
        };

        checkMyEvaluation();
        return () => abortController.abort();
    }, [type, lotPublicId, apiUrl, user, externalData]);

    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    // Запуск deep-анализа
    const handleEvaluate = async () => {
        if (externalDataRef.current !== undefined) return;

        if (!user) {
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
            router.push(`/login?returnUrl=${returnUrl}`);
            return;
        }

        setIsEvaluating(true);
        setError(null);

        try {
            // ВАЖНО: всегда дергаем POST /evaluate, чтобы бэкенд мог:
            //  - проверить лимит/подписку
            //  - записать вызов в БД
            const response = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluate`, {
                method: 'POST',
                credentials: 'include'
            });

            if (externalDataRef.current !== undefined) {
                setIsEvaluating(false);
                return;
            }

            // Если ошибка (402, 500 и т.д.)
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));

                // Если это 402 Payment Required — показываем ошибку сразу, без ожидания
                if (response.status === 402 && err.actionUrl) {
                    setError(
                        <span>
                            {err.message} <br />
                            <a href={err.actionUrl} style={{ textDecoration: 'underline', fontWeight: 'bold' }}>
                                Перейти к тарифам →
                            </a>
                        </span>
                    );
                } else {
                    // Любая другая ошибка
                    throw new Error(err.message || 'Ошибка запуска анализа');
                }

                // Важно: сразу выключаем лоадер, чтобы не висел "Идет анализ..."
                setIsEvaluating(false);
                return;
            }

            // Обработка успешных ответов (200 или 202)
        
            // СЦЕНАРИЙ А: Данные уже готовы (КЭШ) - статус 200
            if (response.status === 200) {
                const dataPromise = response.json();
                const minWaitMs = 5000; // Ждем минимум 5 секунд для красоты
                
                // Ждем и данные, и таймер
                const [data] = await Promise.all([dataPromise, sleep(minWaitMs)]);
                
                if (shouldApplyEvaluationFetchResult({
                    isControlled: externalDataRef.current !== undefined,
                    aborted: false,
                })) {
                    setEvaluationResult(data);
                    setIsTeaserMode(false);
                }
                setIsEvaluating(false);
                
                return;
            }

            // СЦЕНАРИЙ Б: Задача ушла в фон (Fire-and-Forget) - статус 202
            if (response.status === 202) {
                // Тут мы не ждем sleep(5000), потому что поллинг сам займет время.             
                await startPolling(); 
                // startPolling сам установит результат и выключит isEvaluating
                return;
            }
        } catch (err: any) {
            if (externalDataRef.current === undefined) {
                setError(err.message || 'Произошла неизвестная ошибка');
            }
        } finally {
            setIsEvaluating(false);
        }
    };

    // Функция опроса сервера
    const startPolling = async () => {
        const maxAttempts = 60; // 60 раз по 3 сек = 3 минуты макс
        const delay = 3000;     // 3 секунды интервал

        // начальная задержка, чтобы "подумать" минимум 10 сек
        await sleep(10000); 
        
        for (let i = 0; i < maxAttempts; i++) {
            if (externalDataRef.current !== undefined) {
                setIsEvaluating(false);
                return;
            }

            try {
                // Опрашиваем GET эндпоинт
                const res = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluation`, {
                    credentials: 'include'
                });

                if (res.ok) {
                    // УРА! Данные готовы
                    const data = await res.json();
                    if (shouldApplyEvaluationFetchResult({
                        isControlled: externalDataRef.current !== undefined,
                        aborted: false,
                    })) {
                        setEvaluationResult(data);
                        setIsTeaserMode(false);
                    }
                    setIsEvaluating(false);
                    return;
                }
                
                // Если 404 (еще нет) или 401 - ждем и повторяем
                
            } catch (e) {
                if (externalDataRef.current === undefined) {
                    console.error("Polling error", e);
                }
            }

            // Ждем перед следующей попыткой
            await new Promise(r => setTimeout(r, delay));
        }

        // Если цикл кончился, а данных нет
        if (externalDataRef.current === undefined) {
            setError("Время ожидания истекло. Попробуйте обновить страницу.");
        }
        setIsEvaluating(false);
    };

    const handleSaveManual = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const response = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluation/manual`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    estimatedPrice: editEstimatedPrice === '' ? null : Number(editEstimatedPrice),
                    liquidityScore: editLiquidityScore === '' ? null : Number(editLiquidityScore),
                    investmentSummary: editInvestmentSummary || null,
                    reasoningText: editReasoningText || null
                }),
                credentials: 'include'
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.message || 'Ошибка сохранения');
            }

            setEvaluationResult(prev => ({
                ...prev,
                estimatedPrice: editEstimatedPrice === '' ? undefined : Number(editEstimatedPrice),
                liquidityScore: editLiquidityScore === '' ? undefined : Number(editLiquidityScore),
                investmentSummary: editInvestmentSummary || null,
                reasoningText: editReasoningText || undefined
            }));
            setIsTeaserMode(false);
            setIsEditing(false);
        } catch (err: any) {
            setError(err.message || 'Произошла неизвестная ошибка');
        } finally {
            setIsSaving(false);
        }
    };

    // Расчет апсайда
    const calculateUpside = (estimated: number, current: number) => {
        if (!estimated || !current) return null;
        const diff = estimated - current;
        const percent = (diff / current) * 100;
        return { diff, percent };
    };

    const upside = (evaluationResult?.estimatedPrice && currentPrice)
        ? calculateUpside(evaluationResult.estimatedPrice, currentPrice)
        : null;

    // Рендер Markdown
    const renderMarkdown = (text: string | null | undefined) => {
        if (!text) return null;
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, idx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={idx}>{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    const title = type === 'quick' ? 'Экспресс-оценка инвестиционной привлекательности (AI)' : 'Детальная оценка инвестиционной привлекательности (AI)';

    return (
        <div className={styles.aiBlock}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '2px solid #edf2f7' }}>
                <h2 className={styles.title} style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>{title}</h2>
                {user?.isAdmin && type === 'deep' && !isEditing && (
                    <button 
                        onClick={() => {
                            setEditReasoningText(evaluationResult?.reasoningText || '');
                            setEditInvestmentSummary(evaluationResult?.investmentSummary || '');
                            setEditEstimatedPrice(evaluationResult?.estimatedPrice || '');
                            setEditLiquidityScore(evaluationResult?.liquidityScore || '');
                            setIsEditing(true);
                        }}
                        style={{ padding: '0.3rem 0.75rem', fontSize: '0.875rem', background: '#e2e8f0', color: '#2d3748', borderRadius: '6px', cursor: 'pointer', border: 'none', fontWeight: 500, flexShrink: 0, marginLeft: '1rem' }}
                    >
                        Редактировать
                    </button>
                )}
            </div>

            {/* Скелетон или спиннер, пока проверяем "покупал ли я?" */}
            {type === 'deep' && isLoadingInitial && (
                <div style={{ color: '#aaa', fontSize: '0.9rem' }}>Проверка статуса анализа...</div>
            )}

            {/* Ошибка */}
            {error && (
                <div className={styles.errorBox}>❌ {error}</div>
            )}

            {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#4a5568', marginBottom: '0.25rem' }}>Оценочная стоимость (руб)</label>
                        <input 
                            type="number" 
                            value={editEstimatedPrice} 
                            onChange={e => setEditEstimatedPrice(e.target.value ? Number(e.target.value) : '')}
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#4a5568', marginBottom: '0.25rem' }}>Ликвидность (1-10)</label>
                        <input 
                            type="number" 
                            min="1" max="10"
                            value={editLiquidityScore} 
                            onChange={e => setEditLiquidityScore(e.target.value ? Number(e.target.value) : '')}
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#4a5568', marginBottom: '0.25rem' }}>Резюме (Investment Summary)</label>
                        <textarea 
                            value={editInvestmentSummary} 
                            onChange={e => setEditInvestmentSummary(e.target.value)}
                            style={{ width: '100%', minHeight: '80px', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#4a5568', marginBottom: '0.25rem' }}>Детальный анализ (Reasoning Text, поддерживает Markdown **жирный**)</label>
                        <textarea 
                            value={editReasoningText} 
                            onChange={e => setEditReasoningText(e.target.value)}
                            style={{ width: '100%', minHeight: '300px', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                            onClick={handleSaveManual} 
                            disabled={isSaving}
                            style={{ padding: '0.5rem 1rem', background: '#3182ce', color: '#fff', borderRadius: '6px', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 500 }}
                        >
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                        <button 
                            onClick={() => setIsEditing(false)}
                            disabled={isSaving}
                            style={{ padding: '0.5rem 1rem', background: '#e2e8f0', color: '#2d3748', borderRadius: '6px', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 500 }}
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Прогресс бар */}
            {isEvaluating && (
                <div className={styles.progressContainer}>
                    <div className={styles.progressBarTrack}>
                        <div className={styles.progressBarFill}></div>
                    </div>
                    <p className={styles.progressText}>
                        Идет анализ... Это может занять до 2 минут.
                        <br /><span style={{ fontSize: '0.8em', color: '#94a3b8' }}>AI модель думает...</span>
                    </p>
                </div>
            )}

            {/* Результат */}
            {evaluationResult && !isEditing && (
                <div className={styles.resultContainer}>
                    {(type === 'quick' || evaluationResult.estimatedPrice) && (
                        <div className={styles.priceRow}>
                            <span className={styles.priceLabelBadge}>
                                {type === 'quick' ? 'Оценка AI:' : 'Новая оценка AI:'}
                            </span>

                            {evaluationResult.estimatedPrice ? (
                                <div className={styles.priceDataWrapper}>
                                    <span className={styles.estimatedPrice}>
                                        ~{evaluationResult.estimatedPrice.toLocaleString('ru-RU')} ₽
                                    </span>

                                    {upside && (
                                        <div className={styles.upsideContainer}>
                                            <span className={`${styles.upsideBadge} ${upside.percent >= 0 ? styles.upsidePositive : styles.upsideNegative}`}>
                                                {upside.percent > 0 ? '+' : ''}{upside.percent.toFixed(0)}%
                                            </span>
                                            <span className={styles.upsideLabel}>от начальной цены</span>
                                        </div>
                                    )}
                                </div>
                            ) : type === 'quick' ? (
                                <span className={styles.notEvaluableLabel}>
                                    {priceConfidence?.toLowerCase() === 'not_evaluable'
                                        ? 'Автооценка недоступна'
                                        : 'Числовая оценка не рассчитана'}
                                </span>
                            ) : null}
                        </div>
                    )}

                    {type === 'quick' && priceConfidence && (
                        <div className={styles.confidenceRow}>
                            <div className={styles.confidenceBadge}>
                                <div className={`${styles.confidenceDot} ${getQuickConfidenceClass(priceConfidence, styles)}`} />
                                <span className={styles.confidenceText}>
                                    {getQuickConfidenceLabel(priceConfidence)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Ликвидность (только для deep) */}
                    {type === 'deep' && evaluationResult.liquidityScore != null && (
                        <div className={styles.liquidityRow}>
                            <strong>Ликвидность: </strong>
                            <span style={{
                                color: evaluationResult.liquidityScore >= 7 ? '#16a34a' :
                                    evaluationResult.liquidityScore >= 4 ? '#ca8a04' : '#dc2626',
                                fontWeight: 'bold'
                            }}>
                                {evaluationResult.liquidityScore}/10
                            </span>
                        </div>
                    )}

                    {/* Резюме */}
                    {evaluationResult.investmentSummary && (
                        <div className={styles.summary}>
                            <strong>Резюме:</strong> {renderMarkdown(evaluationResult.investmentSummary)}
                        </div>
                    )}

                    {/* Детальный анализ (только для deep) */}
                    {type === 'deep' && evaluationResult.reasoningText && evaluationResult.isReasoningTextTeaser && (
                        <div className={styles.reasoningContainer}>
                            <h3 className={styles.reasoningSummary}>Ознакомительный фрагмент анализа</h3>
                            <div className={`${styles.reasoningText} ${isTeaserMode ? styles.teaserFade : ''}`}>

                                {renderMarkdown(evaluationResult.reasoningText)}
                                <div className={styles.reasoningTeaserNotice}>
                                    <strong>Это ознакомительный фрагмент.</strong>
                                    <span> Полный разбор становится публичным после завершения торгов.</span>
                                    <Link href="/how-it-works/ai-assessment"> Подробнее об AI-оценке →</Link>
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'deep' && evaluationResult.reasoningText && !evaluationResult.isReasoningTextTeaser && (
                        <details className={styles.reasoningDetails}>
                            <summary className={styles.reasoningSummary}>Показать детальный анализ</summary>
                            <div className={styles.reasoningText}>{renderMarkdown(evaluationResult.reasoningText)}</div>
                        </details>
                    )}
                </div>
            )}

            {/* Кнопка запуска:
                Показываем, если:
                1. Это deep режим
                2. Результата НЕТ (или это тизер)
                3. Процесс не идет (isEvaluating == false)
                4. Первичная проверка завершена (!isLoadingInitial)
            */}
            {type === 'deep' && (!evaluationResult || isTeaserMode) && !isEvaluating && !isLoadingInitial && !isEditing && (
                <div style={{ marginTop: evaluationResult ? '1rem' : '0' }}>
                    <button onClick={handleEvaluate} className={styles.evaluateButton}>
                        {isTeaserMode ? 'Читать полный анализ' : 'Запустить анализ'}
                    </button>
                </div>
            )}

            {/* Дисклеймер (показываем только если есть какой-либо результат оценки) */}
            {evaluationResult && !isEditing && (
                <div className={styles.disclaimerBox}>
                    <strong>Внимание!</strong> Данный анализ сгенерирован искусственным интеллектом на основе открытых данных на момент публикации. Он носит исключительно ознакомительный характер, может содержать неточности и не является инвестиционной, финансовой или юридической рекомендацией. Перед принятием решения о покупке проводите самостоятельную проверку.
                </div>
            )}
                </>
            )}
        </div>
    );
}

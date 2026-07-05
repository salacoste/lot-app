import { ReactNode } from 'react';
import styles from './ActiveFiltersSummary.module.css';

type FilterChip = {
  id: string;
  label: string;
  onRemove?: () => void;
};

type ActiveFiltersSummaryProps = {
  activeFilterCount: number;
  chips: FilterChip[];
  onClearAll?: () => void;
  compactLabel?: string;
};

type SummaryBlockProps = {
  title: string;
  children: ReactNode;
};

function ActiveFiltersSummaryBlock({ title, children }: SummaryBlockProps) {
  return (
    <section className={styles.summaryBlock} aria-label={title}>
      <p className={styles.summaryTitle}>{title}</p>
      {children}
    </section>
  );
}

export default function ActiveFiltersSummary({
  activeFilterCount,
  chips,
  onClearAll,
  compactLabel = 'Фильтры',
}: ActiveFiltersSummaryProps) {
  if (activeFilterCount < 1) {
    return null;
  }

  return (
    <ActiveFiltersSummaryBlock title={`${compactLabel}: ${activeFilterCount}`}>
      <div className={styles.filterSummary}>
        {chips.map((chip) => (
          <span key={chip.id} className={styles.filterChip} title={chip.label}>
            <span className={styles.filterChipLabel}>{chip.label}</span>
            {chip.onRemove ? (
              <button
                type="button"
                className={styles.filterChipRemove}
                onClick={chip.onRemove}
                aria-label={`Убрать фильтр ${chip.label}`}
              >
                ✕
              </button>
            ) : null}
          </span>
        ))}
      </div>

      {onClearAll ? (
        <button type="button" className={styles.clearAllButton} onClick={onClearAll}>
          Сбросить все фильтры
        </button>
      ) : null}
    </ActiveFiltersSummaryBlock>
  );
}

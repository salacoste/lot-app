"use client";

import Breadcrumbs from "../../../components/Breadcrumbs";
import LotImageGallery from "../../../components/LotImageGallery/LotImageGallery";
import type { Lot } from "../../../types";
import { generateSlug } from "../../../utils/slugify";
import type { BreadcrumbCrumb } from "@/utils/lotBreadcrumbs";
import styles from "./lot.module.css";

export function getStatusTheme(status?: string | null) {
  if (!status) return "active";
  const s = status.toLowerCase();

  if (s.includes("завершенные") || s.includes("торги завершены")) {
    return "completed";
  }

  if (
    s.includes("отменен") ||
    s.includes("не состоял") ||
    s.includes("аннулирован")
  ) {
    return "cancelled";
  }

  if (s.includes("приостановлен")) return "warning";

  return "active";
}

type LotHeaderSummaryProps = {
  lot: Lot;
  crumbs: BreadcrumbCrumb[];
  onBackToList: () => void;
};

export default function LotHeaderSummary({
  lot,
  crumbs,
  onBackToList,
}: LotHeaderSummaryProps) {
  return (
    <>
      <Breadcrumbs crumbs={crumbs} />

      <button onClick={onBackToList} className={styles.backLink}>
        &larr; Вернуться к списку лотов
      </button>

      <h1 className={styles.mainLotTitle}>
        {lot.title ? lot.title : lot.description}
      </h1>
    </>
  );
}

type LotHeaderGalleryProps = {
  lot: Lot;
  galleryImages: string[];
  badges: string[];
};

export function LotHeaderGallery({
  lot,
  galleryImages,
  badges,
}: LotHeaderGalleryProps) {
  return (
    <LotImageGallery
      images={galleryImages}
      title={lot.title || ""}
      badges={badges}
    />
  );
}

type LotHeaderStatusSummaryProps = {
  lot: Lot;
  isReasonExpanded: boolean;
  onToggleReason: () => void;
};

export function LotHeaderStatusSummary({
  lot,
  isReasonExpanded,
  onToggleReason,
}: LotHeaderStatusSummaryProps) {
  return (
    <>
      <div
        className={`${styles.statusBadge} ${styles[getStatusTheme(lot.tradeStatus)]}`}
      >
        {lot.tradeStatus ? lot.tradeStatus : "Торги идут (прием заявок)"}
      </div>

      {lot.tradeStatusReason && (
        <div
          className={`${styles.statusReason} ${styles[getStatusTheme(lot.tradeStatus)]}`}
        >
          <b>Причина:</b>{" "}
          {lot.tradeStatusReason.length > 200 && !isReasonExpanded
            ? `${lot.tradeStatusReason.substring(0, 200)}... `
            : lot.tradeStatusReason}
          {lot.tradeStatusReason.length > 200 && (
            <button onClick={onToggleReason} className={styles.expandReasonBtn}>
              {isReasonExpanded ? "Скрыть" : "Читать далее"}
            </button>
          )}
        </div>
      )}

      {lot.sameCadastralLots && lot.sameCadastralLots.length > 0 && (
        <div className={styles.sameCadastralTopBlock}>
          <h3 className={styles.sameCadastralTopTitle}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: "6px" }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Внимание: найдены активные торги по этому объекту!
          </h3>
          <div className={styles.sameCadastralTopList}>
            {lot.sameCadastralLots.map((sl) => {
              const slSlug = sl.slug ?? generateSlug(sl.title || "");
              const slUrl = `/lot/${slSlug}-${sl.publicId}`;
              return (
                <a
                  key={sl.id}
                  href={slUrl}
                  className={styles.sameCadastralTopLink}
                >
                  <span className={styles.sameCadastralTopLinkTitle}>
                    {sl.title}
                  </span>
                  {sl.startPrice != null && (
                    <span className={styles.sameCadastralTopLinkPrice}>
                      {sl.startPrice.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { LotDocument } from '../../../types';
import styles from './lot.module.css';

type LotDocumentsSectionProps = {
  documents: LotDocument[];
};

export default function LotDocumentsSection({
  documents,
}: LotDocumentsSectionProps) {
  if (!documents || documents.length === 0) {
    return null;
  }

  return (
    <div className={styles.descriptionSection}>
      <h2 className={styles.sectionTitle}>Документы</h2>
      <ul className={styles.documentList}>
        {documents.map((doc) => {
          const downloadHref = doc.downloadUrl.startsWith('http')
            ? doc.downloadUrl
            : `${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}${doc.downloadUrl}`;

          return (
            <li key={doc.id}>
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.documentLink}
              >
                {doc.title}
                {doc.extension &&
                  !doc.title.toLowerCase().endsWith(doc.extension.toLowerCase()) && (
                    <span className={styles.documentExt}> {doc.extension}</span>
                  )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


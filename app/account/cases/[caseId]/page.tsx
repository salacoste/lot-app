import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CaseDossierClient from './CaseDossierClient';

export const metadata: Metadata = {
  title: 'Досье дела — личный кабинет',
  description: 'Приватное досье арбитражного дела по сохранённым данным.',
  robots: { index: false, follow: false },
};

export default async function CaseDossierPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!/^[0-9a-f]{32}$/u.test(caseId)) notFound();
  return <CaseDossierClient caseId={caseId} />;
}

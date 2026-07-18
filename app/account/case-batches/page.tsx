import type { Metadata } from 'next';
import CaseBatchWorkbenchClient from './CaseBatchWorkbenchClient';

export const metadata: Metadata = {
  title: 'Пакетная проверка дел — личный кабинет',
  description: 'Приватная пакетная проверка сохранённых данных по делам и организациям.',
  robots: { index: false, follow: false },
};

export default function CaseBatchesPage() {
  return <CaseBatchWorkbenchClient />;
}

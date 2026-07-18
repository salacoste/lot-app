import type { Metadata } from 'next';
import LeasingDashboardClient from './LeasingDashboardClient';

export const metadata: Metadata = {
  title: 'Лизинговая активность — личный кабинет',
  description: 'Приватный поиск сохранённых сигналов лизинговой активности.',
  robots: { index: false, follow: false },
};

export default function LeasingPage() { return <LeasingDashboardClient />; }

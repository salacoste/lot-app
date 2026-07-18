import type { Metadata } from 'next';
import CounterpartyMonitoringClient from './CounterpartyMonitoringClient';

export const metadata: Metadata = {
  title: 'Контрагенты — личный кабинет',
  description: 'Приватный список наблюдения за контрагентами.',
  robots: { index: false, follow: false },
};

export default function CounterpartiesPage() {
  return <CounterpartyMonitoringClient />;
}

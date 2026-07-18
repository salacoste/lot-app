import { Suspense } from 'react';
import ParserOperationsClient from './ParserOperationsClient';

export const metadata = { title: 'Операции парсеров | auction.thepeace.ru', description: 'Безопасный операторский срез parser runs' };

export default function ParserOperationsPage() {
  return <Suspense fallback={<main aria-busy="true">Загрузка операций…</main>}><ParserOperationsClient /></Suspense>;
}

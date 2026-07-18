// app/add-ad/page.tsx
import { Metadata } from 'next';
import AddAdClient from './AddAdClient';

export const metadata: Metadata = {
  title: 'Разместить объявление — auction.thepeace.ru',
  description: 'Подать бесплатное объявление о продаже недвижимости.',
};

export default function AddAdPage() {
  return <AddAdClient />;
}
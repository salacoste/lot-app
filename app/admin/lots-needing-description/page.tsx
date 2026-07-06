import AdminLotsClient from './AdminLotsClient';

export const metadata = {
    title: 'Лоты без описания имущества | auction.thepeace.ru',
    description: 'Панель администратора',
};

export default function AdminLotsPage() {
    return <AdminLotsClient />;
}

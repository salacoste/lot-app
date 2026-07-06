import AdminContractPermissionsClient from './AdminContractPermissionsClient';

export const metadata = {
    title: 'Разрешения на договоры | auction.thepeace.ru',
    description: 'Панель администратора',
};

export default function AdminContractPermissionsPage() {
    return <AdminContractPermissionsClient />;
}

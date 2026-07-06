import InboxClient from './InboxClient';

export const metadata = {
    title: 'Мои сообщения | auction.thepeace.ru',
    description: 'Список ваших диалогов',
};

export default function InboxPage() {
    return <InboxClient />;
}

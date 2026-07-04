import { primaryLot } from '../public-smoke/fixture-data.mjs';
import { DEFAULT_ACCOUNT_SMOKE_BACKEND_URL } from './constants.mjs';

const ACCOUNT_SMOKE_BACKEND_URL = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL || DEFAULT_ACCOUNT_SMOKE_BACKEND_URL;

export const ACCOUNT_SMOKE_USER = {
  id: 'fixture-user-2-2',
  name: 'Account Smoke User',
  email: 'account-smoke@example.test',
  password: 'fixture-password',
  isSubscriptionActive: true,
  subscriptionEndDate: '2026-12-31T00:00:00Z',
  isOnTrial: false,
  createdAt: '2026-07-01T00:00:00Z',
  isAdmin: false,
};

export const favoriteLot = {
  ...primaryLot,
  id: '33333333-3333-4333-8333-333333333333',
  publicId: 22001,
  slug: 'account-smoke-favorite-lot',
  title: 'Account Smoke Favorite Lot',
  imageUrl: `${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-favorite-lot.svg`,
  images: [`${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-favorite-lot.svg`],
  documents: [],
  isFavorite: true,
};

export const accountAd = {
  id: 'account-smoke-ad-1',
  title: 'Account Smoke Ad — экскаватор',
  description: 'Детерминированное объявление для account smoke без S3-загрузки.',
  price: 765000,
  region: 'Москва',
  createdAt: '2026-07-02T12:00:00Z',
  status: 1,
  imageUrls: [`${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-ad.svg`],
};

export const initialAlert = {
  id: 'account-smoke-alert-1',
  regionCodes: ['77'],
  categories: ['Недвижимость'],
  minPrice: 1000000,
  maxPrice: 5000000,
  biddingType: null,
  isSharedOwnership: null,
  deliveryTimeStr: '09:00',
  isActive: true,
};

export const inboxItem = {
  roomId: 'account-smoke-room-1',
  adId: accountAd.id,
  adTitle: accountAd.title,
  adImageUrl: accountAd.imageUrls[0],
  companionName: 'Smoke Buyer',
  lastMessageText: 'Здравствуйте, объявление актуально?',
  lastMessageDate: '2026-07-04T10:00:00Z',
  unreadCount: 1,
};

export const initialMessages = [
  {
    id: 'account-smoke-message-1',
    roomId: inboxItem.roomId,
    senderId: 'fixture-companion',
    text: inboxItem.lastMessageText,
    createdAt: inboxItem.lastMessageDate,
    isRead: false,
  },
];

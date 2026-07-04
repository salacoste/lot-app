export const SMOKE_BACKEND_URL = 'http://127.0.0.1:4021';

export const primaryLot = {
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 21001,
  slug: 'smoke-public-lot',
  url: 'https://fedresurs.example/lots/21001',
  title: 'Smoke Public Lot — складской комплекс',
  description: 'Детерминированный публичный лот для smoke-теста без production данных.',
  startPrice: 12345000,
  step: 100000,
  deposit: 500000,
  isFavorite: false,
  bidding: {
    id: 'bid-21001',
    type: 'Аукцион',
    bidAcceptancePeriod: '2026-07-01T09:00:00Z — 2026-07-20T18:00:00Z',
    tradePeriod: '2026-07-21T10:00:00Z',
    viewingProcedure: 'По предварительной записи через организатора торгов.',
    platform: 'Smoke ETP',
    tradeNumber: 'SMOKE-21001',
    bankruptMessageId: 'MSG-SMOKE-21001',
    arbitrationManager: { name: 'Smoke Manager' },
    debtor: { name: 'Smoke Debtor LLC' },
  },
  imageUrl: `${SMOKE_BACKEND_URL}/fixtures/smoke-lot.svg`,
  coordinates: null,
  propertyRegionName: 'Москва',
  marketValue: 15000000,
  marketValueMin: 14000000,
  marketValueMax: 16000000,
  priceConfidence: 'medium',
  cadastralInfos: [{ cadastralNumber: '77:01:000401:1001' }],
  investmentSummary: 'Smoke fixture investment summary.',
  createdAt: '2026-07-01T00:00:00Z',
  categories: [{ id: 10, name: 'Недвижимость' }, { id: 11, name: 'Коммерческая недвижимость' }],
  priceSchedules: [
    { number: 1, startDate: '2026-07-01T09:00:00Z', endDate: '2026-07-20T18:00:00Z', price: 12345000, deposit: 500000 },
  ],
  images: [`${SMOKE_BACKEND_URL}/fixtures/smoke-lot.svg`],
  documents: [{ id: 'doc-21001', title: 'Smoke public document.pdf', downloadUrl: `${SMOKE_BACKEND_URL}/fixtures/smoke-document.pdf` }],
  tradeStatus: 'Открыт прием заявок',
  tradeStatusReason: null,
  similarLots: [],
  sameCadastralLots: [],
  attributes: {},
  needsDescriptionReview: false,
  tags: [{ key: 'asset_type.real_estate', label: 'Недвижимость', family: 'asset_type', confidence: 0.9, source: 'rule' }],
};

export const passengerCarLot = {
  ...primaryLot,
  id: '22222222-2222-4222-8222-222222222222',
  publicId: 21002,
  slug: 'smoke-passenger-car',
  title: 'Smoke Passenger Car — Toyota Camry',
  description: 'Детерминированный легковой автомобиль для smoke-теста.',
  startPrice: 2345000,
  imageUrl: `${SMOKE_BACKEND_URL}/fixtures/smoke-car.svg`,
  images: [`${SMOKE_BACKEND_URL}/fixtures/smoke-car.svg`],
  categories: [{ id: 20, name: 'Транспорт' }, { id: 21, name: 'Легковой автомобиль' }],
  attributes: { brand: 'Toyota', model: 'Camry', year: '2020', mileage: '42000' },
  tags: [{ key: 'asset_type.vehicle', label: 'Транспорт', family: 'asset_type', confidence: 0.95, source: 'rule' }],
};

export const lots = [primaryLot, passengerCarLot];

export const vehicleFilterOptions = {
  brands: ['Toyota'],
  modelsByBrand: { Toyota: ['Camry'] },
};

export const mapLots = {
  lots: [
    {
      id: primaryLot.id,
      type: primaryLot.bidding.type,
      title: primaryLot.title,
      startPrice: primaryLot.startPrice,
      latitude: 55.751244,
      longitude: 37.618423,
    },
  ],
  totalCount: 3,
  accessLevel: 0,
};

export const sitemapLots = lots.map((lot) => ({
  publicId: lot.publicId,
  slug: lot.slug,
  title: lot.title,
  description: lot.description,
  createdAt: lot.createdAt,
}));

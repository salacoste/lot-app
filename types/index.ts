import type { components } from '@/lib/generated/lots-webapi';

export type BackendArbitrationManagerDto = components['schemas']['ArbitrationManagerDto'];
export type BackendBiddingDto = components['schemas']['BiddingDto'];
export type BackendCadastralItemDto = components['schemas']['CadastralItemDto'];
export type BackendLotDocumentDto = components['schemas']['LotDocumentDto'];
export type BackendLotDto = components['schemas']['LotDto'];
export type BackendLotTagDto = components['schemas']['LotTagDto'];
export type BackendPriceScheduleDto = components['schemas']['PriceScheduleDto'];
export type BackendSimilarLotDto = components['schemas']['SimilarLotDto'];

type ArbitrationManager = {
  name: string;
  inn?: string | null;
  snils?: string | null;
  ogrn?: string | null;
};

type Debtor = {
  name: string;
  inn?: string | null;
  snils?: string | null;
  ogrn?: string | null;
};

type BiddingInfo = {
  id?: string | null;
  type: string;
  bidAcceptancePeriod: string;
  tradePeriod: string;
  viewingProcedure?: string;
  platform: string;
  tradeNumber?: string | null;
  bankruptMessageId?: string | null;
  arbitrationManager?: ArbitrationManager | null;
  debtor?: Debtor | null;
};

export type LotTag = Omit<BackendLotTagDto, 'confidence' | 'family' | 'key' | 'label' | 'source'> & {
  key: string;
  label: string;
  family: string;
  confidence?: BackendLotTagDto['confidence'];
  source?: 'admin_override' | 'rule' | 'attribute' | 'category' | 'llm' | null;
};

export type Lot = {
  id: string;
  publicId: number;
  url?: string;
  /** Slug из БД (бэкенд). Если null — на фронте используется generateSlug(title/description). */
  slug?: string | null;
  title: string | null;
  description: string;
  startPrice: number | null;
  step: number | null;
  deposit: number | null;
  isFavorite: boolean;
  bidding: BiddingInfo;
  imageUrl: string | null;
  coordinates: [number, number] | null,
  propertyRegionName?: string | null;
  marketValue?: number | null;
  marketValueMin?: number | null;
  marketValueMax?: number | null;
  priceConfidence?: string | null;
  cadastralInfos?: CadastralInfo[];
  investmentSummary?: string | null;
  createdAt?: string;
  categories: {
    id: number;
    name: string;
  }[];
  priceSchedules: PriceSchedule[];
  images: string[];
  documents?: LotDocument[];
  tradeStatus?: string;
  tradeStatusReason?: string | null;
  finalPrice?: number;
  winnerName?: string;
  winnerInn?: string;
  similarLots?: SimilarLot[];
  sameCadastralLots?: SimilarLot[];
  attributes?: Record<string, string>;
  needsDescriptionReview?: boolean;
  tags?: LotTag[];
};

export type SimilarLot = {
  id: string;
  publicId: number;
  title: string | null;
  slug?: string | null;
  startPrice: number | null;
  imageUrl: string | null;
};

export type LotDocument = Omit<BackendLotDocumentDto, 'downloadUrl' | 'id' | 'title'> & {
  id: string;
  downloadUrl: string;
  title: string;
};

export type PriceSchedule = Omit<BackendPriceScheduleDto, 'deposit' | 'endDate' | 'number' | 'price' | 'startDate'> & {
  number: number;
  startDate: string;
  endDate: string;
  price: number | null;
  deposit: number | null;
};

export type CadastralInfo = Omit<BackendCadastralItemDto, 'cadastralNumber'> & {
  cadastralNumber: string;
};

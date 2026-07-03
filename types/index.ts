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

export type LotTag = {
  key: string;
  label: string;
  family: string;
  confidence?: number | null;
  source?: "admin_override" | "rule" | "attribute" | "category" | "llm" | null;
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

export type LotDocument = {
  id: string;
  downloadUrl: string;
  title: string;
  extension?: string | null;
  isExternal?: boolean;
};

export type PriceSchedule = {
  number: number;
  startDate: string;
  endDate: string;
  price: number | null;
  deposit: number | null;
  estimatedRank: number | null;
  potentialRoi: number | null;
};

export interface CadastralInfo {
  cadastralNumber: string;
  area?: number;
  cadastralCost?: number;
  category?: string;
  permittedUse?: string;
  address?: string;
  status?: string;
  objectType?: string;
  rightType?: string;
  ownershipType?: string;
  regDate?: string;
}

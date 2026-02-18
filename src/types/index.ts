export interface Shelf {
  shelf_id: string;
  side: string;
  position: number;
  level: string;
  farm: string;
  created_at: string;
}

export interface ShelfItem {
  id: number;
  shelf_id: string;
  bucket_id: string;
  variety: string;
  stem_length: string;
  stem_qty: number;
  greenhouse: string;
  date_added: string;
  synced: number; // 0 = pending, 1 = synced
}

export interface SyncQueueEntry {
  id: number;
  action: string;
  payload: string;
  created_at: string;
  status: 'pending' | 'synced' | 'failed';
  error_message?: string;
}

export interface ShelfOccupancy {
  shelf_id: string;
  side: string;
  position: number;
  level: string;
  bucket_count: number;
}

export interface ShelveRequest {
  shelf_id: string;
  bucket_id: string;
  farm: string;
}

export interface ShelveResponse {
  message: string;
  shelf_id: string;
  bucket_id: string;
  stems: number;
  stem_length: string;
}

export interface DashboardStats {
  total_shelves: number;
  occupied_shelves: number;
  empty_shelves: number;
  total_buckets: number;
  pending_sync: number;
}

export type ScanPhase = 'scan-shelf' | 'scan-buckets';

export interface ShelvedBucketEntry {
  bucket_id: string;
  variety: string;
  stems: number;
  stem_length: string;
  greenhouse: string;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export const SHELF_SIDES = ['A', 'B'] as const;
export const SHELF_POSITIONS = [1, 2, 3, 4, 5, 6] as const;
export const SHELF_LEVELS = ['T', 'M', 'B'] as const;

export const LEVEL_LABELS: Record<string, string> = {
  T: 'Top',
  M: 'Middle',
  B: 'Bottom',
  '1': 'Bottom',
  '2': 'Middle',
  '3': 'Top',
};

// Grading types
export type GradingScanPhase = 'scan-bunch' | 'scan-grader' | 'scan-bucket';

export interface GradingRequest {
  bunch_id: string;
  grader: string;
  bucket_id: string;
  farm: string;
}

export interface GradingResponse {
  message: string;
  stock_entry: string;
  variety: string;
  stem_length: string;
  qty: number;
}

export interface GradedEntry {
  bunch_id: string;
  grader: string;
  bucket_id: string;
  variety: string;
  stem_length: string;
  qty: number;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

// Harvest types
export interface HarvestEntry {
  id: number;
  item_code: string;
  quantity: number;
  section: string;
  harvester: string;
  bucket_id: string;
  farm: string;
  greenhouse: string;
  stock_entry: string;
  date_added: string;
  synced: number;
}

export interface HarvestListEntry {
  bucket_id: string;
  item_code: string;
  quantity: number;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export interface HarvestResponse {
  message: string;
  stock_entry: string;
  bucket: string;
}

export interface HarvestSession {
  greenhouse: string;
  section: string;
  harvester: string;
  item_code: string;
}

// Greenhouse (from getGreenhouses)
export interface GreenhouseSection {
  section_name: string;
  employee_name: string;
}

export interface GreenhouseVariety {
  variety: string;
}

export interface Greenhouse {
  name: string;
  warehouse_name: string;
  company: string;
  custom_bed_numbering: string;
  custom_zone_numbering: string;
  custom_location: string;
  custom_varieties_grown: GreenhouseVariety[];
  custom_sections: GreenhouseSection[];
}

export interface GreenhousesResponse {
  message: string;
  greenhouses: Greenhouse[];
}

// Items/Varieties (from getVarieties)
export interface RoseItem {
  name: string;
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
}

export interface RoseItemsResponse {
  message: string;
  items: RoseItem[];
}

// Receiving types
export interface ReceivingEntry {
  id: number;
  bunch_id: string;
  receiver: string;
  farm: string;
  date_added: string;
  synced: number;
}

export interface ReceivingListEntry {
  bunch_id: string;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export interface ReceivingResponse {
  message: string;
  bunch_id: string;
}

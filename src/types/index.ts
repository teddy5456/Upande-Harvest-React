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
  bucket_id: string;
  date_added: string;
  synced: number;
}

export interface ReceivingListEntry {
  bucket_id: string;
  coldroom_bucket_id?: string;
  variety?: string;
  greenhouse?: string;
  qty?: number;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export interface ReceivingResponse {
  message: string;
  stock_entry_name: string;
  // xflora: returns item details read from the bucket
  variety?: string;
  item_code?: string;
  greenhouse?: string;
  qty?: number;
}

export interface BucketTransferResponse {
  message: string;
  stock_entry_name: string;
  from_bucket: string;
  to_bucket: string;
  variety?: string;
  greenhouse?: string;
  item_code?: string;
}

// Packing types
export interface PackingBox {
  box_id: string;
  farm: string;
  date_created: string;
  synced: number;
}

export interface PackingBoxItem {
  id: number;
  box_id: string;
  bunch_id: string;
  date_added: string;
  synced: number;
}

export interface PackingListEntry {
  bunch_id: string;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export interface PackingResponse {
  message: string;
  box_id: string;
}

// Quality types
export type QualitySection = 'field_reject' | 'receiving_reject' | 'grading_reject' | 'packhouse_discard';
export type QuarantineAction = 'discard' | 'intake' | '';

export const QUALITY_SECTIONS: { key: QualitySection; label: string; icon: string }[] = [
  { key: 'field_reject', label: 'Field', icon: 'leaf-outline' },
  { key: 'receiving_reject', label: 'Receiving', icon: 'download-outline' },
  { key: 'grading_reject', label: 'Grading', icon: 'clipboard-outline' },
  { key: 'packhouse_discard', label: 'Discard', icon: 'trash-outline' },
];

export const QUALITY_REASONS: Record<QualitySection, string[]> = {
  field_reject: ['Botrytis', 'Rust', 'Downy Mildew', 'Thrips Damage', 'Broken Stem', 'Short Stem', 'Drooping', 'Bent Neck', 'Mixed Variety', 'Other'],
  receiving_reject: ['Botrytis', 'Rust', 'Downy Mildew', 'Thrips Damage', 'Broken Stem', 'Short Stem', 'Drooping', 'Bent Neck', 'Mixed Variety', 'Damaged in Transit', 'Over-aged', 'Other'],
  grading_reject: ['Botrytis', 'Bent Neck', 'Short Stem', 'Broken Stem', 'Thrips Damage', 'Bruised', 'Rust', 'Mixed Variety', 'Tight Cut Stage', 'Advanced Cut Stage', 'Other'],
  packhouse_discard: ['Bent Neck', 'Short Stem', 'Botrytis', 'Thrips', 'Bruised', 'Other'],
};

// A single reject line: one reason with a quantity
export interface RejectLine {
  reason: string;
  quantity: number;
}

export interface QualityEntry {
  id: number;
  section: QualitySection;
  ref_id: string;
  quantity: number;
  reason: string;
  notes: string;
  farm: string;
  greenhouse: string;
  variety: string;
  quarantined: number;
  quarantine_action: string;
  date_added: string;
  synced: number;
}

export interface QualityListEntry {
  ref_id: string;
  quantity: number;
  reason: string;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
}

export interface QualityResponse {
  message: string;
}

// Actual harvest types
export interface ActualHarvestEntry {
  id: number;
  greenhouse: string;
  variety: string;
  quantity: number;
  harvest_date: string;
  notes: string;
  farm: string;
  date_added: string;
  synced: number;
}

// Dashboard report types
export interface GreenhouseHarvestRow {
  greenhouse: string;
  stems: number;
  varieties: string;
  rejects: number;
}

export interface GradingDashboardData {
  total_graded: number;
  grading_count: number;
  active_graders: number;
  rejection_rate: number;
}

export interface BucketBalance {
  bucket_id: string;
  variety: string;
  stem_length: string;
  bucket_total: number;
  already_graded: number;
  already_rejected: number;
  remaining_stems: number;
  bucket_full: boolean;
}

export interface RejectResponse {
  message: string;
  reject_entry: string;
  bucket_id: string;
  variety: string;
  rejects: number;
  grader: string;
  bucket_total: number;
  already_graded: number;
  already_rejected: number;
  remaining_stems: number;
  bucket_full: boolean;
}

// Quarantine batch types
export type QuarantineScope = 'buckets' | 'greenhouse';

export interface QuarantineBatchListEntry {
  id: number;
  batch_id: string;
  scope: QuarantineScope;
  greenhouse: string;
  bucket_ids: string; // JSON-encoded string array
  reason: string;
  notes: string;
  status: 'pending' | 'discarded' | 'intake';
  date_added: string;
  synced: number;
}

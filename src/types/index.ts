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
  /** The shelving_entry script has always returned this; the screen used to
   *  throw it away, so the operator could not see what they were shelving. */
  variety?: string;
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
  source_item: string;
  stem_length: string;
  qty: number;
  // Server returns the source bucket's remaining stem count post-submit so
  // the client can decide whether to auto-pool without a follow-up call.
  bucket_remaining_stems?: number;
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
  // Server-side handle for cancel/edit on the last-scans panel. Only set when
  // the entry actually went through to the ERP (status==='success'). Queued
  // entries don't have one yet — sync.ts populates it later.
  stock_entry?: string;
  // Context needed to rebuild the entry when the user edits the qty
  section?: string;
  harvester?: string;
  greenhouse?: string;
  farm?: string;
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
  employee?: string; // payroll number
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
  opl?: string;
  sales_order?: string;
  customer?: string;
  pack_rate?: number;
  stems_count?: number;
  status?: 'Open' | 'Closed' | 'Cancelled';
  box_sequence?: number;
  total_boxes?: number;
}

export interface PackingBoxItem {
  id: number;
  box_id: string;
  bunch_id: string;
  date_added: string;
  synced: number;
  stems?: number;
  variety?: string;
  stem_length?: string;
  bunch_size?: string;
}

export interface PackingListEntry {
  bunch_id: string;
  time: string;
  status: 'success' | 'error' | 'queued';
  message?: string;
  stems?: number;
  variety?: string;
}

export interface PackingResponse {
  message: string;
  box_id: string;
}

// Pack Box (server doctype) responses
export interface PackBoxSummary {
  name: string;
  box_id: string;
  box_sequence: number;
  total_boxes: number;
  pack_rate: number;
  stems_count: number;
  status: 'Open' | 'Closed' | 'Cancelled';
}

export interface CreateBoxesForOplResponse {
  message: string;
  opl: string;
  customer: string;
  farm: string;
  pack_rate: number;
  total_stems: number;
  total_boxes: number;
  boxes: PackBoxSummary[];
}

export interface AddBunchResponse {
  message: string;
  box_id: string;
  box_name: string;
  bunch_id: string;
  stems: number;
  stems_count: number;
  pack_rate: number;
  remaining: number;
  full: boolean;
}

// ── Xflora Farm Pack List ───────────────────────────────────────────────────
// The xflora ERP exposes a single batch endpoint (`update_farm_packlist`)
// that accepts a whole box's worth of bunches and creates/updates the
// Farm Pack List + Box Labels in one call.
export interface XfloraOplHeader {
  opl: string;
  sales_order: string;
  customer: string;
  farm: string;
}

export interface XfloraPackItem {
  item_code: string;
  bunch_uom: string;
  bunch_id: string;
  custom_stem_length: string;
  box_id: string;
  bunch_qty: number;
}

export interface XfloraPackPayload {
  custom_sales_order: string;
  custom_customer: string;
  custom_farm: string;
  custom_order_pick_list: string;
  items: XfloraPackItem[];
}

export interface XfloraPackResponse {
  data?: {
    status: 'created' | 'updated';
    message: string;
    docname: string;
    already_packed: { bunch_id: string; item_code: string; stem_length: string; box_id: string }[];
    newly_packed: number;
  };
  // Frappe wraps the response, so the `data` key may also live at top level
  // depending on serializer behavior — we tolerate both shapes.
  message?: string;
}

export interface OpenBoxResponse {
  open_box: PackBoxSummary | null;
  boxes: PackBoxSummary[];
  opl: string;
  customer: string;
  farm: string;
  pack_rate: number;
}

// ── Direct-to-FPL packing (Pack by OPL mode) ────────────────────────────────
export interface PackableOpl {
  opl: string;
  customer: string;
  customer_name: string;
  sales_order: string | null;
  // Two orders for the same customer can otherwise look identical in the
  // picker — these differentiate by route/logistics rather than variety.
  line_code?: string | null;
  delivery_point?: string | null;
  pack_rate: number;
  is_mix: boolean;
  total_stems: number;
  box_count: number;
  open_count: number;
  current_sequence: number;
  date_created: string | null;
  status: 'ready' | 'in_progress' | 'done';
  // Comma-separated variety list, in the lengths the customer BOUGHT.
  // Powers the OPL picker search and the small variety caption on the
  // packing screen once an OPL is chosen.
  varieties?: string;
  /**
   * Per-variety targets from the OPL's Packing tab — what has to go in the
   * boxes, in sold lengths. On a downgrade this differs from the issuing
   * rows: the picker fetched 60cm, the order is 50cm, and packing must be
   * measured against the 50cm line.
   */
  pack_lines?: PackLine[];
  /** False for pick lists made before the Packing tab existed. */
  from_pack_tab?: boolean;
}

export interface PackLine {
  item_code: string;
  item_name: string;
  stem_length: string | null;
  target_stems: number;
  pack_rate: number;
  /** Already in a box for this OPL, counted across every box. */
  packed_stems?: number;
  remaining?: number;
  /**
   * The codes that fill this line: its own, plus any physical codes
   * downgraded into it. A scan reads the bunch's PHYSICAL code, so a 60cm
   * bunch has to be recognised as filling the 50cm line it was picked for.
   */
  counts_as?: string[];
}

export interface ListOpenOplsResponse {
  opls: PackableOpl[];
  count: number;
}

export interface PackBunchToOplResponse {
  box_id: string;
  box_sequence: number;
  pack_box_name: string;
  opl: string;
  stems_count: number;
  pack_rate: number;
  remaining: number;
  full: boolean;
  auto_created_box: boolean;
  fpl: string | null;
  bunch: {
    bunch_id: string;
    variety: string;
    stem_length: string;
    bunch_size: string;
    stems: number;
  };
  // The scanned variety sits on more than one line of this OPL (a straight
  // line AND a mix group, or two different mix groups) — the server refused
  // to guess. `choices` are the candidate lines; resubmit with `choice` set
  // to the picked one's `key`.
  needs_choice?: boolean;
  scanned_variety?: string;
  choices?: PackLineChoice[];
}

export interface PackLineChoice {
  key: string;
  item_code: string;
  line_code: string | null;
  delivery_point: string | null;
  mix_group: string | null;
  total_stems: number | null;
}

export interface PackableVariety {
  display: string;      // e.g. "Athena"
  item_code: string;    // e.g. "Athena 50cm"
  item_name: string;
  stock_uom: string;
}

export interface PackableVarietiesResponse {
  message: string;
  varieties: PackableVariety[];
}

// ── Long Storage ────────────────────────────────────────────────────────────
export interface StorageBoxSealResponse {
  storage_box: string;
  box_id: string;
  variety: string;
  stem_length: string;
  stems_count: number;
  original_stems: number;
  bucket_id: string;
  stems_added: number;
  stock_entry: string;
  bucket_status: 'Available' | 'In Use';
}

export interface LongStorageTotals {
  boxes: number;
  stems: number;
  varieties: number;
  oldest_days: number;
}

export interface LongStorageVarietyRow {
  variety: string;
  variety_name: string;
  stem_length: string;
  stems: number;
  boxes: number;
  oldest_sealed_at: string | null;
}

export interface LongStorageWarehouseRow {
  warehouse: string;
  stems: number;
  boxes: number;
}

export interface LongStorageActiveBox {
  name: string;
  box_id: string;
  variety: string;
  stem_length: string;
  stems_count: number;
  original_stems: number;
  status: string;
  warehouse: string;
  farm: string | null;
  sealed_at: string | null;
  last_drained_at: string | null;
}

export interface LongStorageData {
  totals: LongStorageTotals;
  per_variety: LongStorageVarietyRow[];
  per_warehouse: LongStorageWarehouseRow[];
  active_boxes: LongStorageActiveBox[];
}

export interface ScanResolveResponse {
  kind: 'bucket' | 'storage_box';
  id: string;
  box_id?: string;
  variety?: string;
  variety_name?: string;
  stem_length?: string;
  stems_count?: number;
  warehouse?: string;
  status?: string;
}

// Quality types
//
// `discard` is a request-driven flow (Discard Request doctype): operators
// pick an approved request and scan buckets (Intake coldstore) or bunches
// (Dispatch coldstore) against it. The reason lives on the request, so this
// section has no per-scan reason picker — see DiscardSection.tsx.
export type QualitySection = 'field_reject' | 'receiving_reject' | 'grading_reject' | 'discard';
export type QuarantineAction = 'discard' | 'intake' | '';

export const QUALITY_SECTIONS: { key: QualitySection; label: string; icon: string }[] = [
  { key: 'field_reject', label: 'Field', icon: 'leaf-outline' },
  { key: 'receiving_reject', label: 'Receiving', icon: 'download-outline' },
  { key: 'grading_reject', label: 'Grading', icon: 'funnel-outline' },
  { key: 'discard', label: 'Discard', icon: 'trash-bin-outline' },
];

export const QUALITY_REASONS: Record<Exclude<QualitySection, 'discard'>, string[]> = {
  field_reject: ['Botrytis', 'Rust', 'Downy Mildew', 'Thrips Damage', 'Broken Stem', 'Short Stem', 'Drooping', 'Bent Neck', 'Mixed Variety', 'Other'],
  receiving_reject: ['Botrytis', 'Rust', 'Downy Mildew', 'Thrips Damage', 'Broken Stem', 'Short Stem', 'Drooping', 'Bent Neck', 'Mixed Variety', 'Damaged in Transit', 'Over-aged', 'Other'],
  grading_reject: ['Botrytis', 'Bent Neck', 'Short Stem', 'Broken Stem', 'Thrips Damage', 'Bruised', 'Rust', 'Mixed Variety', 'Tight Cut Stage', 'Advanced Cut Stage', 'Other'],
};

// Receiving-Out leftover-stem rejects (scoped to ReceivingOutScreen): the
// receiving reasons plus receiving-out-specific mismatches. Kept separate from
// receiving_reject so the receiving-IN screen is unaffected. When the reasons
// move server-side (a "Rejection Reason" DocType keyed by page/category), this
// list becomes the `receiving_out` category.
export const RECEIVING_OUT_REASONS: string[] = [
  ...QUALITY_REASONS.receiving_reject.filter((r) => r !== 'Other'),
  'Wrong Variety',
  'Wrong Length',
  'Other',
];

// ---------------------------------------------------------------------------
// Variety display helpers
// ---------------------------------------------------------------------------
// Variety names can carry a trailing stem-length token in several shapes:
//   "Athena 50cm"    (space + digits + "cm")
//   "Athena-50CM"    (hyphen + digits + "CM")
//   "Reflex 60cm"
// stripStemLength drops the trailing token for display. resolveVarietyToItemCode
// puts the canonical 50cm suffix back on for server calls that need item_code.
const STEM_LENGTH_TAIL = /[\s\-]?\d+\s?cm\s*$/i;
const PACKABLE_STEM_LENGTH = '50cm';

// Cache for packable varieties to enable proper item_code resolution
let cachedPackableVarieties: PackableVariety[] = [];

export function stripStemLength(name: string): string {
  if (!name) return '';
  return name.replace(STEM_LENGTH_TAIL, '').trim();
}

/**
 * Extract the stem-length token (e.g. "50cm", "60CM") from a variety name.
 * Returns '' if none is present.
 */
export function extractStemLength(name: string): string {
  if (!name) return '';
  const m = name.match(/(\d+\s?cm)\s*$/i);
  return m ? m[1].replace(/\s+/g, '').toLowerCase() : '';
}

/**
 * Set the cached packable varieties for better item_code resolution
 * Call this when you fetch packable varieties from the API
 */
export function setPackableVarieties(varieties: PackableVariety[]): void {
  cachedPackableVarieties = varieties;
}

// Callers feed this both item_name-style names ("Madam Red") and, for
// varieties pulled off a Link field (Warehouse.custom_varieties_grown etc.),
// item_code-style names ("Madam-Red") — Frappe autonames multi-word items by
// swapping spaces for hyphens, so the two forms differ only in that
// separator. Folding both "-" and " " to a single space before comparing
// makes the two forms equal instead of silently failing every match for a
// compound variety name while single-word varieties (no separator to get
// wrong) pass by accident.
const foldSeparators = (s: string): string =>
  (s || '').trim().toLowerCase().replace(/[\s-]+/g, ' ');

/**
 * Resolve a display variety name to its full item_code.
 * First tries to find a match in the cached packable varieties,
 * then falls back to appending " 50cm" if no match is found.
 */
export function resolveVarietyToItemCode(display: string): string {
  if (!display) return '';

  // Try to find matching packable variety
  const target = foldSeparators(display);
  const match = cachedPackableVarieties.find(v =>
    foldSeparators(v.display) === target ||
    foldSeparators(v.item_name) === target ||
    foldSeparators(v.item_name) === foldSeparators(`${display} ${PACKABLE_STEM_LENGTH}`) ||
    foldSeparators(v.item_code) === target
  );

  if (match) {
    return match.item_code;
  }

  // Already carries a stem length? keep as-is.
  if (STEM_LENGTH_TAIL.test(display)) {
    return display;
  }

  // Fallback: append the default stem length
  return `${display} ${PACKABLE_STEM_LENGTH}`;
}

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

// Discard Request — request/approval-driven coldstore discards.
export type DiscardColdstore = 'Intake' | 'Dispatch';

export interface DiscardRequestRow {
  variety: string;            // item_code
  variety_name?: string;
  qty_requested: number;
  qty_discarded: number;
  qty_remaining: number;
}

export interface DiscardRequestSummary {
  name: string;
  reason: string;
  request_date: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  farm: string | null;
  notes: string | null;
  total_requested: number;
  total_discarded: number;
  total_remaining: number;
  items: DiscardRequestRow[];
}

export interface DiscardConsumeResponse {
  status: 'ok';
  request: string;
  request_status: 'Approved' | 'Completed';
  variety: string;
  stems: number;
  stock_entry: string;
  shelves_cleared: number;
  row: DiscardRequestRow;
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
  stems: number;             // harvested
  received: number;          // received (transferred to coldstore)
  varieties: string;
  varietyBreakdown: VarietyBreakdownRow[];
  rejects: number;
}

export interface VarietyBreakdownRow {
  variety: string;
  stems: number;             // harvested
  received: number;
  variance: number;          // stems - received (positive = unreceived)
}

export interface UnreceivedBucketsResponse {
  greenhouse: string;
  variety: string;
  missing_count: number;
  missing_stems: number;
  missing_buckets: {
    bucket_id: string;
    qty: number;
    posting_date: string;
    harvester: string | null;
  }[];
}

export interface GradingDashboardData {
  total_graded: number;
  grading_count: number;
  active_graders: number;
  rejection_rate: number;
}

export interface PackingDashboardTotals {
  boxes: number;
  open: number;
  closed: number;
  stems: number;
  avg_fill_pct: number;
  downsized_stems: number;
  downsized_entries: number;
  avg_boxes_per_day: number;
}

export interface PackingDashboardBreakdown {
  customer?: string;
  variety?: string;
  farm?: string;
  boxes?: number;
  bunches?: number;
  stems: number;
}

export interface PackingDashboardData {
  from_date: string;
  to_date: string;
  totals: PackingDashboardTotals;
  mix_vs_single: {
    mix: { boxes: number; stems: number };
    single: { boxes: number; stems: number };
  } | null;
  per_customer: PackingDashboardBreakdown[];
  per_variety: PackingDashboardBreakdown[];
  per_farm: PackingDashboardBreakdown[];
  timeline: { day: string; boxes: number; stems: number }[];
}

export interface BucketBalance {
  bucket_id: string;
  variety: string;
  item_code?: string;
  stem_length: string;
  bucket_total: number;
  already_graded: number;
  already_rejected: number;
  remaining_stems: number;
  bucket_full: boolean;
  on_shelf?: boolean;
  shelf_stem_qty?: number;
  pre_receive?: boolean;
  harvester?: string;
  harvest_time?: string;
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

// (BucketBalance has item_code returned by the backend; keep the existing
// interface in sync below if any other consumer needs it.)

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

// Bouquet types
export interface BouquetVarietyRecipe {
  item_code: string;
  item_name: string;
  stems_per_bunch: number;
}

export interface BouquetRecipe {
  is_bouquet: boolean;
  bouquet_group?: string;
  sales_order?: string;
  number_of_bunches?: number;
  varieties?: BouquetVarietyRecipe[];
}

export interface BouquetContribution {
  bucket_id: string;
  item_code: string;
  stems: number;
}

export interface BouquetSubmissionPayload {
  bunch_id: string;
  grader: string;
  bunches_count: number;
  contributions: BouquetContribution[];
}

export interface BouquetSubmissionResponse {
  bouquet_group: string;
  bunch_id: string;
  bunches_count: number;
  created: string[];
}

// Agriculture — Production Planning
export interface ProductionPlanDay {
  plan_date: string;
  target_stems: number;
  variety?: string;
}

export interface ProductionPlanTask {
  task_name: string;
  greenhouse?: string;
  section?: string;
  target?: number;
  status?: 'Pending' | 'Done';
  assignee?: string;
  completed_on?: string;
}

export interface CropCycleSummary {
  name: string;
  greenhouse: string;
  variety?: string;
  cycle_status: string;
  planting_date?: string;
  current_live_plants: number;
  total_stems_harvested: number;
  mortality_rate_pct?: number;
}

export interface CropCycleUprootPayload {
  crop_cycle: string;
  bed_number: number;
  qty: number;
  uproot_date: string;
  reason?: string;
  notes?: string;
}

export interface CropCycleReplantPayload {
  crop_cycle: string;
  bed_number: number;
  variety?: string;
  qty: number;
  replanting_date: string;
  source?: string;
  cost_per_plant?: number;
  notes?: string;
}

export interface SeedlingRequestPayload {
  variety: string;
  qty_requested: number;
  required_by_date?: string;
  company?: string;
  notes?: string;
}

export interface SeedlingRequestListEntry {
  name: string;
  variety: string;
  qty_requested: number;
  required_by_date?: string;
  status: string;
  total_dispatched: number;
}

export interface SeedlingDispatchPayload {
  batch: string;
  seedling_request?: string;
  destination_crop_cycle?: string;
  dispatch_date: string;
  qty_dispatched: number;
  company?: string;
  notes?: string;
}

export interface PropagationBatchSummary {
  name: string;
  variety?: string;
  available_qty?: number;
}

export interface ProductionTaskRow {
  name: string;
  parent: string;
  task_name: string;
  greenhouse: string;
  section: string;
  target: number;
  status: 'Pending' | 'Done';
  assignee: string;
  assignee_name?: string;
  plan_period: string;
  completed_on?: string;
}

export interface ProductionPlanListEntry {
  name: string;
  plan_period: string;
  greenhouse: string;
}

export interface ActualHarvestRecord {
  name: string;
  greenhouse: string;
  variety: string;
  quantity: number;
  harvest_date: string;
}

export interface SamplingStageRow {
  growth_stage: string;
  count: number;
  days_to_harvest?: number;
}

export interface BedSamplingPayload {
  greenhouse: string;
  variety?: string;
  crop_cycle?: string;
  bed_number?: number;
  sampling_date: string;
  company?: string;
  notes?: string;
  stages: SamplingStageRow[];
}

export interface BedSamplingListEntry {
  name: string;
  greenhouse: string;
  variety?: string;
  bed_number: number;
  sampling_date: string;
  total_stems_sampled: number;
  total_expected_harvest: number;
}
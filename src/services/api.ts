import {
  ShelveResponse,
  GradingResponse,
  HarvestResponse,
  ReceivingResponse,
  BucketTransferResponse,
  GreenhousesResponse,
  RoseItemsResponse,
  PackingResponse,
  QualityResponse,
  QualitySection,
  QuarantineAction,
  GradingDashboardData,
  BucketBalance,
  RejectResponse,
  CreateBoxesForOplResponse,
  AddBunchResponse,
  OpenBoxResponse,
  ListOpenOplsResponse,
  PackBunchToOplResponse,
  PackableVarietiesResponse,
  StorageBoxSealResponse,
  LongStorageData,
  ScanResolveResponse,
  BouquetRecipe,
  BouquetSubmissionPayload,
  BouquetSubmissionResponse,
  XfloraOplHeader,
  XfloraPackPayload,
  XfloraPackResponse,
  ProductionPlanListEntry,
  ProductionPlanDay,
  ProductionPlanTask,
  ActualHarvestRecord,
  BedSamplingPayload,
  DiscardColdstore,
  DiscardRequestSummary,
  DiscardConsumeResponse,
  BedSamplingListEntry,
  ProductionTaskRow,
  CropCycleSummary,
  CropCycleUprootPayload,
  CropCycleReplantPayload,
  SeedlingRequestPayload,
  SeedlingRequestListEntry,
  SeedlingDispatchPayload,
  PropagationBatchSummary,
} from '../types';
import { getApiUrl, getSid, getCsrfToken, setSid, setCsrfToken } from '../database/settings';
import { cachedCredentials } from './auth';

// ── Diagnostics ring buffer ─────────────────────────────────────────────────
// Records the last N API calls for the Support modal. Tamper-proof: lives in
// process memory, not user-editable.

export interface ApiCallTrace {
  ts: string;
  method: string;
  status: number;
  durationMs: number;
  error?: string;
}

const TRACE_CAP = 15;
const apiTraces: ApiCallTrace[] = [];

function pushTrace(trace: ApiCallTrace) {
  apiTraces.push(trace);
  if (apiTraces.length > TRACE_CAP) apiTraces.shift();
}

export function getApiTraces(): ApiCallTrace[] {
  return apiTraces.slice();
}
import { notifyNetworkError, notifyNetworkSuccess } from '../hooks/useNetworkStatus';

// Module-level bridge — AppContext registers a logout callback here so that
// apiPost can trigger it when the server returns 401 (expired/invalid session).
// This handles the case where the server URL changes and the stored sid is no
// longer valid on the new instance.
let _onAuthFailure: (() => void) | null = null;

export function registerAuthFailureHandler(fn: () => void): void {
  _onAuthFailure = fn;
}

interface LoginResponse {
  message: string;
  full_name: string;
  sid: string;
  user: string;
  csrf_token: string;
}

// Frappe puts validation messages (from frappe.throw) in `_server_messages` as
// a JSON-encoded list of JSON-encoded objects. Without parsing this, every
// validation error reaches the UI as just "Request failed: 417".
function extractFrappeError(body: any): string {
  if (!body || typeof body !== 'object') return '';

  const raw = body._server_messages;
  if (typeof raw === 'string' && raw.length) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        const first = typeof list[0] === 'string' ? JSON.parse(list[0]) : list[0];
        const msg = first?.message;
        if (typeof msg === 'string' && msg.trim()) {
          return msg.replace(/<[^>]+>/g, '').trim();
        }
      }
    } catch {
      // fall through
    }
  }

  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (typeof body.exception === 'string' && body.exception.trim()) return body.exception;
  if (typeof body.exc === 'string' && body.exc.trim()) return body.exc;
  return '';
}

async function apiPost<T>(endpoint: string, payload: object, _retry = false): Promise<T> {
  let baseUrl = await getApiUrl();
  if (!baseUrl) throw new Error('Server URL not configured — go to Settings');

  // Ensure protocol is present
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }
  // Remove trailing slash
  baseUrl = baseUrl.replace(/\/+$/, '');

  const url = `${baseUrl}/api/method/${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const [sid, csrfToken] = await Promise.all([getSid(), getCsrfToken()]);
  if (sid) {
    headers['Cookie'] = `sid=${sid}`;
  }
  if (csrfToken) {
    headers['X-Frappe-CSRF-Token'] = csrfToken;
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    // Fetch reached the server — clear any forced-offline state immediately.
    // This is what makes seamless reconnection work on Honeywell devices:
    // the OS may still say "connected" when it isn't, but a real successful
    // response is ground truth that we're back online.
    notifyNetworkSuccess();
  } catch (err: any) {
    // Network-level failure → count toward forced-offline threshold.
    // After 2 consecutive failures the app switches to offline mode without
    // waiting for the next poll, even if Android still reports isConnected=true.
    notifyNetworkError();
    pushTrace({
      ts: new Date().toISOString(),
      method: endpoint,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: err?.message || 'network failure',
    });
    throw err;
  }

  const body = await res.json().catch(() => ({}));

  // 401 means the session has expired or the server changed and the stored sid
  // is no longer valid. Try a silent re-login using stored credentials before
  // giving up — the user should not see a sign-in screen mid-shift.
  if (res.status === 401) {
    if (!_retry) {
      const reloggedIn = await trySilentRelogin();
      if (reloggedIn) {
        pushTrace({
          ts: new Date().toISOString(),
          method: endpoint,
          status: 401,
          durationMs: Date.now() - startedAt,
          error: 'session expired → silently re-logged in, retrying',
        });
        return apiPost<T>(endpoint, payload, true);
      }
    }
    pushTrace({
      ts: new Date().toISOString(),
      method: endpoint,
      status: 401,
      durationMs: Date.now() - startedAt,
      error: 'session expired (silent re-login failed)',
    });
    _onAuthFailure?.();
    throw new Error('Session expired — please log in again');
  }

  pushTrace({
    ts: new Date().toISOString(),
    method: endpoint,
    status: res.status,
    durationMs: Date.now() - startedAt,
    error: res.ok ? undefined : extractFrappeError(body) || `HTTP ${res.status}`,
  });

  if (!res.ok) {
    throw new Error(extractFrappeError(body) || `Request failed: ${res.status}`);
  }

  return body as T;
}

/**
 * Silent re-login: when a 401 lands mid-session, see if we have cached
 * credentials in memory (set on the last successful biometric unlock) and
 * call /api/method/login again to refresh the SID + CSRF.
 *
 * Returns true on success — the caller then retries the original request.
 * Never prompts the user. If no cached creds (or the call fails), returns
 * false and the caller surfaces the original 401 to the auth-failure handler.
 *
 * Guarded against concurrent calls: if a 401 storm hits, only one re-login
 * attempt runs at a time, the rest await its outcome.
 */
let _reloginInFlight: Promise<boolean> | null = null;

async function trySilentRelogin(): Promise<boolean> {
  if (_reloginInFlight) return _reloginInFlight;

  _reloginInFlight = (async () => {
    try {
      const creds = cachedCredentials();
      if (!creds) return false;
      const resp = await loginToServer(creds.serverUrl, creds.email, creds.password);
      await setSid(resp.sid);
      if (resp.csrf_token) await setCsrfToken(resp.csrf_token);
      return true;
    } catch {
      return false;
    } finally {
      // Clear after a tick so concurrent calls awaiting this promise see the result
      setTimeout(() => { _reloginInFlight = null; }, 0);
    }
  })();
  return _reloginInFlight;
}

export async function loginToServer(
  serverUrl: string,
  usr: string,
  pwd: string
): Promise<LoginResponse> {
  let baseUrl = serverUrl.trim().replace(/\/+$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const url = `${baseUrl}/api/method/login`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ usr, pwd }),
    });
  } catch (err: any) {
    throw new Error(
      `Cannot reach server: ${err.message}. Check the URL and your internet connection.`
    );
  }

  const text = await res.text();

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned invalid response (${res.status}). Check that the URL points to a valid Frappe/ERPNext instance.`
    );
  }

  if (res.status === 401 || body.http_status_code === 401) {
    throw new Error('Invalid username or password');
  }

  if (!res.ok || (body.http_status_code && body.http_status_code >= 400)) {
    const msg = body.message || body.error || body.exc || `Login failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  // Extract sid from Set-Cookie header or response body
  let sid = body.sid ?? '';
  if (!sid) {
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/sid=([^;]+)/);
    if (match) sid = match[1];
  }

  // Fetch CSRF token for the new session (required for all subsequent POST requests)
  let csrf_token = '';
  if (sid) {
    try {
      const csrfRes = await fetch(`${baseUrl}/api/method/frappe.auth.get_csrf_token`, {
        headers: { Cookie: `sid=${sid}`, Accept: 'application/json' },
      });
      const csrfBody = await csrfRes.json().catch(() => ({}));
      csrf_token = csrfBody.message ?? '';
    } catch {
      // Non-critical — requests may fail until the user re-logs in
    }
  }

  return {
    message: body.message,
    full_name: body.full_name || '',
    user: body.user || usr,
    sid,
    csrf_token,
  };
}

export async function submitShelve(
  shelfId: string,
  bucketId: string,
  farm: string,
  postingDate?: string,
  postingTime?: string
): Promise<ShelveResponse> {
  return apiPost<ShelveResponse>('shelving_entry', {
    shelf_id: shelfId,
    bucket_id: bucketId,
    farm,
    ...(postingDate && { posting_date: postingDate }),
    ...(postingTime && { posting_time: postingTime }),
  });
}

// ── Shelf Transfer (mobile ShelveScreen → Transfer tab) ────────────────────
// Moves a bucket between two physical shelves without touching stock; the
// server preserves variety/stem_length/qty/greenhouse/warehouse/date_added.

export interface BucketShelfLookup {
  bucket_id: string;
  shelf_id: string | null;
  variety?: string | null;
  stem_qty?: number;
}

export interface ShelfTransferResponse {
  status: 'ok' | 'noop';
  bucket_id: string;
  from_shelf: string | null;
  to_shelf: string;
  variety?: string | null;
  stem_qty?: number;
  message?: string;
}

export async function getBucketCurrentShelf(bucketId: string): Promise<BucketShelfLookup> {
  const res = await apiPost<any>('upande_harvest.api.get_bucket_current_shelf', { bucket_id: bucketId });
  const m: any = (res as any).message ?? res;
  return {
    bucket_id: m?.bucket_id ?? bucketId,
    shelf_id:  m?.shelf_id ?? null,
    variety:   m?.variety ?? null,
    stem_qty:  Number(m?.stem_qty ?? 0),
  };
}

export async function transferBucketBetweenShelves(
  bucketId: string,
  toShelf: string,
): Promise<ShelfTransferResponse> {
  const res = await apiPost<any>('upande_harvest.api.transfer_bucket_between_shelves', {
    bucket_id: bucketId,
    to_shelf:  toShelf,
  });
  const m: any = (res as any).message ?? res;
  return m as ShelfTransferResponse;
}

export async function submitGrading(
  gradingData: {
    bunch_id: string;
    grader: string;
    bucket_id: string;
    farm: string;
    bunch_size?: string;
    stem_length?: string;
    qty?: number;
    variety?: string;
    posting_date?: string;
    posting_time?: string;
  }
): Promise<GradingResponse> {
  return serializedByKey('grading', () =>
    apiPost<GradingResponse>('mobile_grading_entry', gradingData)
  );
}

// Reads bunch_size and stem_length straight off the Bunch QR Code record
// in ERP, so the client doesn't have to hardcode "Size 7" / "45".
export async function getBunchInfo(
  bunchId: string
): Promise<{ bunch_size: string; stem_length: string; item_code: string }> {
  const res = await apiPost<{ message?: Record<string, any> }>(
    'frappe.client.get_value',
    {
      doctype: 'Bunch QR Code',
      filters: { name: bunchId },
      fieldname: ['bunch_size', 'stem_length', 'item_code'],
    }
  );
  const m = res.message || {};
  return {
    bunch_size: m.bunch_size ?? '',
    stem_length: m.stem_length ?? '',
    item_code: m.item_code ?? '',
  };
}

// ── Per-key serialization for scan-driven submissions ──────────────────────
// Slow networks + rapid scanning can let request N+1 land at the server
// before request N's ACK arrives. For Stock-Entry writes (harvest, receiving,
// grading) that can corrupt bucket state. We serialize by key — same-key
// calls queue and run one at a time, so the next scan only fires after the
// previous one has been acknowledged (or failed). Different keys run in
// parallel as before.
const __inflight = new Map<string, Promise<unknown>>();

async function serializedByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = __inflight.get(key);
  if (prev) {
    try { await prev; } catch { /* swallow — we still want to try our own call */ }
  }
  const cur = fn();
  __inflight.set(key, cur);
  try {
    return await cur;
  } finally {
    if (__inflight.get(key) === cur) __inflight.delete(key);
  }
}

export async function submitHarvest(
  itemCode: string,
  quantity: number,
  section: string,
  harvester: string,
  bucketId: string,
  farm: string,
  greenhouse: string,
  postingDate?: string,
  postingTime?: string
): Promise<HarvestResponse> {
  // Serialize all harvest submissions: each scan waits for the previous
  // ACK before the next goes out. Prevents reorder-on-slow-network without
  // surfacing concurrency to the screen.
  return serializedByKey('harvest', () =>
    apiPost<HarvestResponse>('createHarvestEntry', {
      item_code: itemCode,
      quantity,
      section,
      harvester,
      bucket_id: bucketId,
      farm,
      greenhouse,
      ...(postingDate && { posting_date: postingDate }),
      ...(postingTime && { posting_time: postingTime }),
    })
  );
}

export async function submitReceiving(
  bucketId: string,
  postingDate?: string,
  postingTime?: string
): Promise<ReceivingResponse> {
  return serializedByKey('receiving', () =>
    apiPost<ReceivingResponse>('receiving_entry', {
      bucket_id: bucketId,
      ...(postingDate && { posting_date: postingDate }),
      ...(postingTime && { posting_time: postingTime }),
    })
  );
}

export async function cancelHarvestEntry(stockEntry: string): Promise<{
  stock_entry: string;
  bucket_id?: string;
  bucket_status?: string;
  message: string;
}> {
  return apiPost('cancel_harvest_entry', { stock_entry: stockEntry });
}

export async function submitBucketTransfer(
  sourceBucketId: string,
  destinationBucketId: string
): Promise<BucketTransferResponse> {
  return apiPost<BucketTransferResponse>('transfer_bucket', {
    source_bucket_id: sourceBucketId,
    destination_bucket_id: destinationBucketId,
  });
}

export async function fetchGreenhouses(): Promise<GreenhousesResponse> {
  return apiPost<GreenhousesResponse>('getGreenhouses', {});
}

export async function fetchVarieties(): Promise<RoseItemsResponse> {
  return apiPost<RoseItemsResponse>('getVarieties', {});
}

export async function createBoxesForOpl(opl: string): Promise<CreateBoxesForOplResponse> {
  return apiPost<CreateBoxesForOplResponse>('create_boxes_for_opl', { opl });
}

export async function addBunchToBoxApi(params: {
  bunch_id: string;
  box_id?: string;
  opl?: string;
  farm?: string;
}): Promise<AddBunchResponse> {
  return apiPost<AddBunchResponse>('add_bunch_to_box', params);
}

export async function closePackBox(boxName: string): Promise<PackingResponse> {
  return apiPost<PackingResponse>('close_pack_box', { box_name: boxName });
}

export async function getOpenBoxForOpl(opl: string): Promise<OpenBoxResponse> {
  return apiPost<OpenBoxResponse>('get_open_box_for_opl', { opl });
}

export async function listOpenOplsForPacking(params?: {
  from_date?: string;
  to_date?: string;
}): Promise<ListOpenOplsResponse> {
  return apiPost<ListOpenOplsResponse>('list_open_opls_for_packing', params || {});
}

export async function packBunchToOpl(params: {
  opl: string;
  bunch_id: string;
}): Promise<PackBunchToOplResponse> {
  return apiPost<PackBunchToOplResponse>('pack_bunch_to_opl', params);
}

export async function fetchPackableVarieties(): Promise<PackableVarietiesResponse> {
  return apiPost<PackableVarietiesResponse>('get_packable_varieties', {});
}

// ── Long Storage ────────────────────────────────────────────────────────────
export async function scanBucketIntoStorageBox(params: {
  box_id: string;
  bucket_id: string;
  farm?: string;
  warehouse?: string;
}): Promise<StorageBoxSealResponse> {
  return apiPost<StorageBoxSealResponse>('scan_bucket_into_storage_box', params);
}

export async function getLongStorageData(farm?: string): Promise<LongStorageData> {
  return apiPost<LongStorageData>('get_long_storage_data', farm ? { farm } : {});
}

export async function resolveScanSource(scan: string): Promise<ScanResolveResponse> {
  return apiPost<ScanResolveResponse>('resolve_scan_source', { scan });
}

export interface MixRecipeItem {
  item_code: string;
  item_name: string;
  target_stems: number;
  packed_stems: number;
  remaining: number;
  done: boolean;
}

export interface PackBoxRecipe {
  pack_box: string;
  box_id: string;
  box_type: string | null;
  pack_rate: number;
  sales_order: string | null;
  customer: string | null;
  is_mix_box: boolean;
  recipe: MixRecipeItem[];
  total_packed: number;
}

export async function getPackBoxRecipe(packBox: string): Promise<PackBoxRecipe> {
  return apiPost<PackBoxRecipe>(
    'upande_harvest.upande_harvest.doctype.pack_box.pack_box.get_pack_box_recipe',
    { pack_box: packBox },
  );
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export interface FplPreviewItem {
  item_code: string;
  qty: number;
  boxes: number;
}

export interface FplPreview {
  fpl: string;
  sales_order: string | null;
  customer: string | null;
  company: string | null;
  delivery_point: string;
  shipping_address_display: string;
  already_dispatched: boolean;
  existing_dn: string;
  items: FplPreviewItem[];
  total_stems: number;
  total_boxes: number;
}

export interface DispatchResult {
  delivery_note: string;
  fpl: string;
  sales_order: string;
  customer: string;
  total_qty: number;
  line_count: number;
}

export async function getFplPreview(fpl: string): Promise<FplPreview> {
  return apiPost<FplPreview>('upande_harvest.api.get_fpl_preview', { fpl });
}

export async function createDeliveryNoteFromFpl(params: {
  fpl: string;
  driver_name: string;
  truck_reg: string;
  posting_date?: string;
}): Promise<DispatchResult> {
  return apiPost<DispatchResult>('upande_harvest.api.create_delivery_note_from_fpl', params);
}

export async function submitActualHarvest(
  greenhouse: string,
  variety: string,
  quantity: number,
  harvest_date: string,
  notes: string,
  farm: string
): Promise<{ message: string }> {
  return apiPost<{ message: string }>('submit_actual_harvest', {
    greenhouse,
    variety,
    quantity,
    harvest_date,
    notes,
    farm,
  });
}

export async function fetchGradingDashboard(fromDate?: string, toDate?: string): Promise<GradingDashboardData> {
  return apiPost<GradingDashboardData>('get_grading_dashboard_data', { from_date: fromDate, to_date: toDate });
}

export async function fetchDashboardData(fromDate?: string, toDate?: string): Promise<any> {
  // Use the extended endpoint that also returns per-greenhouse received/rejects/varieties
  // and actual_harvest. Falls back to the legacy endpoint if not deployed.
  try {
    return await apiPost<any>('get_dashboard_data_full', {
      from_date: fromDate,
      to_date: toDate,
    });
  } catch {
    return apiPost<any>('get_dashboard_data', {
      from_date: fromDate,
      to_date: toDate,
    });
  }
}

export async function fetchShelvesDashboard(): Promise<any> {
  return apiPost<any>('get_shelving_dashboard_data', {});
}

export async function fetchFarms(): Promise<{ farms: { name: string; farm_name: string; company: string }[] }> {
  return apiPost<any>('get_farms', {});
}

export async function getBucketBalance(bucketId: string): Promise<BucketBalance> {
  return apiPost<BucketBalance>('get_bucket_balance', { bucket_id: bucketId });
}

export async function submitBucketReject(
  bucketId: string,
  grader: string,
  rejects: number,
  farm: string,
  reason: string = ''
): Promise<RejectResponse> {
  return apiPost<RejectResponse>('submit_bucket_reject', {
    bucket_id: bucketId,
    grader,
    rejects,
    farm,
    reason,
  });
}

export type StorageMode = 'Shelving' | 'Zoning' | 'Direct-to-Grader';

export interface ReceivingOutResponse {
  message: string;
  receiving_out?: string;
  bucket_id?: string;
  variety?: string;
  remaining_qty?: number;
  http_status_code?: number;
  // Set when the grader already holds a different open bucket. The mobile UI
  // must prompt the operator to either close-and-replace ('reject') or
  // abort the new scan ('cancel') and re-submit with `confirm` set.
  needs_confirmation?: boolean;
  prior_receiving_out?: string;
  prior_bucket_id?: string;
  prior_variety?: string;
  prior_remaining_qty?: number;
  requested_bucket_id?: string;
  cancelled?: boolean;
  // Same grader scans the SAME bucket they already hold — no-op, neutral feedback.
  already_open?: boolean;
  // Set when the RO was opened by scanning a Long Storage (STG-*) label —
  // the server resolved the box's source_bucket and stamped from_storage_box
  // on the RO. Mobile uses this for a "From: STG-*" indicator.
  from_storage_box?: string | null;
}

// ── Issuing ────────────────────────────────────────────────────────────────
// Pickers pull buckets off cold-store shelves against today's OPLs. Variety
// list at the top, drill into a variety, scan each pre-assigned bucket.
// Each scan clears the Shelf Item rows for that bucket and marks the matching
// Pick List Item picked. See upande_harvest.api.{get_issuing_varieties,
// get_issuing_buckets, issue_bucket}.

export interface IssuingVariety {
  variety: string;
  stems_owed: number;
  bucket_count: number;
  opl_count: number;
}

export interface IssuingBucket {
  pli_name: string;
  opl_name: string;
  bucket_id: string;
  stem_length: string | null;
  qty: number;
  picked_qty: number;
  customer: string | null;
  customer_name: string | null;
  shelf_id: string | null;
}

export interface IssuingOpl {
  customer: string | null;
  customer_name: string | null;
  opl_names: string[];
  opl_count: number;
  opl_name: string | null;   // first OPL in the group, for back-compat
  stems_owed: number;
  bucket_count: number;
}

export interface SkipBucketResponse {
  status: 'ok' | 'no_replacement';
  skipped_bucket: string;
  pli: string;
  opl: string;
  variety: string;
  customer?: string | null;
  message?: string;
  replacement?: IssuingBucket;
}

export interface IssueBucketResponse {
  status: 'ok';
  bucket_id: string;
  pli: string;
  opl: string;
  variety: string;
  qty: number;
  customer: string | null;
  shelves_cleared: number;
}

export async function getIssuingVarieties(): Promise<{ varieties: IssuingVariety[] }> {
  const res = await apiPost<{ message?: { varieties?: IssuingVariety[] } } & {
    varieties?: IssuingVariety[];
  }>('upande_harvest.api.get_issuing_varieties', {});
  const m: any = (res as any).message ?? res;
  return { varieties: m?.varieties ?? [] };
}

export async function getIssuingBuckets(
  variety: string,
  opl?: string,
  customer?: string,
): Promise<{ variety: string; opl: string | null; customer: string | null; buckets: IssuingBucket[] }> {
  const args: any = { variety };
  if (opl) args.opl = opl;
  else if (customer) args.customer = customer;
  const res = await apiPost<any>('upande_harvest.api.get_issuing_buckets', args);
  const m: any = (res as any).message ?? res;
  return {
    variety:  m?.variety ?? variety,
    opl:      m?.opl ?? null,
    customer: m?.customer ?? null,
    buckets:  m?.buckets ?? [],
  };
}

export async function getIssuingOpls(variety: string): Promise<{ variety: string; opls: IssuingOpl[] }> {
  const res = await apiPost<any>('upande_harvest.api.get_issuing_opls', { variety });
  const m: any = (res as any).message ?? res;
  return { variety: m?.variety ?? variety, opls: m?.opls ?? [] };
}

export async function issueBucket(bucketId: string): Promise<IssueBucketResponse> {
  return serializedByKey('issuing', async () => {
    const res = await apiPost<any>('upande_harvest.api.issue_bucket', { bucket_id: bucketId });
    const m: any = (res as any).message ?? res;
    return m as IssueBucketResponse;
  });
}

export async function skipBucket(bucketId: string, reason?: string): Promise<SkipBucketResponse> {
  return serializedByKey('issuing', async () => {
    const res = await apiPost<any>('upande_harvest.api.skip_bucket', {
      bucket_id: bucketId,
      ...(reason ? { reason } : {}),
    });
    const m: any = (res as any).message ?? res;
    return m as SkipBucketResponse;
  });
}

// Reads storage_mode via a public whitelisted helper. We can't use
// frappe.client.get_value here because Upande Harvest Config is
// System-Manager-read-only — grader/scanner users would get 403 and the
// app would silently fall back to "Shelving", hiding Direct-to-Grader.
export async function getStorageMode(): Promise<StorageMode> {
  const res = await apiPost<{ message?: { storage_mode?: string } | string }>(
    'upande_harvest.api.get_storage_mode',
    {}
  );
  const m = (res as any).message ?? {};
  const v = typeof m === 'string' ? m : (m.storage_mode ?? 'Shelving');
  return (v || 'Shelving') as StorageMode;
}

export async function submitReceivingOut(
  bucketId: string,
  grader: string,
  farm: string,
  confirm?: 'reject' | 'cancel'
): Promise<ReceivingOutResponse> {
  return serializedByKey('receiving_out', () =>
    apiPost<ReceivingOutResponse>('receiving_out_entry', {
      bucket_id: bucketId,
      grader,
      farm,
      ...(confirm ? { confirm } : {}),
    })
  );
}

export interface GraderOpenBucket {
  open: boolean;
  receiving_out?: string;
  bucket_id?: string;
  variety?: string;
  initial_qty?: number;
  remaining_qty?: number;
  opened_at?: string;
}

/**
 * Direct-to-Grader: resolve which bucket a given grader is currently holding.
 * Returns { open: false } when the grader has no open Receiving Out — caller
 * decides whether that's an error (grading flow) or a no-op (display).
 */
export async function getGraderOpenBucket(grader: string): Promise<GraderOpenBucket> {
  const res = await apiPost<{ message?: GraderOpenBucket } | GraderOpenBucket>(
    'upande_harvest.api.get_grader_open_bucket',
    { grader }
  );
  const m: any = (res as any).message ?? res;
  return {
    open:           Boolean(m?.open),
    receiving_out:  m?.receiving_out,
    bucket_id:      m?.bucket_id,
    variety:        m?.variety,
    initial_qty:    m?.initial_qty,
    remaining_qty:  m?.remaining_qty,
    opened_at:      m?.opened_at,
  };
}

export interface ReceivingOutEntry {
  name: string;
  bucket_id: string;
  grader: string;
  grader_name?: string;
  variety?: string;
  initial_qty?: number;
  remaining_qty?: number;
  leftover_qty?: number;
  opened_at?: string;
  closed_at?: string | null;
  closed_reason?: string | null;
}

export async function listRecentReceivingOuts(
  grader?: string,
  limit = 10,
): Promise<ReceivingOutEntry[]> {
  const res = await apiPost<any>('upande_harvest.api.list_recent_receiving_outs', {
    ...(grader ? { grader } : {}),
    limit,
  });
  const m: any = (res as any).message ?? res;
  return (m?.entries ?? []) as ReceivingOutEntry[];
}

export async function reopenReceivingOut(receivingOut: string): Promise<{
  ok: boolean;
  receiving_out: string;
  bucket_id: string;
  grader: string;
  variety?: string;
  remaining_qty: number;
}> {
  const res = await apiPost<any>('upande_harvest.api.reopen_receiving_out', {
    receiving_out: receivingOut,
  });
  return ((res as any).message ?? res) as any;
}

export async function returnBucket(receivingOut: string): Promise<{
  ok: boolean; receiving_out: string; leftover_qty: number;
}> {
  const res = await apiPost<any>('upande_harvest.api.return_bucket', {
    receiving_out: receivingOut,
  });
  return ((res as any).message ?? res) as any;
}

export async function finishBucket(receivingOut: string): Promise<{
  ok: boolean; receiving_out: string;
}> {
  const res = await apiPost<any>('upande_harvest.api.finish_bucket', {
    receiving_out: receivingOut,
  });
  return ((res as any).message ?? res) as any;
}

export async function transferBucket(
  receivingOut: string,
  newGrader: string,
): Promise<{
  ok: boolean;
  prior_ro: string;
  receiving_out: string;
  bucket_id: string;
  grader: string;
  remaining_qty: number;
}> {
  const res = await apiPost<any>('upande_harvest.api.transfer_bucket', {
    receiving_out: receivingOut,
    new_grader:    newGrader,
  });
  return ((res as any).message ?? res) as any;
}

export async function addReceivingOutNote(
  receivingOut: string,
  note: string,
): Promise<{ ok: boolean; receiving_out: string; notes: string }> {
  const res = await apiPost<any>('upande_harvest.api.add_receiving_out_note', {
    receiving_out: receivingOut,
    note,
  });
  return ((res as any).message ?? res) as any;
}

export async function fetchUserRoles(): Promise<{ roles: string[] }> {
  return apiPost<{ roles: string[] }>('get_user_roles', {});
}

export async function createQuarantineBatch(
  batchId: string,
  scope: string,
  greenhouse: string,
  bucketIds: string[],
  reason: string,
  notes: string,
): Promise<{ message: string; batch_id: string }> {
  return apiPost('create_quarantine_batch', {
    batch_id: batchId,
    scope,
    greenhouse,
    bucket_ids: bucketIds,
    reason,
    notes,
  });
}

export async function fetchQuarantineBatches(): Promise<{ batches: any[] }> {
  return apiPost('get_quarantine_batches', {});
}

export async function resolveQuarantineBatch(
  batchId: string,
  action: 'discard' | 'intake',
): Promise<{ message: string }> {
  return apiPost('resolve_quarantine_batch', { batch_id: batchId, action });
}

export async function fetchHarvesterStats(userEmail: string, date: string): Promise<any> {
  return apiPost<any>('get_harvester_stats', { user: userEmail, date });
}

export async function submitQualityEntry(
  section: QualitySection,
  refId: string,
  quantity: number,
  reason: string,
  notes: string,
  farm: string,
  greenhouse: string = '',
  variety: string = '',
  quarantined: boolean = false,
  quarantineAction: QuarantineAction = '',
  postingDate?: string,
  postingTime?: string
): Promise<QualityResponse> {
  return apiPost<QualityResponse>('create_quality_entry', {
    section,
    ref_id: refId,
    quantity,
    reason,
    notes,
    farm,
    greenhouse,
    variety,
    quarantined: quarantined ? 1 : 0,
    quarantine_action: quarantineAction,
    ...(postingDate && { posting_date: postingDate }),
    ...(postingTime && { posting_time: postingTime }),
  });
}

export async function addToPool(
  bucketId: string, variety: string, farm: string,
  grader: string, stems: number, bunchSize: number
): Promise<{ pool: string; pooled_stems: number; ready_to_grade: boolean }> {
  return apiPost('add_to_pool', { bucket_id: bucketId, variety, farm, grader, stems, bunch_size: bunchSize });
}

export async function submitIssue(
  subject: string,
  description: string
): Promise<{ message: string; issue: string; subject: string }> {
  return apiPost('submit_issue', { subject, description });
}

/**
 * Upload a local file (e.g. a screenshot captured on-device) and attach it
 * to a Frappe document — used to attach the support screenshot to the Issue
 * record after it's been created.
 *
 * Uses /api/method/upload_file (Frappe's standard endpoint) so it inherits
 * the session auth headers we already use elsewhere.
 */
export async function uploadAttachment(params: {
  fileUri: string;
  fileName: string;
  attachedTo: { doctype: string; name: string; field?: string };
  isPrivate?: boolean;
}): Promise<{ file_url: string; file_name: string } | null> {
  let baseUrl = await getApiUrl();
  if (!baseUrl) return null;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/api/method/upload_file`;

  const [sid, csrfToken] = await Promise.all([getSid(), getCsrfToken()]);

  // React Native FormData — Frappe expects the binary under "file"
  const form = new FormData();
  form.append('file', {
    uri: params.fileUri,
    name: params.fileName,
    type: 'image/png',
  } as any);
  form.append('doctype', params.attachedTo.doctype);
  form.append('docname', params.attachedTo.name);
  if (params.attachedTo.field) form.append('fieldname', params.attachedTo.field);
  form.append('is_private', params.isPrivate === false ? '0' : '1');

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (sid) headers['Cookie'] = `sid=${sid}`;
  if (csrfToken) headers['X-Frappe-CSRF-Token'] = csrfToken;

  try {
    const res = await fetch(url, { method: 'POST', headers, body: form });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body?.message || null;
  } catch {
    return null;
  }
}

export async function fetchUnreceivedBuckets(
  greenhouse: string, variety: string, fromDate?: string, toDate?: string
): Promise<import('../types').UnreceivedBucketsResponse> {
  return apiPost('get_unreceived_buckets', {
    greenhouse, variety,
    ...(fromDate && { from_date: fromDate }),
    ...(toDate && { to_date: toDate }),
  });
}

export async function getPoolStatus(
  variety: string, farm: string
): Promise<{ pool: string | null; pooled_stems: number; bunch_size: number; ready_to_grade: boolean; variety?: string }> {
  return apiPost('get_pool_status', { variety, farm });
}

export async function gradeFromPool(
  bunchId: string, grader: string, farm: string, variety: string
): Promise<{ stock_entry: string; pooled_stems: number; contributing_buckets: string[] }> {
  return apiPost('grade_from_pool', { bunch_id: bunchId, grader, farm, variety });
}

export async function getBouquetRecipeForBunch(bunchId: string): Promise<BouquetRecipe> {
  return apiPost<BouquetRecipe>(
    'upande_harvest.api.get_bouquet_recipe_for_bunch',
    { bunch_id: bunchId }
  );
}

export async function submitBouquetGrading(
  payload: BouquetSubmissionPayload
): Promise<BouquetSubmissionResponse> {
  return apiPost<BouquetSubmissionResponse>(
    'upande_harvest.api.submit_bouquet_grading',
    payload
  );
}

// ── Xflora-only packing endpoints ───────────────────────────────────────────
// Note: "Order Pick LIst" (capital L is intentional — that's the doctype name
// in upande_harvest, including in the xflora branch).
// The original upande_harvest doctype name carries a typo ("LIst"), but some
// deployments may have renamed it to the correctly-spelled "Order Pick List".
// Probe both so the lookup works either way. We use `frappe.client.get`
// (returns the whole doc) rather than `get_value` because some Frappe
// deployments restrict get_value to fields on a curated whitelist; .get only
// requires the standard read permission on the doctype itself.
const OPL_DOCTYPE_CANDIDATES = ['Order Pick LIst', 'Order Pick List'];

async function tryGetOplDoc(
  doctype: string,
  opl: string
): Promise<Record<string, any> | null> {
  try {
    const res = await apiPost<{ message?: Record<string, any> }>(
      'frappe.client.get',
      { doctype, name: opl }
    );
    const m = res.message || {};
    if (!m || !m.name) return null;
    return m;
  } catch {
    // 404 (doctype/name not found) or 403 — try the next candidate
    return null;
  }
}

export async function getXfloraOplHeader(opl: string): Promise<XfloraOplHeader> {
  let m: Record<string, any> | null = null;
  for (const dt of OPL_DOCTYPE_CANDIDATES) {
    m = await tryGetOplDoc(dt, opl);
    if (m) break;
  }
  if (!m) {
    throw new Error(`OPL ${opl} not found or no read access`);
  }
  return {
    opl: m.name ?? opl,
    sales_order: m.sales_order ?? '',
    customer: m.customer ?? '',
    farm: m.farm_code ?? m.farm ?? '',
  };
}

export async function submitXfloraPackList(
  payload: XfloraPackPayload
): Promise<XfloraPackResponse> {
  return apiPost<XfloraPackResponse>('createOrUpdateFarmPackList', payload);
}

// ── Agriculture — Production Planning ─────────────────────────────────────
// Production Tracking = the existing Actual Harvest flow (same workflow).
// Plans are weekly targets per greenhouse per day, optionally per variety.

export interface ProductionPlanInput {
  company?: string;
  plan_period: string;
  greenhouse: string;
  days: ProductionPlanDay[];
  tasks?: ProductionPlanTask[];
}

export async function createProductionPlanForm(
  payload: ProductionPlanInput
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    {
      doc: {
        doctype: 'Production Plan Form',
        plan_period: payload.plan_period,
        greenhouse: payload.greenhouse,
        ...(payload.company && { company: payload.company }),
        days: payload.days,
        tasks: payload.tasks ?? [],
      },
    }
  );
  return { name: res.message?.name ?? '' };
}

export async function listProductionPlanForms(
  greenhouse?: string,
  limit: number = 20
): Promise<ProductionPlanListEntry[]> {
  const filters: any[] = [];
  if (greenhouse) filters.push(['greenhouse', '=', greenhouse]);
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Production Plan Form',
    fields: ['name', 'plan_period', 'greenhouse'],
    filters,
    order_by: 'creation desc',
    limit_page_length: limit,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    plan_period: String(r.plan_period ?? ''),
    greenhouse: String(r.greenhouse ?? ''),
  }));
}

export async function getProductionPlanForm(
  name: string
): Promise<{ name: string; plan_period: string; greenhouse: string; days: ProductionPlanDay[]; tasks: ProductionPlanTask[] }> {
  const res = await apiPost<{ message?: Record<string, any> }>(
    'frappe.client.get',
    { doctype: 'Production Plan Form', name }
  );
  const m = res.message || {};
  return {
    name: String(m.name ?? name),
    plan_period: String(m.plan_period ?? ''),
    greenhouse: String(m.greenhouse ?? ''),
    days: Array.isArray(m.days) ? m.days.map((d: any) => ({
      plan_date: String(d.plan_date ?? ''),
      target_stems: Number(d.target_stems ?? 0),
      variety: d.variety ? String(d.variety) : undefined,
    })) : [],
    tasks: Array.isArray(m.tasks) ? m.tasks.map((t: any) => ({
      task_name: String(t.task_name ?? ''),
      greenhouse: t.greenhouse ? String(t.greenhouse) : undefined,
      section: t.section ? String(t.section) : undefined,
      target: t.target != null ? Number(t.target) : undefined,
    })) : [],
  };
}

export async function createBedSamplingForm(
  payload: BedSamplingPayload
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    { doc: { doctype: 'Bed Sampling Form', ...payload } }
  );
  return { name: res.message?.name ?? '' };
}

export async function listBedSamplingForms(
  greenhouse?: string,
  limit: number = 20
): Promise<BedSamplingListEntry[]> {
  const filters: any[] = [];
  if (greenhouse) filters.push(['greenhouse', '=', greenhouse]);
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Bed Sampling Form',
    fields: [
      'name', 'greenhouse', 'variety', 'bed_number',
      'sampling_date', 'total_stems_sampled', 'total_expected_harvest',
    ],
    filters,
    order_by: 'sampling_date desc',
    limit_page_length: limit,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    greenhouse: String(r.greenhouse ?? ''),
    variety: r.variety ? String(r.variety) : undefined,
    bed_number: Number(r.bed_number ?? 0),
    sampling_date: String(r.sampling_date ?? ''),
    total_stems_sampled: Number(r.total_stems_sampled ?? 0),
    total_expected_harvest: Number(r.total_expected_harvest ?? 0),
  }));
}

export async function listProductionTasks(
  planPeriod?: string,
  assignee?: string,
  greenhouse?: string
): Promise<ProductionTaskRow[]> {
  const planFilters: any[] = [];
  if (planPeriod) planFilters.push(['plan_period', '=', planPeriod]);
  if (greenhouse) planFilters.push(['greenhouse', '=', greenhouse]);
  const planRes = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Production Plan Form',
    fields: ['name', 'plan_period'],
    filters: planFilters,
    limit_page_length: 200,
  });
  const planRows = Array.isArray(planRes.message) ? planRes.message : [];
  if (planRows.length === 0) return [];

  // Frappe restricts direct queries on child doctypes; fetch each parent plan
  // and pull tasks out of the embedded child array. Done in parallel.
  const fullPlans = await Promise.all(
    planRows.map(async (p: any) => {
      try {
        const docRes = await apiPost<{ message?: Record<string, any> }>(
          'frappe.client.get',
          { doctype: 'Production Plan Form', name: String(p.name) }
        );
        return {
          name: String(p.name),
          plan_period: String(p.plan_period ?? ''),
          tasks: Array.isArray(docRes.message?.tasks) ? docRes.message!.tasks : [],
        };
      } catch {
        return { name: String(p.name), plan_period: String(p.plan_period ?? ''), tasks: [] };
      }
    })
  );

  const allTasks: ProductionTaskRow[] = [];
  const employeeNames = new Set<string>();
  for (const plan of fullPlans) {
    for (const t of plan.tasks as any[]) {
      if (assignee && t.assignee !== assignee) continue;
      if (greenhouse && t.greenhouse && t.greenhouse !== greenhouse) continue;
      if (t.assignee) employeeNames.add(String(t.assignee));
      allTasks.push({
        name: String(t.name ?? ''),
        parent: plan.name,
        task_name: String(t.task_name ?? ''),
        greenhouse: String(t.greenhouse ?? ''),
        section: String(t.section ?? ''),
        target: Number(t.target ?? 0),
        status: (t.status === 'Done' ? 'Done' : 'Pending') as 'Pending' | 'Done',
        assignee: String(t.assignee ?? ''),
        plan_period: plan.plan_period,
        completed_on: t.completed_on ? String(t.completed_on) : undefined,
      });
    }
  }

  if (employeeNames.size > 0) {
    try {
      const empRes = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
        doctype: 'Employee',
        fields: ['name', 'employee_name'],
        filters: [['name', 'in', Array.from(employeeNames)]],
        limit_page_length: 500,
      });
      const emps = Array.isArray(empRes.message) ? empRes.message : [];
      const employeeMap = new Map(emps.map((e: any) => [String(e.name), String(e.employee_name ?? '')]));
      for (const t of allTasks) {
        if (t.assignee) t.assignee_name = employeeMap.get(t.assignee);
      }
    } catch {}
  }

  return allTasks;
}

export async function setProductionTaskStatus(
  taskName: string,
  status: 'Pending' | 'Done'
): Promise<void> {
  await apiPost<any>('frappe.client.set_value', {
    doctype: 'Production Plan Task',
    name: taskName,
    fieldname: {
      status,
      completed_on: status === 'Done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    },
  });
}

export async function getEmployeeForUser(
  userEmail: string
): Promise<{ name: string; employee_name: string } | null> {
  try {
    const res = await apiPost<{ message?: Record<string, any> }>(
      'frappe.client.get_value',
      {
        doctype: 'Employee',
        filters: { user_id: userEmail },
        fieldname: ['name', 'employee_name'],
      }
    );
    const m = res.message || {};
    if (!m.name) return null;
    return { name: String(m.name), employee_name: String(m.employee_name ?? '') };
  } catch {
    return null;
  }
}

// ── Crop Cycle, Uproot, Replant ───────────────────────────────────────────

export async function listActiveCropCycles(
  greenhouse?: string,
  limit: number = 100
): Promise<CropCycleSummary[]> {
  const filters: any[] = [['cycle_status', 'in', ['Active', 'Planned', 'Replanting', 'Partially Uprooted']]];
  if (greenhouse) filters.push(['greenhouse', '=', greenhouse]);
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Crop Cycle',
    fields: [
      'name', 'greenhouse', 'variety', 'cycle_status', 'planting_date',
      'current_live_plants', 'custom_total_stems_harvested', 'custom_mortality_rate_pct',
    ],
    filters,
    order_by: 'planting_date desc',
    limit_page_length: limit,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    greenhouse: String(r.greenhouse ?? ''),
    variety: r.variety ? String(r.variety) : undefined,
    cycle_status: String(r.cycle_status ?? ''),
    planting_date: r.planting_date ? String(r.planting_date) : undefined,
    current_live_plants: Number(r.current_live_plants ?? 0),
    total_stems_harvested: Number(r.custom_total_stems_harvested ?? 0),
    mortality_rate_pct: r.custom_mortality_rate_pct != null
      ? Number(r.custom_mortality_rate_pct)
      : undefined,
  }));
}

export async function createCropCycleUproot(
  payload: CropCycleUprootPayload
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    { doc: { doctype: 'Crop Cycle Uproot', ...payload } }
  );
  return { name: res.message?.name ?? '' };
}

export async function createCropCycleReplant(
  payload: CropCycleReplantPayload
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    { doc: { doctype: 'Crop Cycle Replant', ...payload } }
  );
  return { name: res.message?.name ?? '' };
}

// ── Seedlings ─────────────────────────────────────────────────────────────

export async function createSeedlingRequest(
  payload: SeedlingRequestPayload
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    { doc: { doctype: 'Seedling Request', status: 'Open', ...payload } }
  );
  return { name: res.message?.name ?? '' };
}

export async function listSeedlingRequests(
  limit: number = 30
): Promise<SeedlingRequestListEntry[]> {
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Seedling Request',
    fields: [
      'name', 'variety', 'qty_requested', 'required_by_date',
      'status', 'total_dispatched',
    ],
    order_by: 'creation desc',
    limit_page_length: limit,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    variety: String(r.variety ?? ''),
    qty_requested: Number(r.qty_requested ?? 0),
    required_by_date: r.required_by_date ? String(r.required_by_date) : undefined,
    status: String(r.status ?? 'Open'),
    total_dispatched: Number(r.total_dispatched ?? 0),
  }));
}

export async function listPropagationBatches(
  limit: number = 100
): Promise<PropagationBatchSummary[]> {
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Propagation Batch',
    fields: ['name', 'variety', 'available_qty'],
    order_by: 'creation desc',
    limit_page_length: limit,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    variety: r.variety ? String(r.variety) : undefined,
    available_qty: r.available_qty != null ? Number(r.available_qty) : undefined,
  }));
}

export async function createSeedlingDispatch(
  payload: SeedlingDispatchPayload
): Promise<{ name: string }> {
  const res = await apiPost<{ message?: { name?: string } }>(
    'frappe.client.insert',
    { doc: { doctype: 'Seedling Dispatch', ...payload } }
  );
  const name = res.message?.name ?? '';
  if (name) {
    try {
      await apiPost('frappe.client.submit', {
        doc: { doctype: 'Seedling Dispatch', name },
      });
    } catch {}
  }
  return { name };
}

export async function listActualHarvest(
  fromDate: string,
  toDate: string,
  greenhouse?: string
): Promise<ActualHarvestRecord[]> {
  const filters: any[] = [
    ['harvest_date', '>=', fromDate],
    ['harvest_date', '<=', toDate],
  ];
  if (greenhouse) filters.push(['greenhouse', '=', greenhouse]);
  const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
    doctype: 'Actual Harvest',
    fields: ['name', 'greenhouse', 'variety', 'quantity', 'harvest_date'],
    filters,
    order_by: 'harvest_date asc',
    limit_page_length: 1000,
  });
  const rows = Array.isArray(res.message) ? res.message : [];
  return rows.map((r: any) => ({
    name: String(r.name ?? ''),
    greenhouse: String(r.greenhouse ?? ''),
    variety: String(r.variety ?? ''),
    quantity: Number(r.quantity ?? 0),
    harvest_date: String(r.harvest_date ?? ''),
  }));
}

export async function listXfloraOpls(
  limit: number = 100
): Promise<{ name: string; customer: string }[]> {
  for (const dt of OPL_DOCTYPE_CANDIDATES) {
    try {
      const res = await apiPost<{ message?: any[] }>('frappe.client.get_list', {
        doctype: dt,
        fields: ['name', 'customer'],
        filters: [['docstatus', '=', 1]],
        order_by: 'creation desc',
        limit_page_length: limit,
      });
      const rows = res.message;
      if (Array.isArray(rows)) {
        return rows.map((r: any) => ({
          name: String(r.name ?? ''),
          customer: String(r.customer ?? ''),
        })).filter((r) => r.name);
      }
    } catch {
      // try next doctype candidate
    }
  }
  return [];
}

// ── Support chat ───────────────────────────────────────────────────────────

export interface SupportContact {
  name: string;
  full_name: string;
  enabled: number;
  mobile_no?: string | null;
  phone?: string | null;
}

export interface SupportThread {
  name: string;
  participant_a: string;
  participant_b: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  other_user: string;
  other_full_name: string;
  other_mobile_no?: string | null;
  other_phone?: string | null;
  unread_count: number;
}

export interface SupportMessage {
  name: string;
  sender: string;
  sent_at: string;
  text: string;
  read_by_recipient: number;
}

// Whitelisted Python functions in upande_harvest.api wrap their return value
// in `{ message: ... }` — apiPost returns the raw body, so we need to unwrap
// `.message` ourselves. This helper does that defensively: if a response is
// already flat (no `.message`), it passes through unchanged.
function unwrapFrappeMessage<T>(resp: any): T {
  if (resp && typeof resp === 'object' && 'message' in resp && resp.message !== undefined) {
    return resp.message as T;
  }
  return resp as T;
}

export async function listSupportContacts(): Promise<{ contacts: SupportContact[] }> {
  const resp = await apiPost<any>('upande_harvest.api.list_support_contacts', {});
  return unwrapFrappeMessage<{ contacts: SupportContact[] }>(resp);
}

export async function openSupportThread(with_user: string): Promise<{
  thread: string;
  participant_a: string;
  participant_b: string;
  last_message_at: string | null;
}> {
  const resp = await apiPost<any>('upande_harvest.api.open_thread', { with_user });
  return unwrapFrappeMessage(resp);
}

export async function sendSupportMessage(thread: string, text: string): Promise<{
  name: string;
  sent_at: string;
}> {
  const resp = await apiPost<any>('upande_harvest.api.send_message', { thread, text });
  return unwrapFrappeMessage(resp);
}

export async function pollSupportMessages(thread: string, since?: string): Promise<{
  messages: SupportMessage[];
}> {
  const resp = await apiPost<any>('upande_harvest.api.poll_messages',
    since ? { thread, since } : { thread });
  return unwrapFrappeMessage<{ messages: SupportMessage[] }>(resp);
}

export async function getMySupportThreads(): Promise<{ threads: SupportThread[] }> {
  const resp = await apiPost<any>('upande_harvest.api.get_my_threads', {});
  return unwrapFrappeMessage<{ threads: SupportThread[] }>(resp);
}

// ── Discard Request ─────────────────────────────────────────────────────────
// Approved-and-incomplete requests power the picker; consumeDiscardRequest
// applies one scan against the chosen request. Both calls live in
// upande_harvest.discard_api.

export async function getOpenDiscardRequests(
  coldstore: DiscardColdstore,
): Promise<{ coldstore: DiscardColdstore; requests: DiscardRequestSummary[] }> {
  const resp = await apiPost<any>('upande_harvest.discard_api.get_open_discard_requests', { coldstore });
  return unwrapFrappeMessage(resp);
}

export async function consumeDiscardRequest(
  requestName: string,
  scanId: string,
): Promise<DiscardConsumeResponse> {
  const resp = await apiPost<any>('upande_harvest.discard_api.consume_discard_request', {
    request_name: requestName,
    scan_id:      scanId,
  });
  return unwrapFrappeMessage<DiscardConsumeResponse>(resp);
}

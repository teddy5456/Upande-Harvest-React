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
  PackingDashboardData,
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

// "Session-invalid" detection — anything that means the stored sid/csrf is
// dead and the user needs to re-login. Frappe uses several codes/exc_types
// for this, not just HTTP 401.
const _AUTH_EXC_TYPES = new Set([
  'AuthenticationError',
  'CSRFTokenError',
  'SessionExpired',
  'SessionStoppedError',
  'PermissionError',
]);

function isSessionInvalid(status: number, body: any): boolean {
  if (status === 401) return true;
  if (!body || typeof body !== 'object') return status === 401;

  const excType = (body.exc_type || body.exception_type || '').toString();
  if (excType && _AUTH_EXC_TYPES.has(excType)) return true;

  if (body.session_expired === 1 || body.session_expired === true) return true;

  // 400 with "Invalid Request" is Frappe's CSRF failure body text.
  if (status === 400) {
    const msg = ((body.exception || body.exc || body.message || '') + '').toLowerCase();
    if (msg.includes('csrf') || msg.includes('invalid request')) return true;
  }

  // 403 with an auth-shaped message.
  if (status === 403) {
    const msg = ((body.exception || body.exc || body.message || '') + '').toLowerCase();
    if (msg.includes('authenticationerror')) return true;
    if (msg.includes('not permitted') && msg.includes('guest')) return true;
  }

  // Session expiry sometimes lands as 417 with a _server_messages entry.
  const raw = body._server_messages;
  if (typeof raw === 'string' && raw.length) {
    const t = raw.toLowerCase();
    if (t.includes('session') && (t.includes('expired') || t.includes('invalid'))) return true;
  }

  return false;
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
    // Tag it so callers can tell "never reached the server, safe to queue
    // for retry" apart from "the server rejected this" below — a screen
    // that requeues a definite rejection (already received, shelf full,
    // not harvested) just replays the same failure again later.
    err.isNetworkError = true;
    throw err;
  }

  const body = await res.json().catch(() => ({}));

  // "Session invalid" isn't just HTTP 401 on Frappe — it also comes back as:
  //   400 + exc_type=CSRFTokenError                → "Invalid Request"
  //   403 + exc_type=AuthenticationError|PermissionError
  //   417 + _server_messages containing "session"/"expired"
  //   body.session_expired = 1
  // Any of these means the stored sid/csrf is dead and every subsequent call
  // will keep failing until the user logs out and back in. Detect the whole
  // family and run the same silent-relogin → auto-logout path.
  if (isSessionInvalid(res.status, body)) {
    if (!_retry) {
      const reloggedIn = await trySilentRelogin();
      if (reloggedIn) {
        pushTrace({
          ts: new Date().toISOString(),
          method: endpoint,
          status: res.status,
          durationMs: Date.now() - startedAt,
          error: `session invalid (${res.status}) → silently re-logged in, retrying`,
        });
        return apiPost<T>(endpoint, payload, true);
      }
    }
    pushTrace({
      ts: new Date().toISOString(),
      method: endpoint,
      status: res.status,
      durationMs: Date.now() - startedAt,
      error: `session invalid (${res.status}) — silent re-login failed`,
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

// ── Shelving suggestions (what to prioritise, what to do when a shelf is full)

export interface WantedVariety {
  item_code: string;
  item_name: string;
  remaining_qty: number;
  so_count: number;
  customer_count: number;
  shelved_qty: number;
}

export interface EvictionCandidate {
  shelf_id: string;
  bucket_id: string;
  variety: string;
  stem_length: string | null;
  stem_qty: number;
  greenhouse: string | null;
  warehouse: string | null;
  date_added: string | null;
  farm: string | null;
}

export interface OverflowBucket {
  bucket_id: string;
  item_code: string;
  item_name: string;
  qty: number;
  farm: string | null;
  received_at: string;
  suggested_evict: EvictionCandidate | null;
}

export interface ShelvingSuggestions {
  target_date: string;
  farm: string | null;
  wanted_varieties: WantedVariety[];
  shelved_no_demand: EvictionCandidate[];
  overflow_buckets: OverflowBucket[];
}

export async function getShelvingSuggestions(farm?: string, daysAhead = 1): Promise<ShelvingSuggestions> {
  const res = await apiPost<any>('upande_harvest.api.get_shelving_suggestions', {
    ...(farm ? { farm } : {}),
    days_ahead: daysAhead,
  });
  const m: any = (res as any).message ?? res;
  return {
    target_date: m?.target_date ?? '',
    farm: m?.farm ?? null,
    wanted_varieties: m?.wanted_varieties ?? [],
    shelved_no_demand: m?.shelved_no_demand ?? [],
    overflow_buckets: m?.overflow_buckets ?? [],
  };
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
  // Which line to use when the scanned variety matches more than one
  // pack_summary row (straight + mix, or two mix groups) — the `key` from
  // the needs_choice response's `choices`.
  choice?: string;
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

// Dispatch by box: each printed box label is scanned off the truck, then the
// notes are raised for exactly what was scanned. `expected_boxes` is the
// pack list's full roster — the server is the only thing that knows it, since
// Pack Box.total_boxes is not filled in on live.
export interface DispatchBoxItem {
  item_code: string;
  qty: number;
}

export interface DispatchBox {
  name: string;
  box_id: string;
  box_sequence: number;
  total_boxes: number;
  stems: number;
  sales_order: string;
  customer: string;
  items: DispatchBoxItem[];
}

export interface DispatchScan {
  box: DispatchBox;
  fpl: string;
  opl: string;
  consignee: string;
  expected_boxes: string[];
  open_boxes: string[];
}

export interface DispatchNote {
  delivery_note: string;
  sales_order: string;
  customer: string;
  total_qty: number;
  line_count: number;
}

export interface DispatchSubmitResult {
  delivery_notes: DispatchNote[];
  fpl: string;
  opl: string;
  boxes: number;
  total_qty: number;
}

export async function getDispatchBox(boxId: string): Promise<DispatchScan> {
  const res = await apiPost<any>('upande_harvest.api.get_dispatch_box', { box_id: boxId });
  const m: any = (res as any).message ?? res;
  return {
    ...m,
    box: { ...m?.box, items: m?.box?.items ?? [] },
    expected_boxes: m?.expected_boxes ?? [],
    open_boxes: m?.open_boxes ?? [],
  } as DispatchScan;
}

export async function createDeliveryNotesFromBoxes(params: {
  box_ids: string[];
  driver_name: string;
  truck_reg: string;
  posting_date?: string;
}): Promise<DispatchSubmitResult> {
  const res = await apiPost<any>('upande_harvest.api.create_delivery_notes_from_boxes', params);
  const m: any = (res as any).message ?? res;
  return { ...m, delivery_notes: m?.delivery_notes ?? [] } as DispatchSubmitResult;
}

export async function getFplPreview(fpl: string): Promise<FplPreview> {
  // Whitelisted app methods answer as { message: {...} }; Server Scripts answer
  // flat. Both shapes reach here — miss the unwrap and `preview.items` is
  // undefined, which grey-screens Dispatch on the first scan (no ErrorBoundary).
  const res = await apiPost<any>('upande_harvest.api.get_fpl_preview', { fpl });
  const m: any = (res as any).message ?? res;
  return { ...m, items: m?.items ?? [] } as FplPreview;
}

export async function createDeliveryNoteFromFpl(params: {
  fpl: string;
  driver_name: string;
  truck_reg: string;
  posting_date?: string;
}): Promise<DispatchResult> {
  const res = await apiPost<any>('upande_harvest.api.create_delivery_note_from_fpl', params);
  return ((res as any).message ?? res) as DispatchResult;
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

export async function fetchPackingDashboard(fromDate?: string, toDate?: string): Promise<PackingDashboardData> {
  // Bare name, not the dotted Python path: there's a Server Script of this
  // exact name that calls the api.py function and does
  // frappe.response.update(result) to answer flat. The dotted path calls
  // the plain function directly, which just `return`s the dict — Frappe
  // wraps that under "message" by default, so every field read flat here
  // came back undefined even though the underlying data was correct.
  return apiPost<PackingDashboardData>('get_packing_dashboard_data', {
    from_date: fromDate,
    to_date: toDate,
  });
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

export interface IssuingCustomer {
  customer: string | null;
  customer_name: string | null;
  stems_owed: number;
  bucket_count: number;
  variety_count: number;
  opl_count: number;
}

// Customer-first counterpart to getIssuingVarieties() — used when
// Upande Harvest Config.issuing_group_by = 'Customer First'.
export async function getIssuingCustomers(): Promise<{ customers: IssuingCustomer[] }> {
  const res = await apiPost<any>('upande_harvest.api.get_issuing_customers', {});
  const m: any = (res as any).message ?? res;
  return { customers: m?.customers ?? [] };
}

export interface IssuingVarietyForCustomer {
  variety: string;
  stems_owed: number;
  bucket_count: number;
  opl_count: number;
}

// Drill-down step for Customer First: varieties owed by one customer
// (or by one Grade to Stock OPL, via the same PREGRADE: key getIssuingCustomers hands out).
export async function getIssuingVarietiesForCustomer(
  customer: string
): Promise<{ varieties: IssuingVarietyForCustomer[] }> {
  const res = await apiPost<any>('upande_harvest.api.get_issuing_varieties_for_customer', { customer });
  const m: any = (res as any).message ?? res;
  return { varieties: m?.varieties ?? [] };
}

export type IssuingGroupBy = 'Variety First' | 'Customer First';

// Same reasoning as getStorageMode() — Upande Harvest Config is
// System-Manager-only, so this reads it through a public wrapper.
export async function getIssuingGroupBy(): Promise<IssuingGroupBy> {
  const res = await apiPost<{ message?: { issuing_group_by?: string } }>(
    'upande_harvest.api.get_issuing_group_by',
    {}
  );
  const m: any = (res as any).message ?? res;
  const v = m?.issuing_group_by;
  return (v === 'Customer First' ? 'Customer First' : 'Variety First');
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
  grader: string, stems: number, bunchSize: number,
  /** Employee the stems are handed to. Omitted = the shared pool. */
  assignedTo?: string
): Promise<{
  pool: string; pooled_stems: number; ready_to_grade: boolean;
  variety?: string; assigned_to?: string | null; shared?: boolean;
}> {
  return apiPost('add_to_pool', {
    bucket_id: bucketId, variety, farm, grader, stems, bunch_size: bunchSize,
    ...(assignedTo ? { assigned_to: assignedTo } : {}),
  });
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

export type PoolEntry = {
  pool: string;
  variety: string;
  item_code: string;
  pooled_stems: number;
  /** How many stem lengths this pool spans — pooling ignores length. */
  lengths: number;
  assigned_to?: string | null;
};

export async function getPoolStatus(
  variety: string, farm: string,
  /** Scope to one grader's handed-over stems. Omitted = the shared pool. */
  assignedTo?: string
): Promise<{
  pool: string | null; pooled_stems: number; bunch_size: number;
  ready_to_grade: boolean; variety?: string;
  /** How many stem lengths the pool spans — pooling ignores length. */
  lengths?: number;
  assigned_to?: string | null;
  /** EVERY variety with stems pooled. The top-level fields above describe only
   *  the biggest one, which hid every other variety from the graders. */
  pools?: PoolEntry[];
  total_pooled_stems?: number;
}> {
  return apiPost('get_pool_status', {
    variety, farm, ...(assignedTo ? { assigned_to: assignedTo } : {}),
  });
}

export async function gradeFromPool(
  bunchId: string, grader: string, farm: string,
  /** Fallback only — the server reads the variety off the scanned bunch label,
   *  which is the physical thing in the grader's hand. */
  variety?: string
): Promise<{
  stock_entry: string; pooled_stems: number; contributing_buckets: string[];
  variety?: string; bunch_size?: number; lengths_used?: number;
  assigned_to?: string | null;
}> {
  return apiPost('grade_from_pool', {
    bunch_id: bunchId, grader, farm, ...(variety ? { variety } : {}),
  });
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
// applies one scan against the chosen request. Both calls are bare-name
// Server Scripts (Discards Request doctype), not dotted app.py paths.

export async function getOpenDiscardRequests(
  coldstore: DiscardColdstore,
): Promise<{ coldstore: DiscardColdstore; requests: DiscardRequestSummary[] }> {
  const resp = await apiPost<any>('get_open_discards_requests', { coldstore });
  return unwrapFrappeMessage(resp);
}

export async function consumeDiscardRequest(
  requestName: string,
  scanId: string,
): Promise<DiscardConsumeResponse> {
  const resp = await apiPost<any>('consume_discards_request', {
    request_name: requestName,
    scan_id:      scanId,
  });
  return unwrapFrappeMessage<DiscardConsumeResponse>(resp);
}

// ── Item Journey (Settings → Bucket Journey) ────────────────────────────────
// Scan any bucket / bunch / storage box / pack box / shelf code → full life
// story as a normalized timeline, plus which fields a supervisor-authorized
// correction may change.

export type JourneyEntityType = 'bucket' | 'bunch' | 'storage_box' | 'pack_box' | 'shelf';

export interface JourneyEvent {
  stage: string;
  ts: string | null;
  title: string;
  detail: string;
  doc: { doctype: string; name: string } | null;
  meta: Record<string, any>;
}

export interface JourneyLink {
  type: JourneyEntityType | 'opl';
  id: string;
  label: string;
}

export interface JourneyEditable {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'relocate';
  options_source?: 'varieties' | 'greenhouses';
  scan_hint?: string;
  current: string | number;
}

/** How a bucket correction should land — the operator picks, we never guess. */
export interface JourneyCorrectionMode {
  key: 'new_cycle' | 'amend';
  label: string;
  hint: string;
  default: boolean;
}

export interface JourneyTrace {
  entity_type: JourneyEntityType;
  id: string;
  header: {
    id: string;
    title: string;
    subtitle: string;
    status: string;
    harvested_at: string | null;
    stems: number;
    /** 'idle' = empty and unheld, so everything shown is LAST KNOWN, not current. */
    cycle_state?: 'idle' | 'live';
    stale?: boolean;
    meta: Record<string, any>;
  };
  cycle_state?: 'idle' | 'live';
  timeline: JourneyEvent[];
  previous_cycles: { start_ts: string | null; events: JourneyEvent[] }[];
  links: JourneyLink[];
  editable: JourneyEditable[];
  correction_modes?: JourneyCorrectionMode[];
  corrections: { text: string; ts: string }[];
}

// Journey endpoints live in upande_harvest.api once the app is deployed, but
// on servers still waiting for that deploy they exist as Server Scripts under
// the short method name. Try the permanent path first, fall back on
// "method missing"-shaped errors only.
async function journeyPost<T>(dotted: string, short: string, payload: object): Promise<T> {
  try {
    return await apiPost<T>(dotted, payload);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/not whitelisted|not found|no attribute|failed to get method|404/i.test(msg)) {
      return apiPost<T>(short, payload);
    }
    throw e;
  }
}

export async function traceItemJourney(code: string): Promise<JourneyTrace> {
  const resp = await journeyPost<any>(
    'upande_harvest.api.trace_item_journey', 'trace_item_journey', { code });
  return unwrapFrappeMessage<JourneyTrace>(resp);
}

export interface RelabelOption { item_code: string; length: number }

export interface RelabelInfo {
  found: boolean;
  message?: string;
  bunch_id?: string;
  stock_entry?: string;
  bucket_id?: string | null;
  /** What the bucket physically held — the truth the sticker should match. */
  bucket_variety?: string;
  /** What the sticker currently claims. */
  current_label?: string;
  stems?: number;
  options?: RelabelOption[];
}

/**
 * What a mis-stickered bunch may legitimately be corrected to. The server
 * only offers lengths at or below the bucket's, so the options can never
 * include something the correction would then refuse.
 */
export async function getRelabelOptions(bunchId: string): Promise<RelabelInfo> {
  const resp = await apiPost<any>('upande_harvest.api.get_relabel_options', { bunch_id: bunchId });
  return unwrapFrappeMessage<RelabelInfo>(resp);
}

/**
 * Correct a bunch that was graded under the wrong sticker. Re-posts the
 * grading stock entry as well as the label, so the ledger matches the stems.
 */
/** Stem lengths that exist as items — the batch relabel picker. */
export async function getRelabelLengths(): Promise<number[]> {
  const resp = await apiPost<any>('upande_harvest.api.get_relabel_lengths', {});
  return unwrapFrappeMessage<number[]>(resp);
}

/**
 * Relabel one bunch to a length, keeping its own variety. Built for the batch
 * case: set "60cm" once, then scan a whole tray — a mixed tray still lands on
 * the right item code per bunch.
 */
export async function relabelBunchToLength(params: {
  bunchId: string;
  lengthCm: number;
  /** Omit both when the signed-in user is already a supervisor. */
  supervisorUser?: string;
  supervisorPin?: string;
}): Promise<{ status: string; bunch_id: string; to: string; applied: string[] }> {
  const resp = await apiPost<any>('upande_harvest.api.relabel_bunch_to_length', {
    bunch_id: params.bunchId,
    length_cm: params.lengthCm,
    ...(params.supervisorUser ? { supervisor_user: params.supervisorUser } : {}),
    ...(params.supervisorPin ? { supervisor_pin: params.supervisorPin } : {}),
  });
  return unwrapFrappeMessage(resp);
}

export interface PinCheck {
  ok: boolean;
  /** self | pin | wrong_pin | no_pin | not_supervisor | unknown_user | no_supervisor */
  reason: string;
  user?: string;
  full_name?: string;
  message?: string;
}

/** Check a supervisor PIN before arming, so the operator learns what is wrong now. */
export async function verifyCorrectionPin(
  supervisorUser?: string, supervisorPin?: string,
): Promise<PinCheck> {
  const resp = await apiPost<any>('upande_harvest.api.verify_correction_pin', {
    ...(supervisorUser ? { supervisor_user: supervisorUser } : {}),
    ...(supervisorPin ? { supervisor_pin: supervisorPin } : {}),
  });
  return unwrapFrappeMessage<PinCheck>(resp);
}

export interface CorrectionAuthContext {
  user: string;
  full_name: string;
  /** True when the signed-in user already holds a supervisor role. */
  self_authorized: boolean;
}

/** Whether this device's user can correct on their own authority. */
export async function getCorrectionAuthContext(): Promise<CorrectionAuthContext> {
  const resp = await apiPost<any>('upande_harvest.api.correction_auth_context', {});
  return unwrapFrappeMessage<CorrectionAuthContext>(resp);
}

export async function relabelBunch(params: {
  bunchId: string;
  itemCode: string;
  supervisorUser?: string;
  supervisorPin?: string;
}): Promise<{ status: string; applied: string[] }> {
  return applyJourneyCorrection({
    code: params.bunchId,
    changes: { relabel: params.itemCode },
    supervisorUser: params.supervisorUser,
    supervisorPin: params.supervisorPin,
  });
}

/**
 * A bucket correction refuses once grading has already happened against it —
 * rewriting the harvest entry alone would leave every grading Stock Entry
 * pointing at the old, wrong variety. This is the fallback the server itself
 * names in that refusal ("Use relabel_bucket_cycle..."): it re-issues the
 * harvest/receiving entry at the corrected variety/length AND re-posts every
 * grading already taken off the bucket against that correction, so the whole
 * cycle moves together. Refuses on its own if the cycle has rejects posted
 * (those carry P&L entries) or if the correction would cross varieties, not
 * just length.
 */
export async function relabelBucketCycle(params: {
  bucketId: string;
  correctItemCode: string;
  supervisorUser?: string;
  supervisorPin?: string;
}): Promise<{ status: string; bucket_id: string; to: string; applied: string[] }> {
  const resp = await journeyPost<any>(
    'upande_harvest.api.relabel_bucket_cycle', 'relabel_bucket_cycle', {
      bucket_id: params.bucketId,
      correct_item_code: params.correctItemCode,
      ...(params.supervisorUser ? { supervisor_user: params.supervisorUser } : {}),
      ...(params.supervisorPin ? { supervisor_pin: params.supervisorPin } : {}),
    });
  return unwrapFrappeMessage(resp);
}

export async function applyJourneyCorrection(params: {
  code: string;
  changes: Record<string, string | number>;
  /** All optional: a signed-in supervisor authorises on their own role. */
  supervisorUser?: string;
  supervisorPwd?: string;
  supervisorPin?: string;
  /** Buckets only: 'new_cycle' posts a fresh Harvesting entry, 'amend' rewrites
   *  the last one. Omitted → the server keeps its legacy 'amend' default, which
   *  is what servers still running the old Server Script will do regardless. */
  mode?: 'new_cycle' | 'amend';
}): Promise<{ status: string; applied: string[]; mode?: string }> {
  const resp = await journeyPost<any>(
    'upande_harvest.api.apply_journey_correction', 'apply_journey_correction', {
      code:    params.code,
      changes: params.changes,
      ...(params.supervisorUser ? { supervisor_user: params.supervisorUser } : {}),
      ...(params.supervisorPwd ? { supervisor_pwd: params.supervisorPwd } : {}),
      ...(params.supervisorPin ? { supervisor_pin: params.supervisorPin } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
    });
  return unwrapFrappeMessage(resp);
}

/**
 * Verify a supervisor's credentials against the current server with a
 * throwaway login call (no session state is stored). Needed because the
 * temporary Server Script deployment can't check another user's password
 * server-side — and it doubles as a crisp pre-submit check everywhere else.
 */
export async function verifySupervisorCredentials(email: string, pwd: string): Promise<void> {
  const serverUrl = await getApiUrl();
  if (!serverUrl) throw new Error('Server URL not configured');
  try {
    await loginToServer(serverUrl, email, pwd);
  } catch (e: any) {
    if (/invalid username or password/i.test(String(e?.message || ''))) {
      throw new Error('Supervisor email or password is incorrect');
    }
    throw e;
  }
}

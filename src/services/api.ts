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
  PackableVarietiesResponse,
  BouquetRecipe,
  BouquetSubmissionPayload,
  BouquetSubmissionResponse,
} from '../types';
import { getApiUrl, getSid, getCsrfToken } from '../database/settings';
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

async function apiPost<T>(endpoint: string, payload: object): Promise<T> {
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
    throw err;
  }

  const body = await res.json().catch(() => ({}));

  // 401 means the session has expired or the server changed and the stored sid
  // is no longer valid. Trigger auto-logout so the user lands on the login screen
  // rather than seeing silent failures on every screen.
  if (res.status === 401) {
    _onAuthFailure?.();
    throw new Error('Session expired — please log in again');
  }

  if (!res.ok) {
    throw new Error(extractFrappeError(body) || `Request failed: ${res.status}`);
  }

  return body as T;
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
  return apiPost<GradingResponse>('mobile_grading_entry', gradingData);
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
  return apiPost<HarvestResponse>('createHarvestEntry', {
    item_code: itemCode,
    quantity,
    section,
    harvester,
    bucket_id: bucketId,
    farm,
    greenhouse,
    ...(postingDate && { posting_date: postingDate }),
    ...(postingTime && { posting_time: postingTime }),
  });
}

export async function submitReceiving(
  bucketId: string,
  postingDate?: string,
  postingTime?: string
): Promise<ReceivingResponse> {
  return apiPost<ReceivingResponse>('receiving_entry', {
    bucket_id: bucketId,
    ...(postingDate && { posting_date: postingDate }),
    ...(postingTime && { posting_time: postingTime }),
  });
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

export async function fetchPackableVarieties(): Promise<PackableVarietiesResponse> {
  return apiPost<PackableVarietiesResponse>('get_packable_varieties', {});
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
  return apiPost<any>('get_dashboard_data', {
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

export async function getPoolStatus(
  variety: string, farm: string
): Promise<{ pool: string | null; pooled_stems: number; bunch_size: number; ready_to_grade: boolean }> {
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
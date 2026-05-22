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
  XfloraOplHeader,
  XfloraPackPayload,
  XfloraPackResponse,
  ProductionPlanListEntry,
  ProductionPlanDay,
  ProductionPlanTask,
  ActualHarvestRecord,
  BedSamplingPayload,
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
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
} from '../types';
import { getApiUrl, getSid } from '../database/settings';

interface LoginResponse {
  message: string;
  full_name: string;
  sid: string;
  user: string;
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

  const sid = await getSid();
  if (sid) {
    headers['Cookie'] = `sid=${sid}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    throw err;
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.message || body.error || body.exc || `Request failed: ${res.status}`);
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
  return {
    message: body.message,
    full_name: body.full_name || '',
    user: body.user || usr,
    sid,
  };
}

export async function submitShelve(
  shelfId: string,
  bucketId: string,
  farm: string
): Promise<ShelveResponse> {
  return apiPost<ShelveResponse>('shelving_entry', {
    shelf_id: shelfId,
    bucket_id: bucketId,
    farm,
  });
}

export async function submitGrading(
  bunchId: string,
  grader: string,
  bucketId: string,
  farm: string
): Promise<GradingResponse> {
  return apiPost<GradingResponse>('mobile_grading_entry', {
    bunch_id: bunchId,
    grader,
    bucket_id: bucketId,
    farm,
  });
}

export async function submitHarvest(
  itemCode: string,
  quantity: number,
  section: string,
  harvester: string,
  bucketId: string,
  farm: string,
  greenhouse: string
): Promise<HarvestResponse> {
  return apiPost<HarvestResponse>('createHarvestEntry', {
    item_code: itemCode,
    quantity,
    section,
    harvester,
    bucket_id: bucketId,
    farm,
    greenhouse,
  });
}

export async function submitReceiving(
  bucketId: string
): Promise<ReceivingResponse> {
  return apiPost<ReceivingResponse>('receiving_entry', { bucket_id: bucketId });
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

export async function submitPackingBox(
  boxId: string,
  farm: string,
  bunches: string[]
): Promise<PackingResponse> {
  return apiPost<PackingResponse>('create_packing_box', {
    box_id: boxId,
    farm,
    bunches,
  });
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

export async function fetchGradingDashboard(): Promise<GradingDashboardData> {
  return apiPost<GradingDashboardData>('get_grading_dashboard_data', {});
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
  farm: string
): Promise<RejectResponse> {
  return apiPost<RejectResponse>('submit_bucket_reject', {
    bucket_id: bucketId,
    grader,
    rejects,
    farm,
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
  quarantineAction: QuarantineAction = ''
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
  });
}

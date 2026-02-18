import {
  ShelveResponse,
  GradingResponse,
  HarvestResponse,
  ReceivingResponse,
  GreenhousesResponse,
  RoseItemsResponse,
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

  // Attach session token to URL and headers
  const sid = await getSid();
  const url = sid
    ? `${baseUrl}/api/method/${endpoint}?sid=${sid}`
    : `${baseUrl}/api/method/${endpoint}`;
  console.log('REQUEST:', url, JSON.stringify(payload, null, 2));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

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
    console.log('FETCH ERROR:', err.message);
    throw err;
  }

  const body = await res.json().catch(() => ({}));
  console.log('RESPONSE:', res.status, JSON.stringify(body, null, 2));

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
  console.log('[LOGIN] URL:', url);
  console.log('[LOGIN] User:', usr);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ usr, pwd }),
      credentials: 'omit',
    });
  } catch (err: any) {
    console.error('[LOGIN] Network error:', err.message);
    throw new Error(
      `Cannot reach server: ${err.message}. Check the URL and your internet connection.`
    );
  }

  console.log('[LOGIN] Status:', res.status);

  const text = await res.text();
  console.log('[LOGIN] Raw response:', text.substring(0, 500));

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    console.error('[LOGIN] Response is not JSON');
    throw new Error(
      `Server returned invalid response (${res.status}). Check that the URL points to a valid Frappe/ERPNext instance.`
    );
  }

  console.log('[LOGIN] Parsed body:', JSON.stringify(body, null, 2));

  if (!res.ok) {
    const msg = body.message || body._server_messages || body.exc || `Login failed (${res.status})`;
    console.error('[LOGIN] Failed:', msg);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  // Extract sid from Set-Cookie header
  const cookies = res.headers.get('set-cookie') || '';
  console.log('[LOGIN] Cookies:', cookies);
  const sidMatch = cookies.match(/sid=([^;]+)/);
  const sid = sidMatch ? sidMatch[1] : '';
  if (!sid) {
    console.warn('[LOGIN] No sid cookie found in response');
  }

  return {
    message: body.message,
    full_name: body.full_name || '',
    user: usr,
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
  bunchId: string,
  receiver: string,
  farm: string
): Promise<ReceivingResponse> {
  return apiPost<ReceivingResponse>('receiving_entry', {
    bunch_id: bunchId,
    receiver,
    farm,
  });
}

export async function fetchGreenhouses(): Promise<GreenhousesResponse> {
  return apiPost<GreenhousesResponse>('getGreenhouses', {});
}

export async function fetchVarieties(): Promise<RoseItemsResponse> {
  return apiPost<RoseItemsResponse>('getVarieties', {});
}

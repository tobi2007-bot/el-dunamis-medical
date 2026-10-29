// api.js — EL DUNAMIS shared API helper
// Include this with <script src="api.js"></script> in every page

const API_BASE = window.location.origin + '/api';

/**
 * Core fetch wrapper.
 * - Automatically attaches the JWT token if one is saved.
 * - Returns the parsed `data` field on success.
 * - Throws a plain Error with the server's message on failure.
 */
async function apiRequest(method, path, body = null) {
  const token = sessionStorage.getItem('eld_token');

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  if (body)  options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, options);
  const json = await res.json();

  if (res.status === 401 && token) {
    // The token expired or the account was disabled mid-session. Drop it and
    // send the person back to the login screen instead of leaving them stuck
    // re-clicking a button that will only ever fail with a stale token.
    sessionStorage.removeItem('eld_token');
    if (typeof onSessionExpired === 'function') onSessionExpired();
  }

  if (!res.ok) throw new Error(json.message || 'Something went wrong.');
  return json.data;
}

// Convenience shorthand methods
const api = {
  get:    (path)        => apiRequest('GET',    path),
  post:   (path, body)  => apiRequest('POST',   path, body),
  put:    (path, body)  => apiRequest('PUT',    path, body),
  delete: (path)        => apiRequest('DELETE', path),
};

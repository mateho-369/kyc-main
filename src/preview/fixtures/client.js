import { fixtureRequest } from './store';
// An adapter, not an HTTP interceptor: there is no network fallback.
const client = {
  get: url => fixtureRequest('GET',url),
  post: (url,body) => fixtureRequest('POST',url,body),
  put: (url,body) => fixtureRequest('PUT',url,body),
  delete: url => fixtureRequest('DELETE',url)
};
export default client;

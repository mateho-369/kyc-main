import { describe, it, expect, vi, beforeEach } from 'vitest';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../SecureApiClient', () => ({ default: { get } }));
import { getPerformerDocuments } from '../performerService';
beforeEach(() => get.mockReset());
describe('performer document response shape', () => {
  it('unwraps the mounted API data.documents response', async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: { documents: [{ type: 'idFront', verified: true }] } } });
    expect(await getPerformerDocuments(1)).toEqual([{ type: 'idFront', verified: true }]);
  });
  it('supports the existing array shape', async () => {
    get.mockResolvedValueOnce({ data: { data: [] } });
    expect(await getPerformerDocuments(1)).toEqual([]);
  });
  it('does not turn a failed lookup into a successful empty list', async () => {
    get.mockRejectedValueOnce(new Error('network failure'));
    await expect(getPerformerDocuments(1)).rejects.toThrow('network failure');
  });
  it('rejects malformed responses instead of fabricating empty documents', async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await expect(getPerformerDocuments(1)).rejects.toThrow('Invalid document response');
  });
});

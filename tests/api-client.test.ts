import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiClientError } from '../src/api-client.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiClient', () => {
  const config = {
    apiKey: 'cf_live_test123',
    apiUrl: 'https://api.contextforge.io',
    defaultSpace: '123e4567-e89b-12d3-a456-426614174000',
  };

  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient(config);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listSpaces', () => {
    it('should return list of spaces', async () => {
      const mockSpaces = [
        { id: '123', name: 'Space 1', slug: 'space-1' },
        { id: '456', name: 'Space 2', slug: 'space-2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockSpaces,
      });

      const spaces = await client.listSpaces();

      expect(spaces).toEqual(mockSpaces);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/spaces',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer cf_live_test123',
          }),
        })
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.listSpaces()).rejects.toThrow(ApiClientError);

      // Reset and try again to check properties
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      try {
        await client.listSpaces();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('query', () => {
    it('should send query request', async () => {
      const mockResponse = {
        results: [
          { id: '1', content: 'Test content', score: 0.9 },
        ],
        query_embedding_cached: false,
        tokens_used: 5,
        latency_ms: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await client.query({
        query: 'How to authenticate?',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/query',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify the body was called with correct space_id
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.space_id).toBe(config.defaultSpace);
      expect(body.query).toBe('How to authenticate?');
    });

    it('should send query without space_id when none available (uses project_id fallback)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ results: [], search_type: 'text', latency_ms: 10 }),
      });

      const clientNoSpace = new ApiClient({
        apiKey: 'cf_live_test123',
        apiUrl: 'https://api.contextforge.io',
      });

      const result = await clientNoSpace.query({ query: 'test' });
      expect(result.results).toEqual([]);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.space_id).toBeUndefined();
      expect(body.query).toBe('test');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Space not found', code: 'NOT_FOUND' }),
      });

      try {
        await client.query({ query: 'test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).message).toBe('Space not found');
        expect((error as ApiClientError).statusCode).toBe(404);
        expect((error as ApiClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('ingest', () => {
    it('should send ingest request', async () => {
      const mockResponse = {
        created: 1,
        duplicates_skipped: 0,
        items: [{ id: '123', status: 'created' }],
        tokens_used: 50,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await client.ingest({
        content: 'This is test content',
        title: 'Test Document',
        tags: ['test'],
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/ingest',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify body contains content
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.items[0].content).toBe('This is test content');
    });
  });

  describe('createSpace', () => {
    it('should create a new space', async () => {
      const mockSpace = {
        id: 'new-space-id',
        name: 'New Space',
        slug: 'new-space',
        settings: {
          auto_learning: true,
          git_sync_enabled: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockSpace,
      });

      const result = await client.createSpace({
        name: 'New Space',
        description: 'A test space',
      });

      expect(result).toEqual(mockSpace);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/spaces',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('relate', () => {
    it('should create a relationship', async () => {
      const mockRelationship = {
        id: 'rel-id',
        source_item_id: 'source-123',
        target_item_id: 'target-456',
        relationship_type: 'references',
        weight: 0.8,
        confidence: 1.0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockRelationship,
      });

      const result = await client.relate({
        source_id: 'source-123',
        target_id: 'target-456',
        relationship_type: 'references',
        weight: 0.8,
      });

      expect(result).toEqual(mockRelationship);
    });
  });

  describe('deleteItem', () => {
    it('should delete an item by id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, deleted: { id: 'item-123', title: 'Test Item' } }),
      });

      const result = await client.deleteItem({ id: 'item-123' });

      expect(result).toEqual({ id: 'item-123', title: 'Test Item' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/delete-item',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify body contains id
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.id).toBe('item-123');
    });

    it('should delete an item by title', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, deleted: { id: 'found-id', title: 'My Document' } }),
      });

      const result = await client.deleteItem({ title: 'My Document' });

      expect(result).toEqual({ id: 'found-id', title: 'My Document' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.title).toBe('My Document');
    });
  });

  describe('freshnessAction', () => {
    it('should post action + id for confirm', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const result = await client.freshnessAction('confirm', 'id1');

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.contextforge.io/functions/v1/freshness',
        expect.objectContaining({
          method: 'POST',
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({ action: 'confirm', id: 'id1' });
    });

    it('should post action + id for forget', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      await client.freshnessAction('forget', 'id3');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({ action: 'forget', id: 'id3' });
    });

    it('should include content and git_context for correct', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const gitContext = {
        repo: 'org/repo',
        sha: 'abc123',
        related_paths: ['src/index.ts'],
      };
      await client.freshnessAction('correct', 'id2', {
        content: 'updated content',
        git_context: gitContext,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        action: 'correct',
        id: 'id2',
        content: 'updated content',
        git_context: gitContext,
      });
    });

    it('should propagate API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Item not found', code: 'NOT_FOUND' }),
      });

      await expect(client.freshnessAction('confirm', 'missing-id')).rejects.toThrow(
        ApiClientError
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'healthy' }),
      });

      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });
});

describe('ApiClientError', () => {
  it('should create error with all properties', () => {
    const error = new ApiClientError(
      'Not found',
      404,
      'NOT_FOUND',
      { resource: 'space' }
    );

    expect(error.message).toBe('Not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toEqual({ resource: 'space' });
    expect(error.name).toBe('ApiClientError');
  });
});

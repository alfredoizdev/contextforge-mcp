import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../src/api-client.js';
import {
  SkillsListInputSchema,
  SkillsGetInputSchema,
  SkillsCreateInputSchema,
  SkillsUpdateInputSchema,
  SkillsDeleteInputSchema,
  SkillsRunInputSchema,
} from '../src/types.js';

// ============================================================
// Section A — Zod Schema validation tests
// ============================================================

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_UUID_2 = '123e4567-e89b-12d3-a456-426614174001';

describe('SkillsListInputSchema', () => {
  it('accepts a valid uuid project_id', () => {
    const result = SkillsListInputSchema.safeParse({ project_id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects missing project_id', () => {
    const result = SkillsListInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid project_id', () => {
    const result = SkillsListInputSchema.safeParse({ project_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('SkillsGetInputSchema', () => {
  it('accepts a valid uuid id', () => {
    const result = SkillsGetInputSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = SkillsGetInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid id', () => {
    const result = SkillsGetInputSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('SkillsCreateInputSchema', () => {
  const minimal = {
    project_id: VALID_UUID,
    name: 'My Skill',
    body: 'You are a helpful skill.',
    model: 'claude-3-5-sonnet-20241022',
  };

  it('accepts minimal payload {project_id, name, body, model}', () => {
    const result = SkillsCreateInputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('accepts full payload with all optional fields', () => {
    const full = {
      ...minimal,
      description: 'A test skill',
      input_schema: { type: 'object', properties: { topic: { type: 'string' } } },
      llm_provider: 'anthropic' as const,
      save_to_space_id: VALID_UUID_2,
    };
    const result = SkillsCreateInputSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects missing project_id', () => {
    const { project_id, ...rest } = minimal;
    const result = SkillsCreateInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const { name, ...rest } = minimal;
    const result = SkillsCreateInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing body', () => {
    const { body, ...rest } = minimal;
    const result = SkillsCreateInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing model', () => {
    const { model, ...rest } = minimal;
    const result = SkillsCreateInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects name shorter than 1 char', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 200 chars', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, name: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects body shorter than 1 char', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects llm_provider not in [anthropic, openai]', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, llm_provider: 'cohere' });
    expect(result.success).toBe(false);
  });

  it('accepts llm_provider openai', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, llm_provider: 'openai' });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid save_to_space_id', () => {
    const result = SkillsCreateInputSchema.safeParse({ ...minimal, save_to_space_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('SkillsUpdateInputSchema', () => {
  it('accepts id-only payload', () => {
    const result = SkillsUpdateInputSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('accepts full patch', () => {
    const full = {
      id: VALID_UUID,
      name: 'Updated name',
      description: 'Updated description',
      body: 'Updated body',
      input_schema: { foo: 'bar' },
      llm_provider: 'openai' as const,
      model: 'gpt-4o',
      save_to_space_id: VALID_UUID_2,
    };
    const result = SkillsUpdateInputSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = SkillsUpdateInputSchema.safeParse({ name: 'New name' });
    expect(result.success).toBe(false);
  });

  it('accepts save_to_space_id explicitly null', () => {
    const result = SkillsUpdateInputSchema.safeParse({
      id: VALID_UUID,
      save_to_space_id: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid id', () => {
    const result = SkillsUpdateInputSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('SkillsDeleteInputSchema', () => {
  it('accepts a valid uuid id', () => {
    const result = SkillsDeleteInputSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = SkillsDeleteInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid id', () => {
    const result = SkillsDeleteInputSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('SkillsRunInputSchema', () => {
  it('accepts skill_id only', () => {
    const result = SkillsRunInputSchema.safeParse({ skill_id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('accepts skill_id + input_params object', () => {
    const result = SkillsRunInputSchema.safeParse({
      skill_id: VALID_UUID,
      input_params: { topic: 'AI', limit: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing skill_id', () => {
    const result = SkillsRunInputSchema.safeParse({ input_params: { foo: 'bar' } });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid skill_id', () => {
    const result = SkillsRunInputSchema.safeParse({ skill_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Section B — ApiClient method tests
// ============================================================

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiClient skills methods', () => {
  const config = {
    apiKey: 'cf_live_test123',
    apiUrl: 'https://api.contextforge.io',
  };

  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient(config);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listSkills', () => {
    it('calls GET /skills-crud with project_id query param and returns unwrapped data', async () => {
      const mockSkills = [
        { id: 'skill-1', name: 'Skill 1' },
        { id: 'skill-2', name: 'Skill 2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: mockSkills }),
      });

      const projectId = VALID_UUID;
      const result = await client.listSkills({ project_id: projectId });

      expect(result).toEqual(mockSkills);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        `https://api.contextforge.io/functions/v1/skills-crud?project_id=${encodeURIComponent(projectId)}`,
      );
      expect(callArgs[1].method).toBe('GET');
    });
  });

  describe('getSkill', () => {
    it('calls GET /skills-crud with id query param and returns unwrapped data', async () => {
      const mockSkill = { id: 'skill-1', name: 'My Skill' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: mockSkill }),
      });

      const id = VALID_UUID;
      const result = await client.getSkill({ id });

      expect(result).toEqual(mockSkill);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        `https://api.contextforge.io/functions/v1/skills-crud?id=${encodeURIComponent(id)}`,
      );
      expect(callArgs[1].method).toBe('GET');
    });
  });

  describe('createSkill', () => {
    it('calls POST /skills-crud with body and returns unwrapped data', async () => {
      const created = { id: 'new-skill', name: 'New Skill' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: created }),
      });

      const input = {
        project_id: VALID_UUID,
        name: 'New Skill',
        body: 'Skill body',
        model: 'claude-3-5-sonnet-20241022',
      };

      const result = await client.createSkill(input);

      expect(result).toEqual(created);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.contextforge.io/functions/v1/skills-crud');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].body).toBe(JSON.stringify(input));
    });
  });

  describe('updateSkill', () => {
    it('calls PATCH /skills-crud with body and returns unwrapped data', async () => {
      const updated = { id: VALID_UUID, name: 'Updated' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: updated }),
      });

      const input = { id: VALID_UUID, name: 'Updated' };
      const result = await client.updateSkill(input);

      expect(result).toEqual(updated);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.contextforge.io/functions/v1/skills-crud');
      expect(callArgs[1].method).toBe('PATCH');
      expect(callArgs[1].body).toBe(JSON.stringify(input));
    });
  });

  describe('deleteSkill', () => {
    it('calls DELETE /skills-crud with id query param and returns unwrapped data', async () => {
      const deleted = { id: VALID_UUID, deleted: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: deleted }),
      });

      const id = VALID_UUID;
      const result = await client.deleteSkill({ id });

      expect(result).toEqual(deleted);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        `https://api.contextforge.io/functions/v1/skills-crud?id=${encodeURIComponent(id)}`,
      );
      expect(callArgs[1].method).toBe('DELETE');
    });
  });

  describe('runSkill', () => {
    it('calls POST /skill-execute with body (incl. trigger_type) and returns unwrapped data', async () => {
      const execResult = { output: 'Hello world' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: execResult }),
      });

      const input = {
        skill_id: VALID_UUID,
        input_params: { topic: 'AI' },
      };

      const result = await client.runSkill(input);

      expect(result).toEqual(execResult);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.contextforge.io/functions/v1/skill-execute');
      expect(callArgs[1].method).toBe('POST');

      // The client appends trigger_type: "mcp" to the body
      const sentBody = JSON.parse(callArgs[1].body);
      expect(sentBody.skill_id).toBe(input.skill_id);
      expect(sentBody.input_params).toEqual(input.input_params);
      expect(sentBody.trigger_type).toBe('mcp');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  ConfigSchema,
  IngestInputSchema,
  QueryInputSchema,
  CreateSpaceInputSchema,
  RelateInputSchema,
  DeleteInputSchema,
  ImportInputSchema,
} from '../src/types.js';

describe('ConfigSchema', () => {
  it('should validate a valid config', () => {
    const config = {
      apiKey: 'cf_live_test123',
      apiUrl: 'https://api.contextforge.io',
      defaultSpace: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should fail with missing apiKey', () => {
    const config = {
      apiUrl: 'https://api.contextforge.io',
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should use default apiUrl', () => {
    const config = {
      apiKey: 'cf_live_test123',
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://byzngcpqiqmqpxpmnhmo.supabase.co');
    }
  });

  it('should fail with invalid apiUrl', () => {
    const config = {
      apiKey: 'cf_live_test123',
      apiUrl: 'not-a-url',
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('IngestInputSchema', () => {
  it('should validate minimal input', () => {
    const input = {
      content: 'This is some content to ingest',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_type).toBe('manual');
      expect(result.data.tags).toEqual([]);
    }
  });

  it('should validate full input', () => {
    const input = {
      content: 'This is some content',
      title: 'My Document',
      source_type: 'url' as const,
      source_uri: 'https://example.com/doc',
      tags: ['javascript', 'tutorial'],
      category: 'documentation',
      space_id: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should fail with empty content', () => {
    const input = {
      content: '',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should fail with invalid source_type', () => {
    const input = {
      content: 'Some content',
      source_type: 'invalid',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should default related_paths to an empty array when omitted', () => {
    const input = {
      content: 'Some content',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.related_paths).toEqual([]);
    }
  });

  it('should coerce a JSON-encoded string related_paths into a real string[]', () => {
    // Some MCP clients send arrays as JSON-encoded strings instead of real arrays,
    // exactly like the `tags` field above — related_paths must be coerced the same way
    // before it reaches buildGitContext, or git_context.related_paths ends up a string.
    const input = {
      content: 'Some content',
      related_paths: '["src/api.ts", "src/auth"]',
    };

    const result = IngestInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.related_paths)).toBe(true);
      expect(result.data.related_paths).toEqual(['src/api.ts', 'src/auth']);
    }
  });
});

describe('QueryInputSchema', () => {
  it('should validate minimal input', () => {
    const input = {
      query: 'How do I authenticate?',
    };

    const result = QueryInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.min_score).toBe(0.3);
      expect(result.data.include_relationships).toBe(false);
    }
  });

  it('should validate full input with filters', () => {
    const input = {
      query: 'authentication methods',
      space_id: '123e4567-e89b-12d3-a456-426614174000',
      limit: 20,
      min_score: 0.7,
      filters: {
        tags: ['auth', 'security'],
        source_types: ['manual', 'url'],
        category: 'documentation',
      },
      include_relationships: true,
    };

    const result = QueryInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should fail with empty query', () => {
    const input = {
      query: '',
    };

    const result = QueryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should enforce limit bounds', () => {
    const input = {
      query: 'test',
      limit: 100,
    };

    const result = QueryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should enforce min_score bounds', () => {
    const input = {
      query: 'test',
      min_score: 1.5,
    };

    const result = QueryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('CreateSpaceInputSchema', () => {
  it('should validate minimal input', () => {
    const input = {
      name: 'My Project',
    };

    const result = CreateSpaceInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should validate full input', () => {
    const input = {
      name: 'My Project',
      description: 'A project for testing',
      settings: {
        auto_learning: false,
        git_sync_enabled: true,
      },
    };

    const result = CreateSpaceInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should fail with empty name', () => {
    const input = {
      name: '',
    };

    const result = CreateSpaceInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('RelateInputSchema', () => {
  it('should validate valid input', () => {
    const input = {
      source_id: '123e4567-e89b-12d3-a456-426614174000',
      target_id: '123e4567-e89b-12d3-a456-426614174001',
      relationship_type: 'references' as const,
    };

    const result = RelateInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBe(0.5);
      expect(result.data.bidirectional).toBe(false);
    }
  });

  it('should validate all relationship types', () => {
    const types = [
      'references', 'implements', 'extends', 'depends_on',
      'related_to', 'contradicts', 'supersedes', 'part_of',
      'similar_to', 'derived_from',
    ] as const;

    for (const type of types) {
      const input = {
        source_id: '123e4567-e89b-12d3-a456-426614174000',
        target_id: '123e4567-e89b-12d3-a456-426614174001',
        relationship_type: type,
      };

      const result = RelateInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should fail with invalid relationship type', () => {
    const input = {
      source_id: '123e4567-e89b-12d3-a456-426614174000',
      target_id: '123e4567-e89b-12d3-a456-426614174001',
      relationship_type: 'invalid',
    };

    const result = RelateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should fail with invalid UUID', () => {
    const input = {
      source_id: 'not-a-uuid',
      target_id: '123e4567-e89b-12d3-a456-426614174001',
      relationship_type: 'references',
    };

    const result = RelateInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('DeleteInputSchema', () => {
  it('should validate valid input', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = DeleteInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascade).toBe(false);
    }
  });

  it('should validate with cascade option', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      cascade: true,
    };

    const result = DeleteInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascade).toBe(true);
    }
  });
});

describe('ImportInputSchema', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  it('should validate with existing formats', () => {
    const formats = ['contextforge', 'markdown', 'notion', 'obsidian'] as const;
    for (const format of formats) {
      const result = ImportInputSchema.safeParse({ space_id: validUuid, format });
      expect(result.success).toBe(true);
    }
  });

  it('should validate claude_memory format', () => {
    const input = {
      space_id: validUuid,
      format: 'claude_memory',
      data: '## Section\nContent here',
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should validate knowledge_graph_jsonl format', () => {
    const input = {
      space_id: validUuid,
      format: 'knowledge_graph_jsonl',
      data: '{"type":"entity","name":"Test","entityType":"thing","observations":[]}',
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should validate chatgpt format', () => {
    const input = {
      space_id: validUuid,
      format: 'chatgpt',
      data: [{ title: 'Chat', mapping: {} }],
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject invalid format', () => {
    const input = {
      space_id: validUuid,
      format: 'invalid_format',
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should validate with direct items array', () => {
    const input = {
      space_id: validUuid,
      items: [{ content: 'Some content' }],
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should require space_id', () => {
    const input = {
      format: 'claude_memory',
      data: '## Test\nContent',
    };
    const result = ImportInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

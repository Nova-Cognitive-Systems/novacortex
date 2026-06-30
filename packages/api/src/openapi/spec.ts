import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
// Import paths to register all routes with the registry
import './paths.js';

export function generateOpenApiSpec(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'NovaCortex API',
      version: '1.0.0',
      description:
        'NovaCortex memory and knowledge API. Provides persistent memory storage, vector search, knowledge-base management, and multi-agent coordination.\n\n' +
        '**Authentication**: All protected endpoints require a Bearer token in the `Authorization` header.\n' +
        'Obtain a token via `POST /setup/exchange` (initial setup) or `POST /tokens` (after setup).',
      contact: {
        name: 'Nova Cognitive Systems LLC',
        url: 'https://github.com/Nova/novacortex',
      },
    },
    servers: [
      {
        url: `http://localhost:${process.env['PORT'] ?? 8080}`,
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Service health and readiness probes' },
      { name: 'Setup', description: 'Initial server setup and bootstrap code exchange' },
      { name: 'Auth', description: 'Token identity' },
      { name: 'Tokens', description: 'Token lifecycle management' },
      { name: 'Memories', description: 'CRUD operations on memory records' },
      { name: 'Search', description: 'Vector similarity search' },
      { name: 'Import / Export', description: 'Bulk import and export of memories' },
      { name: 'Namespaces', description: 'Namespace management' },
      { name: 'Processor', description: 'Background memory-processing scheduler' },
      { name: 'License', description: 'License activation and tier management' },
      { name: 'Federation', description: 'Cross-namespace read rules for agents (Pro+)' },
      { name: 'Knowledge', description: 'Document storage and access control' },
      { name: 'Agent Knowledge', description: 'Agent-scoped knowledge access (agent tokens)' },
      { name: 'Buckets', description: 'Shared knowledge buckets for agent groups' },
      { name: 'Admin', description: 'Administrative operations' },
      { name: 'Stats', description: 'Aggregate statistics' },
    ],
  });
}

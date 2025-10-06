# Data Persistence and Archival System

This document describes the comprehensive data persistence and archival system implemented for the Cloudflare AI Support Bot.

## Overview

The data persistence system provides:
- **Conversation Archiving**: Long-term storage of conversations in R2
- **Embedding Caching**: KV-based caching for AI embeddings
- **Query Result Caching**: Caching of frequent support queries
- **Backup and Recovery**: Automated backup creation and restoration
- **Data Retention Policies**: Configurable TTL and cleanup mechanisms

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Durable       │    │  Data           │    │  Cloudflare     │
│   Objects       │───▶│  Persistence    │───▶│  Storage        │
│   (Session)     │    │  Service        │    │  (R2 + KV)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Components

### 1. DataPersistenceService

The main service class that handles all persistence operations.

```typescript
const service = new DataPersistenceService(bindings, {
  conversationTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
  archiveRetention: 90 * 24 * 60 * 60 * 1000, // 90 days
  cleanupInterval: 60 * 60 * 1000, // 1 hour
  maxArchiveSize: 50 * 1024 * 1024 // 50MB
});
```

### 2. Storage Layout

#### R2 Storage Structure
```
conversations/
├── 2025/
│   ├── 01/
│   │   ├── archive_session1_timestamp.json
│   │   └── archive_session2_timestamp.json
│   └── 02/
│       └── archive_session3_timestamp.json
└── backups/
    ├── backup_id1/
    │   ├── manifest.json
    │   └── data.json
    └── backup_id2/
        ├── manifest.json
        └── data.json
```

#### KV Storage Keys
```
embedding:{hash}          - Cached embeddings
query:{hash}             - Cached query results
archive_meta:{sessionId} - Archive metadata
backup_manifest:{id}     - Backup manifests
```

## Usage Examples

### Basic Conversation Archiving

```typescript
import { DataPersistenceService } from './data_persistence';

const service = new DataPersistenceService(bindings);

// Archive a conversation
const archiveKey = await service.archiveConversation(memory, session);

// Retrieve archived conversation
const archived = await service.retrieveArchivedConversation(sessionId);

// List user's archived conversations
const archives = await service.listArchivedConversations(userId, 20);
```

### Embedding Caching

```typescript
// Cache an embedding
await service.cacheEmbedding(text, embedding, {
  source: 'knowledge_base',
  model: 'text-embedding-ada-002'
});

// Retrieve cached embedding
const cached = await service.getCachedEmbedding(text);
if (cached) {
  console.log('Cache hit!');
  return cached;
}
```

### Query Result Caching

```typescript
// Cache frequent query results
await service.cacheFrequentQuery(query, result, {
  confidence: 0.95,
  source: 'support_bot'
});

// Check cache before expensive operations
const cachedResult = await service.getCachedQueryResult(query);
if (cachedResult) {
  return cachedResult;
}
```

### Backup and Recovery

```typescript
// Create backup of multiple sessions
const sessionIds = ['session1', 'session2', 'session3'];
const backupId = await service.createBackup(sessionIds);

// Restore from backup
const restoredSessions = await service.restoreFromBackup(backupId);
console.log(`Restored ${restoredSessions.length} sessions`);
```

### Data Retention Management

```typescript
// Enforce retention policies (run periodically)
await service.enforceRetentionPolicy();

// This will:
// - Clean up expired cache entries
// - Remove old archives beyond retention period
// - Clean up old backups
```

## Integration with Durable Objects

The SessionMemoryDO class integrates with the persistence service:

```typescript
// Archive session when it ends
const archiveKey = await memoryDO.archiveSession();

// Restore session from archive
const restored = await memoryDO.restoreSession(sessionId);

// List archived conversations
const archives = await memoryDO.listArchivedConversations(userId);
```

## Configuration

### Retention Policies

```typescript
interface DataRetentionPolicy {
  conversationTTL: number;    // How long to keep active conversations
  cacheTTL: number;          // How long to keep cache entries
  archiveRetention: number;   // How long to keep archives
  cleanupInterval: number;    // How often to run cleanup
  maxArchiveSize: number;     // Maximum size per archive
}
```

### Environment Variables

Set these in your `wrangler.toml`:

```toml
[vars]
SESSION_TTL_HOURS = "24"
CACHE_TTL_HOURS = "24"
ARCHIVE_RETENTION_DAYS = "90"
CLEANUP_INTERVAL_HOURS = "1"
MAX_ARCHIVE_SIZE_MB = "50"
```

## Monitoring and Health Checks

### Health Check Endpoint

```typescript
import { DataPersistenceIntegration } from './data_persistence_integration';

const integration = new DataPersistenceIntegration(bindings);

// Health check
const health = await integration.healthCheck();
console.log(health);
// {
//   status: 'healthy',
//   details: {
//     r2_storage: 'healthy',
//     kv_cache: 'healthy',
//     timestamp: '2025-01-06T...'
//   }
// }
```

### Storage Metrics

```typescript
// Get storage metrics
const metrics = await integration.getStorageMetrics();
console.log(metrics);
// {
//   cache: {
//     embeddings: 150,
//     queries: 75,
//     archives_metadata: 25
//   },
//   storage: {
//     archived_conversations: 100,
//     backups: 5
//   }
// }
```

## Error Handling

The system implements comprehensive error handling:

### Graceful Degradation
- Archive failures don't prevent session cleanup
- Cache misses fall back to computation
- Storage errors are logged but don't crash the system

### Retry Mechanisms
- Automatic retries for transient failures
- Exponential backoff for rate limiting
- Circuit breaker pattern for persistent failures

### Data Integrity
- Checksums for backup verification
- Atomic operations where possible
- Rollback mechanisms for failed operations

## Performance Considerations

### Caching Strategy
- Hash-based keys for consistent lookups
- TTL-based expiration to prevent stale data
- Batch operations for bulk cache updates

### Storage Optimization
- Hierarchical R2 key structure for efficient listing
- Compressed JSON for large archives
- Metadata separation for quick lookups

### Memory Management
- Streaming for large archive operations
- Lazy loading of archive data
- Automatic cleanup of expired entries

## Security

### Data Protection
- No PII in cache keys (hashed)
- Encrypted storage (R2 encryption at rest)
- Access control through session validation

### Audit Trail
- All operations logged with request IDs
- Archive metadata includes timestamps
- Backup manifests track data lineage

## Testing

The system includes comprehensive tests:

```bash
# Run data persistence tests
npm test -- --run data_persistence.test.ts

# Run DO memory integration tests
npm test -- --run do_memory.test.ts
```

### Test Coverage
- Unit tests for all service methods
- Integration tests with mock Cloudflare bindings
- Error handling and edge case scenarios
- Performance and load testing scenarios

## Deployment

### Required Bindings

Ensure your `wrangler.toml` includes:

```toml
# R2 Storage for archives
[[r2_buckets]]
binding = "ARCHIVE_R2"
bucket_name = "cf-ai-supportbot-archives"

# KV Storage for caching
[[kv_namespaces]]
binding = "CHAT_KV"
id = "your-kv-namespace-id"
```

### Scheduled Tasks

Set up Cron Triggers for maintenance:

```toml
[[triggers.crons]]
cron = "0 */6 * * *"  # Every 6 hours
```

## Troubleshooting

### Common Issues

1. **Cache Misses**: Check TTL configuration and key hashing
2. **Archive Failures**: Verify R2 permissions and bucket configuration
3. **Memory Issues**: Monitor DO memory usage and implement cleanup
4. **Performance**: Use metrics to identify bottlenecks

### Debug Mode

Enable debug logging:

```typescript
const service = new DataPersistenceService(bindings, {
  // ... config
}, { debug: true });
```

## Future Enhancements

- **Compression**: Implement archive compression for storage efficiency
- **Encryption**: Add client-side encryption for sensitive data
- **Replication**: Cross-region backup replication
- **Analytics**: Advanced metrics and usage analytics
- **Migration**: Tools for data migration between environments

## API Reference

See the TypeScript interfaces in `workers/data_persistence.ts` for complete API documentation.
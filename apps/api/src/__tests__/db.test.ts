import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { v4 as uuid } from 'uuid';
import { execute, query, queryOne } from '../db/index.js';

/**
 * Sanity-test the test-DB plumbing:
 *  1. The pool connects to wbs_builder_test (NOT wbs_builder).
 *  2. We can write a row and read it back.
 *  3. Cleanup actually wipes test data.
 *
 * If these pass, the foundation is good and you can write feature tests
 * (e.g. "creating a project via POST /projects writes the right row").
 *
 * Note: every test uses a uuid()-prefixed organisation so concurrent or
 * leftover test data can't collide with other tests.
 */

// Plain UUID — the "id" column is VARCHAR(36) so a "test-" prefix would
// overflow. Collision with a real org is astronomically unlikely.
const TEST_ORG_ID = uuid();

describe('Test DB — sanity', () => {
  beforeAll(async () => {
    // Create a throwaway organisation to use as a foreign key target.
    await execute(
      "INSERT INTO organisations (id, name, slug, plan) VALUES (?, 'Test Org', ?, 'trial')",
      [TEST_ORG_ID, `test-org-${TEST_ORG_ID.slice(0, 8)}`],
    );
  });

  afterAll(async () => {
    // Wipe the throwaway org. Cascading FKs would handle child rows but we
    // delete them explicitly for clarity in case schemas drift.
    await execute('DELETE FROM projects WHERE org_id = ?', [TEST_ORG_ID]);
    await execute('DELETE FROM organisations WHERE id = ?', [TEST_ORG_ID]);
  });

  afterEach(async () => {
    // Each test cleans up its own projects under the test org so tests don't
    // see each other's leftover state.
    await execute('DELETE FROM projects WHERE org_id = ?', [TEST_ORG_ID]);
  });

  it('connects to a database whose name ends with _test', async () => {
    const row = await queryOne<{ db: string }>('SELECT DATABASE() AS db');
    expect(row?.db).toBeTruthy();
    expect(row!.db).toMatch(/_test$/);
  });

  it('can write and read a project row', async () => {
    const projectId = uuid();
    await execute(
      `INSERT INTO projects (id, org_id, name, client, project_type, raw_input, provider, status, created_by)
       VALUES (?, ?, 'Test Project', 'Test Client', 'web_app', 'raw', 'openai', 'draft', 'test-user')`,
      [projectId, TEST_ORG_ID],
    );

    const row = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM projects WHERE id = ?',
      [projectId],
    );
    expect(row).not.toBeNull();
    expect(row!.id).toBe(projectId);
    expect(row!.name).toBe('Test Project');
  });

  it('isolates tests — afterEach wipes data from previous tests', async () => {
    // If afterEach didn't run from the previous test, we'd see "Test Project"
    // here. We expect zero rows under our test org.
    const rows = await query<{ id: string }>('SELECT id FROM projects WHERE org_id = ?', [TEST_ORG_ID]);
    expect(rows).toHaveLength(0);
  });
});

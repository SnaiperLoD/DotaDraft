import './test-db-env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

const READ_TOKEN = 'integration-telemetry-token';

function event(name: string, sessionId: string) {
  return {
    name,
    ts: Date.now(),
    sessionId,
    visitorId: `visitor-${sessionId}`,
  };
}

describe('Telemetry HTTP (integration)', () => {
  let app: INestApplication;
  const previousToken = process.env.TELEMETRY_READ_TOKEN;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousToken === undefined) delete process.env.TELEMETRY_READ_TOKEN;
    else process.env.TELEMETRY_READ_TOKEN = previousToken;
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.TELEMETRY_READ_TOKEN;
    else process.env.TELEMETRY_READ_TOKEN = previousToken;
  });

  it('ingests a funnel batch and 404s the dump when the read token is unset', async () => {
    delete process.env.TELEMETRY_READ_TOKEN;
    const sessionId = `tel-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const ingest = await request(app.getHttpServer())
      .post('/telemetry')
      .send({ events: [event('session_start', sessionId)] })
      .expect(201);

    expect(ingest.body).toEqual({ ok: true });

    const dump = await request(app.getHttpServer()).get('/telemetry/funnel').expect(404);
    expect(dump.body.statusCode).toBe(404);
    expect(typeof dump.body.requestId).toBe('string');
    expect(dump.headers['x-request-id']).toBe(dump.body.requestId);
  });

  it('401s a wrong dump token and returns the snapshot on a match', async () => {
    process.env.TELEMETRY_READ_TOKEN = READ_TOKEN;
    const sessionId = `tel-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await request(app.getHttpServer())
      .post('/telemetry')
      .send({ events: [event('session_start', sessionId), event('draft_first_pick', sessionId)] })
      .expect(201);

    const denied = await request(app.getHttpServer())
      .get('/telemetry/funnel')
      .set('X-Telemetry-Read-Token', 'nope')
      .expect(401);
    expect(denied.body.statusCode).toBe(401);
    expect(typeof denied.body.requestId).toBe('string');

    const dump = await request(app.getHttpServer())
      .get('/telemetry/funnel')
      .set('X-Telemetry-Read-Token', READ_TOKEN)
      .expect(200);

    expect(dump.headers['cache-control']).toBe('no-store');
    expect(dump.body.events).toBeGreaterThanOrEqual(2);
    expect(dump.body.counts.session_start).toBeGreaterThanOrEqual(1);
    expect(dump.body.counts.draft_first_pick).toBeGreaterThanOrEqual(1);
    expect(dump.body.sessionsReached.session_start).toBeGreaterThanOrEqual(1);
  });

  it('returns the unified envelope for a malformed ingest batch', async () => {
    const res = await request(app.getHttpServer())
      .post('/telemetry')
      .send({ events: [{ name: 'hack', ts: 1, sessionId: 's', visitorId: 'v' }] })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toMatch(/invalid event name/i);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});

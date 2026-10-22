import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../http/context.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { catalogJson, listPublishedVersions } from './service.js';

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/catalog/versions', async (req) => {
    requireUser(req);
    return { versions: await listPublishedVersions(ctx.db) };
  });

  app.get('/api/catalog/versions/:id', async (req, reply) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    if (!z.uuid().safeParse(id).success) throw notFound('Catalog version');
    const { json, etag } = await catalogJson(ctx.db, id);
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate');
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.type('application/json; charset=utf-8').send(json);
  });
}
